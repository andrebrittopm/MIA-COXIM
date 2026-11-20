// pedido.js — lançamento de pedido no painel (tele_entrega.php), mapeado e testado em 10/10/2026.
// op 29 cliente por telefone · op 28 formas de pagamento · op 154 bairros · op 105 taxa · op 58 envia o pedido
import { conferirEstabelecimento, valorBR, numBR, produtosAtuais } from './painel.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- funções que rodam na aba do painel ----------
async function pg_contextoPedido() {
  const op = async (d) => { const r = await fetch('ajax_operacao.php', { method: 'POST', body: new URLSearchParams(d), credentials: 'include' }); try { return JSON.parse(await r.text()); } catch { return []; } };
  const d = new DOMParser().parseFromString(await fetch('tele_entrega.php', { credentials: 'include' }).then(r => r.text()), 'text/html');
  const v = (id) => d.getElementById(id)?.value ?? '';
  const rest = [...d.querySelectorAll('#idRestaurante option')].filter(o => o.value !== '0');
  const idRestaurante = (rest.find(o => o.selected) || rest[0])?.value || '';
  const idCidade = v('idCidade');
  const bairros = await op({ nrOperacao: 154, idCidade });
  const pagamentos = idRestaurante ? await op({ nrOperacao: 28, idRestaurante }) : [];
  return {
    idRestaurante, idCidade, dsCidade: v('dsCidade'), dsEmail: v('dsEmail'), idFuncionario: v('idFuncionario'),
    idSituacao: d.querySelector('#idSituacao')?.value || '1',
    bairros: (Array.isArray(bairros) ? bairros : []).filter(b => b.flgAtivo !== '0').map(b => ({ id: b.idBairro, nome: b.dsBairro })),
    pagamentos: (Array.isArray(pagamentos) ? pagamentos : []).map(p => ({ id: p.idPagamento, nome: p.dsPagamento })),
  };
}

async function pg_opPedido(dados) {
  const r = await fetch('ajax_operacao.php', { method: 'POST', body: new URLSearchParams(dados), credentials: 'include' });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { bruto: t.slice(0, 300) }; }
}

async function rodar(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'ISOLATED' });
  return r?.result;
}

// Parecido de nomes (para bairro e forma de pagamento).
function parecido(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const pa = new Set(a.split(' ').filter(x => x.length > 2)), pb = new Set(b.split(' ').filter(x => x.length > 2));
  if (!pa.size || !pb.size) return 0;
  const comum = [...pa].filter(x => pb.has(x)).length;
  const menor = Math.min(pa.size, pb.size);
  if (comum === menor && menor >= 2) return 0.85; // todas as palavras importantes batem ("cartao credito")
  return comum / Math.max(pa.size, pb.size) * 0.8;
}
function escolher(lista, nome) {
  const ord = lista.map(x => ({ ...x, nota: parecido(x.nome, nome) })).sort((a, b) => b.nota - a.nota);
  const melhor = ord[0];
  const unico = melhor && melhor.nota >= 0.85 && !(ord[1] && ord[1].nota >= melhor.nota);
  return { item: unico ? melhor : null, sugestoes: ord.slice(0, 5).filter(x => x.nota > 0).map(x => x.nome) };
}

// ---------- preço dos itens pelo cardápio ----------
// Regra combinada com a equipe: se o produto é único no cardápio, usa o preço do app sem perguntar.
// Só pergunta quando há o mesmo produto com preços diferentes, ou quando não acha / preço é pelos níveis.
const chave = (s) => norm(s).replace(/\s+/g, '');
function acharNoCardapio(produtos, nomeItem) {
  const alvo = norm(nomeItem);
  const exatos = produtos.filter(p => norm(p.nome) === alvo);
  if (exatos.length) return exatos;
  const palavras = alvo.split(' ').filter(w => w.length > 2 || /\d/.test(w));
  if (!palavras.length) return [];
  return produtos.filter(p => { const n = norm(p.nome + ' ' + p.categoria); return palavras.every(w => n.includes(w)); });
}
function precificar(produtos, itens) {
  const linhas = [], problemas = [];
  for (const it of itens) {
    const qtd = Number(it.quantidade) > 0 ? Number(it.quantidade) : 1;
    if (it.valor_unitario != null && numBR(it.valor_unitario) > 0) { // o estabelecimento informou o preço (aceita 12.5 ou "12,50")
      linhas.push({ nome: it.produto, qtd, unit: numBR(it.valor_unitario) }); continue;
    }
    const cands = acharNoCardapio(produtos, it.produto).filter(p => numBR(p.valor) > 0);
    const precos = [...new Set(cands.map(p => numBR(p.valor)))];
    if (!cands.length) problemas.push(`Não achei "${it.produto}" com preço no cardápio (pode ser preço pelos níveis). Qual o valor?`);
    else if (precos.length > 1) problemas.push(`"${it.produto}" tem mais de um preço no cardápio: ${cands.slice(0, 6).map(p => `${p.nome} (R$ ${p.valor})`).join(', ')}. Qual deles?`);
    else linhas.push({ nome: cands.length === 1 ? cands[0].nome : it.produto, qtd, unit: precos[0] });
  }
  return { linhas, problemas, total: linhas.reduce((s, l) => s + l.qtd * l.unit, 0) };
}

// ---------- monta e confere o pedido (não grava nada) ----------
// p: { telefone, nome?, entrega:'delivery'|'retirada', bairro, rua, numero, complemento, referencia,
//      itens?: [{produto, quantidade, valor_unitario?}], valor_produtos?, taxa_print?,
//      forma_pagamento?, situacao_pagamento?: 'pago'|'receber', observacao? }
export async function montarPedido(tabId, estab, p) {
  await conferirEstabelecimento(tabId, estab);
  const problemas = [], avisos = [];
  const ctx = await rodar(tabId, pg_contextoPedido);
  if (!ctx?.idRestaurante) throw new Error('Não consegui abrir a tela de Lançar Pedido deste estabelecimento.');

  // 1) TELEFONE PRIMEIRO: aceita "(66) 99999-0000", "66999990000" ou só o número
  let dig = String(p.telefone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  let ddd = String(p.ddd || '').replace(/\D/g, '');
  if (dig.length >= 10) { ddd = dig.slice(0, 2); dig = dig.slice(2); }
  if (!ddd) ddd = MIA.ddd;
  const telOk = dig.length >= 8 && dig.length <= 9;
  if (!telOk) problemas.push('Qual o telefone do cliente? (é por ele que eu acho o cadastro)');

  const cliente = telOk ? await rodar(tabId, pg_opPedido, [{ nrOperacao: 29, nrDDD: ddd, nrTelefone: dig }]) : null;
  const cad = Array.isArray(cliente) ? cliente[0] : null;

  // 2) NOME: se o telefone tem cadastro, vale o nome do cadastro (mesmo que o print traga outro).
  let nome = String(p.nome || '').trim();
  if (cad?.dsNome) {
    if (nome && norm(nome) !== norm(cad.dsNome)) avisos.push(`Telefone já cadastrado: usei o nome do cadastro "${cad.dsNome}" (no pedido veio "${nome}").`);
    nome = cad.dsNome;
  } else if (telOk && nome.split(/\s+/).length < 2) {
    problemas.push(nome ? `Cliente novo: o painel exige nome e sobrenome. Qual o sobrenome de "${nome}"?` : 'Cliente novo: qual o nome completo dele?');
  }

  // 3) ENDEREÇO
  const delivery = (p.entrega || 'delivery') !== 'retirada';
  let bairro = null, igual = null, taxa = { vlEntrega: '0.00', vlEntregaOriginal: '0.00' };
  if (delivery) {
    const salvos = cad?.enderecos || [];
    if (!p.rua && !p.numero && salvos.length) {
      if (salvos.length === 1) igual = salvos[0];
      else problemas.push(`Qual o endereço? Endereços salvos desse cliente: ${salvos.slice(0, 5).map(e => `${e.dsRua}, ${e.nrRua} – ${e.dsBairro || ''}`).join(' | ')}.`);
    }
    if (!igual) {
      igual = salvos.find(e => chave(e.dsRua) === chave(p.rua) && chave(e.nrRua) === chave(p.numero)) || null;
    }
    if (igual) bairro = ctx.bairros.find(b => String(b.id) === String(igual.idBairro)) || { id: igual.idBairro, nome: igual.dsBairro };
    else if (p.rua || p.numero || !salvos.length) {
      if (!p.rua) problemas.push('Falta a rua do endereço.');
      if (!p.numero) problemas.push('Falta o número do endereço (se não tiver, use "S/N").');
      const r = escolher(ctx.bairros, p.bairro);
      bairro = r.item;
      if (!bairro) problemas.push(`Bairro "${p.bairro || '(não informado)'}" não encontrado com certeza. Parecidos no painel: ${r.sugestoes.join(', ') || 'nenhum'}.`);
    }
    if (bairro) {
      const t = await rodar(tabId, pg_opPedido, [{ nrOperacao: 105, idRestaurante: ctx.idRestaurante, dsCidade: ctx.dsCidade, dsEstado: MIA.uf,
        nrLatitude: 0, nrLongitude: 0, dsRua: igual?.dsRua || p.rua || '', nrRua: igual?.nrRua || p.numero || '', idBairro: bairro.id, flgPedidoLancado: 1 }]);
      if (t && t.vlEntrega != null) taxa = t;
    }
  }

  // 4) VALOR: valor informado pelo estabelecimento > preço do cardápio
  let vlPedido = numBR(p.valor_produtos) > 0 ? numBR(p.valor_produtos) : 0;
  let linhas = [];
  if (Array.isArray(p.itens) && p.itens.length) {
    const pr = precificar(await produtosAtuais(tabId), p.itens);
    linhas = pr.linhas;
    if (!(vlPedido > 0)) { problemas.push(...pr.problemas); vlPedido = pr.total; }
    else if (!pr.problemas.length && Math.abs(pr.total - vlPedido) > 0.009) avisos.push(`O valor informado (R$ ${valorBR(vlPedido)}) é diferente da soma do cardápio (R$ ${valorBR(pr.total)}). Vai valer o informado.`);
  }
  if (!(vlPedido > 0) && !problemas.some(x => /valor|preço/i.test(x))) problemas.push('Quais os itens do pedido ou o valor total dos produtos?');

  // 5) PAGAMENTO: o painel exige forma de pagamento.
  let pagamento = null;
  const situacao = p.situacao_pagamento || (p.pago === true ? 'pago' : p.pago === false ? 'receber' : '');
  if (!ctx.pagamentos.length) {
    problemas.push('Este estabelecimento está sem nenhuma forma de pagamento ativa no painel, e o painel recusa pedido assim. Ative uma forma de pagamento no cadastro do estabelecimento e tente de novo.');
  } else if (!p.forma_pagamento) {
    problemas.push(`Qual a forma de pagamento (${ctx.pagamentos.map(x => x.nome).join(', ')}) e já está pago ou é pra receber?`);
  } else {
    const r = escolher(ctx.pagamentos, p.forma_pagamento);
    pagamento = r.item;
    if (!pagamento) problemas.push(`Forma de pagamento "${p.forma_pagamento}" não existe neste estabelecimento. Disponíveis: ${ctx.pagamentos.map(x => x.nome).join(', ')}.`);
    else if (!situacao) problemas.push(`Pagamento em ${pagamento.nome}: já está pago ou é pra receber na entrega?`);
  }

  const vlEntrega = Number(taxa.vlEntrega || 0);
  const taxaPrint = p.taxa_print != null && p.taxa_print !== '' ? numBR(p.taxa_print) : NaN;
  if (Number.isFinite(taxaPrint) && Math.abs(taxaPrint - vlEntrega) > 0.009)
    avisos.push(`A taxa no pedido é R$ ${valorBR(taxaPrint)}, mas o painel calcula R$ ${valorBR(vlEntrega)} para ${bairro?.nome}. Vai valer a do painel.`);

  const itensTxt = linhas.map(l => `${l.qtd}x ${l.nome} (R$ ${valorBR(l.unit * l.qtd)})`).join(', ');
  const obs = [itensTxt, p.observacao].filter(Boolean).join(' | ');
  const rua = igual?.dsRua ?? p.rua ?? '', num = igual?.nrRua ?? p.numero ?? '';
  const compl = p.complemento || igual?.dsComplemento || '', ref = p.referencia || igual?.dsReferencia || '';

  const envio = {
    nrOperacao: 58, idRestaurante: ctx.idRestaurante, dsNome: nome, nrDDD: ddd, nrTelefone: dig, idCidade: ctx.idCidade,
    // Igual à tela do painel: coordenadas 0 (com coordenadas o painel falhou sem resposta no teste).
    nrLatitude: '0', nrLongitude: '0',
    dsRua: delivery ? rua : '', nrRua: delivery ? num : '', dsComplemento: compl, dsReferencia: ref,
    idBairro: bairro?.id || '', vlPedido: valorBR(vlPedido), vlEntrega: valorBR(vlEntrega), idPagamento: pagamento?.id || 0,
    flgPedidoPago: situacao === 'pago' ? 1 : 0, idSituacao: ctx.idSituacao, dsObservacao: obs, idEntrega: delivery ? 1 : 2,
    idEndereco: igual?.idEndereco || '', idFuncionario: ctx.idFuncionario || '', vlEntregaOriginal: String(Number(taxa.vlEntregaOriginal || vlEntrega)), // número com ponto, como a tela envia
    dsEmail: cad?.dsEmail || ctx.dsEmail || '',
  };
  const resumo = [
    `🧾 Lançar pedido em ${estab}`,
    `👤 ${nome || '?'} · (${ddd}) ${dig}${cad ? ' · já cadastrado' : ' · cliente novo'}`,
    delivery ? `📍 ${rua}, ${num}${compl ? ' – ' + compl : ''} · ${bairro?.nome || '?'}${ref ? '\n   Ref.: ' + ref : ''}${igual ? ' (endereço salvo)' : ''}` : '🏪 Retirada no balcão',
    itensTxt ? `🍽 ${itensTxt}` : '',
    `💰 Produtos R$ ${valorBR(vlPedido)} + entrega R$ ${valorBR(vlEntrega)} = R$ ${valorBR(vlPedido + vlEntrega)}`,
    `💳 ${pagamento?.nome || '?'} · ${situacao === 'pago' ? 'já pago' : 'receber na entrega'}`,
    p.observacao ? `📝 ${p.observacao}` : '',
    ...avisos.map(a => '⚠ ' + a),
  ].filter(Boolean).join('\n');
  return { ok: !problemas.length, problemas, avisos, resumo, envio, total: vlPedido + vlEntrega, nome };
}

export async function enviarPedido(tabId, estab, envio) {
  await conferirEstabelecimento(tabId, estab);
  const r = await rodar(tabId, pg_opPedido, [envio]);
  if (r?.retorno !== 'OK') throw new Error('O painel recusou o pedido: ' + (r?.mensagem || (r?.bruto === '' ? 'resposta vazia (confira a forma de pagamento do estabelecimento)' : JSON.stringify(r).slice(0, 150))));
  return { ok: true, idPedido: r.idPedido, mensagem: r.mensagem || 'Pedido enviado com sucesso' };
}

