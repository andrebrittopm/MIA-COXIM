// vendas.js — o que os clientes compram junto (pedidos concluídos) e os "Sugeridos" do fim do pedido.
// Só lê NOMES e QUANTIDADES dos produtos de cada pedido; dados de clientes nunca saem do painel.
import { conferirEstabelecimento } from './painel.js';

async function rodar(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'ISOLATED' });
  return r?.result;
}

// ---------- injetadas ----------
// Números dos pedidos concluídos no período (relatório "Pedidos concluídos - detalhado").
async function pg_numerosPedidos(dtInicio, dtFim) {
  const d0 = new DOMParser().parseFromString(await fetch('relatorio.php', { credentials: 'include' }).then(r => r.text()), 'text/html');
  const f = d0.querySelector('#frmRelatorio');
  if (!f) return { erro: 'Não achei a tela de relatórios.' };
  const fd = new FormData(f);
  fd.set('idRelatorio', '3'); fd.set('hdnRelatorioSel', '3'); fd.set('dtInicio', dtInicio); fd.set('dtFim', dtFim); fd.set('idFormatoSaida', '1');
  for (const k of ['arrBairrosSel', 'arrEntregadoresSel', 'arrOrigensSel', 'arrPagamentosSel', 'arrTpCalculoComissaoSel']) fd.set(k, '0');
  const d = new DOMParser().parseFromString(await fetch('relatorio.php', { method: 'POST', body: fd, credentials: 'include' }).then(r => r.text()), 'text/html');
  const t = d.querySelector('table');
  if (!t) return { numeros: [] };
  const cab = [...t.querySelectorAll('th')].map(x => x.innerText.trim());
  const iN = cab.indexOf('Número');
  return { numeros: [...t.querySelectorAll('tbody tr')].map(tr => (tr.cells[iN]?.innerText || '').replace(/\D/g, '')).filter(Boolean) };
}

// Itens (nome e quantidade) de vários pedidos, lendo a tela de detalhes de cada um.
async function pg_itensPedidos(numeros) {
  const fila = [...numeros], out = [];
  async function trab() {
    while (fila.length) {
      const n = fila.shift();
      try {
        const d = new DOMParser().parseFromString(await fetch('detalhes_pedido.php?id=' + btoa(n), { credentials: 'include' }).then(r => r.text()), 'text/html');
        const t = [...d.querySelectorAll('table')].find(x => [...x.querySelectorAll('th')].some(h => h.innerText.trim() === 'Nome'));
        if (!t) continue;
        const cab = [...t.querySelectorAll('th')].map(x => x.innerText.trim());
        const iNome = cab.indexOf('Nome'), iQtd = cab.indexOf('Qtd'), iCat = cab.indexOf('Categoria');
        const itens = [...t.querySelectorAll('tbody tr')].map(tr => ({ nome: (tr.cells[iNome]?.innerText || '').trim(), qtd: Number(tr.cells[iQtd]?.innerText || 1) || 1,
          categoria: (tr.cells[iCat]?.innerText || '').replace(/^ITEM \d+\s*-\s*/i, '').trim() })).filter(i => i.nome);
        if (itens.length) out.push(itens);
      } catch { /* pedido ignorado */ }
    }
  }
  await Promise.all([trab(), trab(), trab(), trab(), trab()]);
  return out;
}

async function pg_idRestaurante() {
  const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ action: 'new', idCardapio: '0' }) }).then(r => r.text()), 'text/html');
  return d.querySelector('#frmCadastro [name=idRestaurante]')?.value || null;
}

async function pg_op(dados) {
  const t = await fetch('ajax_operacao.php', { method: 'POST', credentials: 'include', body: new URLSearchParams(dados) }).then(r => r.text());
  try { return JSON.parse(t); } catch { return { bruto: t.slice(0, 200) }; }
}

// ---------- análise ----------
const dataBR = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Lê os pedidos dos últimos `dias` (no máximo `limite` pedidos) e conta os pares que saem juntos.
export async function analisarVendas(tab, { dias = 30, limite = 400, progresso = () => {} } = {}) {
  const fim = new Date(), ini = new Date(Date.now() - dias * 864e5);
  progresso('Buscando os pedidos concluídos…');
  const r = await rodar(tab, pg_numerosPedidos, [dataBR(ini), dataBR(fim)]);
  if (r?.erro) throw new Error(r.erro);
  const numeros = (r?.numeros || []).slice(-limite); // os mais recentes
  if (!numeros.length) return { pedidos: 0, pares: [], maisVendidos: [], qtdPorChave: {}, dias };
  const pedidos = [];
  for (let i = 0; i < numeros.length; i += 25) {
    progresso(`Lendo os itens dos pedidos (${Math.min(i + 25, numeros.length)}/${numeros.length})…`);
    pedidos.push(...((await rodar(tab, pg_itensPedidos, [numeros.slice(i, i + 25)])) || []));
  }
  const vendas = {}, juntos = {}, nomes = {};
  for (const itens of pedidos) {
    const unicos = [...new Set(itens.map(i => { const k = chave(i.nome); nomes[k] = nomes[k] || i.nome; return k; }))];
    for (const i of itens) vendas[chave(i.nome)] = (vendas[chave(i.nome)] || 0) + i.qtd;
    for (let a = 0; a < unicos.length; a++) for (let b = a + 1; b < unicos.length; b++) {
      const k = [unicos[a], unicos[b]].sort().join('||');
      juntos[k] = (juntos[k] || 0) + 1;
    }
  }
  const pedidosCom = {};
  for (const itens of pedidos) for (const k of new Set(itens.map(i => chave(i.nome)))) pedidosCom[k] = (pedidosCom[k] || 0) + 1;
  const pares = Object.entries(juntos).filter(([, n]) => n >= 2).map(([k, n]) => {
    const [a, b] = k.split('||');
    // "pct": de cada 100 pedidos com o produto principal (o mais vendido do par), quantos levam o outro junto.
    const [prin, comp] = (pedidosCom[a] || 0) >= (pedidosCom[b] || 0) ? [a, b] : [b, a];
    return { a: nomes[prin], b: nomes[comp], vezes: n, pct: Math.round(100 * n / Math.max(1, pedidosCom[prin])) };
  }).sort((x, y) => y.vezes - x.vezes || y.pct - x.pct).slice(0, 15);
  const maisVendidos = Object.entries(vendas).sort((x, y) => y[1] - x[1]).slice(0, 15).map(([k, q]) => ({ nome: nomes[k], qtd: q }));
  return { pedidos: pedidos.length, pares, maisVendidos, qtdPorChave: vendas, dias }; // qtdPorChave: quantidade vendida de cada produto (nome normalizado)
}

// ---------- Sugeridos (o "peça também" do fim do pedido) ----------
// Regras do painel: mínimo 3 para aparecer no app, máximo 5, e cada sugerido precisa ter foto.
export async function lerSugeridos(tab, idCardapio) {
  const idRest = await rodar(tab, pg_idRestaurante);
  const r = await rodar(tab, pg_op, [{ nrOperacao: 145, idRestaurante: idRest, tpSugerido: 'cardapio', idCardapio }]);
  const lista = Array.isArray(r) ? r : (Array.isArray(r?.dados) ? r.dados : []);
  return lista.map(x => String(x.idCardapioSg)).filter(x => x && x !== '0');
}

export async function aplicarSugeridos(tab, estab, idCardapio, ids) {
  await conferirEstabelecimento(tab, estab);
  if (ids.length < 3 || ids.length > 5) throw new Error('O app só mostra sugeridos com 3 a 5 produtos.');
  const idRest = await rodar(tab, pg_idRestaurante);
  const antes = await lerSugeridos(tab, idCardapio);
  for (const id of antes.filter(x => !ids.includes(x))) await rodar(tab, pg_op, [{ nrOperacao: 147, idCardapioSg: id, idRestaurante: idRest, tpSugerido: 'cardapio', idCardapio }]);
  const faltam = ids.filter(x => !antes.includes(x));
  for (const [i, id] of ids.entries()) {
    if (!faltam.includes(id)) continue;
    const r = await rodar(tab, pg_op, [{ nrOperacao: 149, idCardapioSg: id, idRestaurante: idRest, nrOrdem: i + 1, tpSugerido: 'cardapio', idCardapio }]);
    if (r?.retorno && r.retorno !== 'OK') throw new Error(r.mensagem || 'O painel recusou um sugerido.');
  }
  const depois = await lerSugeridos(tab, idCardapio);
  if (ids.some(x => !depois.includes(x))) throw new Error('O painel não confirmou todos os sugeridos.');
  return { antes, depois };
}

export async function removerSugeridos(tab, estab, idCardapio, ids) {
  await conferirEstabelecimento(tab, estab);
  const idRest = await rodar(tab, pg_idRestaurante);
  for (const id of ids) await rodar(tab, pg_op, [{ nrOperacao: 147, idCardapioSg: id, idRestaurante: idRest, tpSugerido: 'cardapio', idCardapio }]);
}
