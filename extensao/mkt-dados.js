// mkt-dados.js — o que a aba Marketing sabe do app e do painel (só leitura).
// • App do cliente: abre o app numa aba em segundo plano e lê o que o próprio app carregou
//   (banners, queridinhos, lojas abertas, promoções ativas, novos parceiros, novidades, feriados).
// • Painel (se houver uma aba aberta): pedidos concluídos por dia da semana e hora, para achar os horários fracos.
//   Só conta horários; nenhum dado de cliente sai do painel.
import { PAINEL } from './painel.js';
import { PERIODOS } from './calendario.js';

const APP = 'https://maisdeliveryapp.com.br/pwa/';
const CIDADE = { dsCidade: MIA.cidade, idMarketplace: MIA.idMarketplace, idCidade: MIA.idCidade, idEstado: '', lat: '', lng: '' };
export const FOTOS_APP = 'https://maisdeliveryfranquia.com.br/api/';

async function rodar(tabId, func, args = [], world = 'ISOLATED') {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world });
  return r?.result;
}
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

function carregarEsperar(tabId, url) {
  return new Promise(res => {
    let feito = false;
    const f = (id, info) => { if (id === tabId && info.status === 'complete') { feito = true; chrome.tabs.onUpdated.removeListener(f); res(); } };
    chrome.tabs.onUpdated.addListener(f);
    chrome.tabs.update(tabId, { url });
    setTimeout(() => { if (!feito) { chrome.tabs.onUpdated.removeListener(f); res(); } }, 20000);
  });
}

// ---------- injetadas ----------
function pg_garantirCidade(cidade) {
  if (!localStorage.getItem('@mais/delivery/dataStateCity')) { localStorage.setItem('@mais/delivery/dataStateCity', JSON.stringify(cidade)); return 'definida'; }
  return 'ok';
}
async function pg_esperarColeta(ops, ms) {
  const ini = Date.now();
  while (Date.now() - ini < ms) {
    const tem = new Set((window.__miaColeta || []).map(c => c.op));
    if (ops.every(o => tem.has(o))) break;
    await new Promise(r => setTimeout(r, 300));
  }
  return (window.__miaColeta || []).map(c => ({ op: c.op, dados: c.dados }));
}

// Pedidos concluídos (relatório "Pedidos concluídos - detalhado") contados por dia da semana × hora.
async function pg_pedidosPorHora(dtInicio, dtFim) {
  const d0 = new DOMParser().parseFromString(await fetch('relatorio.php', { credentials: 'include' }).then(r => r.text()), 'text/html');
  const f = d0.querySelector('#frmRelatorio');
  if (!f) return { erro: 'Não achei a tela de relatórios.' };
  const fd = new FormData(f);
  fd.set('idRelatorio', '3'); fd.set('hdnRelatorioSel', '3'); fd.set('dtInicio', dtInicio); fd.set('dtFim', dtFim); fd.set('idFormatoSaida', '1');
  for (const k of ['arrBairrosSel', 'arrEntregadoresSel', 'arrOrigensSel', 'arrPagamentosSel', 'arrTpCalculoComissaoSel']) fd.set(k, '0');
  const d = new DOMParser().parseFromString(await fetch('relatorio.php', { method: 'POST', body: fd, credentials: 'include' }).then(r => r.text()), 'text/html');
  const t = d.querySelector('table');
  if (!t) return { erro: 'Relatório vazio.' };
  const matriz = Array.from({ length: 7 }, () => Array(24).fill(0));
  let total = 0;
  for (const tr of t.querySelectorAll('tbody tr')) {
    const txt = [...tr.cells].map(c => c.innerText).join(' ');
    const m = txt.match(/(\d{2})\/(\d{2})\/(\d{4})\D{1,3}(\d{2}):(\d{2})/);
    if (!m) continue;
    const dia = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getDay();
    matriz[dia][Number(m[4])]++; total++;
  }
  const estab = (document.body.innerText.match(/Gerencial/) ? 'Gerencial' : '') ;
  return { total, matriz, estab };
}

// ---------- API ----------
// Lê o app do cliente como ele é agora. Não muda nada: só abre e lê.
export async function lerApp(progresso = () => {}) {
  if (!MIA.idCidade || !MIA.idMarketplace) throw new Error('Faltam idCidade e idMarketplace em config.js (veja o LEIA-PRIMEIRO).');
  const aba = await chrome.tabs.create({ url: 'about:blank', active: false });
  try {
    progresso('Abrindo o app do cliente…');
    await carregarEsperar(aba.id, APP);
    if ((await rodar(aba.id, pg_garantirCidade, [CIDADE])) === 'definida') await carregarEsperar(aba.id, APP);
    const inicio = await rodar(aba.id, pg_esperarColeta, [['172'], 12000], 'MAIN') || [];
    progresso('Lendo promoções e novidades…');
    await carregarEsperar(aba.id, APP + 'explore');
    const explore = await rodar(aba.id, pg_esperarColeta, [['19', '50', '53'], 12000], 'MAIN') || [];
    return organizarApp([...inicio, ...explore]);
  } finally { chrome.tabs.remove(aba.id).catch(() => {}); }
}

export function organizarApp(coleta) {
  const ultimo = (op) => [...coleta].reverse().find(c => c.op === op)?.dados;
  const home = ultimo('172') || {};
  const lojas = {};
  for (const l of home.arrAbertosAgora || []) lojas[l.idRestaurante] = l.dsNome;
  for (const l of ultimo('50') || []) lojas[l.idRestaurante] = lojas[l.idRestaurante] || l.dsNome;
  for (const p of ultimo('19') || []) lojas[p.idRestaurante] = lojas[p.idRestaurante] || p.dsNome;
  const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
  // lojas de teste (ex.: "Estabelecimento Teste") nunca viram pauta
  const teste = (nome) => /teste/i.test(nome || '');
  for (const [id, nome] of Object.entries(lojas)) if (teste(nome)) lojas[id] = '__teste__';
  if (MIA.lojaTesteId) lojas[MIA.lojaTesteId] = '__teste__'; // loja de teste, mesmo quando está fechada
  const real = (id) => lojas[id] !== '__teste__';
  return {
    lido_em: new Date().toISOString(),
    banners: (home.arrBanners || []).map(b => ({ nome: b.dsBanner, imagem: b.dsImagem ? FOTOS_APP + b.dsImagem : '', inicio: b.dtInicio, fim: b.dtFim, loja: lojas[b.idRestaurante] || '' })),
    queridinhos: (home.arrQueridinhos || []).filter(q => real(q.idRestaurante)).map(q => ({ nome: q.dsNome, loja: lojas[q.idRestaurante] || '', idRestaurante: q.idRestaurante, preco: num(q.vlItem), comprados: num(q.qtComprados), imagem: q.dsImagem ? FOTOS_APP + q.dsImagem : '' })),
    abertos: (home.arrAbertosAgora || []).filter(l => !teste(l.dsNome)).map(l => ({ nome: l.dsNome, segmento: l.dsCategoria, nota: num(l.vlMedia), avaliacoes: num(l.qtAvaliacoes), cupom: l.dsCupom || '', cashback: !!l.flgCashBack, novidade: !!l.flgNovidade })),
    feriados: (home.feriado || []).map(f => ({ nome: f.dsFeriado, data: f.dtFeriado })),
    promocoes: (ultimo('19') || []).filter(p => !teste(p.dsNome)).map(p => ({ loja: p.dsNome, promocao: p.dsPromocao, de: num(p.vlNormal), por: num(p.vlDesconto), aberta: !!p.flgAberto, imagem: p.dsImagemUrl || (p.dsImagem ? FOTOS_APP + p.dsImagem : '') })),
    novos_parceiros: (ultimo('50') || []).filter(l => !teste(l.dsNome)).map(l => ({ nome: l.dsNome, segmento: l.dsSegmento, maior_idade: l.flgMaiorIdade === '1', imagem: l.dsImagem ? FOTOS_APP + l.dsImagem : '' })),
    novidades: (ultimo('53') || []).filter(p => real(p.idRestaurante)).map(p => ({ maior_idade: p.flgMaiorIdade === '1', nome: p.dsNome, loja: lojas[p.idRestaurante] || '', idRestaurante: p.idRestaurante, descricao: (p.dsDescricao || '').slice(0, 160), segmento: p.dsSegmento, preco: num(p.vlItem), imagem: p.dsImagem ? FOTOS_APP + p.dsImagem : '' })),
  };
}

// Horários fracos: precisa de uma aba do painel. No login Gerencial o relatório cobre a cidade toda.
export async function horarios(dias = 28) {
  const abas = await chrome.tabs.query({ url: PAINEL + '*' });
  if (!abas.length) return null;
  abas.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const fim = new Date(), ini = new Date(Date.now() - dias * 864e5);
  const br = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  let r;
  try { r = await rodar(abas[0].id, pg_pedidosPorHora, [br(ini), br(fim)]); } catch { return null; }
  if (!r || r.erro || !r.total) return r?.erro ? { erro: r.erro } : null;
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const porHora = Array(24).fill(0);
  r.matriz.forEach(l => l.forEach((n, h) => { porHora[h] += n; }));
  const periodos = PERIODOS.map(p => {
    let n = 0; for (let h = p.de; h < p.ate; h++) n += porHora[h % 24];
    return { periodo: p.nome, pedidos: n, pct: Math.round(100 * n / r.total) };
  });
  const porDia = r.matriz.map((l, i) => ({ dia: DIAS[i], pedidos: l.reduce((a, b) => a + b, 0) }));
  // janelas dia×período mais fracas, entre as que têm loja funcionando (algum pedido)
  const janelas = [];
  r.matriz.forEach((l, i) => PERIODOS.forEach(p => {
    let n = 0; for (let h = p.de; h < p.ate; h++) n += (h < 24 ? l[h] : (r.matriz[(i + 1) % 7][h - 24] || 0));
    janelas.push({ dia: DIAS[i], periodo: p.nome, pedidos: n });
  }));
  const media = r.total / janelas.length;
  return { dias, total: r.total, gerencial: r.estab === 'Gerencial', porHora, periodos, porDia,
    fracas: janelas.filter(j => j.pedidos > 0 && j.pedidos < media * 0.6).sort((a, b) => a.pedidos - b.pedidos).slice(0, 8) };
}
