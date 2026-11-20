// background.js — o "cérebro local" da MIA.
// Atende duas telas ao mesmo tempo: a Central (aba inteira) e o MAX flutuante
// dentro do painel. Cada tela tem sua própria conversa.
import './config.js'; // sempre o primeiro: define MIA (cidade, DDD, servidor…) para os módulos abaixo
import { porNome, paraAPI } from './ferramentas.js';
import { PAINEL, lerCardapioCompleto, estabelecimentoAtual, gravarCampo, produtosAtuais, paraNumero } from './painel.js';
import * as Hist from './historico.js';
import { calcularReajuste } from './precos.js';
import { verificar, nota, resumoParaIA } from './analise.js';
import { ESTILO_DESCRICAO, ESTILO_CATEGORIA } from './estilo.js';
import { lerCardapio, contextoRevisao, gravarCardapio } from './criar.js';
import { ordemEstrategica } from './ordem-produtos.js';
import { categoriasEstab, criarCategoria, criarProduto, excluirProduto, moverProduto, salvarOrdem } from './cardapio.js';
import { listarNiveis } from './painel.js';

// Clicar no ícone da extensão abre (ou foca) a Central.
chrome.action.onClicked.addListener(abrirCentral);
async function abrirCentral(tela) {
  // Uma janela só (mia.html) com a Central e o Marketing; o seletor do topo troca entre as duas.
  const url = chrome.runtime.getURL('mia.html');
  const destino = url + (typeof tela === 'string' && tela ? `#${tela}` : '');
  const [aberta] = await chrome.tabs.query({ url: url + '*' });
  if (aberta) { await chrome.tabs.update(aberta.id, { active: true, url: destino }); await chrome.windows.update(aberta.windowId, { focused: true }); }
  else await chrome.tabs.create({ url: destino });
}

const SISTEMA = `Você dá voz à dupla MIA & MAX, da central do Mais Delivery em ${MIA.cidade} – ${MIA.uf}. Os dois são raposas com o uniforme vermelho do Mais Delivery.
- MIA (Mais Inteligência Artificial): de óculos, analítica e caprichosa. Lê o cardápio, encontra problemas, explica e sugere.
- MAX: o entregador, rápido e animado. Confirma e executa as ações, dá os avisos e comemora.
Eles são parceiros que se completam e têm cumplicidade (um elogia ou provoca o outro de leve, "a gente forma um bom time"), sem romance explícito.

Formato das respostas:
- Cada fala começa com "MIA:" ou "MAX:" no início da linha. Use a MIA para análise e explicação; o MAX para ações feitas e próximos passos.
- Respostas curtas, em português do Brasil, tom alegre e direto. No máximo uma brincadeira entre os dois por resposta, e só quando couber; em erro ou assunto sério, vão direto ao ponto.

Você opera o painel administrativo usando SOMENTE as ferramentas disponíveis.

Regras:
- Nunca invente dados (preços, nomes, opções). Se faltar informação, pergunte.
- Antes de agir num estabelecimento, confira em qual o painel está (estabelecimento_atual). Se não for o pedido, use trocar_estabelecimento.
- Níveis de cardápio podem ser "por categoria" (valem para todos os produtos da categoria/subcategoria) ou "por produto".
- Produtos com sabores ou adicionais não podem ter níveis.
- Para alterar um produto: use buscar_produtos para achar o id. Se houver mais de um parecido, pergunte qual antes de alterar.
- As ferramentas de gravação já mostram um botão Confirmar ao atendente. NÃO peça confirmação por texto antes; chame a ferramenta direto.
- Preços em reais (ex.: 16.5). Estoque 999999 = sem controle de estoque; 0 = esgotado.
- Toda alteração fica no histórico e pode ser desfeita na Central (Histórico).
- Foto: quando o atendente anexar uma imagem e pedir para trocar/colocar a foto de um produto, use buscar_produtos e depois trocar_foto. A imagem anexada é numerada pela ordem de envio na conversa (1, 2, 3…).
- Pedido: os dados podem vir digitados, colados, em print do WhatsApp ou foto de papel. Leia com cuidado e chame lancar_pedido IMEDIATAMENTE com o que tiver (mesmo incompleto): a ferramenta confere no painel e diz exatamente o que falta. Só então pergunte, tudo numa mensagem curta. Nunca invente telefone, endereço ou valor. Não pergunte nome se o telefone já tem cadastro; não pergunte se pode usar o preço do cardápio. A MIA explica o que leu; o MAX lança.
- Produto novo: use criar_produto (um por vez). Para cardápio inteiro (foto/PDF/lista grande), indique a missão "Criar cardápio" da Central, que mostra uma tabela de revisão antes de gravar.
- Descrições e nomes de categoria SEMPRE no estilo abaixo.
${ESTILO_DESCRICAO}
${ESTILO_CATEGORIA}
- Na Central também existem as missões "Fotos automáticas" (acha produtos/opções sem foto e sugere fotos gratuitas), "Ranking dos parceiros" (nota de todos os cardápios) e o botão "Mensagem pro parceiro" (texto pronto pro WhatsApp). Indique-as quando fizer sentido.
- Ainda NÃO sabem: editar níveis de produtos que já existem, cancelar pedidos. Se pedirem, digam que chega nas próximas versões.
- Ao terminar uma tarefa, façam um resumo curto do que foi feito e do que ficou pendente.`;

// ---------- sessões (uma por tela conectada) ----------
chrome.runtime.onConnect.addListener(p => {
  if (p.name !== 'mia') return;
  const s = {
    porta: p,
    historico: [],
    imagens: [], // imagens anexadas nesta conversa (para trocar foto)
    confirmar: null,
    // O MAX flutuante trabalha sempre na aba em que está; a Central usa a última aba do painel.
    tabFixa: p.sender?.tab?.url?.startsWith(PAINEL) ? p.sender.tab.id : null,
    enviar: (m) => { try { p.postMessage(m); } catch {} },
  };
  p.onMessage.addListener(async msg => {
    // Perfil Marketing: só as mensagens da aba Marketing. O painel fica fora do alcance.
    if (!MSG_MARKETING.has(msg.tipo) && (await chrome.storage.local.get('perfil')).perfil === 'marketing') {
      return s.enviar({ tipo: 'falha', texto: 'Seu código é do Marketing: aqui você usa só o quadro de Marketing.' });
    }
    if (msg.tipo === 'perfil') await atualizarPerfil(s);
    if (msg.tipo === 'mkt_sugerir') await mktSugerir(s);
    if (msg.tipo === 'mkt_escrever') await mktEscrever(s, msg);
    if (msg.tipo === 'comando') await processar(s, msg.texto, msg.anexos || []);
    if (msg.tipo === 'varredura') await varredura(s);
    if (msg.tipo === 'melhorias') await melhorias(s);
    if (msg.tipo === 'abrir_central') await abrirCentral(msg.tela);
    if (msg.tipo === 'qual_estab') {
      try { s.enviar({ tipo: 'estab', ...(await estabelecimentoAtual(await abaDoPainel(s))) }); }
      catch (e) { s.enviar({ tipo: 'estab', atual: null, erro: e.message }); }
    }
    if (msg.tipo === 'historico') s.enviar({ tipo: 'historico', lista: await Hist.listar() });
    if (msg.tipo === 'desfazer') await desfazer(s, msg.uid);
    if (msg.tipo === 'aplicar') await aplicar(s, msg.itens, msg.estab, msg.rotulo);
    if (msg.tipo === 'desfazer_lote') await desfazerLote(s, msg.lote);
    if (msg.tipo === 'reajuste_preview') {
      try { const tab = await abaDoPainel(s); const estab = (await estabelecimentoAtual(tab)).atual; const produtos = await produtosAtuais(tab);
        s.enviar({ tipo: 'reajuste_preview', estab, categorias: [...new Set(produtos.map(p => p.categoria))], lista: calcularReajuste(produtos, msg.params) }); }
      catch (e) { s.enviar({ tipo: 'falha', texto: e.message }); }
    }
    if (msg.tipo === 'produtos') {
      try { const tab = await abaDoPainel(s); s.enviar({ tipo: 'produtos', estab: (await estabelecimentoAtual(tab)).atual, lista: await produtosAtuais(tab) }); }
      catch (e) { s.enviar({ tipo: 'falha', texto: e.message }); }
    }
    if (msg.tipo === 'criar_ler') await criarLer(s, msg);
    if (msg.tipo === 'criar_gravar') await criarGravar(s, msg);
    if (msg.tipo === 'ordem_aplicar') await ordemAplicar(s, msg);
    if (msg.tipo === 'categoria_renomear') await categoriaRenomear(s, msg);
    if (msg.tipo === 'fotos_buscar') await fotosBuscar(s, msg);
    if (msg.tipo === 'fotos_mais') await fotosMais(s, msg);
    if (msg.tipo === 'fotos_aplicar') await fotosAplicar(s, msg);
    if (msg.tipo === 'ranking_rodar') await rankingRodar(s);
    if (msg.tipo === 'ranking_cancelar' && s.controleRanking) s.controleRanking.cancelado = true;
    if (msg.tipo === 'ranking_ultimo') s.enviar({ tipo: 'ranking_ultimo', rankings: await ultimosRankings() });
    if (msg.tipo === 'mensagem_parceiro') await mensagemParceiro(s, msg);
    if (msg.tipo === 'sugeridos_aplicar') await sugeridosAplicar(s, msg);
    if (msg.tipo === 'combo_criar') await comboCriar(s, msg);
    if (msg.tipo === 'confirmacao' && s.confirmar) { s.confirmar(msg.ok); s.confirmar = null; }
    if (msg.tipo === 'limpar') { s.historico = []; s.imagens = []; }
  });
  p.onDisconnect.addListener(() => { if (s.confirmar) { s.confirmar(false); s.confirmar = null; } });
});

const MSG_MARKETING = new Set(['perfil', 'mkt_sugerir', 'mkt_escrever', 'abrir_central', 'limpar', 'confirmacao']);

async function abaDoPainel(s) {
  if (s.tabFixa) return s.tabFixa;
  const abas = await chrome.tabs.query({ url: PAINEL + '*' });
  if (!abas.length) throw new Error('Abra o painel do Mais Delivery numa aba do Chrome e faça login.');
  abas.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return abas[0].id;
}

const SERVIDOR_PADRAO = MIA.servidor;
async function servidor(corpo) {
  const { servidor = SERVIDOR_PADRAO, codigo } = await chrome.storage.local.get(['servidor', 'codigo']);
  if (!servidor || !codigo) throw new Error('Configure o endereço do servidor e o seu código de acesso na Central (⚙).');
  // Tempo limite (a IA pode levar ~1 min em cardápio grande) e 1 nova tentativa se a rede cair ou o serviço estiver sobrecarregado.
  for (let tentativa = 1; ; tentativa++) {
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), 150000);
    let r;
    try {
      r = await fetch(servidor.replace(/\/$/, '') + '/mensagem', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-codigo-mia': codigo },
        body: JSON.stringify(corpo),
      });
    } catch (e) {
      clearTimeout(relogio);
      if (tentativa < 2 && e.name !== 'AbortError') { await new Promise(x => setTimeout(x, 2000)); continue; }
      throw new Error(e.name === 'AbortError' ? 'O servidor da MIA demorou demais para responder (mais de 2 min). Tente de novo.' : 'Sem conexão com o servidor da MIA. Confira a internet e tente de novo.');
    }
    clearTimeout(relogio);
    const dados = await r.json().catch(() => ({}));
    if (((r.status === 429 && !dados.limite) || r.status === 529 || r.status >= 502) && tentativa < 2) { await new Promise(x => setTimeout(x, 3000)); continue; }
    if (!r.ok) throw new Error(dados.erro || `Servidor respondeu ${r.status}`);
    return dados;
  }
}

// ---------- gravação com histórico ----------
function pedirConfirmacao(s, texto) {
  return new Promise(res => { s.confirmar = res; s.enviar({ tipo: 'confirmar', texto }); });
}

// O estabelecimento é anotado no momento da confirmação; toda gravação confere de novo.
async function contexto(s, tab) {
  const { atual } = await estabelecimentoAtual(tab);
  return {
    estab: atual,
    imagens: s.imagens,
    progresso: (texto) => s.enviar({ tipo: 'status', texto }),
    registrarPedido: async (info) => {
      const { codigo = '' } = await chrome.storage.local.get('codigo');
      // LGPD: no histórico fica só o primeiro nome do cliente (o pedido completo está no painel).
      const reg = await Hist.registrar({ id: info.idPedido || '', nome: Hist.primeiroNome(info.nome) + (info.idPedido ? ` · pedido #${info.idPedido}` : ''), campo: 'pedido', antes: '', depois: info.total, estab: atual }, codigo.split('-')[0]);
      s.enviar({ tipo: 'alterado', alteracao: reg });
    },
    gravar: async (id, campo, valor, lista, lote) => {
      if (!atual || atual === 'Gerencial') throw new Error('Escolha um estabelecimento antes de alterar produtos.');
      esquecerCardapio();
      const alt = await gravarCampo(tab, atual, id, campo, valor, lista);
      const { codigo = '' } = await chrome.storage.local.get('codigo');
      const reg = await Hist.registrar({ ...alt, estab: atual, ...(lote || {}) }, codigo.split('-')[0]);
      s.enviar({ tipo: 'alterado', alteracao: reg });
      return alt;
    },
    // Cria um produto (pela conversa). Categoria pelo nome: usa a do estabelecimento ou cria nova.
    criar: async (p, nomeCategoria) => {
      if (!atual || atual === 'Gerencial') throw new Error('Escolha um estabelecimento antes de criar produtos.');
      esquecerCardapio();
      const cat = await acharOuCriarCategoria(tab, atual, nomeCategoria);
      const r = await criarProduto(tab, atual, { ...p, idCategoria: cat.id }, cat.nome);
      if (r.jaExistia) throw new Error(`"${r.nome}" já existe em ${r.categoria}.`);
      await registrarCriado(s, atual, r);
      return { ...r, categoriaNova: cat.nova };
    },
  };
}

const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export async function acharOuCriarCategoria(tab, estab, nome) {
  const existe = (await categoriasEstab(tab)).find(c => normal(c.nome) === normal(nome));
  if (existe) return { ...existe, nova: false };
  const r = await criarCategoria(tab, estab, nome);
  return { id: r.id, nome: nome.trim(), nova: r.nova };
}

async function quemSou() { const { codigo = '' } = await chrome.storage.local.get('codigo'); return codigo.split('-')[0]; }
async function registrarCriado(s, estab, r, lote) {
  const reg = await Hist.registrar({ id: r.id, nome: r.nome, campo: 'criado', antes: '', depois: r.categoria, estab, ...(lote || {}) }, await quemSou());
  s.enviar({ tipo: 'alterado', alteracao: reg });
}

const novoLote = () => 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const desfazendo = new Set(); // evita desfazer duas vezes a mesma alteração (clique duplo)
async function desfazer(s, uid) {
  if (desfazendo.has(uid)) return;
  desfazendo.add(uid);
  try {
    const alt = await desfazerUm(s, uid);
    s.enviar({ tipo: 'desfeito', uid, alteracao: alt });
  } catch (e) { s.enviar({ tipo: 'falha_leve', texto: e.message }); }
  finally { desfazendo.delete(uid); }
}

// Desfaz um lote inteiro (reajuste, "aplicar em todos", cardápio criado), do mais novo para o mais antigo.
// O que não der (alterado de novo depois, produto apagado) fica listado; o resto volta.
async function desfazerLote(s, lote) {
  if (!lote || desfazendo.has(lote)) return;
  desfazendo.add(lote);
  const feitos = [], falhas = [];
  try {
    const itens = (await Hist.listar()).filter(a => a.lote === lote && !a.desfeito && a.campo !== 'pedido');
    for (const [n, a] of itens.entries()) {
      s.enviar({ tipo: 'progresso_desfazer', lote, feito: n, total: itens.length, nome: a.nome });
      try { await desfazerUm(s, a.uid); feitos.push(a.nome); }
      catch (e) {
        falhas.push({ nome: a.nome, erro: e.message });
        if (/Para desfazer, abra o estabelecimento|Trava de segurança|sessão expirada|Tabela não encontrada/i.test(e.message)) {
          if (itens.length - n - 1 > 0) falhas.push({ nome: `Mais ${itens.length - n - 1} item(ns) não desfeito(s)`, erro: 'Parei por segurança.' });
          break;
        }
      }
    }
    s.enviar({ tipo: 'lote_desfeito', lote, feitos, falhas });
  } catch (e) { s.enviar({ tipo: 'falha_leve', texto: e.message }); }
  finally { desfazendo.delete(lote); }
}

// Núcleo do Desfazer: confere tudo, volta o valor de antes e marca no histórico. Lança erro se não puder.
async function desfazerUm(s, uid) {
  {
    const alt = await Hist.buscar(uid);
    if (!alt || alt.desfeito) throw new Error('Essa alteração já foi desfeita (ou não existe mais).');
    const tab = await abaDoPainel(s);
    const { atual } = await estabelecimentoAtual(tab);
    if (alt.campo === 'pedido') throw new Error('Pedido lançado não se desfaz por aqui: para cancelar, use a tela de Pedidos do painel (ela pede o motivo).');
    if (atual !== alt.estab) throw new Error(`Para desfazer, abra o estabelecimento "${alt.estab}" no painel (agora está em "${atual}").`);
    if (['preco', 'ativo', 'estoque', 'posicao'].includes(alt.campo)) {
      // Se o produto mudou de novo depois (outra pessoa, outra tela, reajuste), desfazer apagaria a mudança mais nova.
      const q = (await produtosAtuais(tab)).find(x => x.id === String(alt.id));
      if (!q) throw new Error(`O produto "${alt.nome}" não existe mais neste estabelecimento.`);
      const agora = alt.campo === 'preco' ? paraNumero(q.valor) : alt.campo === 'ativo' ? q.ativo : alt.campo === 'posicao' ? Number(q.ordem) : Number(q.estoque);
      const esperado = alt.campo === 'preco' ? paraNumero(alt.depois) : alt.campo === 'ativo' ? !!alt.depois : Number(alt.depois);
      const mesmo = alt.campo === 'preco' ? Math.abs(agora - esperado) < 0.005 : agora === esperado;
      if (!mesmo) throw new Error(`"${alt.nome}" já foi alterado de novo depois disso (agora: ${alt.campo === 'preco' ? 'R$ ' + q.valor : alt.campo === 'ativo' ? (q.ativo ? 'ativo' : 'pausado') : alt.campo === 'posicao' ? q.ordem + 'º na categoria' : 'estoque ' + q.estoque}). Desfazer apagaria a mudança mais nova; ajuste direto, se precisar.`);
    }
    esquecerCardapio();
    if (alt.campo === 'criado') await excluirProduto(tab, alt.estab, alt.id);
    else if (alt.campo === 'sugeridos') {
      if ((alt.antes || []).length >= 3) await aplicarSugeridos(tab, alt.estab, alt.id, alt.antes);
      else await removerSugeridos(tab, alt.estab, alt.id, (await lerSugeridos(tab, alt.id)).filter(x => !(alt.antes || []).includes(x)));
    }
    else if (alt.campo === 'foto_opcao') {
      if (!alt.antes) throw new Error('Essa opção não tinha foto antes. Para tirar a nova, troque por outra imagem.');
      const blob = await fetch(alt.antes).then(r => { if (!r.ok) throw new Error('Não consegui baixar a foto antiga.'); return r.blob(); });
      const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
      await aplicarFotoOpcao(tab, alt.estab, alt.id, { b64, tipo: blob.type || 'image/jpeg' }, alt.idCardapio);
    }
    else if (alt.campo === 'ordem') await salvarOrdem(tab, alt.estab, alt.antes);
    else if (alt.campo === 'categoria') {
      for (const id of alt.produtos) await moverProduto(tab, alt.estab, id, alt.antes.id);
      if (alt.ordemAntes) await salvarOrdem(tab, alt.estab, alt.ordemAntes).catch(() => {});
    } else if (alt.campo === 'foto') {
      if (!alt.antes) throw new Error('Esse produto não tinha foto antes. Para tirar a foto nova, troque por outra imagem.');
      const blob = await fetch(alt.antes).then(r => { if (!r.ok) throw new Error('Não consegui baixar a foto antiga.'); return r.blob(); });
      const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
      await gravarCampo(tab, alt.estab, alt.id, 'foto', { b64, tipo: blob.type || 'image/jpeg' });
    } else await gravarCampo(tab, alt.estab, alt.id, alt.campo, alt.antes);
    await Hist.marcarDesfeito(uid);
    return alt;
  }
}

// Botão "Aplicar" das telas (o atendente já confirmou na tela).
async function aplicar(s, itens, estabEsperado, rotulo) {
  try {
    const tab = await abaDoPainel(s);
    const ctx = await contexto(s, tab);
    if (estabEsperado && ctx.estab !== estabEsperado) throw new Error(`Essas sugestões são do "${estabEsperado}", mas o painel está em "${ctx.estab}". Nada foi alterado.`);
    const feitos = [], falhas = [];
    // Lote grande: lê a lista de produtos uma vez só (antes eram 2 leituras completas por produto).
    const lista = itens.length > 3 && itens.every(x => ['preco', 'ativo', 'estoque', 'posicao'].includes(x.campo)) ? await produtosAtuais(tab) : undefined;
    // Vários itens de uma vez = um lote no Histórico (dá para desfazer todos com 1 clique).
    const lote = itens.length > 1 ? { lote: novoLote(), loteNome: String(rotulo || 'Alterações em lote').slice(0, 80) } : undefined;
    for (const [n, x] of itens.entries()) {
      s.enviar({ tipo: 'progresso_aplicar', feito: n, total: itens.length, nome: x.nome || '' });
      try { feitos.push(await ctx.gravar(x.id, x.campo, x.valor, lista, lote)); }
      catch (e) {
        falhas.push({ nome: x.nome || x.id, erro: e.message });
        // Erro geral (trocou de estabelecimento, sessão caiu): para aqui em vez de falhar produto por produto.
        if (/Trava de segurança|sessão expirada|Tabela não encontrada|Escolha um estabelecimento/i.test(e.message)) {
          const resto = itens.length - n - 1;
          if (resto > 0) falhas.push({ nome: `Mais ${resto} produto(s) não alterado(s)`, erro: 'Parei por segurança. Confira o painel e aplique de novo: os que já foram feitos não mudam.' });
          break;
        }
      }
    }
    s.enviar({ tipo: 'aplicado', feitos, falhas });
  } catch (e) { s.enviar({ tipo: 'aplicado', feitos: [], falhas: [{ nome: 'Nada foi alterado', erro: e.message }], erro: e.message }); }
}

// ---------- chat com ferramentas ----------
// Mais leve: fotos e PDFs só seguem nas últimas mensagens; nas antigas viram um lembrete curto (a IA já leu).
function semImagensAntigas(hist) {
  const corte = hist.length - 4;
  return hist.map((m, i) => (i >= corte || m.role !== 'user' || !Array.isArray(m.content)) ? m
    : { ...m, content: m.content.map(b => (b.type === 'image' || b.type === 'document') ? { type: 'text', text: '[anexo já lido antes]' } : b) });
}
const TOOLS_CACHE = paraAPI.map((t, i) => i === paraAPI.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t);
async function processar(s, texto, anexos) {
  // Um comando por vez: dois ao mesmo tempo misturam a conversa (a IA perde o par pergunta/resposta das ferramentas).
  if (s.processando) return s.enviar({ tipo: 'erro', texto: 'Calma, ainda estou terminando o pedido anterior. Manda de novo em seguida. ⏳' });
  s.processando = true;
  try { await processarAgora(s, texto, anexos); } finally { s.processando = false; }
}
async function processarAgora(s, texto, anexos) {
  for (const a of anexos) if (a.tipo !== 'application/pdf') s.imagens.push({ nome: a.nome, tipo: a.tipo, dados: a.dados });
  if (anexos.some(a => a.tipo !== 'application/pdf')) texto += `\n[imagens anexadas nesta conversa até agora: ${s.imagens.map((x, i) => `${i + 1}=${x.nome}`).join(', ')}]`;
  s.historico.push({ role: 'user', content: [
    ...anexos.map(a => a.tipo === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: a.tipo, data: a.dados } }
      : { type: 'image', source: { type: 'base64', media_type: a.tipo, data: a.dados } }),
    { type: 'text', text: texto },
  ] });
  s.enviar({ tipo: 'status', texto: 'Pensando…' });
  const tamanhoAntes = s.historico.length - 1;

  try {
    const tab = await abaDoPainel(s);
    for (let passo = 0; passo < 25; passo++) {
      // cache_control: o texto fixo (regras + ferramentas) fica em cache na Anthropic → ~90% mais barato a partir da 2ª mensagem.
      const resp = await servidor({ system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }], tools: TOOLS_CACHE, messages: semImagensAntigas(s.historico) });
      s.historico.push({ role: 'assistant', content: resp.content });
      for (const b of resp.content) if (b.type === 'text' && b.text.trim()) s.enviar({ tipo: 'resposta', texto: b.text });
      if (resp.stop_reason !== 'tool_use') break;

      const resultados = [];
      for (const b of resp.content.filter(b => b.type === 'tool_use')) {
        const f = porNome[b.name];
        let saida;
        try {
          if (!f) throw new Error('Ferramenta inexistente.');
          const ctx = await contexto(s, tab);
          if (f.sensivel && !(await pedirConfirmacao(s, await f.resumo(tab, b.input || {}, ctx)))) {
            saida = { cancelado: true, motivo: 'O atendente não confirmou.' };
          } else {
            s.enviar({ tipo: 'status', texto: `Executando: ${b.name}…` });
            saida = await f.run(tab, b.input || {}, ctx);
          }
        } catch (e) { saida = { erro: e.message }; }
        resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(saida).slice(0, 60000) });
      }
      s.historico.push({ role: 'user', content: resultados });
      if (passo === 24) s.enviar({ tipo: 'erro', texto: 'Essa tarefa ficou longa demais e eu parei por segurança. Confira o Histórico e me peça o que faltou.' });
    }
  } catch (e) {
    s.historico.length = tamanhoAntes; // desfaz a rodada que falhou, para a conversa não "quebrar"
    s.enviar({ tipo: 'erro', texto: e.message });
  }
  s.enviar({ tipo: 'status', texto: '' });
}

// ---------- missões (Varredura e Melhorias) ----------
async function iaJson(sistema, pedido, maxTokens = 8000) {
  const dados = await servidor({ system: sistema, max_tokens: maxTokens, messages: [{ role: 'user', content: pedido }] });
  const texto = dados.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const ini = texto.indexOf('{'), fim = texto.lastIndexOf('}');
  if (ini < 0) throw new Error('A IA não devolveu o formato esperado. Tente de novo.');
  try { return JSON.parse(texto.slice(ini, fim + 1)); }
  catch { throw new Error(dados.stop_reason === 'max_tokens' ? 'A resposta da IA veio cortada (cardápio grande). Tente de novo.' : 'A IA devolveu uma resposta incompleta. Tente de novo.'); }
}

// Guarda o cardápio lido por 5 min (Varredura → Melhorias não lê tudo de novo). Qualquer gravação limpa.
let cacheCardapio = null;
export const esquecerCardapio = () => { cacheCardapio = null; };
async function prepararCardapio(s) {
  const tab = await abaDoPainel(s);
  const { atual } = await estabelecimentoAtual(tab);
  if (!atual || atual === 'Gerencial') throw new Error('MAX_GERENCIAL');
  if (cacheCardapio?.estab === atual && Date.now() - cacheCardapio.em < 5 * 60e3) {
    s.enviar({ tipo: 'progresso', etapa: 'Cardápio já lido há pouco ⚡', pct: 65 });
    return { atual, cardapio: cacheCardapio.cardapio };
  }
  s.enviar({ tipo: 'progresso', etapa: 'Lendo os produtos…', pct: 5 });
  const cardapio = await lerCardapioCompleto(tab, (f, t) =>
    s.enviar({ tipo: 'progresso', etapa: `Lendo descrições (${f}/${t})…`, pct: 5 + Math.round(60 * f / t) }));
  if (!cardapio.produtos.length) throw new Error('Este estabelecimento ainda não tem produtos cadastrados.');
  cacheCardapio = { estab: atual, em: Date.now(), cardapio };
  return { atual, cardapio };
}

// Guarda o último resultado para a outra tela poder abrir sem refazer.
const guardar = (chave, valor) => chrome.storage.session.set({ [chave]: { ...valor, em: Date.now() } });

const SIS_ANALISTA = `Você é a MIA, a analista de cardápios da dupla MIA & MAX, da central Mais Delivery (${MIA.cidade} – ${MIA.uf}).
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois.
Nunca invente produtos, preços ou ingredientes que não estejam nos dados. Escreva em português do Brasil.`;

async function varredura(s) {
  try {
    const { atual, cardapio } = await prepararCardapio(s);
    const problemas = verificar(cardapio);
    s.enviar({ tipo: 'progresso', etapa: 'Procurando erros de digitação…', pct: 75 });
    try {
      const textos = {
        produtos: cardapio.produtos.map(p => ({ id: p.id, nome: p.nome, desc: p.descricao || undefined })),
        categorias: [...new Set(cardapio.produtos.map(p => p.categoria))],
        niveis: cardapio.niveis.map(n => n.titulo),
      };
      const r = await iaJson(SIS_ANALISTA,
        `Procure APENAS erros de ortografia, acentuação ou digitação nos textos abaixo. Ignore escolhas de estilo (caixa alta, abreviações comuns como "c/" e "ml"). Ignore nomes próprios e marcas.
Formato: {"erros":[{"onde":"produto|descrição|categoria|nível","id":"id do produto (quando onde = produto ou descrição)","texto":"trecho errado, exatamente como está","correcao":"trecho corrigido"}]}
Dados: ${JSON.stringify(textos)}`, 4000);
      const erros = (r.erros || []).filter(e => e?.texto && e.correcao && e.texto !== e.correcao);
      if (erros.length) problemas.unshift({ nivel: 'erro', titulo: 'Erros de digitação', detalhe: 'Encontrados pela MIA. Confira o texto corrigido e clique em Corrigir.',
        itens: erros.map(e => `${e.onde}: "${e.texto}" → "${e.correcao}"`),
        // Botão Corrigir: só para nome e descrição de produto (categoria e nível se corrigem no painel).
        acoes: erros.map(e => {
          const p = cardapio.produtos.find(x => String(x.id) === String(e.id));
          const campo = /desc/i.test(e.onde) ? 'descricao' : /produto/i.test(e.onde) ? 'nome' : null;
          const atual = campo === 'descricao' ? p?.descricao : p?.nome;
          if (!p || !campo || !atual || !atual.includes(e.texto)) return null;
          return { tipo: 'texto', id: p.id, nome: p.nome, campo, valor: atual.split(e.texto).join(e.correcao) };
        }) });
    } catch (e) {
      problemas.push({ nivel: 'dica', titulo: 'Revisão de digitação não rodou', detalhe: e.message, itens: [] });
    }
    const resultado = { tipo: 'varredura_ok', estab: atual, nota: nota(problemas), problemas,
      totais: { produtos: cardapio.produtos.length, categorias: new Set(cardapio.produtos.map(p => p.categoria)).size, niveis: cardapio.niveis.length } };
    await guardar('ultimaVarredura', resultado);
    s.enviar(resultado);
  } catch (e) { s.enviar({ tipo: 'falha', texto: e.message }); }
}

// Melhorias em cardápio grande: descrições e nomes por partes (grupos de categorias com até 60 produtos).
const MELHORIAS_UMA_VEZ = 120;
async function textosPorPartes(s, cardapio) {
  const porCat = new Map();
  for (const p of cardapio.produtos) { if (!porCat.has(p.categoria)) porCat.set(p.categoria, []); porCat.get(p.categoria).push(p); }
  const grupos = []; let atual = [];
  for (const lista of porCat.values()) {
    for (let i = 0; i < lista.length; i += 60) {
      const pedaco = lista.slice(i, i + 60);
      if (atual.length && atual.length + pedaco.length > 60) { grupos.push(atual); atual = []; }
      atual.push(...pedaco);
    }
  }
  if (atual.length) grupos.push(atual);
  const porGrupo = Math.max(3, Math.ceil(12 / grupos.length) + 1);
  const descricoes = [], nomes = [];
  let feitos = 0;
  const fila = [...grupos];
  async function trabalhador() {
    while (fila.length) {
      const g = fila.shift();
      try {
        const r = await iaJson(SIS_ANALISTA, `Parte de um cardápio grande. Sugira melhorias SÓ de texto para estes produtos.
Formato exato: {"descricoes":[{"produto_id":"id","produto":"nome exato","atual":"descrição atual ou vazio","sugerida":"nova descrição no estilo abaixo"}],"nomes":[{"tipo":"produto","atual":"nome atual","sugerido":"nome melhor","motivo":"curto"}]}
${ESTILO_DESCRICAO}
Regras: descricoes = produtos sem descrição, com descrição fraca (curta, só repete o nome, erro de português, CAIXA ALTA) ou sem apelo; até ${porGrupo}, priorizando os sem descrição; se já segue o estilo, NÃO inclua. nomes = até 2, só se o nome tiver erro ou estiver confuso. Use só produtos da lista.
Produtos: ${JSON.stringify(g.map(p => ({ id: p.id, cat: p.categoria, nome: p.nome, desc: p.descricao || undefined, valor: p.valor })))}`, 6000);
        descricoes.push(...(r.descricoes || [])); nomes.push(...(r.nomes || []));
      } catch {} // uma parte que falha não derruba as outras
      feitos++;
      s.enviar({ tipo: 'progresso', etapa: `Descrições por partes (${feitos}/${grupos.length})…`, pct: 85 + Math.round(13 * feitos / grupos.length) });
    }
  }
  await Promise.all([trabalhador(), trabalhador()]);
  // Os sem descrição primeiro; no máximo 12 descrições e 6 nomes no total.
  descricoes.sort((x, y) => (x.atual ? 1 : 0) - (y.atual ? 1 : 0));
  return { descricoes: descricoes.slice(0, 12), nomes: nomes.slice(0, 6) };
}

async function melhorias(s) {
  try {
    const { atual, cardapio } = await prepararCardapio(s);
    const tab = await abaDoPainel(s);
    // Vendas reais: o que sai junto nos pedidos concluídos dos últimos 30 dias.
    let vendas = null;
    try {
      vendas = await analisarVendas(tab, { progresso: (t) => s.enviar({ tipo: 'progresso', etapa: t, pct: 70 }) });
    } catch (e) { vendas = { erro: e.message }; }
    s.enviar({ tipo: 'progresso', etapa: 'A MIA está pensando em melhorias…', pct: 80 });
    const produtosIA = cardapio.produtos.map(p => ({ id: p.id, nome: p.nome, cat: p.categoria, valor: p.valor, foto: p.foto !== false }));
    // Cardápio grande: a análise geral vai sem as descrições (cabe na resposta) e as descrições/nomes saem por partes.
    const grande = cardapio.produtos.length > MELHORIAS_UMA_VEZ;
    const dadosIA = resumoParaIA(cardapio);
    if (grande) dadosIA.produtos = dadosIA.produtos.map(({ desc, ...p }) => p);
    const r = await iaJson(SIS_ANALISTA,
      `Analise o cardápio do estabelecimento "${atual}" e sugira melhorias para VENDER MAIS.
Formato exato:
{
 "resumo": "2 frases sobre o cardápio",
 "descricoes": [{"produto_id":"id do produto","produto":"nome exato","atual":"descrição atual ou vazio","sugerida":"nova descrição no estilo abaixo"}],
 "categorias": [{"atual":"nome exato da categoria","sugerido":"nome com emoji no estilo abaixo","motivo":"curto"}],
 "juntos": [{"a":"produto principal (nome exato)","b":"o que sai junto (nome exato)","vezes":3,"pct":19,"ideia":"combo ou sugerido","texto":"frase curta e animada sugerindo o que fazer, ex.: 'A Pizza Família sai com Coca 2L em 19% dos pedidos: que tal um combo com R$ 5 de desconto?'","combo_nome":"nome do combo com emoji (se ideia=combo)","combo_preco":"preço sugerido com 8% a 12% de desconto sobre a soma (se ideia=combo)"}],
 "sugeridos": [{"produto_id":"id do produto principal","produto":"nome exato","sugeridos_ids":["3 a 5 ids de produtos COM foto que combinam para oferecer no fim do pedido"],"motivo":"curto, ex.: bebida gelada + sobremesa combinam com pizza"}],
 "combos": [{"nome":"nome chamativo com emoji","itens":["nomes exatos dos produtos"],"soma":"soma dos preços atuais","preco_sugerido":"valor com desconto de 8% a 15% sobre a soma","descricao":"descrição do combo no estilo abaixo","motivo":"por que vende"}],
 "ordem_categorias": [{"categoria":"nome exato","motivo":"curto"}],
 "nomes": [{"tipo":"produto|nível","atual":"nome atual","sugerido":"nome melhor","motivo":"curto"}],
 "niveis": [{"onde":"produto ou categoria","sugestao":"ex.: criar nível de adicionais pagos, limitar escolhas, renomear título"}]
}
${ESTILO_DESCRICAO}
${ESTILO_CATEGORIA}
Regras:
- descricoes: produtos sem descrição, com descrição fraca (curta, só repete o nome, erro de português, CAIXA ALTA) ou sem apelo (só uma lista seca de ingredientes, sem emoji). Até 12, priorizando os sem descrição. Se a descrição atual já segue o estilo, NÃO inclua.
- categorias: só as que ainda não têm emoji ou que mostram o nome do estabelecimento (ex.: "Lanches - Fulano"). Mantenha o sentido do nome.
- juntos: use SOMENTE os pares dos dados de vendas (não invente números). Até 6, os mais fortes. Se não houver dados de vendas, devolva [].
- sugeridos: para os 3 a 6 produtos mais importantes (mais vendidos ou carro-chefe), escolha de 3 a 5 produtos que combinam para oferecer no fim do pedido (bebidas, sobremesas, porções, adicionais vendidos como produto). Use os dados de vendas quando houver; senão, o bom senso de delivery. SOMENTE produtos com foto=true e que existam na lista; nunca o próprio produto.
- 2 a 4 combos (prefira os que nascem dos pares "juntos"); ordem_categorias com TODAS as categorias na ordem recomendada (carro-chefe primeiro, bebidas e sobremesas no fim); até 6 nomes; até 4 sugestões de níveis. Use só produtos que existem.
${grande ? '- CARDÁPIO GRANDE: devolva "descricoes": [] e "nomes": [] (eles são feitos em outra etapa).\n' : ''}Dados do cardápio: ${JSON.stringify(dadosIA)}
Produtos (id, foto): ${JSON.stringify(produtosIA)}
Vendas dos últimos ${vendas?.dias || 30} dias: ${vendas?.erro ? 'indisponível' : JSON.stringify({ pedidos: vendas.pedidos, pares: vendas.pares, maisVendidos: vendas.maisVendidos })}`);
    if (grande) Object.assign(r, await textosPorPartes(s, cardapio));
    const porId = Object.fromEntries(cardapio.produtos.map(p => [String(p.id), p]));
    // Garante as regras do painel nos sugeridos: produtos existentes, com foto, sem o próprio, 3 a 5.
    r.sugeridos = (r.sugeridos || []).map(x => ({ ...x, sugeridos: (x.sugeridos_ids || []).map(String).filter(id => porId[id] && porId[id].foto !== false && id !== String(x.produto_id)).slice(0, 5).map(id => ({ id, nome: porId[id].nome, valor: porId[id].valor })) }))
      .filter(x => porId[String(x.produto_id)] && x.sugeridos.length >= 3);
    // Ordem estratégica dos produtos (calculada aqui, sem IA): carro-chefe no topo, menor ticket no fim.
    r.ordem_produtos = ordemEstrategica(cardapio.produtos, vendas?.erro ? {} : vendas?.qtdPorChave);
    const resultado = { tipo: 'melhorias_ok', estab: atual, vendas: vendas?.erro ? null : { pedidos: vendas.pedidos, dias: vendas.dias, maisVendidos: vendas.maisVendidos }, ...r };
    await guardar('ultimasMelhorias', resultado);
    s.enviar(resultado);
  } catch (e) { s.enviar({ tipo: 'falha', texto: e.message }); }
}

async function sugeridosAplicar(s, msg) {
  try {
    const tab = await abaDoPainel(s);
    const { atual } = await estabelecimentoAtual(tab);
    if (atual !== msg.estab) throw new Error(`Essa sugestão é do "${msg.estab}", mas o painel está em "${atual}". Nada foi alterado.`);
    const r = await aplicarSugeridos(tab, atual, String(msg.produto_id), msg.ids.map(String));
    const reg = await Hist.registrar({ id: String(msg.produto_id), nome: `${msg.produto} · peça também`, campo: 'sugeridos', antes: r.antes, depois: r.depois, nomes: msg.nomes, estab: atual }, await quemSou());
    s.enviar({ tipo: 'alterado', alteracao: reg });
    s.enviar({ tipo: 'sugeridos_ok', produto_id: msg.produto_id });
  } catch (e) { s.enviar({ tipo: 'falha_leve', texto: e.message }); }
}

async function comboCriar(s, msg) {
  try {
    const tab = await abaDoPainel(s);
    const ctx = await contexto(s, tab);
    if (ctx.estab !== msg.estab) throw new Error(`Esse combo é do "${msg.estab}", mas o painel está em "${ctx.estab}". Nada foi criado.`);
    const preco = paraNumero(msg.preco);
    if (!(preco > 0)) throw new Error(`Não entendi o preço do combo ("${msg.preco}"). Nada foi criado.`);
    const r = await ctx.criar({ nome: msg.nome, descricao: msg.descricao || '', preco, bebida: false, niveis: [], ativo: msg.ativo !== false }, msg.categoria || '🔥 COMBOS');
    s.enviar({ tipo: 'combo_ok', nome: r.nome, chave: msg.chave });
  } catch (e) { s.enviar({ tipo: 'falha_leve', texto: e.message }); }
}

// ======================= v0.7: criar cardápio, ordem e categorias =======================
async function criarLer(s, msg) {
  try {
    const tab = await abaDoPainel(s);
    const { atual } = await estabelecimentoAtual(tab);
    if (!atual || atual === 'Gerencial') throw new Error('MAX_GERENCIAL');
    const progresso = (etapa, pct) => s.enviar({ tipo: 'progresso', etapa, pct });
    const [rascunho, ctx] = await Promise.all([
      lerCardapio({ servidor, anexos: msg.anexos || [], texto: msg.texto || '', estab: atual, progresso }),
      contextoRevisao(tab),
    ]);
    // Liga categorias lidas às que o estabelecimento já tem (mesmo nome, sem contar emoji e acento).
    for (const c of rascunho.categorias) {
      const ex = ctx.existentes.find(e => normal(e.nome) === normal(c.nome) || normal(e.nome).startsWith(normal(c.nome) + ' '));
      if (ex) { c.idExistente = ex.id; c.nomeExistente = ex.nome; }
    }
    const resultado = { tipo: 'criar_rascunho', estab: atual, ...rascunho, existentes: ctx.existentes, aberta: ctx.aberta };
    await guardar('ultimoRascunho', resultado);
    s.enviar(resultado);
  } catch (e) { s.enviar({ tipo: 'falha', texto: e.message }); }
}

async function criarGravar(s, msg) {
  try {
    const tab = await abaDoPainel(s);
    const { atual } = await estabelecimentoAtual(tab);
    if (atual !== msg.estab) throw new Error(`Esse cardápio é para "${msg.estab}", mas o painel está em "${atual}". Nada foi gravado.`);
    esquecerCardapio();
    const lote = { lote: novoLote(), loteNome: 'Cardápio criado pela MIA' };
    const r = await gravarCardapio({ tab, estab: atual, plano: msg.plano,
      progresso: (texto, feito, total) => s.enviar({ tipo: 'criar_progresso', texto, feito, total }),
      registrar: (p) => registrarCriado(s, atual, p, lote) });
    s.enviar({ tipo: 'criar_ok', estab: atual, ...r });
  } catch (e) { s.enviar({ tipo: 'criar_erro', texto: e.message }); }
}

async function ordemAplicar(s, msg) {
  try {
    const tab = await abaDoPainel(s);
    const { atual } = await estabelecimentoAtual(tab);
    if (atual !== msg.estab) throw new Error(`Essa ordem é do "${msg.estab}", mas o painel está em "${atual}".`);
    const cats = await categoriasEstab(tab);
    const usados = new Set(), ids = [];
    for (const nome of msg.ordem) {
      const c = cats.find(x => !usados.has(x.id) && (x.nome === nome || normal(x.nome) === normal(nome)));
      if (c) { ids.push(c.id); usados.add(c.id); }
    }
    for (const c of cats) if (!usados.has(c.id)) ids.push(c.id); // as que a IA não citou ficam no fim, na ordem atual
    const antes = cats.map(c => c.id);
    if (antes.join() === ids.join()) throw new Error('A ordem sugerida é igual à atual. 👌');
    await salvarOrdem(tab, atual, ids);
    esquecerCardapio();
    const reg = await Hist.registrar({ id: '', nome: 'Ordem das categorias', campo: 'ordem', antes, depois: ids, nomes: ids.map(id => cats.find(c => c.id === id)?.nome), estab: atual }, await quemSou());
    s.enviar({ tipo: 'alterado', alteracao: reg });
    s.enviar({ tipo: 'ordem_ok', nomes: reg.nomes });
  } catch (e) { s.enviar({ tipo: 'falha_leve', texto: e.message }); }
}

// "Renomear" categoria sem Gerencial: cria a categoria nova, move os produtos e devolve a posição.
async function categoriaRenomear(s, msg) {
  try {
    const tab = await abaDoPainel(s);
    const { atual } = await estabelecimentoAtual(tab);
    if (atual !== msg.estab) throw new Error(`Essa sugestão é do "${msg.estab}", mas o painel está em "${atual}".`);
    const [cats, produtos, niv] = await Promise.all([categoriasEstab(tab), produtosAtuais(tab), listarNiveis(tab)]);
    const velha = cats.find(c => c.nome === msg.atual);
    if (!velha) throw new Error(`Não achei a categoria "${msg.atual}" neste estabelecimento.`);
    const nivCat = (niv?.linhas || []).filter(n => !n['Produto'] && n['Categoria'] === msg.atual);
    if (nivCat.length) throw new Error(`"${msg.atual}" tem níveis por categoria (${nivCat.map(n => n['Titulo']).join(', ')}). Mudando de categoria, os produtos perderiam essas opções. Renomeie essa pelo login Gerencial.`);
    const dela = produtos.filter(p => p.categoria === msg.atual);
    if (dela.some(p => p.subcategoria)) throw new Error(`"${msg.atual}" usa subcategorias. Renomeie pelo login Gerencial.`);
    if (!dela.length) throw new Error('Essa categoria não tem produtos.');
    esquecerCardapio();
    const nova = await criarCategoria(tab, atual, msg.sugerido);
    const movidos = [];
    try {
      for (const [i, p] of dela.entries()) {
        s.enviar({ tipo: 'progresso_aplicar', feito: i, total: dela.length, nome: p.nome });
        await moverProduto(tab, atual, p.id, nova.id); movidos.push(p.id);
      }
    } catch (e) {
      for (const id of movidos) await moverProduto(tab, atual, id, velha.id).catch(() => {});
      throw new Error(`Parei no meio e voltei tudo como estava: ${e.message}`);
    }
    const ordemAntes = cats.map(c => c.id);
    await salvarOrdem(tab, atual, ordemAntes.map(id => id === velha.id ? nova.id : id)).catch(() => {});
    const reg = await Hist.registrar({ id: nova.id, nome: `${msg.atual} → ${msg.sugerido}`, campo: 'categoria', antes: { id: velha.id, nome: velha.nome }, depois: { id: nova.id, nome: msg.sugerido }, produtos: movidos, ordemAntes, estab: atual }, await quemSou());
    s.enviar({ tipo: 'alterado', alteracao: reg });
    s.enviar({ tipo: 'categoria_ok', atual: msg.atual, sugerido: msg.sugerido, qtd: movidos.length });
  } catch (e) { s.enviar({ tipo: 'falha_leve', texto: e.message }); }
}

// ======================= v0.8: fotos automáticas, ranking e mensagem pro parceiro =======================
import { semFoto, buscarFotos, baixarB64, aplicarFotoOpcao } from './fotos.js';
import { rodarRanking, ultimosRankings } from './ranking.js';
import { analisarVendas, aplicarSugeridos, lerSugeridos, removerSugeridos } from './vendas.js';

async function fotosBuscar(s, msg) {
  try {
    const { atual, cardapio } = await prepararCardapio(s);
    const tab = await abaDoPainel(s);
    s.enviar({ tipo: 'progresso', etapa: 'Procurando produtos e opções sem foto…', pct: 70 });
    const itens = await semFoto(tab, cardapio, { opcoes: msg.opcoes !== false, limite: 60 });
    if (!itens.length) { s.enviar({ tipo: 'fotos_sugestoes', estab: atual, itens: [] }); return; }
    s.enviar({ tipo: 'progresso', etapa: `A MIA está pensando nas fotos (${itens.length})…`, pct: 78 });
    const r = await iaJson(SIS_ANALISTA, `Para cada item de cardápio abaixo, escreva um termo de busca CURTO em inglês para achar uma foto bonita do alimento num banco de imagens (2 a 4 palavras, sem marcas; ex.: "pastel de carne" → "brazilian fried pastry", "Coca-Cola lata" → "cola soda can", "Ao ponto" de carne → "medium rare steak").
Formato: {"buscas":["termo 1","termo 2", ...]} na MESMA ordem e quantidade.
Itens: ${JSON.stringify(itens.map(i => ({ nome: i.nome, grupo: i.contexto, desc: (i.descricao || '').slice(0, 80) })))}`, 3000);
    const fila = itens.map((it, i) => ({ it, termo: r.buscas?.[i] || it.nome }));
    let feitos = 0;
    async function trabalhador() {
      while (fila.length) {
        const { it, termo } = fila.shift();
        try { it.candidatos = await buscarFotos(termo, 4); } catch { it.candidatos = []; }
        it.termo = termo;
        feitos++; s.enviar({ tipo: 'progresso', etapa: `Buscando fotos (${feitos}/${itens.length})…`, pct: 80 + Math.round(18 * feitos / itens.length) });
      }
    }
    await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
    s.enviar({ tipo: 'fotos_sugestoes', estab: atual, itens });
  } catch (e) { s.enviar({ tipo: 'falha', texto: e.message }); }
}

async function fotosMais(s, msg) {
  try { s.enviar({ tipo: 'fotos_mais', chave: msg.chave, candidatos: await buscarFotos(msg.termo, 8) }); }
  catch (e) { s.enviar({ tipo: 'falha_leve', texto: e.message }); }
}

async function fotosAplicar(s, msg) {
  try {
    const tab = await abaDoPainel(s);
    const ctx = await contexto(s, tab);
    if (ctx.estab !== msg.estab) throw new Error(`Essas fotos são do "${msg.estab}", mas o painel está em "${ctx.estab}". Nada foi alterado.`);
    esquecerCardapio();
    const feitos = [], falhas = [];
    for (const [n, x] of msg.escolhas.entries()) {
      s.enviar({ tipo: 'progresso_aplicar', feito: n, total: msg.escolhas.length, nome: x.nome });
      try {
        const img = await baixarB64(x.foto);
        if (x.tipo === 'produto') feitos.push(await ctx.gravar(x.id, 'foto', img));
        else {
          const alt = await aplicarFotoOpcao(tab, ctx.estab, x.id, img, x.idCardapio);
          alt.idCardapio = x.idCardapio;
          const reg = await Hist.registrar({ ...alt, nome: `${alt.nome} (opção)`, estab: ctx.estab }, await quemSou());
          s.enviar({ tipo: 'alterado', alteracao: reg });
          feitos.push(alt);
        }
      } catch (e) { falhas.push({ nome: x.nome, erro: e.message }); }
    }
    s.enviar({ tipo: 'fotos_aplicadas', feitos, falhas });
  } catch (e) { s.enviar({ tipo: 'falha_leve', texto: e.message }); }
}

async function rankingRodar(s) {
  try {
    const tab = await abaDoPainel(s);
    s.controleRanking = { cancelado: false };
    const r = await rodarRanking({ tabPainel: tab, controle: s.controleRanking,
      progresso: (feito, total, nome) => s.enviar({ tipo: 'ranking_progresso', feito, total, nome }) });
    s.enviar({ tipo: 'ranking_ok', ...r });
  } catch (e) { s.enviar({ tipo: 'ranking_erro', texto: e.message }); }
}

const soDigitos = (t) => String(t || '').replace(/\D/g, '');
async function mensagemParceiro(s, msg) {
  try {
    const { parceiros = [] } = await chrome.storage.local.get('parceiros');
    const p = parceiros.find(x => normal(x.nome) === normal(msg.estab)) || parceiros.find(x => normal(x.nome).includes(normal(msg.estab)) || normal(msg.estab).includes(normal(x.nome)));
    const r = await iaJson(`Você escreve, em nome da central do Mais Delivery ${MIA.cidade}, mensagens de WhatsApp para os estabelecimentos parceiros. Tom: amigável, parceiro, positivo e direto, como um colega que quer ver a loja vendendo mais. Português do Brasil. Responda SOMENTE com JSON.`,
      `Escreva UMA mensagem de WhatsApp para o estabelecimento "${msg.estab}" sobre o cardápio dele no app.
Estrutura: saudação curta com o nome da loja e 1 emoji; um elogio sincero (o que já está bom); 3 a 5 melhorias mais importantes em lista com emojis (frases curtas, linguagem simples, sem termos técnicos do painel, com número quando ajudar, ex.: "12 produtos estão sem foto"); explique em 1 frase que isso ajuda a vender mais; termine perguntando se a central pode fazer os ajustes ou se ele prefere mandar fotos/infos. Até 900 caracteres. Use *negrito* do WhatsApp com moderação. Não cite notas numéricas internas${msg.incluirNota ? ' (exceto: pode dizer a nota de 0 a 100 do cardápio)' : ''}.
Formato: {"texto":"..."}
Dados: ${JSON.stringify({ nota: msg.nota, totais: msg.totais, problemas: (msg.problemas || []).slice(0, 10), melhorias: msg.melhorias || undefined })}`, 1500);
    let tel = soDigitos(p?.telefone);
    if (tel && tel.length <= 11) tel = '55' + tel;
    s.enviar({ tipo: 'mensagem_ok', estab: msg.estab, texto: r.texto || '', telefone: tel || '', chave: msg.chave });
  } catch (e) { s.enviar({ tipo: 'falha_leve', texto: e.message }); }
}


// ---------- Marketing ----------
import { lerApp, horarios } from './mkt-dados.js';
import { proximasDatas } from './calendario.js';
import { SISTEMA_PAUTAS, SISTEMA_CARTAO, pedidoPautas, sanearPautas, resumoRanking, extrairPautas } from './marketing-ia.js';

async function chamarServidor(caminho, opcoes = {}) {
  const { servidor = SERVIDOR_PADRAO, codigo } = await chrome.storage.local.get(['servidor', 'codigo']);
  if (!codigo) throw new Error('Coloque o seu código de acesso (⚙).');
  if (!servidor) throw new Error('Configure o endereço do servidor na Central (⚙).');
  const r = await fetch(servidor.replace(/\/$/, '') + caminho, { ...opcoes, headers: { 'content-type': 'application/json', 'x-codigo-mia': codigo, ...(opcoes.headers || {}) } });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `Servidor respondeu ${r.status}`);
  return dados;
}

// Pergunta ao servidor quem é o dono do código (central ou marketing) e guarda.
async function atualizarPerfil(s) {
  try {
    const eu = await chamarServidor('/eu');
    await chrome.storage.local.set({ perfil: eu.perfil, nomeUsuario: eu.nome });
    s?.enviar({ tipo: 'perfil', ...eu });
    return eu;
  } catch (e) {
    // servidor antigo (sem /eu): continua como central
    if (/Rota inválida|404/.test(e.message)) { await chrome.storage.local.set({ perfil: 'central' }); s?.enviar({ tipo: 'perfil', perfil: 'central', nome: '' }); return; }
    s?.enviar({ tipo: 'perfil', erro: e.message });
  }
}
chrome.runtime.onInstalled.addListener(() => { atualizarPerfil(); Hist.limparAntigos().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { atualizarPerfil(); Hist.limparAntigos().catch(() => {}); });
chrome.storage.onChanged.addListener((m, area) => { if (area === 'local' && m.codigo) atualizarPerfil(); });

async function mktSugerir(s) {
  const prog = (texto) => s.enviar({ tipo: 'mkt_progresso', texto });
  try {
    const { perfil } = await chrome.storage.local.get('perfil');
    if (perfil === 'marketing') throw new Error('Só a central gera as sugestões da MIA.');
    const hojeD = new Date();
    const hoje = `${hojeD.getFullYear()}-${String(hojeD.getMonth() + 1).padStart(2, '0')}-${String(hojeD.getDate()).padStart(2, '0')}`;
    prog('Olhando o calendário…');
    const datas = proximasDatas(hojeD, 45);
    let app = null;
    try { app = await lerApp(prog); } catch (e) { console.warn('[MIA] app', e); }
    prog('Contando os pedidos por horário…');
    let horas = null;
    try { horas = await horarios(28); } catch (e) { console.warn('[MIA] horários', e); }
    const ranking = resumoRanking(await ultimosRankings());
    const quadro = await chamarServidor('/quadro');
    prog('A MIA está escrevendo as pautas…');
    const resp = await servidor({ system: SISTEMA_PAUTAS, max_tokens: 8000, messages: [{ role: 'user', content: pedidoPautas({ hoje, datas, app, horas: horas?.erro ? null : horas, ranking, quadro }) }] });
    const r = extrairPautas(resp.content.filter(b => b.type === 'text').map(b => b.text).join(''));
    const cartoes = sanearPautas(r, hoje);
    prog('Colocando no quadro…');
    const res = await chamarServidor('/quadro', { method: 'POST', body: JSON.stringify({ acao: 'criar_varios', cartoes }) });
    await chrome.storage.local.set({ mktUltimaLeitura: { app, horas, data: Date.now() } });
    s.enviar({ tipo: 'mkt_sugerido', resumo: r.resumo || '', criados: res.criados.length, sugeridos: cartoes.length, quadro: res.quadro, banners: app?.banners || [],
      fontes: { app: !!app, horas: !!(horas && !horas.erro), gerencial: !!horas?.gerencial, ranking: !!ranking, datas: datas.length } });
  } catch (e) {
    s.enviar({ tipo: 'mkt_falha', texto: e.message });
  }
}

// A MIA melhora o briefing/legenda de um cartão (central e marketing podem usar).
async function mktEscrever(s, msg) {
  try {
    const c = msg.cartao || {};
    const comentarios = (c.comentarios || []).slice(-6).map(x => ({ autor: x.autor, texto: x.texto }));
    const pedido = `Cartão atual:\n${JSON.stringify({ tipo: c.tipo, titulo: c.titulo, descricao: c.descricao, texto_arte: c.texto_arte, legenda: c.legenda, formatos: c.formatos, loja: c.loja, produtos: c.produtos, prazo: c.prazo, horario: c.horario, checklist: c.checklist, comentarios })}\n\n`
      + (msg.comentario
        ? `Novo comentário de ${msg.autor || 'alguém da equipe'}: "${msg.comentario}"\nLeia o comentário e reescreva o cartão aplicando a sugestão (principalmente o texto da arte e a legenda; ajuste o briefing e o checklist se precisar). Em "comentario", diga em 1 frase o que mudou.`
        : `Pedido: ${msg.pedido || 'Deixe o briefing mais claro e a legenda mais atrativa.'}`);
    const r = await iaJson(SISTEMA_CARTAO, pedido, 3000);
    s.enviar({ tipo: 'mkt_escrito', id: c.id, campos: r, sugestao: !!msg.comentario });
  } catch (e) { s.enviar({ tipo: 'mkt_falha', texto: e.message }); }
}
