// marketing.js — quadro de Marketing (estilo Trello) da MIA.
// O quadro fica no servidor da MIA (compartilhado entre a central e o designer).
import { TIPOS, FORMATOS } from './marketing-ia.js';
import { proximasDatas } from './calendario.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SERVIDOR_PADRAO = MIA.servidor;

const COLUNAS = [
  { id: 'ideias', nome: '💡 Ideias da MIA', dica: 'Sugestões para escolher' },
  { id: 'afazer', nome: '📋 A fazer', dica: 'Aprovado para criar' },
  { id: 'criando', nome: '🎨 Criando', dica: 'O designer está fazendo' },
  { id: 'aprovacao', nome: '👀 Aprovação', dica: 'Esperando o OK da central' },
  { id: 'publicado', nome: '✅ Publicado', dica: 'No ar' },
  { id: 'arquivado', nome: '🗄️ Arquivados', dica: 'Fora do quadro' },
  { id: 'lixeira', nome: '🗑️ Lixeira', dica: 'Dá para restaurar por 30 dias' },
];
const NOME_COLUNA = Object.fromEntries(COLUNAS.map(c => [c.id, c.nome]));
const COR = { data: '#ff7a00', promocao: '#e3141c', produto: '#1fb36b', parceiro: '#3a86ff', horario: '#8e24aa', banner: '#00a6b2', segmento: '#f4a100', loja: '#ffc23d', livre: '#b9aaa1' };
const ICONE_FORMATO = { feed: '📱 Feed', story: '📲 Story', quadrado: '⬜ Quadrado', banner_app: '🖥️ Banner' };

let quadro = { versao: 0, cartoes: [] };
let eu = { nome: '', perfil: 'central' };
let filtroTipo = '', busca = '', verArquivados = false, verLixeira = false;
let jaDesenhou = false; // o quadro já foi desenhado uma vez?

let aberto = null;      // id do cartão aberto no modal
let sujo = false;       // o modal tem mudanças não salvas
let editando = null;    // cópia de trabalho do cartão aberto
const blobs = new Map(); // id do anexo → URL local (cache das imagens)

// ---------------- servidor ----------------
async function cfg() { const { servidor = SERVIDOR_PADRAO, codigo = '' } = await chrome.storage.local.get(['servidor', 'codigo']); return { servidor: servidor.replace(/\/$/, ''), codigo }; }
async function api(caminho, opcoes = {}) {
  const { servidor, codigo } = await cfg();
  if (!codigo) throw new Error('SEM_CODIGO');
  let r;
  try { r = await fetch(servidor + caminho, { ...opcoes, signal: AbortSignal.timeout(opcoes.method === 'POST' ? 60000 : 20000), headers: { 'content-type': 'application/json', 'x-codigo-mia': codigo } }); }
  catch (e) { throw new Error(e.name === 'TimeoutError' ? 'O servidor demorou demais. Tente de novo.' : 'Sem conexão com o servidor da MIA.'); }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `O servidor respondeu ${r.status}`);
  return dados;
}
async function acao(corpo) {
  const r = await api('/quadro', { method: 'POST', body: JSON.stringify(corpo) });
  if (r.quadro) aplicarQuadro(r.quadro);
  return r;
}
async function urlAnexo(id) {
  if (blobs.has(id)) return blobs.get(id);
  const p = (async () => {
    const { servidor, codigo } = await cfg();
    const r = await fetch(`${servidor}/anexo/${id}`, { headers: { 'x-codigo-mia': codigo } });
    if (!r.ok) throw new Error('arquivo indisponível');
    return URL.createObjectURL(await r.blob());
  })();
  blobs.set(id, p);
  p.catch(() => blobs.delete(id));
  return p;
}

// ---------------- conversa com a extensão (MIA) ----------------
let porta = null;
function conectar() {
  try {
    porta = chrome.runtime.connect({ name: 'mia' });
    porta.onMessage.addListener(receber);
    porta.onDisconnect.addListener(() => { porta = null; });
  } catch { porta = null; }
}
function enviar(m) { if (!porta) conectar(); try { porta.postMessage(m); } catch { conectar(); porta?.postMessage(m); } }

function receber(m) {
  if (m.tipo === 'perfil') { if (!m.erro) { eu = { nome: m.nome, perfil: m.perfil }; mostrarPerfil(); } }
  if (m.tipo === 'mkt_progresso') { $('btnSugerir').innerHTML = `<span class="carregando-mia"></span>${esc(m.texto)}`; }
  if (m.tipo === 'mkt_sugerido') {
    restaurarBotaoSugerir();
    if (m.quadro) aplicarQuadro(m.quadro);
    const fontes = [m.fontes.datas ? `${m.fontes.datas} datas no calendário` : '', m.fontes.app ? 'o app do cliente' : '', m.fontes.horas ? (m.fontes.gerencial ? 'os horários da cidade toda' : 'os horários desta loja') : '', m.fontes.ranking ? 'o ranking' : ''].filter(Boolean);
    falar(`${m.criados ? `Coloquei <b>${m.criados}</b> ideia${m.criados > 1 ? 's' : ''} novas em 💡 Ideias da MIA` : 'Não achei nada novo além do que já está no quadro'}${m.sugeridos > m.criados ? ` (${m.sugeridos - m.criados} já existiam)` : ''}. ${esc(m.resumo)}<br><small>Olhei: ${fontes.join(', ') || 'só o calendário'}.${!m.fontes.horas ? ' Para eu ver os horários fracos, deixe o painel aberto no login Gerencial.' : ''}</small>`);
    if (m.banners?.length) guardarBanners(m.banners);
  }
  if (m.tipo === 'mkt_escrito') (m.sugestao ? mostrarSugestaoMia(m) : aplicarEscritaMia(m));
  if (m.tipo === 'mkt_falha') { if (!$('mSugestao').hidden && $('mSugestao').classList.contains('lendo')) $('mSugestao').hidden = true; restaurarBotaoSugerir(); $('mMia').disabled = false; $('mMia').innerHTML = '<img src="img/mia-rosto.png" alt="">MIA, melhora este cartão'; avisar(m.texto, 'erro'); }
  if (m.tipo === 'falha') avisar(m.texto, 'erro');
}

// ---------------- avisos ----------------
let tAviso;
function avisar(texto, tipo = '', desfazer = null) {
  const a = $('aviso'); a.textContent = texto; a.className = `aviso ${tipo}`; a.hidden = false;
  if (desfazer) {
    const b = el('button', 'desfazer', '↩ Desfazer'); b.type = 'button';
    b.onclick = () => { a.hidden = true; desfazer(); };
    a.appendChild(b);
  }
  clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, tipo === 'erro' ? 8000 : desfazer ? 8000 : 3500);
}
function falar(html) { $('falaTexto').innerHTML = html; $('falaMia').hidden = false; }
$('falaFechar').onclick = () => { $('falaMia').hidden = true; };

// ---------------- perfil ----------------
function mostrarPerfil() {
  const central = eu.perfil === 'central';
  $('btnSugerir').hidden = !central;

  $('quem').textContent = eu.nome ? `${eu.nome} · ${central ? 'Central' : 'Marketing'}` : '';
}

// ---------------- sincronização ----------------
function estadoSinc(ok, txt) { $('sinc').className = `sinc ${ok ? 'ok' : 'erro'}`; $('sincTxt').textContent = txt; }
function aplicarQuadro(q) {
  if (!q || !Array.isArray(q.cartoes)) return;
  const mudou = q.versao !== quadro.versao || !jaDesenhou;
  jaDesenhou = true;
  quadro = q;
  estadoSinc(true, 'sincronizado');
  if (mudou) { desenhar(); if (aberto) atualizarModalDoServidor(); }
  window.miaSeloMarketing?.(q.cartoes.filter(c => c.coluna === 'aprovacao').length);
}
let tPuxar;
async function puxar() {
  clearTimeout(tPuxar);
  try { aplicarQuadro(await api('/quadro')); }
  catch (e) {
    if (e.message === 'SEM_CODIGO') { pedirCodigo(); return; }
    estadoSinc(false, 'sem conexão');
    if (!quadro.versao) mostrarVazio('Não consegui abrir o quadro', e.message);
  }
  tPuxar = setTimeout(puxar, document.hidden ? 120000 : 25000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) puxar(); });

function pedirCodigo() {
  abrirConfig(true);
  mostrarVazio('Bem-vindo ao quadro de Marketing! 👋', 'Coloque o seu código de acesso em ⚙ (peça à administração) para ver o quadro.');
  estadoSinc(false, 'sem código');
}
function mostrarVazio(titulo, texto) { $('vazioTitulo').textContent = titulo; $('vazioTexto').textContent = texto; $('vazio').hidden = false; }

// ---------------- desenho do quadro ----------------
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dataBR = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
function seloPrazo(c) {
  if (!c.prazo || c.coluna === 'publicado' || c.coluna === 'arquivado') return '';
  const dias = Math.round((Date.parse(c.prazo + 'T12:00') - Date.parse(hojeISO() + 'T12:00')) / 864e5);
  const cls = dias < 0 ? 'vencido' : dias === 0 ? 'hoje' : dias <= 2 ? 'breve' : '';
  const txt = dias < 0 ? `atrasado ${-dias}d` : dias === 0 ? 'prazo hoje' : `até ${dataBR(c.prazo)}`;
  return `<span class="selo ${cls}" title="Prazo da arte">⏳ ${txt}</span>`;
}
function combina(c) {
  if (filtroTipo && c.tipo !== filtroTipo) return false;
  if (!busca) return true;
  const alvo = [c.titulo, c.loja, c.descricao, c.texto_arte, (c.produtos || []).join(' ')].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return alvo.includes(busca);
}

function desenhar() {
  const q = $('quadro'); const rolagem = q.scrollLeft; q.innerHTML = '';
  const cols = COLUNAS.filter(c => (c.id !== 'arquivado' || verArquivados) && (c.id !== 'lixeira' || verLixeira));
  const naLixeira = quadro.cartoes.filter(c => c.coluna === 'lixeira').length;
  $('btnLixeira').textContent = `🗑️ Lixeira${naLixeira ? ` (${naLixeira})` : ''}`;
  let total = 0;
  for (const col of cols) {
    const lista = quadro.cartoes.filter(c => c.coluna === col.id && combina(c)).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    total += lista.length;
    const box = el('section', 'coluna');
    box.innerHTML = `<div class="coluna-topo"><div>${col.nome}<small>${col.dica}</small></div><span class="conta">${lista.length}</span></div>`;
    const ul = el('div', 'lista'); ul.dataset.coluna = col.id;
    for (const c of lista) ul.appendChild(cartaoEl(c));
    prepararSoltar(ul);
    box.appendChild(ul);
    if (col.id === 'afazer' || col.id === 'ideias') {
      const add = el('button', 'add-coluna', '＋ Adicionar cartão'); add.onclick = () => novoCartao(col.id); box.appendChild(add);
    }
    q.appendChild(box);
  }
  q.scrollLeft = rolagem;
  const temAlgum = quadro.cartoes.some(c => !['arquivado', 'lixeira'].includes(c.coluna)) || verArquivados || verLixeira;
  if (!temAlgum) mostrarVazio('O quadro está vazio', eu.perfil === 'central' ? 'Clique em "MIA, sugere pautas" ou crie um cartão.' : 'Crie um cartão ou espere as pautas da central.');
  else $('vazio').hidden = true;
}

function diasLixeira(c) {
  const dias = Math.floor((Date.now() - Date.parse(c.lixeira_em || c.atualizado_em)) / 864e5);
  return `na lixeira ${dias ? `há ${dias} dia${dias > 1 ? 's' : ''}` : 'desde hoje'} · some em ${Math.max(0, 30 - dias)} dia(s)`;
}
function cartaoEl(c) {
  const b = el('button', 'cartao'); b.type = 'button'; b.draggable = true; b.dataset.id = c.id;
  b.style.setProperty('--cor', COR[c.tipo] || COR.livre);
  const feitos = (c.checklist || []).filter(x => x.ok).length, itens = (c.checklist || []).length;
  const imagem = (c.anexos || []).find(a => /^image\//.test(a.tipo));
  b.innerHTML = `${imagem ? `<img class="capa" alt="" data-anexo="${imagem.id}">` : ''}
    <div class="tipo">${esc(TIPOS[c.tipo] || TIPOS.livre)}${c.origem === 'mia' ? '<span class="mia-tag"><img src="img/mia-rosto.png" alt="">MIA</span>' : ''}</div>
    <h4>${esc(c.titulo)}</h4>
    ${c.loja ? `<div class="loja">🏪 ${esc(c.loja)}</div>` : ''}
    ${c.coluna === 'lixeira' ? `<div class="loja">🗑️ ${diasLixeira(c)}</div>` : ''}
    <div class="meta">${seloPrazo(c)}${c.publicar_em && c.coluna !== 'publicado' ? `<span class="selo" title="Publicar em">📣 ${dataBR(c.publicar_em)}</span>` : ''}
      ${(c.formatos || []).map(f => `<span class="selo">${ICONE_FORMATO[f] || esc(f)}</span>`).join('')}
      ${itens ? `<span class="selo ${feitos === itens ? 'ok' : ''}">☑ ${feitos}/${itens}</span>` : ''}
      ${(c.comentarios || []).length ? `<span class="selo">💬 ${c.comentarios.length}</span>` : ''}
      ${(c.anexos || []).length ? `<span class="selo">📎 ${c.anexos.length}</span>` : ''}</div>`;
  if (imagem) urlAnexo(imagem.id).then(u => { const im = b.querySelector('.capa'); if (im) im.src = u; }).catch(() => b.querySelector('.capa')?.remove());
  b.onclick = () => abrir(c.id);
  b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/mia-cartao', c.id); e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => { b.classList.add('arrastando'); document.body.classList.add('arrastando-cartao'); }); });
  b.addEventListener('dragend', () => { b.classList.remove('arrastando'); document.body.classList.remove('arrastando-cartao'); });
  return b;
}

// ---------------- arrastar e soltar ----------------
function posicaoNaLista(ul, y) {
  const cards = [...ul.querySelectorAll('.cartao:not(.arrastando)')];
  const i = cards.findIndex(cd => { const r = cd.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return i < 0 ? cards.length : i;
}
function prepararSoltar(ul) {
  ul.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('text/mia-cartao')) return; e.preventDefault(); ul.classList.add('alvo'); });
  ul.addEventListener('dragleave', (e) => { if (!ul.contains(e.relatedTarget)) ul.classList.remove('alvo'); });
  ul.addEventListener('drop', async (e) => {
    e.preventDefault(); ul.classList.remove('alvo');
    const id = e.dataTransfer.getData('text/mia-cartao'); if (!id) return;
    await mover(id, ul.dataset.coluna, posicaoNaLista(ul, e.clientY));
  });
}
// Lixeira flutuante: aparece no canto enquanto um cartão é arrastado.
{
  const z = $('zonaLixeira');
  z.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('text/mia-cartao')) return; e.preventDefault(); z.classList.add('alvo'); });
  z.addEventListener('dragleave', () => z.classList.remove('alvo'));
  z.addEventListener('drop', async (e) => {
    e.preventDefault(); z.classList.remove('alvo'); document.body.classList.remove('arrastando-cartao');
    const id = e.dataTransfer.getData('text/mia-cartao'); if (id) await mover(id, 'lixeira');
  });
}

// Desfazer: guarda o último movimento (arrastar, lixeira, arquivar, botões do fluxo) para voltar com 1 clique ou Ctrl+Z.
let ultimoMovimento = null;
async function mover(id, coluna, posicao, { semDesfazer = false } = {}) {
  const c = quadro.cartoes.find(x => x.id === id); if (!c) return;
  const de = c.coluna;
  const posDe = quadro.cartoes.filter(x => x.coluna === de).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).findIndex(x => x.id === id);
  // otimista: move na tela antes do servidor responder
  c.coluna = coluna; c.ordem = (posicao ?? 999) + 0.5; desenhar();
  try {
    await acao({ acao: 'mover', id, coluna, posicao });
    if (de === coluna) return;
    if (semDesfazer) return avisar(`Voltou para ${NOME_COLUNA[coluna]}`, 'ok');
    ultimoMovimento = { id, de, posDe, para: coluna, em: Date.now() };
    avisar(coluna === 'lixeira' ? `"${c.titulo}" foi para a lixeira` : `Movido para ${NOME_COLUNA[coluna]}`, 'ok', desfazerMovimento);
  } catch (e) { avisar(e.message, 'erro'); puxar(); }
}
async function desfazerMovimento() {
  const u = ultimoMovimento; ultimoMovimento = null;
  if (!u) return avisar('Nada para desfazer.');
  const c = quadro.cartoes.find(x => x.id === u.id);
  if (!c) return avisar('Esse cartão não existe mais.', 'erro');
  if (c.coluna !== u.para) return avisar('Alguém já mexeu nesse cartão depois. Mova ele pelo quadro.', 'erro');
  await mover(u.id, u.de, Math.max(0, u.posDe), { semDesfazer: true });
  if (aberto === u.id && editando) { editando.coluna = u.de; $('mColuna').value = u.de; desenharFluxo(); atualizarBotoesFim(); }
}
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return; // Ctrl+Z normal nos campos de texto
  if (!ultimoMovimento || Date.now() - ultimoMovimento.em > 5 * 60e3) return;
  e.preventDefault(); desfazerMovimento();
});

// ---------------- filtros e barra ----------------
function desenharFiltros() {
  const f = $('filtros'); f.innerHTML = '';
  const todos = el('button', 'filtro' + (filtroTipo ? '' : ' ativo'), 'Todos'); todos.onclick = () => { filtroTipo = ''; desenharFiltros(); desenhar(); }; f.appendChild(todos);
  for (const [id, nome] of Object.entries(TIPOS)) {
    const b = el('button', 'filtro' + (filtroTipo === id ? ' ativo' : ''), esc(nome)); b.onclick = () => { filtroTipo = filtroTipo === id ? '' : id; desenharFiltros(); desenhar(); }; f.appendChild(b);
  }
}
$('busca').addEventListener('input', (e) => { busca = e.target.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); desenhar(); });
$('btnArquivados').onclick = () => { verArquivados = !verArquivados; $('btnArquivados').setAttribute('aria-pressed', String(verArquivados)); desenhar(); };
$('btnLixeira').onclick = () => { verLixeira = !verLixeira; $('btnLixeira').setAttribute('aria-pressed', String(verLixeira)); desenhar(); if (verLixeira) requestAnimationFrame(() => { $('quadro').scrollLeft = $('quadro').scrollWidth; }); };
$('btnNovo').onclick = () => novoCartao('afazer');
$('btnSugerir').onclick = () => {
  $('btnSugerir').disabled = true; $('btnSugerir').innerHTML = '<span class="carregando-mia"></span>A MIA está pensando…';
  falar('Vou olhar o calendário, o app do cliente, os horários e o ranking. Leva uns 30 segundos ⏳');
  enviar({ tipo: 'mkt_sugerir' });
};
function restaurarBotaoSugerir() { $('btnSugerir').disabled = false; $('btnSugerir').innerHTML = '<img src="img/mia-rosto.png" alt="">MIA, sugere pautas'; }

// Medidas + banners no ar
$('btnMedidas').onclick = async () => {
  $('tabMedidas').innerHTML = Object.values(FORMATOS).map(f => `<tr><td>${esc(f.nome)}</td><td>${esc(f.medida)}</td></tr>`).join('');
  const { mktBanners } = await chrome.storage.local.get('mktBanners');
  if (mktBanners?.length) $('bannersAgora').innerHTML = mktBanners.map(b => `<figure><img src="${esc(b.imagem)}" alt=""><figcaption>${esc(b.nome)}${b.fim ? ` · até ${esc(b.fim.slice(8, 10) + '/' + b.fim.slice(5, 7) + '/' + b.fim.slice(0, 4))}` : ''}</figcaption></figure>`).join('');
  $('medidas').showModal();
};
$('medFechar').onclick = () => $('medidas').close();
async function guardarBanners(lista) { await chrome.storage.local.set({ mktBanners: lista }); }

// ---------------- configuração ----------------
async function abrirConfig(mostrar) {
  const { servidor, codigo } = await cfg();
  $('cfgServidor').value = servidor; $('cfgCodigo').value = codigo;
  $('config').hidden = mostrar === undefined ? !$('config').hidden : !mostrar;
}
$('btnConfig').onclick = () => abrirConfig();
$('cfgSalvar').onclick = async () => {
  const servidor = ($('cfgServidor').value.trim() || SERVIDOR_PADRAO).replace(/\/$/, '');
  const codigo = $('cfgCodigo').value.trim().replace(/^["']|["']$/g, '');
  const erro = (t) => { $('cfgErro').textContent = t; $('cfgErro').hidden = !t; };
  if (!servidor) return erro('Cole o endereço do servidor (o seu Worker do Cloudflare).');
  if (!codigo) return erro('Cole o código de acesso.');
  $('cfgSalvar').disabled = true; $('cfgSalvar').textContent = 'Conferindo…'; erro('');
  let eu = null;
  try {
    const r = await fetch(servidor + '/eu', { headers: { 'x-codigo-mia': codigo }, signal: AbortSignal.timeout(15000) });
    if (r.status === 401) { $('cfgSalvar').disabled = false; $('cfgSalvar').textContent = 'Entrar'; return erro('Código não reconhecido. Confira se copiou inteiro, sem espaço no começo ou no fim.'); }
    if (r.ok) eu = await r.json();
  } catch {}
  await chrome.storage.local.set({ servidor, codigo });
  $('cfgSalvar').disabled = false; $('cfgSalvar').textContent = 'Entrar';
  $('config').hidden = true;
  enviar({ tipo: 'perfil' });
  avisar(eu ? `Bem-vindo, ${eu.nome}! ✓` : 'Código salvo (servidor sem resposta agora).', eu ? 'ok' : 'erro');
  puxar();
};
$('cfgCodigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('cfgSalvar').click(); });

// ---------------- cartão novo ----------------
async function novoCartao(coluna) {
  try {
    const r = await acao({ acao: 'criar', cartao: { titulo: '✏️ Nova arte', tipo: 'livre', coluna, formatos: ['feed', 'story'] } });
    if (r.criados?.[0]) abrir(r.criados[0], true);
  } catch (e) { avisar(e.message === 'SEM_CODIGO' ? 'Coloque o seu código em ⚙ primeiro.' : e.message, 'erro'); }
}

// ---------------- modal ----------------
const CAMPOS = ['titulo', 'tipo', 'descricao', 'texto_arte', 'legenda', 'formatos', 'loja', 'produtos', 'prazo', 'publicar_em', 'horario', 'checklist'];
$('mTipo').innerHTML = Object.entries(TIPOS).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
$('mColuna').innerHTML = COLUNAS.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');

function abrir(id, focarTitulo = false) {
  const c = quadro.cartoes.find(x => x.id === id); if (!c) return;
  aberto = id; sujo = false; sugestaoMia = null; $('mSugestao').hidden = true;
  editando = JSON.parse(JSON.stringify(c));
  preencherModal();
  if (!$('modal').open) $('modal').showModal();
  if (focarTitulo) { $('mTitulo').focus(); $('mTitulo').select(); }
}
function preencherModal() {
  const c = editando;
  $('mTipoFaixa').style.setProperty('--cor', COR[c.tipo] || COR.livre);
  $('mTitulo').value = c.titulo || '';
  $('mTipo').value = c.tipo || 'livre';
  $('mColuna').value = c.coluna;
  $('mLoja').value = c.loja || '';
  $('mPrazo').value = c.prazo || '';
  $('mPublicar').value = c.publicar_em || '';
  $('mHorario').value = c.horario || '';
  $('mProdutos').value = (c.produtos || []).join(', ');
  $('mDescricao').value = c.descricao || '';
  $('mTextoArte').value = c.texto_arte || '';
  $('mLegenda').value = c.legenda || '';
  desenharFormatos(); desenharChecklist(); desenharAnexos(); desenharComentarios(); desenharFluxo();
  $('mHistorico').innerHTML = (c.historico || []).slice().reverse().map(h => `<li><b>${esc(h.quem)}</b> ${esc(h.texto)} · ${quando(h.data)}</li>`).join('') || '<li>—</li>';
  $('mCriado').textContent = `Criado por ${c.criado_por || '—'} em ${quando(c.criado_em)}`;
  atualizarBotoesFim();
  $('mStatus').textContent = '';
}
const quando = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

// Se outra pessoa mudou o cartão aberto: comentários/anexos/histórico atualizam sempre; o resto só se não houver edição local.
function atualizarModalDoServidor() {
  const c = quadro.cartoes.find(x => x.id === aberto);
  if (!c) { $('mStatus').textContent = 'Este cartão foi excluído por outra pessoa.'; return; }
  editando.comentarios = c.comentarios; editando.anexos = c.anexos; editando.historico = c.historico; editando.coluna = c.coluna;
  if (!sujo) { editando = JSON.parse(JSON.stringify(c)); preencherModal(); }
  else { desenharComentarios(); desenharAnexos(); desenharFluxo(); $('mColuna').value = c.coluna; $('mStatus').textContent = 'Outra pessoa também mexeu neste cartão. Salve para manter as suas mudanças.'; }
}

function marcarSujo() { sujo = true; $('mStatus').textContent = 'Mudanças não salvas'; }
for (const id of ['mTitulo', 'mLoja', 'mPrazo', 'mPublicar', 'mHorario', 'mProdutos', 'mDescricao', 'mTextoArte', 'mLegenda']) $(id).addEventListener('input', marcarSujo);
$('mTipo').addEventListener('change', () => { editando.tipo = $('mTipo').value; $('mTipoFaixa').style.setProperty('--cor', COR[editando.tipo]); marcarSujo(); });
$('mColuna').addEventListener('change', async () => { const col = $('mColuna').value; await salvar(false); await mover(aberto, col); editando.coluna = col; desenharFluxo(); atualizarBotoesFim(); });

function desenharFormatos() {
  const box = $('mFormatos'); box.innerHTML = '';
  for (const [id, f] of Object.entries(FORMATOS)) {
    const b = el('button', 'formato', `${ICONE_FORMATO[id]}<small>${esc(f.medida)}</small>`); b.type = 'button';
    b.setAttribute('aria-pressed', String((editando.formatos || []).includes(id)));
    b.onclick = () => { const s = new Set(editando.formatos || []); s.has(id) ? s.delete(id) : s.add(id); editando.formatos = [...s]; desenharFormatos(); marcarSujo(); };
    box.appendChild(b);
  }
}
function desenharChecklist() {
  const ul = $('mChecklist'); ul.innerHTML = '';
  const lista = editando.checklist || [];
  lista.forEach((it, i) => {
    const li = el('li', it.ok ? 'ok' : '', `<input type="checkbox" ${it.ok ? 'checked' : ''}><span>${esc(it.t)}</span><button type="button" title="Remover">×</button>`);
    li.querySelector('input').onchange = (e) => { it.ok = e.target.checked; desenharChecklist(); marcarSujo(); };
    li.querySelector('button').onclick = () => { lista.splice(i, 1); desenharChecklist(); marcarSujo(); };
    ul.appendChild(li);
  });
  $('mCheckConta').textContent = lista.length ? `${lista.filter(x => x.ok).length}/${lista.length}` : '';
}
function addItem() { const t = $('mNovoItem').value.trim(); if (!t) return; editando.checklist = [...(editando.checklist || []), { t, ok: false }]; $('mNovoItem').value = ''; desenharChecklist(); marcarSujo(); }
$('mAddItem').onclick = addItem;
$('mNovoItem').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });

// --- fluxo de aprovação ---
function desenharFluxo() {
  const box = $('mAcoesFluxo'); box.innerHTML = '';
  const c = editando, central = eu.perfil === 'central';
  const botao = (txt, cls, fn) => { const b = el('button', `botao ${cls}`, txt); b.type = 'button'; b.onclick = fn; box.appendChild(b); };
  if (c.coluna === 'ideias' && central) botao('👍 Aprovar ideia (vai pra A fazer)', 'verde', () => irPara('afazer'));
  if (c.coluna === 'afazer') botao('🎨 Comecei a criar', 'amarelo', () => irPara('criando'));
  if (c.coluna === 'criando') botao('👀 Enviar para aprovação', 'verde', async () => {
    if (!(c.anexos || []).length && !confirm('Ainda não tem arte anexada. Enviar mesmo assim?')) return;
    irPara('aprovacao');
  });
  if (c.coluna === 'aprovacao') {
    // a arte mais recente aparece em destaque para aprovar sem rolar a tela
    const img = [...(c.anexos || [])].reverse().find(a => /^image\//.test(a.tipo));
    if (img) {
      const f = el('img', 'previa-aprovacao'); f.alt = 'Arte para aprovar'; f.title = 'Clique para ver grande';
      urlAnexo(img.id).then(u => { f.src = u; f.onclick = () => window.open(u, '_blank'); }).catch(() => f.remove());
      box.appendChild(f);
    }
  }
  if (c.coluna === 'publicado' && central) botao('↩️ Voltar para aprovação', 'amarelo', () => irPara('aprovacao'));
  if (c.coluna === 'aprovacao' && central) {
    botao('✅ Aprovar e publicar', 'verde', () => irPara('publicado'));
    botao('↩️ Pedir ajuste', 'amarelo', async () => {
      const t = $('mNovoComent').value.trim() || prompt('O que precisa ajustar?') || '';
      if (!t.trim()) return;
      await acao({ acao: 'comentar', id: aberto, texto: '↩️ Ajuste: ' + t.trim() }); $('mNovoComent').value = '';
      irPara('criando');
    });
  }
  if (c.coluna === 'aprovacao' && !central) box.appendChild(el('p', 'nota', 'Esperando o OK da central 👀'));
}
async function irPara(coluna) { await salvar(false); await mover(aberto, coluna); editando.coluna = coluna; $('mColuna').value = coluna; desenharFluxo(); atualizarBotoesFim(); }

// --- salvar ---
function lerCampos() {
  editando.titulo = $('mTitulo').value.trim() || 'Sem título';
  editando.loja = $('mLoja').value.trim(); editando.prazo = $('mPrazo').value; editando.publicar_em = $('mPublicar').value;
  editando.horario = $('mHorario').value.trim(); editando.produtos = $('mProdutos').value.split(',').map(s => s.trim()).filter(Boolean);
  editando.descricao = $('mDescricao').value; editando.texto_arte = $('mTextoArte').value; editando.legenda = $('mLegenda').value;
}
async function salvar(avisando = true) {
  if (!sujo) return true;
  lerCampos();
  const campos = Object.fromEntries(CAMPOS.map(k => [k, editando[k]]));
  $('mSalvar').disabled = true; $('mStatus').textContent = 'Salvando…';
  try { await acao({ acao: 'atualizar', id: aberto, campos }); sujo = false; $('mStatus').textContent = 'Salvo ✓'; if (avisando) avisar('Cartão salvo ✓', 'ok'); return true; }
  catch (e) { $('mStatus').textContent = 'Não salvou: ' + e.message; avisar(e.message, 'erro'); return false; }
  finally { $('mSalvar').disabled = false; }
}
$('form').addEventListener('submit', async (e) => { e.preventDefault(); if (await salvar()) fechar(true); });
function fechar(forcar = false) {
  if (!forcar && sujo && !confirm('Há mudanças não salvas. Fechar mesmo assim?')) return;
  $('modal').close();
}
$('modal').addEventListener('close', () => { aberto = null; sujo = false; editando = null; });
$('modal').addEventListener('cancel', (e) => { if (sujo) { e.preventDefault(); fechar(); } });
$('mFechar').onclick = () => fechar(); $('mCancelar').onclick = () => fechar();

// --- comentários ---
function desenharComentarios() {
  const box = $('mComentarios');
  const lista = editando.comentarios || [];
  box.innerHTML = lista.length ? lista.map(c => `<div class="coment"><b>${esc(c.autor)}</b><time>${quando(c.data)}</time><p>${esc(c.texto)}</p></div>`).join('') : '<p class="nota">Sem comentários ainda.</p>';
  box.scrollTop = box.scrollHeight;
}
// Comentar → (opcional) a MIA lê o comentário e sugere o cartão reescrito. Nada muda até clicar em "Usar sugestão".
const lerPref = () => { try { return localStorage.getItem('miaLeComentario') !== '0'; } catch { return true; } };
$('mMiaLe').checked = lerPref();
const rotuloComentar = () => { $('mComentar').textContent = $('mMiaLe').checked ? '💬 Comentar e pedir sugestão à MIA' : 'Comentar'; };
$('mMiaLe').onchange = () => { try { localStorage.setItem('miaLeComentario', $('mMiaLe').checked ? '1' : '0'); } catch {} rotuloComentar(); };
rotuloComentar();
$('mComentar').onclick = async () => {
  const t = $('mNovoComent').value.trim(); if (!t) return;
  $('mComentar').disabled = true;
  try {
    await acao({ acao: 'comentar', id: aberto, texto: t }); $('mNovoComent').value = '';
    if ($('mMiaLe').checked && editando) {
      lerCampos();
      const box = $('mSugestao'); box.hidden = false; box.className = 'sugestao-mia lendo';
      box.innerHTML = '<span class="carregando-mia"></span><b>A MIA está lendo seu comentário…</b>';
      const atual = quadro.cartoes.find(x => x.id === aberto);
      enviar({ tipo: 'mkt_escrever', cartao: { ...editando, comentarios: atual?.comentarios || editando.comentarios, id: aberto }, comentario: t, autor: eu.nome });
    }
  }
  catch (e) { avisar(e.message, 'erro'); } finally { $('mComentar').disabled = false; }
};
let sugestaoMia = null;
function mostrarSugestaoMia(m) {
  const box = $('mSugestao');
  if (m.id !== aberto || !editando) return;
  const r = m.campos || {}; sugestaoMia = r;
  const campos = [['titulo', 'Título', $('mTitulo').value], ['texto_arte', 'Texto da arte', $('mTextoArte').value], ['legenda', 'Legenda', $('mLegenda').value], ['descricao', 'Briefing', $('mDescricao').value]]
    .filter(([k, , atual]) => r[k] && r[k].trim() !== String(atual || '').trim());
  const novosItens = (r.checklist || []).filter(x => x?.t && !(editando.checklist || []).some(y => y.t === x.t));
  box.className = 'sugestao-mia';
  if (!campos.length && !novosItens.length) { box.innerHTML = `<b>🦊 MIA:</b> ${esc(r.comentario || 'Li o comentário e o cartão já está de acordo.')} <button type="button" class="mini" id="mSugFechar">ok</button>`; $('mSugFechar').onclick = () => { box.hidden = true; }; return; }
  box.innerHTML = `<div class="sug-topo"><img src="img/mia-rosto.png" alt=""><b>Sugestão da MIA</b><span>${esc(r.comentario || '')}</span></div>
    ${campos.map(([k, nome]) => `<div class="sug-campo"><small>${nome}</small><p>${esc(r[k])}</p></div>`).join('')}
    ${novosItens.length ? `<div class="sug-campo"><small>Checklist (novo)</small><p>${novosItens.map(x => '☐ ' + esc(x.t)).join('<br>')}</p></div>` : ''}
    <div class="sug-botoes"><button type="button" class="botao verde" id="mSugUsar">✅ Usar sugestão</button><button type="button" class="botao claro" id="mSugDescartar">Descartar</button></div>`;
  $('mSugDescartar').onclick = () => { box.hidden = true; sugestaoMia = null; };
  $('mSugUsar').onclick = async () => {
    aplicarEscritaMia({ id: aberto, campos: sugestaoMia });
    box.hidden = true; sugestaoMia = null;
    await salvar(false);
    avisar('Sugestão da MIA aplicada e salva ✅', 'ok');
  };
}

// --- anexos ---
function desenharAnexos() {
  const box = $('mAnexos'); box.innerHTML = '';
  for (const a of editando.anexos || []) {
    const img = /^image\//.test(a.tipo);
    const d = el('div', 'anexo', `${img ? '<img class="previa" alt="">' : `<div class="previa arquivo">${/pdf/.test(a.tipo) ? '📄' : '🗂️'}</div>`}
      <div class="nome" title="${esc(a.nome)}">${esc(a.nome)}</div><div class="info">${(a.tamanho / 1024 / 1024).toFixed(1)} MB · ${esc(a.autor)} · <a href="#" class="baixar">baixar</a></div>
      ${eu.perfil === 'central' || a.autor === eu.nome ? '<button type="button" class="tirar" title="Remover">×</button>' : ''}`);
    const abrirArq = async (baixar) => { try { const u = await urlAnexo(a.id); const l = document.createElement('a'); l.href = u; if (baixar) l.download = a.nome; else l.target = '_blank'; l.click(); } catch (e) { avisar(e.message, 'erro'); } };
    d.querySelector('.previa').onclick = () => abrirArq(false);
    d.querySelector('.baixar').onclick = (e) => { e.preventDefault(); abrirArq(true); };
    if (img) urlAnexo(a.id).then(u => { d.querySelector('img').src = u; }).catch(() => {});
    const tirar = d.querySelector('.tirar');
    if (tirar) tirar.onclick = async () => { if (!confirm(`Remover "${a.nome}"?`)) return; try { await acao({ acao: 'remover_anexo', id: aberto, anexo: a.id }); } catch (e) { avisar(e.message, 'erro'); } };
    box.appendChild(d);
  }
}
const paraB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
async function anexar(arquivos) {
  for (const f of arquivos) {
    if (f.size > 8 * 1024 * 1024) { avisar(`"${f.name}" passa de 8 MB. Exporte em JPG/PNG menor.`, 'erro'); continue; }
    $('mStatus').textContent = `Enviando ${f.name}…`;
    try { await acao({ acao: 'anexar', id: aberto, nome: f.name || 'colado.png', tipo: f.type || 'application/octet-stream', b64: await paraB64(f) }); $('mStatus').textContent = `${f.name} anexado ✓`; }
    catch (e) { avisar(e.message, 'erro'); $('mStatus').textContent = ''; }
  }
}
$('mArquivo').addEventListener('change', (e) => { anexar([...e.target.files]); e.target.value = ''; });
const zona = $('mSoltar');
zona.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); zona.classList.add('alvo'); } });
zona.addEventListener('dragleave', () => zona.classList.remove('alvo'));
zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('alvo'); anexar([...e.dataTransfer.files]); });
$('modal').addEventListener('paste', (e) => {
  const arqs = [...(e.clipboardData?.files || [])];
  if (arqs.length && aberto) { e.preventDefault(); anexar(arqs); }
});

// --- copiar ---
async function copiar(txt, ok) { try { await navigator.clipboard.writeText(txt); avisar(ok, 'ok'); } catch { avisar('Não consegui copiar.', 'erro'); } }
$('mCopiarLegenda').onclick = () => copiar($('mLegenda').value, 'Legenda copiada ✓');
// Versão para o Status do WhatsApp: sem hashtags, curta (até ~160 letras) e com a chamada do app.
function versaoStatus(legenda) {
  const linhas = String(legenda || '').split('\n').map(l => l.trim()).filter(l => l && !/^(#\S+\s*)+$/.test(l));
  let txt = linhas.join(' ').replace(/\s#\S+/g, '').replace(/\s+/g, ' ').trim();
  if (txt.length > 160) { const corte = txt.slice(0, 160); const fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('! '), corte.lastIndexOf('? ')); txt = fim > 60 ? corte.slice(0, fim + 1) : corte.replace(/\s+\S*$/, '') + '…'; }
  if (!/app Mais Delivery/i.test(txt)) txt += ' 📲 Peça agora no app Mais Delivery!';
  return txt;
}
$('mCopiarStatus').onclick = () => { if (!$('mLegenda').value.trim()) return avisar('Escreva a legenda primeiro.', 'erro'); copiar(versaoStatus($('mLegenda').value), 'Versão para Status copiada ✓'); };
$('mWhats').onclick = () => {
  lerCampos();
  const c = editando;
  const txt = [`*${c.titulo}*`, c.loja ? `🏪 Loja: ${c.loja}` : '', (c.formatos || []).length ? `📐 Formatos: ${c.formatos.map(f => `${FORMATOS[f]?.nome} (${FORMATOS[f]?.medida})`).join(', ')}` : '',
    c.prazo ? `⏳ Prazo da arte: ${dataBR(c.prazo)}` : '', c.publicar_em ? `📣 Publicar em: ${dataBR(c.publicar_em)}` : '', c.horario ? `🕐 Horário: ${c.horario}` : '',
    c.produtos?.length ? `🍔 Produtos: ${c.produtos.join(', ')}` : '', c.descricao ? `\n*Briefing*\n${c.descricao}` : '', c.texto_arte ? `\n*Texto da arte*\n${c.texto_arte}` : '',
    c.legenda ? `\n*Legenda*\n${c.legenda}` : ''].filter(Boolean).join('\n');
  copiar(txt, 'Briefing copiado. É só colar no WhatsApp ✓');
};

// --- MIA melhora o cartão ---
$('mMia').onclick = () => {
  lerCampos();
  $('mMia').disabled = true; $('mMia').innerHTML = '<span class="carregando-mia"></span>A MIA está escrevendo…';
  enviar({ tipo: 'mkt_escrever', cartao: { ...editando, id: aberto }, pedido: $('mPedidoMia').value.trim() });
};
function aplicarEscritaMia(m) {
  $('mMia').disabled = false; $('mMia').innerHTML = '<img src="img/mia-rosto.png" alt="">MIA, melhora este cartão';
  if (m.id !== aberto || !editando) return;
  const r = m.campos || {};
  if (r.titulo) $('mTitulo').value = r.titulo;
  if (r.descricao) $('mDescricao').value = r.descricao;
  if (r.texto_arte) $('mTextoArte').value = r.texto_arte;
  if (r.legenda) $('mLegenda').value = r.legenda;
  if (Array.isArray(r.checklist) && r.checklist.length) { editando.checklist = r.checklist.filter(x => x?.t).map(x => ({ t: x.t, ok: false })); desenharChecklist(); }
  marcarSujo(); $('mPedidoMia').value = '';
  $('mStatus').textContent = `MIA: ${r.comentario || 'pronto, dá uma olhada'} — confira e clique em Salvar.`;
}

// --- arquivar / lixeira / excluir de vez ---
// Fora da lixeira: Arquivar + Lixeira (qualquer pessoa). Na lixeira: Restaurar (qualquer pessoa) + Excluir de vez (só a central).
function atualizarBotoesFim() {
  const c = editando; if (!c) return;
  const lixo = c.coluna === 'lixeira';
  $('mArquivar').hidden = lixo;
  $('mArquivar').textContent = c.coluna === 'arquivado' ? '↩️ Desarquivar' : '🗄️ Arquivar';
  $('mLixeira').hidden = lixo;
  $('mRestaurar').hidden = !lixo;
  $('mRestaurar').textContent = `↩️ Restaurar para ${NOME_COLUNA[c.coluna_antes] || NOME_COLUNA.afazer}`;
  $('mExcluir').hidden = !(lixo && eu.perfil === 'central');
}
$('mArquivar').onclick = async () => irPara(editando.coluna === 'arquivado' ? 'afazer' : 'arquivado');
$('mLixeira').onclick = async () => { const id = aberto; await salvar(false); fechar(true); await mover(id, 'lixeira'); };
$('mRestaurar').onclick = async () => irPara(COLUNAS.some(x => x.id === editando.coluna_antes && x.id !== 'lixeira') ? editando.coluna_antes : 'afazer');
$('mExcluir').onclick = async () => {
  if (!confirm('Excluir de vez este cartão (com as artes anexadas)? Isso não tem volta.')) return;
  try { await acao({ acao: 'excluir', id: aberto }); fechar(true); avisar('Cartão excluído de vez', 'ok'); } catch (e) { avisar(e.message, 'erro'); }
};

// --- próximas datas ---
const semAcento = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function abrirDatas() {
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const lista = proximasDatas(new Date(), 60);
  const ul = $('listaDatas'); ul.innerHTML = '';
  for (const d of lista) {
    const ja = quadro.cartoes.find(c => (c.chave || '').startsWith(`data:${d.data}`) || semAcento(c.titulo).includes(semAcento(d.nome)));
    const li = el('li', '', `<div class="dia">${d.data.slice(8, 10)}<small>${MESES[Number(d.data.slice(5, 7)) - 1]}</small></div>
      <div class="txt"><b>${esc(d.nome)}</b><span>${d.faltam === 0 ? 'Hoje' : `Em ${d.faltam} dia${d.faltam > 1 ? 's' : ''}`} · arte até ${dataBR(d.prazo)} · ${esc(d.dica)}</span></div>`);
    if (ja) { const t = el('span', 'tem', `✓ no quadro`); t.title = ja.titulo; li.appendChild(t); }
    else {
      const b = el('button', 'botao claro', '＋ Cartão'); b.type = 'button';
      b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await acao({ acao: 'criar', cartao: { titulo: `📅 ${d.nome}`, tipo: 'data', chave: `data:${d.data}:${semAcento(d.nome)}`, prazo: d.prazo, publicar_em: d.data,
            descricao: `${d.dica}\n(Escreva o briefing ou clique em "MIA, melhora este cartão".)`, formatos: ['feed', 'story'] } });
          b.replaceWith(el('span', 'tem', '✓ criado'));
          avisar(`Cartão "${d.nome}" criado em 📋 A fazer`, 'ok');
        } catch (e) { b.disabled = false; avisar(e.message, 'erro'); }
      };
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
  $('datas').showModal();
}
$('datasFechar').onclick = () => $('datas').close();
$('btnDatas').onclick = abrirDatas;

// ---------------- início ----------------
(async () => {
  conectar();
  const { perfil = 'central', nomeUsuario = '' } = await chrome.storage.local.get(['perfil', 'nomeUsuario']);
  eu = { perfil, nome: nomeUsuario }; mostrarPerfil();
  desenharFiltros();
  desenhar();
  enviar({ tipo: 'perfil' });
  await puxar();
})();
