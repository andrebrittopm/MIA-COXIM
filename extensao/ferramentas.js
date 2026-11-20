// ferramentas.js — o conjunto FECHADO de ações que a IA pode pedir.
// A IA nunca mexe no painel diretamente: ela pede uma ferramenta, e o código
// decide se executa direto ou se para e pede confirmação ao atendente.
//
// run(tab, input, ctx) / resumo(tab, input, ctx)
// ctx = { estab, gravar(id, campo, valor), progresso(texto), imagens: [{nome,tipo,dados}], registrarPedido(info) }
import * as P from './painel.js';
import { calcularReajuste, textoReajuste } from './precos.js';
import { montarPedido, enviarPedido } from './pedido.js';
import * as Hist from './historico.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function produto(tab, id) {
  const p = (await P.produtosAtuais(tab)).find(x => x.id === String(id));
  if (!p) throw new Error(`Produto ${id} não encontrado. Use buscar_produtos primeiro.`);
  return p;
}

export const FERRAMENTAS = [
  // ---------- leitura ----------
  {
    name: 'estabelecimento_atual',
    description: 'Diz em qual estabelecimento o painel está agora.',
    input_schema: { type: 'object', properties: {} },
    run: (tab) => P.estabelecimentoAtual(tab),
  },
  {
    name: 'listar_estabelecimentos',
    description: 'Lista os estabelecimentos parceiros. Use "busca" para filtrar pelo nome.',
    input_schema: { type: 'object', properties: { busca: { type: 'string' } } },
    run: (tab, i) => P.listarEstabelecimentos(tab, i.busca),
  },
  {
    name: 'buscar_produtos',
    description: 'Procura produtos do estabelecimento atual pelo nome ou categoria (aceita parte do nome, sem acento). Devolve id, nome, categoria, valor, estoque, ativo. Use SEMPRE antes de alterar um produto, para pegar o id certo. Se vier mais de um parecido, pergunte ao atendente qual é.',
    input_schema: { type: 'object', properties: { termo: { type: 'string' } }, required: ['termo'] },
    run: async (tab, i) => {
      const t = norm(i.termo).split(/\s+/).filter(Boolean);
      const achados = (await P.produtosAtuais(tab)).filter(p => t.every(w => norm(p.nome + ' ' + p.categoria).includes(w)));
      return achados.slice(0, 30);
    },
  },
  {
    name: 'listar_produtos',
    description: 'Lê todos os produtos do estabelecimento atual (sem descrições). Para cardápios grandes prefira buscar_produtos.',
    input_schema: { type: 'object', properties: {} },
    run: (tab) => P.produtosAtuais(tab),
  },
  {
    name: 'listar_niveis',
    description: 'Lê os níveis de cardápio do estabelecimento atual. Nível com Produto preenchido é "por produto"; sem produto é "por categoria".',
    input_schema: { type: 'object', properties: {} },
    run: (tab) => P.listarNiveis(tab),
  },

  // ---------- navegação ----------
  {
    name: 'trocar_estabelecimento',
    description: 'Troca o painel para outro estabelecimento, pelo nome EXATO (use listar_estabelecimentos antes).',
    input_schema: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] },
    sensivel: true,
    resumo: async (tab, i) => `Trocar o painel para o estabelecimento "${i.nome}".\nAtenção: outras abas do painel também mudam.`,
    run: (tab, i) => P.trocarEstabelecimento(tab, i.nome),
  },

  // ---------- gravação (todas pedem confirmação e ficam no histórico) ----------
  {
    name: 'alterar_preco',
    description: 'Muda o preço de UM produto. novo_valor em reais (ex.: 16.5).',
    input_schema: { type: 'object', properties: { produto_id: { type: 'string' }, novo_valor: { type: 'number' } }, required: ['produto_id', 'novo_valor'] },
    sensivel: true,
    resumo: async (tab, i, c) => { const p = await produto(tab, i.produto_id); return `💲 Mudar o preço de "${p.nome}"\nR$ ${p.valor} → R$ ${P.valorBR(i.novo_valor)}\n(${c.estab})`; },
    run: (tab, i, c) => c.gravar(i.produto_id, 'preco', Number(i.novo_valor)),
  },
  {
    name: 'pausar_ativar',
    description: 'Pausa (ativo=false) ou ativa (ativo=true) UM produto no app.',
    input_schema: { type: 'object', properties: { produto_id: { type: 'string' }, ativo: { type: 'boolean' } }, required: ['produto_id', 'ativo'] },
    sensivel: true,
    resumo: async (tab, i, c) => { const p = await produto(tab, i.produto_id); return `${i.ativo ? '▶ Ativar' : '⏸ Pausar'} "${p.nome}"\n(${c.estab})`; },
    run: (tab, i, c) => c.gravar(i.produto_id, 'ativo', !!i.ativo),
  },
  {
    name: 'ajustar_estoque',
    description: 'Define a quantidade em estoque de UM produto. 999999 = estoque "infinito" (padrão do painel). 0 = esgotado.',
    input_schema: { type: 'object', properties: { produto_id: { type: 'string' }, quantidade: { type: 'integer' } }, required: ['produto_id', 'quantidade'] },
    sensivel: true,
    resumo: async (tab, i, c) => { const p = await produto(tab, i.produto_id); return `📦 Estoque de "${p.nome}"\n${p.estoque} → ${i.quantidade}\n(${c.estab})`; },
    run: (tab, i, c) => c.gravar(i.produto_id, 'estoque', Number(i.quantidade)),
  },
  {
    name: 'alterar_descricao',
    description: 'Troca a descrição de UM produto. Escreva no estilo Mais Delivery (atrativa, com 1 a 3 emojis), só com informações reais; nunca invente ingredientes. Se o atendente ditou o texto exato, use o texto dele.',
    input_schema: { type: 'object', properties: { produto_id: { type: 'string' }, descricao: { type: 'string' } }, required: ['produto_id', 'descricao'] },
    sensivel: true,
    resumo: async (tab, i, c) => { const p = await produto(tab, i.produto_id); return `📝 Nova descrição de "${p.nome}":\n"${i.descricao}"\n(${c.estab})`; },
    run: (tab, i, c) => c.gravar(i.produto_id, 'descricao', i.descricao),
  },
  {
    name: 'renomear_produto',
    description: 'Troca o NOME de UM produto (ex.: corrigir erro de digitação ou padronizar CAIXA ALTA). Não acrescente palavras que o atendente não pediu.',
    input_schema: { type: 'object', properties: { produto_id: { type: 'string' }, novo_nome: { type: 'string' } }, required: ['produto_id', 'novo_nome'] },
    sensivel: true,
    resumo: async (tab, i, c) => { const p = await produto(tab, i.produto_id); return `🏷️ Renomear produto\n"${p.nome}" → "${i.novo_nome}"\n(${c.estab})`; },
    run: (tab, i, c) => c.gravar(i.produto_id, 'nome', i.novo_nome),
  },
  {
    name: 'marcar_bebida',
    description: 'Marca (bebida=true) ou desmarca (bebida=false) UM produto como bebida. A marcação avisa o entregador que o pedido tem bebida.',
    input_schema: { type: 'object', properties: { produto_id: { type: 'string' }, bebida: { type: 'boolean' } }, required: ['produto_id', 'bebida'] },
    sensivel: true,
    resumo: async (tab, i, c) => { const p = await produto(tab, i.produto_id); return `${i.bebida ? '🥤 Marcar como bebida' : '🍔 Tirar a marcação de bebida'}: "${p.nome}"\n(${c.estab})`; },
    run: (tab, i, c) => c.gravar(i.produto_id, 'bebida', !!i.bebida),
  },
  {
    name: 'reajustar_precos',
    description: 'Reajusta preços em lote, da loja toda ou de uma categoria. tipo "percentual" (valor 10 = +10%, -5 = -5%) ou "valor" (valor 2 = +R$ 2,00). arredondar: "90" (termina em ,90), "00" (inteiro), "50" (,00 ou ,50) ou "nao". Produtos com preço zero (preço pelos níveis) não mudam.',
    input_schema: { type: 'object', properties: {
      escopo: { type: 'string', enum: ['loja', 'categoria'] }, categoria: { type: 'string' },
      tipo: { type: 'string', enum: ['percentual', 'valor'] }, valor: { type: 'number' },
      arredondar: { type: 'string', enum: ['90', '00', '50', 'nao'] } }, required: ['escopo', 'tipo', 'valor'] },
    sensivel: true,
    resumo: async (tab, i, c) => {
      const lista = calcularReajuste(await P.produtosAtuais(tab), i);
      if (!lista.length) throw new Error('Nenhum produto seria alterado com esse reajuste (confira o nome da categoria).');
      return `💲 Reajuste de ${lista.length} produto(s) em ${c.estab}:\n${textoReajuste(lista)}`;
    },
    run: async (tab, i, c) => {
      const lista = calcularReajuste(await P.produtosAtuais(tab), i);
      const feitos = [], falhas = [];
      for (const [n, x] of lista.entries()) {
        c.progresso(`Reajustando ${n + 1}/${lista.length}: ${x.nome}`);
        try { feitos.push(await c.gravar(x.id, 'preco', x.depois)); } catch (e) { falhas.push({ produto: x.nome, erro: e.message }); }
      }
      return { alterados: feitos.length, falhas };
    },
  },
  {
    name: 'trocar_foto',
    description: 'Troca (ou adiciona) a foto de UM produto usando uma imagem que o atendente anexou na conversa. imagem = número da imagem anexada (1 = a primeira, na ordem em que foram enviadas; use a última se ele não disser). Só use imagem que o atendente mandou.',
    input_schema: { type: 'object', properties: { produto_id: { type: 'string' }, imagem: { type: 'integer' } }, required: ['produto_id'] },
    sensivel: true,
    resumo: async (tab, i, c) => {
      const p = await produto(tab, i.produto_id);
      const n = i.imagem || c.imagens.length;
      const img = c.imagens[n - 1];
      if (!img) throw new Error('Nenhuma imagem anexada na conversa. Peça ao atendente para anexar a foto (📎).');
      return `📷 ${'Trocar a foto'} de "${p.nome}" pela imagem "${img.nome}"\n(${c.estab})`;
    },
    run: (tab, i, c) => {
      const img = c.imagens[(i.imagem || c.imagens.length) - 1];
      return c.gravar(i.produto_id, 'foto', { b64: img.dados, tipo: img.tipo });
    },
  },
  {
    name: 'criar_produto',
    description: `Cadastra UM produto novo no estabelecimento atual. categoria = nome de uma categoria que o estabelecimento já tem (use listar_produtos para ver) ou o nome de uma categoria nova (no estilo com emoji, ex.: "🍟 FRITAS"). Descrição no estilo Mais Delivery. preco em reais; se o produto tem tamanhos com preços diferentes, use um nível tipo "substituir" e preco 0. Nunca invente preço: se não souber, pergunte.`,
    input_schema: { type: 'object', properties: {
      categoria: { type: 'string' }, nome: { type: 'string' }, descricao: { type: 'string' }, preco: { type: 'number' }, bebida: { type: 'boolean' },
      niveis: { type: 'array', items: { type: 'object', properties: {
        titulo: { type: 'string' }, min: { type: 'integer' }, max: { type: 'integer' }, tipo: { type: 'string', enum: ['somar', 'substituir'] },
        opcoes: { type: 'array', items: { type: 'object', properties: { nome: { type: 'string' }, preco: { type: 'number' } }, required: ['nome'] } } }, required: ['titulo', 'opcoes'] } },
      foto: { type: 'integer', description: 'número da imagem anexada para usar como foto (opcional)' },
    }, required: ['categoria', 'nome', 'preco'] },
    sensivel: true,
    resumo: async (tab, i, c) => {
      const niv = (i.niveis || []).map(n => `\n  • ${n.titulo}: ${n.opcoes.map(o => `${o.nome}${o.preco ? ' R$ ' + P.valorBR(o.preco) : ''}`).join(', ')}`).join('');
      const img = i.foto ? c.imagens[i.foto - 1] : null;
      if (i.foto && !img) throw new Error('A imagem indicada não foi anexada.');
      return `🆕 Cadastrar produto em ${c.estab}\n${i.nome} — R$ ${P.valorBR(i.preco)}\nCategoria: ${i.categoria}\n"${i.descricao || ''}"${niv}${img ? `\n📷 Foto: ${img.nome}` : ''}`;
    },
    run: (tab, i, c) => {
      const img = i.foto ? c.imagens[i.foto - 1] : null;
      return c.criar({ nome: i.nome, descricao: i.descricao || '', preco: Number(i.preco) || 0, bebida: !!i.bebida, niveis: i.niveis || [], foto: img ? { b64: img.dados, tipo: img.tipo } : null }, i.categoria);
    },
  },
  {
    name: 'lancar_pedido',
    description: `Lança um pedido no painel do estabelecimento atual. Os dados podem vir digitados, colados de uma conversa, de um print do WhatsApp ou da foto de um papel anotado. Extraia SOMENTE o que está escrito e chame esta ferramenta logo — ela mesma confere tudo no painel e devolve exatamente o que falta perguntar.
Regras:
- telefone é o principal: o cadastro é achado por ele e o nome do cadastro prevalece (não pergunte o nome se o telefone já tem cadastro).
- itens: liste os produtos e quantidades; o preço vem do cardápio automaticamente (NÃO pergunte se pode usar o preço do cardápio). Se o estabelecimento informou só o valor total, mande em valor_produtos (sem a taxa de entrega).
- Se não veio endereço e o cliente já tem endereço salvo, deixe rua/número vazios: a ferramenta usa ou lista os endereços salvos.
- forma_pagamento e situacao_pagamento ('pago' ou 'receber'): só preencha se estiver escrito; se faltar, a ferramenta pede.
- observacao: troco, observações do cliente.`,
    input_schema: { type: 'object', properties: {
      telefone: { type: 'string' }, nome: { type: 'string' }, entrega: { type: 'string', enum: ['delivery', 'retirada'] },
      bairro: { type: 'string' }, rua: { type: 'string' }, numero: { type: 'string' }, complemento: { type: 'string' }, referencia: { type: 'string' },
      itens: { type: 'array', items: { type: 'object', properties: { produto: { type: 'string' }, quantidade: { type: 'number' }, valor_unitario: { type: 'number' } }, required: ['produto'] } },
      valor_produtos: { type: 'number' }, taxa_print: { type: 'number' },
      forma_pagamento: { type: 'string' }, situacao_pagamento: { type: 'string', enum: ['pago', 'receber'] }, observacao: { type: 'string' },
    }, required: ['telefone'] },
    sensivel: true,
    resumo: async (tab, i, c) => {
      const m = await montarPedido(tab, c.estab, i);
      if (!m.ok) throw new Error('FALTA PERGUNTAR (pergunte tudo de uma vez, numa mensagem curta, e depois chame lancar_pedido de novo com os dados completos):\n- ' + m.problemas.join('\n- ') + (m.avisos.length ? '\nJá resolvido: ' + m.avisos.join(' ') : ''));
      // Proteção contra pedido em dobro (mesmo print mandado duas vezes): avisa na confirmação.
      const igual = (await Hist.listar()).find(h => h.campo === 'pedido' && h.estab === c.estab && Date.now() - h.quando < 20 * 60e3
        && String(h.nome || '').startsWith(Hist.primeiroNome(m.nome)) && Math.abs(Number(h.depois) - m.total) < 0.01);
      return igual ? `⚠️ ATENÇÃO: já lancei um pedido igual para ${Hist.primeiroNome(m.nome)} há ${Math.max(1, Math.round((Date.now() - igual.quando) / 60e3))} min (${igual.nome}). Confirme só se for um pedido NOVO.\n\n${m.resumo}` : m.resumo;
    },
    run: async (tab, i, c) => {
      const m = await montarPedido(tab, c.estab, i);
      if (!m.ok) throw new Error(m.problemas.join(' '));
      const r = await enviarPedido(tab, c.estab, m.envio);
      await c.registrarPedido({ nome: m.envio.dsNome, total: m.total, idPedido: r.idPedido });
      return { ...r, total: m.total, avisos: m.avisos };
    },
  },
];

export const porNome = Object.fromEntries(FERRAMENTAS.map(f => [f.name, f]));
export const paraAPI = FERRAMENTAS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
