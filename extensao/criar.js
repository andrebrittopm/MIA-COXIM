// criar.js — "Criar cardápio": lê foto/PDF/texto, monta o rascunho e grava em lote.
import { ESTILO_DESCRICAO, ESTILO_CATEGORIA } from './estilo.js';
import { categoriasEstab, criarCategoria, criarProduto, lojaAberta, limparTexto } from './cardapio.js';
import { buscarFotos, baixarB64, opcoesDoProduto, aplicarFotoOpcao } from './fotos.js';
import { paraNumero } from './painel.js';

// A IA às vezes devolve o preço como texto ("12,50", "R$ 12.50"): vira número, ou null se não der.
const preco = (v) => { if (v == null || v === '') return null; const n = paraNumero(v); return Number.isFinite(n) && n >= 0 ? n : null; };

const SIS = `Você é a MIA, da central Mais Delivery (${MIA.cidade} – ${MIA.uf}). Você transforma cardápios (foto, PDF ou texto) em dados para cadastrar no app.
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois. Português do Brasil.`;

const REGRAS_LEITURA = `Leia TODOS os itens do cardápio e devolva:
{"categorias":[{"nome":"nome da categoria","produtos":[{"nome":"...","info":"ingredientes/observações exatamente como no cardápio (ou vazio)","preco":12.5,"bebida":false,
  "app":true,"fora_motivo":"","foto":"termo curto em inglês para buscar foto do alimento",
  "niveis":[{"titulo":"Escolha o tamanho","min":1,"max":1,"tipo":"substituir","opcoes":[{"nome":"P","preco":12.99,"foto":"termo em inglês ou vazio"}]}],"duvida":"só se algo ficou ilegível ou ambíguo"}]}],
 "avisos":["coisas que o atendente precisa conferir"]}
Regras:
- Preço exatamente como está escrito (número com ponto: 12.5). Ilegível ou ausente → null e explique em "duvida". NUNCA invente preço.
- Produto com tamanhos de preços diferentes (P/M/G, 300ml/500ml, broto/grande) → UM produto com nível "Escolha o tamanho" (min 1, max 1, tipo "substituir", cada opção com seu preço) e preco 0.
- Adicionais/complementos com preço → nível "Adicionais" (min 0, max = quantidade de opções, tipo "somar") em cada produto a que se aplicam. Opções grátis para escolher (ex.: "escolha 2 acompanhamentos") → nível com min/max do cardápio e preço 0.
- Sabores de pizza, meio a meio e combinações complexas: não monte; descreva em "avisos".
- Nome do produto: o mesmo do cardápio, só arrumando para formato Título (ex.: "X-Salada Especial", "Coca-Cola 2 L"). Não acrescente palavras (nada de "Pastel de…" se não está escrito) e não ponha preço no nome.
- bebida = true para refrigerante, suco, água, cerveja, energético, drinks.
- Mantenha a ordem do cardápio. ${ESTILO_CATEGORIA}
- Itens repetidos em fotos diferentes: liste uma vez só.
- "app": false (e o motivo curto em "fora_motivo") para o que provavelmente NÃO vai para o delivery: refrigerante/cerveja com casco retornável, "só no local", "consumo no local", rodízio, buffet livre, self-service por quilo, bebida em dose/garrafa de bar, itens de festa/encomenda. Na dúvida, true.
- "foto": termo curto em inglês (2 a 4 palavras, sem marca) que ache uma foto bonita do produto (ex.: "pastel de carne" → "brazilian fried pastry"). Nas opções de nível, preencha "foto" só quando a opção é um alimento/bebida que dá para fotografar (sabor, adicional, bebida); para tamanhos (P/M/G), pontos e textos, deixe vazio.`;

async function iaJson(servidor, conteudo, maxTokens = 8000) {
  const dados = await servidor({ system: SIS, max_tokens: maxTokens, messages: [{ role: 'user', content: conteudo }] });
  const texto = dados.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const ini = texto.indexOf('{'), fim = texto.lastIndexOf('}');
  if (ini < 0) throw new Error('A IA não devolveu o formato esperado. Tente de novo.');
  try { return JSON.parse(texto.slice(ini, fim + 1)); }
  catch { throw new Error('O cardápio é grande demais para ler de uma vez. Mande em partes (uma foto/página por vez).'); }
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Junta as leituras de várias fotos, unindo categorias de mesmo nome e tirando produtos repetidos.
function juntar(leituras) {
  const cats = [], avisos = [];
  for (const l of leituras) {
    avisos.push(...(l.avisos || []));
    for (const c of l.categorias || []) {
      let alvo = cats.find(x => norm(x.nome) === norm(c.nome));
      if (!alvo) { alvo = { nome: c.nome, produtos: [] }; cats.push(alvo); }
      for (const p of c.produtos || []) {
        if (alvo.produtos.some(x => norm(x.nome) === norm(p.nome))) continue;
        p.preco = preco(p.preco);
        for (const n of p.niveis || []) for (const o of n.opcoes || []) o.preco = preco(o.preco) ?? 0;
        alvo.produtos.push(p);
      }
    }
  }
  return { categorias: cats, avisos };
}

// anexos: [{nome,tipo,dados}] (imagens já reduzidas; PDF em base64). texto: cardápio colado/digitado.
export async function lerCardapio({ servidor, anexos = [], texto = '', estab, progresso }) {
  const partes = [];
  for (const a of anexos) partes.push([a.tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: a.tipo, data: a.dados } }
    : { type: 'image', source: { type: 'base64', media_type: a.tipo, data: a.dados } }]);
  if (texto.trim()) partes.push([]);
  if (!partes.length) throw new Error('Mande uma foto, um PDF ou cole o cardápio em texto.');

  // 1) Leitura: uma chamada por foto/PDF (cabe no limite de resposta), 3 de cada vez.
  const leituras = new Array(partes.length);
  let feitas = 0;
  progresso(`Lendo o cardápio (0/${partes.length})…`, 10);
  const fila = partes.map((p, i) => i);
  async function trabalhador() {
    while (fila.length) {
      const i = fila.shift();
      const extra = texto.trim() && !partes[i].length ? `\nCardápio em texto:\n${texto}` : (texto.trim() ? `\nObservação do atendente: ${texto}` : '');
      leituras[i] = await iaJson(servidor, [...partes[i], { type: 'text', text: `Estabelecimento: ${estab}.\n${REGRAS_LEITURA}${extra}` }]);
      feitas++; progresso(`Lendo o cardápio (${feitas}/${partes.length})…`, 10 + Math.round(45 * feitas / partes.length));
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
  const rascunho = juntar(leituras);
  const todos = rascunho.categorias.flatMap(c => c.produtos.map(p => ({ c, p })));
  if (!todos.length) throw new Error('Não encontrei produtos nesse material. A foto está nítida?');

  // 2) Descrições no estilo Mais Delivery, em lotes de 25.
  const lotes = [];
  for (let i = 0; i < todos.length; i += 25) lotes.push(todos.slice(i, i + 25));
  let prontos = 0;
  progresso('A MIA está escrevendo as descrições…', 60);
  const filaD = [...lotes];
  async function escritor() {
    while (filaD.length) {
      const lote = filaD.shift();
      const r = await iaJson(servidor, `Escreva a descrição de cada produto para o app.
${ESTILO_DESCRICAO}
Formato: {"descricoes":["descrição do produto 1", "descrição do produto 2", ...]} na MESMA ordem e quantidade da lista.
Produtos: ${JSON.stringify(lote.map(({ c, p }) => ({ categoria: c.nome, nome: p.nome, info: p.info || '', tamanhos: (p.niveis || []).find(n => n.tipo === 'substituir')?.opcoes?.map(o => o.nome) })))}`, 6000);
      lote.forEach(({ p }, i) => { p.descricao = limparTexto(r.descricoes?.[i] || p.info || ''); });
      prontos += lote.length; progresso(`Descrições: ${prontos}/${todos.length}`, 60 + Math.round(35 * prontos / todos.length));
    }
  }
  await Promise.all([escritor(), escritor(), escritor()]);

  // 3) Fotos sugeridas (gratuitas): 4 opções para cada produto e 1 para cada opção de nível fotografável.
  const buscas = [];
  for (const { p } of todos) {
    p.incluir = p.app !== false;
    buscas.push(async () => { try { p.fotos = (await buscarFotos(p.foto || p.nome, 4)).map(f => ({ id: f.id, thumb: f.thumb })); } catch { p.fotos = []; } p.fotoEscolhida = p.fotos[0]?.id || null; });
    for (const n of p.niveis || []) for (const o of n.opcoes || []) if (o.foto) {
      buscas.push(async () => { try { const f = (await buscarFotos(o.foto, 1))[0]; if (f) { o.fotoId = f.id; o.thumb = f.thumb; } } catch {} });
    }
  }
  let fb = 0; const totalB = buscas.length;
  progresso('Procurando fotos bonitas…', 95);
  async function buscador() { while (buscas.length) { await buscas.shift()(); fb++; progresso(`Procurando fotos (${fb}/${totalB})…`, 95 + Math.round(4 * fb / Math.max(1, totalB))); } }
  await Promise.all([buscador(), buscador(), buscador(), buscador()]);
  return rascunho;
}

// Prepara a tela de revisão: diz quais categorias já existem no estabelecimento e se a loja está aberta.
export async function contextoRevisao(tab) {
  const [existentes, aberta] = await Promise.all([categoriasEstab(tab), lojaAberta(tab).catch(() => null)]);
  return { existentes, aberta };
}

// plano: { categorias: [{ nome, idExistente?, produtos: [{nome, descricao, preco, bebida, niveis, incluir}] }], ativo }
// Grava em lote. Cada produto criado vai para o histórico (Desfazer = excluir).
export async function gravarCardapio({ tab, estab, plano, progresso, registrar }) {
  const cats = plano.categorias.filter(c => c.produtos.some(p => p.incluir !== false));
  const total = cats.reduce((s, c) => s + c.produtos.filter(p => p.incluir !== false).length, 0);
  const feitos = [], pulados = [], falhas = [], categoriasNovas = [];
  let n = 0;
  for (const c of cats) {
    let idCategoria = c.idExistente, nomeCat = c.nome;
    try {
      if (!idCategoria) {
        progresso(`Criando a categoria ${c.nome}…`, n, total);
        const r = await criarCategoria(tab, estab, c.nome);
        idCategoria = r.id; if (r.nova) categoriasNovas.push(c.nome);
      } else nomeCat = c.nomeExistente || c.nome;
    } catch (e) {
      for (const p of c.produtos.filter(p => p.incluir !== false)) { falhas.push({ nome: p.nome, erro: e.message }); n++; }
      continue;
    }
    let ordem = 1;
    for (const p of c.produtos.filter(p => p.incluir !== false)) {
      progresso(`Cadastrando ${p.nome}…`, n, total);
      try {
        const temTamanho = (p.niveis || []).some(x => x.tipo === 'substituir');
        if (!temTamanho && !(Number(p.preco) > 0)) throw new Error('sem preço');
        let foto = null;
        if (plano.fotosProdutos !== false && p.fotoEscolhida) { try { foto = await baixarB64(p.fotoEscolhida); } catch {} }
        const niveis = (p.niveis || []).map(n => ({ ...n, opcoes: (n.opcoes || []).filter(o => o.incluir !== false) })).filter(n => n.opcoes.length);
        const r = await criarProduto(tab, estab, {
          nome: p.nome, descricao: plano.descricoes === false ? (p.info || '') : p.descricao, preco: temTamanho ? 0 : Number(p.preco), idCategoria, bebida: !!p.bebida,
          ativo: plano.ativo !== false, ordem: ordem++, niveis, foto,
          estoque: p.estoque !== '' && p.estoque != null ? Number(p.estoque) : (plano.estoque !== '' && plano.estoque != null ? Number(plano.estoque) : 999999),
        }, nomeCat);
        if (r.jaExistia) pulados.push(p.nome);
        else {
          feitos.push(r); await registrar(r);
          // Fotos das opções (depois que o painel criou as opções e deu um id para cada uma).
          const comFoto = niveis.flatMap(n => n.opcoes).filter(o => o.fotoId);
          if (plano.fotosOpcoes !== false && comFoto.length) {
            try {
              const ops = await opcoesDoProduto(tab, r.id);
              for (const o of comFoto) {
                const alvo = ops.find(x => norm(x.nome) === norm(o.nome) && !x.img);
                if (!alvo) continue;
                progresso(`Foto da opção ${o.nome}…`, n, total);
                try { await aplicarFotoOpcao(tab, estab, alvo.idOpcao, await baixarB64(o.fotoId), r.id); alvo.img = 'ok'; } catch {}
              }
            } catch {}
          }
        }
      } catch (e) { falhas.push({ nome: p.nome, erro: e.message }); }
      n++;
    }
  }
  progresso('Pronto!', total, total);
  return { feitos, pulados, falhas, categoriasNovas, total };
}
