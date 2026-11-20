// central.js — Central da MIA em aba inteira: missões, varredura, melhorias, chat e avisos do MAX.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let porta = conectar();
let anexos = [];
let estabAtual = null;
let ultimaVarredura = null;
let ultimasMelhorias = null;
let melhoriasNaTela = null; // o resultado que está desenhado na tela de Melhorias
let abaInicial = 'descricoes';
let voltarPara = null; // tela para voltar se a tarefa longa falhar

// Conexão com o "cérebro" da extensão. Se a extensão foi atualizada (⟳), esta aba antiga perde a ligação:
// em vez de gerar erros, ela recarrega sozinha (ou avisa, se não der).
let extensaoAtualizada = false;
function extensaoViva() { try { return !!chrome.runtime?.id; } catch { return false; } }
function aposAtualizar() {
  if (extensaoAtualizada) return; extensaoAtualizada = true;
  try { location.reload(); } catch { document.body.innerHTML = '<p style="font:16px sans-serif;padding:40px">A MIA foi atualizada. Feche esta aba e clique de novo no ícone da MIA.</p>'; }
}
function conectar() {
  if (!extensaoViva()) { aposAtualizar(); return { postMessage() {} }; }
  let p;
  try { p = chrome.runtime.connect({ name: 'mia' }); } catch { aposAtualizar(); return { postMessage() {} }; }
  p.onMessage.addListener(receber);
  p.onDisconnect.addListener(() => { if (extensaoViva()) porta = conectar(); else aposAtualizar(); });
  const enviar = p.postMessage.bind(p);
  p.postMessage = (m) => { try { enviar(m); } catch { if (extensaoViva()) { porta = conectar(); porta.postMessage(m); } else aposAtualizar(); } };
  return p;
}

// ---------------- navegação ----------------
const TELAS = ['telaInicio', 'telaCarregando', 'telaVarredura', 'telaMelhorias', 'telaChat', 'telaReajuste', 'telaHistorico', 'telaCriar', 'telaRevisao', 'telaFotos', 'telaRanking'];
function mostrar(tela) {
  TELAS.forEach(t => { $(t).hidden = t !== tela; });
  $('btnVoltar').hidden = tela === 'telaInicio';
  window.scrollTo(0, 0);
}
$('btnVoltar').onclick = () => mostrar('telaInicio');

// ---------------- a dupla ----------------
const FOTO = { mia: 'img/mia-rosto.png', max: 'img/max-rosto.png' };
function dialogo(id, falas) {
  const box = $(id); box.innerHTML = '';
  falas.filter(Boolean).forEach(([quem, html]) => box.appendChild(el('div', `fala ${quem}`,
    `<img class="foto" src="${FOTO[quem]}" alt=""><div class="balao"><b class="quem ${quem}">${quem.toUpperCase()}</b>${html}</div>`)));
}

// ---------------- avisos do MAX ----------------
let timerAviso;
// Separa a parte técnica (resposta do painel, JSON) do texto para o atendente.
function separarDetalhe(texto) {
  const t = String(texto ?? '');
  const m = t.match(/\s*\((?:resposta|detalhe)s?:\s*([\s\S]*)\)\.?\s*$/i) || t.match(/:\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
  if (!m) return { curto: t, detalhe: '' };
  return { curto: (t.slice(0, m.index).trim().replace(/[:\s]+$/, '') + '.').replace(/\.\.$/, '.'), detalhe: m[1] };
}
function comDetalhe(alvo, texto) {
  const { curto, detalhe } = separarDetalhe(texto);
  alvo.textContent = curto;
  if (detalhe) {
    const d = document.createElement('details'); d.className = 'detalhe-tecnico';
    d.innerHTML = '<summary>ver detalhes</summary>'; const pre = document.createElement('code'); pre.textContent = detalhe; d.appendChild(pre);
    alvo.appendChild(d);
  }
}
function maxAvisa(texto, tipo = '', titulo = 'MAX avisa', quem = 'max') {
  $('avisoTitulo').textContent = titulo;
  $('avisoFoto').src = FOTO[quem];
  comDetalhe($('avisoTexto'), texto);
  const a = $('aviso'); a.className = `max-aviso ${tipo} ${quem}`; a.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { a.hidden = true; }, tipo === 'erro' ? 9000 : 5000);
}
$('avisoFechar').onclick = () => { $('aviso').hidden = true; };

// ---------------- estabelecimento atual ----------------
// Pergunta qual estabelecimento está aberto. Agrupa os pedidos (troca de aba, página carregando, timer)
// para não rodar várias leituras no painel ao mesmo tempo, e não pergunta com a janela escondida.
let tEstab = null;
function atualizarEstab() {
  clearTimeout(tEstab);
  tEstab = setTimeout(() => { if (!document.hidden) porta.postMessage({ tipo: 'qual_estab' }); }, 400);
}
const timerEstab = setInterval(() => { if (extensaoViva()) atualizarEstab(); else { clearInterval(timerEstab); aposAtualizar(); } }, 5000);
chrome.tabs.onActivated.addListener(atualizarEstab);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') atualizarEstab(); });

function mostrarEstab(m) {
  const box = $('estab');
  if (m.erro || !m.atual) { box.className = 'estab'; $('estabNome').textContent = m.erro ? 'Abra o painel do Mais Delivery' : 'Painel aberto, estabelecimento não identificado'; estabAtual = null; falaInicio(null); return; }
  if (m.atual !== estabAtual) {
    if (ultimaVarredura?.estab !== m.atual) ultimaVarredura = null;
    if (ultimasMelhorias?.estab !== m.atual) ultimasMelhorias = null;
  }
  estabAtual = m.atual;
  if (m.atual === 'Gerencial') { box.className = 'estab alerta'; $('estabNome').textContent = 'Gerencial — escolha um estabelecimento'; falaInicio('Gerencial'); return; }
  box.className = 'estab ok';
  $('estabNome').textContent = m.atual;
  falaInicio(m.atual);
}
let ultimaFalaInicio = '-';
function falaInicio(estab) {
  if (estab === ultimaFalaInicio) return; ultimaFalaInicio = estab;
  if (!estab) return dialogo('dlgInicio', [['mia', 'Oi! Eu sou a <b>MIA</b> 🤓 Abre o painel do Mais Delivery numa aba pra gente começar.'], ['max', 'E eu sou o <b>MAX</b>! Tô pronto quando você estiver 🦊']]);
  if (estab === 'Gerencial') return dialogo('dlgInicio', [['mia', 'Você está no <b>Gerencial</b>. Escolhe um estabelecimento no seletor ⇄ do painel que eu dou uma olhada no cardápio.'], ['max', 'Aí é comigo: o que ela achar, eu resolvo! 💪']]);
  dialogo('dlgInicio', [['mia', `Oi! Eu sou a <b>MIA</b> 🤓 Eu leio e analiso o cardápio do <b>${esc(estab)}</b>.`], ['max', 'E eu sou o <b>MAX</b>! Ela acha, eu resolvo. Escolhe uma missão 👇']]);
}

// ---------------- missões ----------------
const DICAS = [
  'Produto com descrição vende mais: o cliente sabe exatamente o que vai receber.',
  'Combos aumentam o ticket médio. Bebida + prato é o clássico que funciona.',
  'Categorias carro-chefe no topo: o cliente decide nos primeiros segundos.',
  'Nomes curtos e claros são lidos mais rápido no celular.',
  'Fotos boas fazem mais diferença que qualquer desconto.',
];
function carregar(titulo, quem = 'mia', volta = null) {
  voltarPara = volta;
  $('carTitulo').textContent = titulo;
  $('carMia').hidden = quem === 'max';
  $('carBarra').style.width = '3%';
  $('carEtapa').textContent = 'Começando…';
  $('carDica').textContent = '💡 ' + DICAS[Math.floor(Math.random() * DICAS.length)];
  mostrar('telaCarregando');
}

function podeRodar() {
  if (!estabAtual) { maxAvisa('Abre o painel do Mais Delivery numa aba e entra num estabelecimento primeiro!', 'erro', 'Opa!'); return false; }
  if (estabAtual === 'Gerencial') { maxAvisa('Você está no Gerencial. Escolhe um estabelecimento no seletor ⇄ do painel e tenta de novo.', 'erro', 'Quase lá!'); return false; }
  return true;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-acao]');
  if (!b) return;
  const acao = b.dataset.acao;
  if (acao === 'criar') { if (podeRodar()) abrirCriar(); return; }
  if (acao === 'ranking') { abrirRanking(); return; }
  if (acao === 'fotos') { if (podeRodar()) { carregar('A MIA está procurando o que está sem foto…', 'mia', 'telaInicio'); porta.postMessage({ tipo: 'fotos_buscar' }); } return; }
  if (acao === 'pedido') { mostrar('telaChat'); opcoesPedido(); return; }
  if (acao === 'chat') return mostrar('telaChat');
  if (acao === 'historico') { mostrar('telaHistorico'); return porta.postMessage({ tipo: 'historico' }); }
  if (!podeRodar()) return;
  if (acao === 'reajuste') { abrirReajuste(); return; }
  if (acao === 'varredura') {
    if (ultimaVarredura) return desenharVarredura(ultimaVarredura);
    carregar('A MIA está varrendo o cardápio…'); porta.postMessage({ tipo: 'varredura' });
  }
  if (acao === 'melhorias' || acao === 'combos') {
    abaInicial = acao === 'combos' ? 'combos' : 'descricoes';
    if (ultimasMelhorias) return desenharMelhorias(ultimasMelhorias);
    carregar(acao === 'combos' ? 'A MIA está montando combos…' : 'A MIA está caçando melhorias…'); porta.postMessage({ tipo: 'melhorias' });
  }
});

// ---------------- mensagens do background ----------------
function receber(m) {
  if (m.tipo === 'estab') mostrarEstab(m);
  if (m.tipo === 'progresso') { $('carBarra').style.width = m.pct + '%'; $('carEtapa').textContent = m.etapa; }
  if (m.tipo === 'varredura_ok') { ultimaVarredura = m; $('carBarra').style.width = '100%'; setTimeout(() => desenharVarredura(m), 300); }
  if (m.tipo === 'melhorias_ok') { ultimasMelhorias = m; $('carBarra').style.width = '100%'; setTimeout(() => desenharMelhorias(m), 300); }
  if (m.tipo === 'fotos_sugestoes') { $('carBarra').style.width = '100%'; setTimeout(() => desenharFotos(m), 300); }
  if (m.tipo === 'fotos_mais') maisFotos(m);
  if (m.tipo === 'fotos_aplicadas') fimFotos(m);
  if (m.tipo === 'ranking_progresso') progressoRanking(m);
  if (m.tipo === 'ranking_ok') fimRanking(m);
  if (m.tipo === 'ranking_erro') { estadoRanking(false); maxAvisa(m.texto, 'erro', 'Ranking parado ✋'); }
  if (m.tipo === 'ranking_ultimo') { if (m.rankings?.length) desenharRanking({ ...m.rankings[0], anterior: m.rankings[1] || null }); }
  if (m.tipo === 'mensagem_ok') mostrarMensagem(m);
  if (m.tipo === 'sugeridos_ok') aoSugeridosOk(m);
  if (m.tipo === 'combo_ok') aoComboOk(m);
  if (m.tipo === 'falha_leve') {
    // devolve os botões de Desfazer que ficaram em "Aplicando…"
    document.querySelectorAll('[data-desfazer]:disabled').forEach(b => { b.disabled = false; b.textContent = '↩ Desfazer'; b.classList.remove('confirma'); });
    return maxAvisa(m.texto, 'erro', 'MIA: não deu 😬', 'mia');
  }
  if (m.tipo === 'criar_rascunho') { $('carBarra').style.width = '100%'; setTimeout(() => desenharRevisao(m), 300); }
  if (m.tipo === 'criar_progresso') progressoGravacao(m);
  if (m.tipo === 'criar_ok') fimGravacao(m);
  if (m.tipo === 'criar_erro') { $('rvGravar').disabled = false; $('rvGravar').textContent = '🚀 Tentar de novo'; maxAvisa(m.texto, 'erro', 'Parei aqui ✋'); }
  if (m.tipo === 'ordem_ok') { maxAvisa('Ordem das categorias aplicada no app! Dá pra desfazer no Histórico.', 'ok', 'Reorganizado ↕'); }
  if (m.tipo === 'categoria_ok') { const c = melhoriasNaTela?.categorias?.find(x => x.atual === m.atual); if (c) c.aplicada = true; if (!$('telaMelhorias').hidden) desenharAba('categorias'); maxAvisa(`"${m.sugerido}" no ar com ${m.qtd} produto(s), na mesma posição de antes.`, 'ok', 'Categoria nova ✨'); }
  if (m.tipo === 'falha') {
    if (voltarPara) { const t = voltarPara; voltarPara = null; mostrar(t); } else mostrar('telaInicio');
    if (m.texto === 'MAX_GERENCIAL') return maxAvisa('Você está no Gerencial. Escolhe um estabelecimento e tenta de novo.', 'erro', 'Quase lá!');
    maxAvisa(m.texto, 'erro', 'MIA: deu ruim aqui 😬', 'mia');
  }
  if (m.tipo === 'reajuste_preview') desenharPrevia(m);
  if (m.tipo === 'historico') desenharHistorico(m.lista);
  if (m.tipo === 'alterado') aoAlterar(m.alteracao);
  if (m.tipo === 'desfeito') {
    const a = m.alteracao;
    const t = a.campo === 'criado' ? `"${a.nome}" foi excluído do painel.` : a.campo === 'ordem' ? 'As categorias voltaram para a ordem de antes.' : a.campo === 'categoria' ? `Os produtos voltaram para "${a.antes.nome}".` : `${a.nome} voltou para ${fmt(a.campo, a.antes)}.`;
    maxAvisa('Desfeito: ' + t, 'ok', 'Voltei atrás ↩'); porta.postMessage({ tipo: 'historico' });
  }
  if (m.tipo === 'progresso_aplicar') aoProgredir(m);
  if (m.tipo === 'progresso_desfazer') { const b = document.querySelector(`[data-desfazer-lote="${CSS.escape(m.lote)}"]`); if (b) b.textContent = `⏳ ${m.feito + 1}/${m.total}`; }
  if (m.tipo === 'lote_desfeito') {
    const n = m.feitos.length, f = m.falhas.length;
    maxAvisa(f ? `Desfiz ${n}. ${f} não deu: ${m.falhas.slice(0, 2).map(x => `${x.nome} (${x.erro})`).join('; ')}` : `Pronto! Desfiz as ${n} alterações do lote. Tudo voltou como era antes.`, f ? 'erro' : 'ok', f ? 'Quase tudo ↩' : 'Voltei atrás ↩');
    porta.postMessage({ tipo: 'historico' });
  }
  if (m.tipo === 'aplicado') aoAplicar(m);
  // chat
  if (m.tipo === 'resposta') porFalante(m.texto).forEach(([quem, t]) => { const d = el('div', 'msg ' + quem); d.innerHTML = `<b class="quem ${quem}">${quem.toUpperCase()}</b>`; d.appendChild(document.createTextNode(t)); $('conversa').appendChild(d); d.scrollIntoView({ block: 'end' }); });
  if (m.tipo === 'erro') adicionar('erro', '⚠ ' + m.texto);
  if (m.tipo === 'status') { $('status').textContent = m.texto; chatOcupado = !!m.texto; $('btnEnviar').disabled = chatOcupado; }
  if (m.tipo === 'confirmar') { mostrar('telaChat'); pedirConfirmacao(m.texto); maxAvisa('Preciso da sua confirmação antes de continuar.', '', 'Confere aí!'); }
}

// ---------------- tela: varredura ----------------
function desenharVarredura(m) {
  const n = m.nota;
  const anel = $('anel');
  anel.style.setProperty('--cor', n >= 80 ? 'var(--verde)' : n >= 55 ? 'var(--laranja)' : 'var(--vermelho)');
  let atual = 0;
  const anima = setInterval(() => { atual = Math.min(n, atual + 2); anel.style.setProperty('--p', atual); $('notaNum').textContent = atual; if (atual >= n) clearInterval(anima); }, 16);
  $('notaTitulo').textContent = n >= 85 ? 'Cardápio caprichado! 🏆' : n >= 65 ? 'Tá bom, dá pra melhorar 👍' : n >= 40 ? 'Precisa de atenção ⚠️' : 'Bora arrumar isso! 🛠️';
  $('totais').innerHTML = [`🍽 ${m.totais.produtos} produtos`, `🗂 ${m.totais.categorias} categorias`, `🧩 ${m.totais.niveis} níveis`].map(t => `<span class="chip">${t}</span>`).join('');

  const conta = (nv) => m.problemas.filter(p => p.nivel === nv).length;
  const e = conta('erro'), a = conta('aviso'), d = conta('dica');
  dialogo('dlgVarredura', (e + a + d === 0)
    ? [['mia', `Li tudinho do <b>${esc(m.estab)}</b> e não achei nenhum problema. 🤩`], ['max', 'Cardápio nota 10! Bora ver as melhorias pra vender ainda mais? 🎉']]
    : [['mia', `Varri o <b>${esc(m.estab)}</b>: achei <b>${e}</b> erro(s), <b>${a}</b> aviso(s) e <b>${d}</b> dica(s). Os vermelhos primeiro, tá? 👓`],
       ['max', (m.problemas.some(p => p.acoes?.some(Boolean) || p.grupo) ? 'Onde tiver botão, é só clicar em <b>Corrigir</b> ou <b>Aplicar</b> que eu ajusto no painel na hora. ' : '') + (e ? 'Os vermelhos primeiro! 💪' : 'Nada grave! 😉')]]);

  desenharProblemas(m);
  mostrar('telaVarredura');

}

// Lista de problemas com os botões de correção (Aplicar / Corrigir / Adicionar foto…).
function botaoAcao(a, ref) {
  if (!a) return '';
  if (a.feito) return '<span class="vr-acao"><span class="selo">✓ corrigido</span></span>';
  const botao = (txt) => `<button class="botao mini aplicar" data-vr="${ref}">${txt}</button>`;
  const campo = (cls, ph, extra = '') => `<input class="vr-campo ${cls}" data-vr-campo="${ref}" value="${esc(a.valor ?? '')}" placeholder="${ph}" ${extra}>`;
  if (a.tipo === 'aplicar') return `<span class="vr-acao">${botao(esc(a.rotulo || 'Aplicar'))}</span>`;
  if (a.tipo === 'preco') return `<span class="vr-acao">${campo('', 'R$ 0,00', 'inputmode="decimal"')}${botao('💲 Corrigir')}${a.rotulo ? `<small>${esc(a.rotulo)}</small>` : ''}</span>`;
  if (a.tipo === 'estoque') return `<span class="vr-acao">${campo('', 'estoque', 'inputmode="numeric"')}${botao('📦 Repor')}</span>`;
  if (a.tipo === 'texto') return `<span class="vr-acao largo">${campo('largo', 'texto corrigido')}${botao('✏️ Corrigir')}</span>`;
  return '';
}
function desenharProblemas(m) {
  const lista = $('listaProblemas');
  const abertos = new Set([...lista.querySelectorAll('details[open]')].map(d => d.dataset.pi));
  const primeira = !lista.childElementCount;
  lista.innerHTML = '';
  if (!m.problemas.length) lista.appendChild(el('div', 'vazio cartao', '<img src="img/max.png" alt=""><h3>Tudo certinho!</h3>'));
  const ordem = { erro: 0, aviso: 1, dica: 2 };
  m.problemas.map((p, pi) => ({ p, pi })).sort((x, y) => ordem[x.p.nivel] - ordem[y.p.nivel]).forEach(({ p, pi }, i) => {
    const rotulo = { erro: 'Erro', aviso: 'Aviso', dica: 'Dica' }[p.nivel];
    const max = p.acoes ? 40 : 12;
    const itens = p.itens.slice(0, max).map((t, j) => `<li>${esc(t)}${botaoAcao(p.acoes?.[j], `${pi}:${j}`)}</li>`).join('') + (p.itens.length > max ? `<li class="mais">+ ${p.itens.length - max} outros</li>` : '');
    const pendentes = (p.acoes || []).filter(a => a?.tipo === 'aplicar' && !a.feito).length;
    const grupo = [pendentes > 1 ? `<button class="botao mini aplicar" data-vr-todos="${pi}">✅ Aplicar em todos (${pendentes})</button>` : '',
      p.grupo?.tipo === 'missao' ? `<button class="botao mini" data-acao="${esc(p.grupo.acao)}">${esc(p.grupo.rotulo)}</button>` : ''].join('');
    const d = el('details', `cartao problema ${p.nivel}`, `<summary><span class="tag">${rotulo}</span><b>${esc(p.titulo)}</b>${p.itens.length ? `<span class="qtd">${p.itens.length}</span>` : ''}</summary><p>${esc(p.detalhe)}</p>${itens ? `<ul>${itens}</ul>` : ''}${grupo ? `<div class="vr-grupo">${grupo}</div>` : ''}`);
    d.dataset.pi = pi;
    if (primeira ? (i === 0 && p.nivel === 'erro') : abertos.has(String(pi))) d.open = true;
    lista.appendChild(d);
  });
}

// Monta a alteração a partir do botão (lê o campo editável quando tem).
function itemDaVarredura(m, ref) {
  const [pi, j] = ref.split(':').map(Number);
  const a = m.problemas[pi]?.acoes?.[j];
  if (!a || a.feito) return null;
  let valor = a.valor;
  const inp = document.querySelector(`[data-vr-campo="${ref}"]`);
  if (inp) {
    const t = inp.value.trim();
    if (a.tipo === 'preco') { valor = lerReais(t); if (!(valor > 0)) throw new Error(`Digite o preço de "${a.nome}" (ex.: 12,50).`); valor = reais(valor); }
    else if (a.tipo === 'estoque') { valor = Number(t.replace(/\D/g, '')); if (!t || !Number.isFinite(valor)) throw new Error(`Digite o estoque de "${a.nome}".`); }
    else { valor = t; if (!valor) throw new Error(`O texto de "${a.nome}" ficou vazio.`); }
  }
  return { ref, id: a.id, nome: a.nome, campo: a.campo, valor };
}
document.addEventListener('click', (e) => {
  const um = e.target.closest('[data-vr]'), todos = e.target.closest('[data-vr-todos]');
  if (!um && !todos) return;
  const m = ultimaVarredura; if (!m) return;
  let itens;
  try {
    itens = um ? [itemDaVarredura(m, um.dataset.vr)]
      : (m.problemas[Number(todos.dataset.vrTodos)].acoes || []).map((a, j) => a?.tipo === 'aplicar' && !a.feito ? itemDaVarredura(m, `${todos.dataset.vrTodos}:${j}`) : null);
  } catch (err) { return maxAvisa(err.message, 'erro', 'Falta um dado'); }
  itens = itens.filter(Boolean);
  if (!itens.length) return;
  doisToques(um || todos, () => {
    aplicando = { tipo: 'varredura', refs: itens.map(x => x.ref) };
    porta.postMessage({ tipo: 'aplicar', estab: m.estab, rotulo: `Varredura: ${itens.length} correção(ões)`, itens: itens.map(({ ref, ...x }) => x) });
  });
});
// Enter no campo = clicar em Corrigir.
document.addEventListener('keydown', (e) => {
  const inp = e.target.closest?.('[data-vr-campo]');
  if (inp && e.key === 'Enter') { e.preventDefault(); document.querySelector(`[data-vr="${inp.dataset.vrCampo}"]`)?.click(); }
});

$('copiarRelatorio').onclick = async () => {
  const m = ultimaVarredura; if (!m) return;
  const txt = [`Varredura MIA – ${m.estab} – nota ${m.nota}/100`, ''].concat(
    m.problemas.flatMap(p => [`[${p.nivel.toUpperCase()}] ${p.titulo}`, ...p.itens.map(i => `  • ${i}`), ''])).join('\n');
  try { await navigator.clipboard.writeText(txt); } catch { return maxAvisa('Não consegui copiar. Clique na janela da MIA e tente de novo.', 'erro', 'Ops'); }
  maxAvisa('Relatório copiado! Dá pra colar no WhatsApp do parceiro.', 'ok', 'MIA: copiado 📋', 'mia');
};

// ---------------- tela: melhorias ----------------
function desenharMelhorias(m) {
  melhoriasNaTela = m;
  dialogo('dlgMelhorias', [['mia', `<b>${esc(m.estab)}</b>: ${esc(m.resumo || 'Separei algumas ideias pra esse cardápio vender mais.')}`],
    ['max', 'Gostou de alguma descrição? Clica em <b>Aplicar</b> que eu coloco no painel na hora!']]);
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === abaInicial));
  desenharAba(abaInicial);
  mostrar('telaMelhorias');
}
$('abas').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#abas button').forEach(x => x.classList.toggle('ativa', x === b));
  desenharAba(b.dataset.aba);
};

function botaoCopiar(texto) { return `<button class="botao mini" data-copiar="${esc(texto)}">📋 Copiar</button>`; }
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copiar]'); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copiar); } catch { return maxAvisa('Não consegui copiar. Clique na janela da MIA e tente de novo.', 'erro', 'Ops'); }
  b.textContent = '✓ Copiado';
  setTimeout(() => { b.textContent = '📋 Copiar'; }, 1500);
});

function desenharAba(aba) {
  const m = melhoriasNaTela, box = $('conteudoAba');
  box.innerHTML = '';
  if (!m) { box.appendChild(el('div', 'cartao vazio', '<p>As sugestões expiraram. Volte e clique em ✨ Melhorias de novo.</p>')); return; }
  const vazio = (t) => box.appendChild(el('div', 'cartao vazio', `<p>${t}</p>`));
  const card = (html) => box.appendChild(el('div', 'cartao sugestao', html));

  if (aba === 'descricoes') {
    if (!m.descricoes?.length) return vazio('Nenhuma descrição para sugerir. 👌');
    m.descricoes.forEach((d, i) => card(`<div class="linha"><h4>${esc(d.produto)}</h4><span>${botaoCopiar(d.sugerida)} ${d.aplicada ? '<span class="selo">✓ Aplicada</span>' : d.produto_id ? `<button class="botao mini aplicar" data-aplicar-desc="${i}">✅ Aplicar</button>` : ''}</span></div>
      ${d.atual ? `<div class="antes">${esc(d.atual)}</div>` : '<div class="motivo">Hoje: sem descrição</div>'}
      <div class="depois">${esc(d.sugerida)}</div>`));
    const pendentes = m.descricoes.filter(d => d.produto_id && !d.aplicada).length;
    if (pendentes > 1) box.appendChild(el('div', 'motivo', `<button class="botao laranja" data-aplicar-todas="1">✅ Aplicar as ${pendentes} descrições</button>`));
  }
  if (aba === 'categorias') {
    if (!m.categorias?.length) return vazio('As categorias já estão com cara boa. 👌');
    m.categorias.forEach((c, i) => card(`<div class="linha"><h4>🗂 Categoria</h4><span>${botaoCopiar(c.sugerido)} ${c.aplicada ? '<span class="selo">✓ Aplicada</span>' : `<button class="botao mini aplicar" data-aplicar-cat="${i}">✅ Aplicar</button>`}</span></div>
      <div class="antes">${esc(c.atual)}</div><div class="depois">${esc(c.sugerido)}</div><div class="motivo">💡 ${esc(c.motivo || '')}</div>`));
    box.appendChild(el('div', 'motivo', 'Como categoria só se renomeia no Gerencial, o MAX cria a categoria nova, muda os produtos pra ela e coloca na mesma posição. Dá pra desfazer no Histórico.'));
  }
  if (aba === 'juntos') {
    const v = m.vendas;
    box.appendChild(el('div', 'motivo', v ? `📊 Analisei <b>${v.pedidos}</b> pedido(s) concluído(s) dos últimos ${v.dias} dias.${v.maisVendidos?.length ? ' Mais vendidos: ' + v.maisVendidos.slice(0, 3).map(x => esc(x.nome)).join(', ') + '.' : ''}` : '📊 Não consegui ler os pedidos (o painel precisa estar no estabelecimento, não no Gerencial).'));
    if (!m.juntos?.length) return vazio(v ? 'Ainda não há produtos saindo juntos com frequência. Com mais pedidos eu acho padrões! 🔎' : 'Sem dados de vendas por enquanto.');
    m.juntos.forEach((j, i) => card(`<div class="linha"><h4>🤝 ${esc(j.a)} + ${esc(j.b)}</h4><span class="jt-num">${esc(j.vezes)}x</span></div>
      <div class="jt-barra"><div style="width:${Math.min(100, Number(j.pct) || 0)}%"></div></div>
      <div class="motivo">Em <b>${esc(j.pct)}%</b> dos pedidos com ${esc(j.a)}, o cliente levou ${esc(j.b)} junto.</div>
      <div class="depois">${esc(j.texto)}</div>
      ${j.ideia === 'combo' && j.combo_nome ? `<div class="linha"><span class="motivo">Combo sugerido: <b>${esc(j.combo_nome)}</b> por <b>R$ ${esc(j.combo_preco)}</b></span>${j.criado ? '<span class="selo">✓ Criado</span>' : `<button class="botao mini aplicar" data-combo-juntos="${i}">🍔 Criar combo</button>`}</div>` : '<div class="motivo">💡 Dica: coloque no <b>➕ Peça também</b> do produto principal.</div>'}`));
    box.appendChild(el('div', 'motivo', 'O combo é criado <b>pausado</b> na categoria 🔥 COMBOS, sem foto: confira com o estabelecimento, coloque a foto e ative.'));
  }
  if (aba === 'sugeridos') {
    if (!m.sugeridos?.length) return vazio('Não achei produtos com foto suficientes para montar sugestões. (O app exige de 3 a 5 sugeridos, todos com foto.)');
    m.sugeridos.forEach((g, i) => card(`<div class="linha"><h4>➕ ${esc(g.produto)}</h4>${g.aplicado ? '<span class="selo">✓ No app</span>' : `<button class="botao mini aplicar" data-sugeridos="${i}">✅ Aplicar</button>`}</div>
      <div class="motivo">No fim do pedido, o app oferece:</div>
      <div class="sg-lista">${g.sugeridos.map((x, k) => `<label class="sg-item"><input type="checkbox" data-sg="${i}" data-k="${k}" ${x.fora ? '' : 'checked'}> ${esc(x.nome)} <small>R$ ${esc(x.valor)}</small></label>`).join('')}</div>
      <div class="motivo">💡 ${esc(g.motivo || '')}</div>`));
    box.appendChild(el('div', 'motivo', 'Regras do app: de 3 a 5 sugeridos por produto, todos com foto. Se o produto já tinha sugeridos, eles são trocados por estes (dá para desfazer no Histórico).'));
  }
  if (aba === 'combos') {
    if (!m.combos?.length) return vazio('Não achei bons combos com os produtos atuais.');
    m.combos.forEach(c => card(`<div class="linha"><h4>${esc(c.nome)}</h4><span class="preco"><s>R$ ${esc(c.soma)}</s>R$ ${esc(c.preco_sugerido)}</span></div>
      <div class="depois">${c.itens.map(esc).join(' + ')}</div>${c.descricao ? `<div class="motivo">📝 ${esc(c.descricao)} ${botaoCopiar(c.descricao)}</div>` : ''}<div class="motivo">💡 ${esc(c.motivo)}</div>`));
    box.appendChild(el('div', 'motivo', 'Preços sugeridos: confira a margem com o estabelecimento antes de criar.'));
  }
  if (aba === 'ordem') {
    if (!m.ordem_categorias?.length) return vazio('A ordem atual já está boa.');
    const o = el('div', 'cartao ordem');
    m.ordem_categorias.forEach(c => o.appendChild(el('div', 'item', `<div><b>${esc(c.categoria)}</b><div class="motivo">${esc(c.motivo)}</div></div>`)));
    box.appendChild(o);
    box.appendChild(el('div', 'motivo', '<button class="botao laranja" data-aplicar-ordem="1">↕ Aplicar esta ordem no app</button>'));
  }
  if (aba === 'ordemprod') {
    const grupos = m.ordem_produtos || [];
    if (!grupos.length) return vazio('Os produtos já estão numa boa ordem em todas as categorias. 👌');
    const total = grupos.filter(g => !g.aplicada).reduce((s, g) => s + g.itens.filter(x => x.antes !== x.depois).length, 0);
    box.appendChild(el('div', 'motivo', `🎯 <b>Ordem estratégica:</b> carro-chefe no topo, depois o que mais fatura, item de menor ticket no fim e pausados por último. ${m.vendas?.pedidos ? `Usei as vendas de ${m.vendas.pedidos} pedidos dos últimos ${m.vendas.dias || 30} dias.` : 'Sem vendas no período: usei preço e foto.'} Use ↑ ↓ para ajustar antes de aplicar.`));
    if (total) box.appendChild(el('div', 'motivo', `<button class="botao laranja" data-ordemprod-todas="1">🎯 Aplicar em todas as categorias (${total} produto(s) mudam de lugar)</button> <span class="nota-op">Melhor fora do horário de pico: grava produto por produto.</span>`));
    grupos.forEach((g, gi) => {
      const c = el('div', 'cartao sugestao ordemprod');
      c.innerHTML = `<div class="linha"><h4>${esc(g.categoria)}${g.subcategoria ? ' › ' + esc(g.subcategoria) : ''}</h4>${g.aplicada ? '<span class="selo">✓ Aplicada</span>' : `<button class="botao mini aplicar" data-ordemprod="${gi}">Aplicar nesta categoria</button>`}</div>
        <ol class="lista-ordem">${g.itens.map((x, i) => `<li><span class="pos">${i + 1}º</span><div><b>${esc(x.nome)}</b> ${x.antes && x.antes !== i + 1 ? `<span class="era">era ${x.antes}º</span>` : ''}<div class="motivo">${esc(x.motivo)}</div></div>
          ${g.aplicada ? '' : `<span class="setas"><button class="mini" data-mover="${gi}:${i}:-1" title="Subir" ${i ? '' : 'disabled'}>↑</button><button class="mini" data-mover="${gi}:${i}:1" title="Descer" ${i < g.itens.length - 1 ? '' : 'disabled'}>↓</button></span>`}</li>`).join('')}</ol>`;
      box.appendChild(c);
    });
  }
  if (aba === 'nomes') {
    if (!m.nomes?.length) return vazio('Os nomes estão ótimos. 👌');
    m.nomes.forEach(n => card(`<div class="linha"><h4>${esc(n.tipo)}</h4>${botaoCopiar(n.sugerido)}</div>
      <div class="antes">${esc(n.atual)}</div><div class="depois">${esc(n.sugerido)}</div><div class="motivo">💡 ${esc(n.motivo)}</div>`));
  }
  if (aba === 'niveis') {
    if (!m.niveis?.length) return vazio('Os níveis estão bem organizados. 👌');
    m.niveis.forEach(n => card(`<h4>🧩 ${esc(n.onde)}</h4><div class="depois">${esc(n.sugestao)}</div>`));
  }
}

// ---------------- chat ----------------
// A IA escreve "MIA:" ou "MAX:" no começo das falas; separamos para mostrar quem fala.
function porFalante(texto) {
  const partes = []; let atual = ['mia', ''];
  for (const linha of String(texto).split('\n')) {
    const m = linha.match(/^\s*\**(MIA|MAX)\**\s*:\s*(.*)$/i);
    if (m) { if (atual[1].trim()) partes.push(atual); atual = [m[1].toLowerCase(), m[2]]; }
    else atual[1] += (atual[1] ? '\n' : '') + linha;
  }
  if (atual[1].trim()) partes.push(atual);
  return partes.map(([q, t]) => [q, t.trim()]);
}
function adicionar(classe, texto) {
  const d = el('div', 'msg ' + classe);
  if (classe === 'erro') comDetalhe(d, texto); else d.textContent = texto;
  $('conversa').appendChild(d); d.scrollIntoView({ block: 'end' });
}
function pedirConfirmacao(texto) {
  const c = el('div', 'confirmar', '<strong>Confirma esta ação?</strong><div class="t"></div><div class="botoes"><button class="botao vermelho">Confirmar</button><button class="botao claro">Cancelar</button></div>');
  c.querySelector('.t').textContent = texto;
  const [sim, nao] = c.querySelectorAll('button');
  const responder = (ok) => { porta.postMessage({ tipo: 'confirmacao', ok }); sim.disabled = nao.disabled = true; c.querySelector('strong').textContent = ok ? 'Confirmado ✓' : 'Cancelado'; };
  sim.onclick = () => responder(true); nao.onclick = () => responder(false);
  $('conversa').appendChild(c); c.scrollIntoView({ block: 'end' });
}
// ---------- lançar pedido: escolher como os dados chegaram ----------
let modoPedido = null;
function opcoesPedido() {
  const d = el('div', 'msg max', `<b class="quem max">MAX</b>Bora lançar! 🧾 Como o pedido chegou?
    <div class="opcoes-pedido">
      <button class="botao claro" data-ped="digitar">⌨️ Digitar os dados</button>
      <button class="botao claro" data-ped="colar">📋 Colar a conversa</button>
      <button class="botao claro" data-ped="print">📱 Print do WhatsApp</button>
      <button class="botao claro" data-ped="papel">📝 Foto do papel</button></div>`);
  $('conversa').appendChild(d); d.scrollIntoView({ block: 'end' });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ped]'); if (!b) return;
  const m = b.dataset.ped;
  modoPedido = { digitar: 'digitado', colar: 'conversa colada do WhatsApp', print: 'print do WhatsApp', papel: 'foto de um papel anotado' }[m];
  b.parentElement.querySelectorAll('button').forEach(x => { x.disabled = true; x.style.opacity = x === b ? 1 : .4; });
  const fala = (quem, t) => { const d = el('div', 'msg ' + quem, `<b class="quem ${quem}">${quem.toUpperCase()}</b>${t}`); $('conversa').appendChild(d); d.scrollIntoView({ block: 'end' }); };
  if (m === 'digitar') { fala('mia', 'Escreve do seu jeito, numa mensagem só: telefone, endereço (ou "retirada"), itens ou valor e pagamento. O que faltar eu pergunto 😉'); $('texto').placeholder = 'Ex.: 66 99999-0000, Rua 17 nº 242 Setor Norte, 2 X-Salada, Pix pago'; $('texto').focus(); }
  if (m === 'colar') { fala('mia', 'Cola aqui a conversa com o pedido (Ctrl+V) e envia 👇'); $('texto').placeholder = 'Cole a conversa do WhatsApp aqui…'; $('texto').focus(); }
  if (m === 'print' || m === 'papel') { fala('max', m === 'print' ? 'Escolhe o print do WhatsApp 📱' : 'Escolhe a foto do papel 📝 (bem de pertinho, com boa luz)'); $('arquivo').click(); }
});

let chatOcupado = false;
function enviarComando() {
  let texto = $('texto').value.trim();
  if (!texto && !anexos.length) return;
  if (chatOcupado) return maxAvisa('Calma, a dupla ainda está terminando o pedido anterior. ⏳', '', 'Só um instante');
  adicionar('eu', (texto || (modoPedido ? 'Lança esse pedido' : '')) + (anexos.length ? `\n📎 ${anexos.map(a => a.nome).join(', ')}` : ''));
  if (modoPedido) texto = `[Lançar pedido · dados: ${modoPedido}]\n${texto || 'Lança esse pedido.'}`;
  porta.postMessage({ tipo: 'comando', texto: texto || 'Veja o anexo.', anexos });
  $('texto').value = ''; anexos = []; $('anexos').innerHTML = '';
  modoPedido = null; $('texto').placeholder = 'Digite um comando…';
}
$('btnEnviar').onclick = enviarComando;
$('texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarComando(); } });

$('arquivo').onchange = async (e) => {
  const campoArquivo = e.currentTarget;
  for (const f of [...campoArquivo.files]) {
    const dados = f.type === 'application/pdf' ? await paraBase64(f) : await reduzirImagem(f);
    anexos.push({ nome: f.name, tipo: f.type === 'application/pdf' ? f.type : 'image/jpeg', dados });
    $('anexos').appendChild(el('span', 'anexo', esc(f.name)));
  }
  campoArquivo.value = '';
  if (anexos.length && modoPedido && /print|papel/.test(modoPedido)) enviarComando();
};
function paraBase64(f) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); }); }
async function reduzirImagem(f) {
  const img = await createImageBitmap(f);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = new OffscreenCanvas(Math.round(img.width * k), Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return paraBase64(await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
}

// ---------------- configuração ----------------
$('btnConfig').onclick = async () => {
  $('config').hidden = !$('config').hidden;
  const { servidor = MIA.servidor, codigo = '' } = await chrome.storage.local.get(['servidor', 'codigo']);
  $('cfgServidor').value = servidor; $('cfgCodigo').value = codigo;
};
$('cfgSalvar').onclick = async () => {
  const servidor = ($('cfgServidor').value.trim() || MIA.servidor).replace(/\/$/, '');
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
  } catch { /* sem internet ou servidor fora: salva assim mesmo e avisa */ }
  await chrome.storage.local.set({ servidor, codigo });
  $('cfgSalvar').disabled = false; $('cfgSalvar').textContent = 'Entrar';
  $('config').hidden = true;
  maxAvisa(eu ? `Bem-vindo, ${eu.nome}! Agora é só escolher uma missão.` : 'Código salvo, mas não consegui falar com o servidor agora. Confira a internet.', eu ? 'ok' : 'erro', eu ? 'Login feito ✓' : 'Salvo');
  porta.postMessage({ tipo: 'perfil' });
};
$('cfgCodigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('cfgSalvar').click(); });

// Código do Marketing (designer) não usa a Central: vai direto para o quadro.
chrome.storage.local.get('perfil').then(({ perfil }) => { if (perfil === 'marketing') window.miaTrocarAba('marketing'); });

// Número no seletor 📣 Marketing: quantas artes esperam a aprovação da central.
async function seloMarketing() {
  try {
    const { servidor = MIA.servidor, codigo } = await chrome.storage.local.get(['servidor', 'codigo']);
    if (!codigo || !servidor) return;
    const r = await fetch(servidor.replace(/\/$/, '') + '/quadro', { headers: { 'x-codigo-mia': codigo } });
    if (!r.ok) return;
    const q = await r.json();
    const aprov = q.cartoes.filter(c => c.coluna === 'aprovacao').length;
    window.miaSeloMarketing?.(aprov);
  } catch { /* servidor sem quadro ainda */ }
}
seloMarketing();
document.addEventListener('visibilitychange', () => { if (!document.hidden) seloMarketing(); });

chrome.storage.local.get(['servidor', 'codigo']).then(({ codigo }) => {
  if (!codigo) { $('btnConfig').click(); maxAvisa('Primeiro passo: coloca o seu código de acesso aqui em cima. Peça o seu à administração 😉', '', 'Bem-vindo! 👋'); }
});
atualizarEstab();

$('refazerVarredura').onclick = () => {
  if (!podeRodar()) return;
  ultimaVarredura = null; carregar('Fazendo a varredura…'); porta.postMessage({ tipo: 'varredura' });
};

// Abrir direto num resultado (ex.: vindo do MAX flutuante): central.html#varredura
async function abrirPeloEndereco() {
  const alvo = location.hash.slice(1);
  if (!alvo) return;
  const { ultimaVarredura: v, ultimasMelhorias: mm } = await chrome.storage.session.get(['ultimaVarredura', 'ultimasMelhorias']);
  if (alvo === 'varredura' && v) { ultimaVarredura = v; desenharVarredura(v); }
  if ((alvo === 'melhorias' || alvo === 'combos') && mm) { ultimasMelhorias = mm; abaInicial = alvo === 'combos' ? 'combos' : 'descricoes'; desenharMelhorias(mm); }
  if (alvo === 'chat') mostrar('telaChat');
  if (alvo === 'criar') setTimeout(() => { if (podeRodar()) abrirCriar(); }, 600);
  if (alvo === 'fotos') setTimeout(() => document.querySelector('[data-acao="fotos"]').click(), 700);
  if (alvo === 'ranking') abrirRanking();
  history.replaceState(null, '', location.pathname);
}
window.addEventListener('hashchange', abrirPeloEndereco);
abrirPeloEndereco();


// ======================= v0.4: aplicar, reajuste, histórico =======================
const fmt = (campo, v) => campo === 'criado' ? 'cadastrado' : campo === 'ordem' ? 'ordem anterior' : campo === 'categoria' ? `"${v?.nome || ''}"` : campo === 'preco' ? `R$ ${v}` : campo === 'ativo' ? (v ? 'ativo' : 'pausado') : campo === 'bebida' ? (v ? 'bebida' : 'não é bebida') : campo === 'posicao' ? `${v}º` : campo === 'estoque' ? `estoque ${v}` : (campo === 'foto' || campo === 'foto_opcao') ? (v ? 'a foto anterior' : 'sem foto') : campo === 'pedido' ? `R$ ${Number(v).toFixed(2).replace('.', ',')}` : `"${String(v || '(vazia)').slice(0, 60)}"`;
const ICONE = { posicao: '🎯', nome: '🏷️', bebida: '🥤', sugeridos: '➕', foto_opcao: '🖼️', preco: '💲', ativo: '⏯', estoque: '📦', descricao: '📝', foto: '📷', pedido: '🧾', criado: '🆕', ordem: '↕', categoria: '🗂' };
const NOME_CAMPO = { posicao: 'Posição na categoria', nome: 'Nome', bebida: 'Bebida', sugeridos: 'Peça também', foto_opcao: 'Foto da opção', preco: 'Preço', ativo: 'Situação', estoque: 'Estoque', descricao: 'Descrição', foto: 'Foto', pedido: 'Pedido lançado', criado: 'Produto novo', ordem: 'Ordem', categoria: 'Categoria' };
const miniFoto = (url) => url ? `<img src="${esc(url)}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;vertical-align:middle">` : 'sem foto';
const mudanca = (a) => a.campo === 'sugeridos' ? `Sugeridos: ${esc((a.nomes || []).join(', '))}`
  : a.campo === 'pedido' ? `Total ${esc(fmt('pedido', a.depois))}`
  : a.campo === 'criado' ? `Cadastrado em <b>${esc(a.depois)}</b>`
  : a.campo === 'ordem' ? `Nova ordem: ${esc((a.nomes || []).slice(0, 4).join(' › '))}${(a.nomes || []).length > 4 ? '…' : ''}`
  : a.campo === 'categoria' ? `${(a.produtos || []).length} produto(s) movidos para <b>${esc(a.depois?.nome)}</b>`
  : (a.campo === 'foto' || a.campo === 'foto_opcao') ? `${miniFoto(a.antes)} → ${miniFoto(a.depois)}`
  : `${esc(NOME_CAMPO[a.campo])}: <s>${esc(fmt(a.campo, a.antes))}</s> → <b>${esc(fmt(a.campo, a.depois))}</b>`;

// Botão em dois toques: 1º vira "Confirmar?", 2º executa.
function doisToques(b, acao) {
  if (b.dataset.armado) { delete b.dataset.armado; b.disabled = true; b.textContent = '⏳ Aplicando…'; return acao(); }
  b.dataset.armado = '1'; const txt = b.textContent; b.textContent = 'Confirmar?'; b.classList.add('confirma');
  setTimeout(() => { if (b.dataset.armado) { delete b.dataset.armado; b.textContent = txt; b.classList.remove('confirma'); } }, 4000);
}

let aplicando = null; // { tipo: 'desc'|'reajuste', indices }
document.addEventListener('click', (e) => {
  const um = e.target.closest('[data-aplicar-desc]');
  const todas = e.target.closest('[data-aplicar-todas]');
  if (!um && !todas) return;
  const m = melhoriasNaTela; if (!m) return;
  const indices = um ? [Number(um.dataset.aplicarDesc)] : m.descricoes.map((d, i) => (d.produto_id && !d.aplicada) ? i : -1).filter(i => i >= 0);
  doisToques(um || todas, () => {
    aplicando = { tipo: 'desc', indices };
    porta.postMessage({ tipo: 'aplicar', estab: m.estab, rotulo: `Melhorias: ${indices.length} descrição(ões)`, itens: indices.map(i => ({ id: m.descricoes[i].produto_id, nome: m.descricoes[i].produto, campo: 'descricao', valor: m.descricoes[i].sugerida })) });
  });
});

function aoAlterar(a) {
  if (aplicando?.tipo === 'desc' && a.campo === 'descricao') {
    const d = melhoriasNaTela?.descricoes?.find(x => String(x.produto_id) === String(a.id));
    if (d) d.aplicada = true;
  }
  if (!$('telaChat').hidden) {
    const d = el('div', 'msg feito', `<span>✅ ${esc(NOME_CAMPO[a.campo])} · <b>${esc(a.nome)}</b> · ${mudanca(a)}</span>${a.campo === 'pedido' ? '' : `<button class="botao mini" data-desfazer="${a.uid}">↩ Desfazer</button>`}`);
    $('conversa').appendChild(d); d.scrollIntoView({ block: 'end' });
  }
}
function aoProgredir(m) {
  if (aplicando?.tipo === 'fotos') { $('ftBarraBox').hidden = false; $('ftBarra').style.width = Math.round(100 * (m.feito + 1) / m.total) + '%'; $('ftAplicar').textContent = `⏳ ${m.feito + 1}/${m.total}: ${m.nome}`; return; }
  if (aplicando?.tipo === 'reajuste') { $('rjBarraBox').hidden = false; $('rjBarra').style.width = Math.round(100 * m.feito / m.total) + '%'; $('rjTitulo').textContent = `Aplicando ${m.feito + 1}/${m.total}…`; }
}
function aoAplicar(m) {
  const tipo = aplicando?.tipo, aplicandoIdx = aplicando?.indices; aplicando = null;
  if (tipo === 'varredura' && ultimaVarredura) {
    const ok = new Set((m.feitos || []).map(x => `${x.id}|${x.campo}`));
    for (const p of ultimaVarredura.problemas) for (const a of p.acoes || []) if (a && ok.has(`${a.id}|${a.campo}`)) a.feito = true;
    if (!$('telaVarredura').hidden) desenharProblemas(ultimaVarredura);
  }
  if (m.erro) { // nada foi aplicado (ex.: painel em outro estabelecimento): avisa e devolve os botões
    maxAvisa(m.erro, 'erro', 'Não apliquei nada ✋');
    if (tipo === 'desc' && !$('telaMelhorias').hidden) desenharAba('descricoes');
    if (tipo === 'reajuste') { $('rjBarraBox').hidden = true; $('rjAplicar').disabled = false; $('rjAplicar').textContent = 'Aplicar no painel'; $('rjAplicar').classList.remove('confirma'); }
    return;
  }
  if (tipo === 'ordemprod' && melhoriasNaTela?.ordem_produtos && !m.falhas.length) {
    (aplicandoIdx || []).forEach(gi => { if (melhoriasNaTela.ordem_produtos[gi]) melhoriasNaTela.ordem_produtos[gi].aplicada = true; });
    if (!$('telaMelhorias').hidden) desenharAba('ordemprod');
  }
  const n = m.feitos.length, f = m.falhas.length;
  maxAvisa(f ? `Apliquei ${n} e ${f} não deu certo: ${m.falhas.slice(0, 2).map(x => x.nome).join(', ')}. Veja no Histórico.` : `Prontinho! ${n} alteração(ões) feita(s) e conferida(s) no painel. Dá pra desfazer no Histórico.`, f ? 'erro' : 'ok', f ? 'Quase tudo ✅' : 'Feito! ✅');
  if (tipo === 'desc' && !$('telaMelhorias').hidden) desenharAba('descricoes');
  if (tipo === 'reajuste') {
    $('rjBarraBox').hidden = true; $('rjTitulo').textContent = `✅ ${n} preço(s) reajustado(s)`;
    const ok = new Set(m.feitos.map(x => String(x.id)));
    $('rjLinhas').querySelectorAll('tr[data-id]').forEach(tr => tr.classList.add(ok.has(tr.dataset.id) ? 'ok' : 'erro'));
    $('rjAplicar').disabled = true; $('rjAplicar').textContent = 'Aplicado ✓'; $('rjAplicar').classList.remove('confirma');
  }
}

// ---------- reajuste ----------
let previa = null;
function paramsReajuste() {
  return { escopo: $('rjEscopo').value, categoria: $('rjCategoria').value, tipo: $('rjTipo').value, valor: Number($('rjValor').value || 0), arredondar: $('rjArred').value };
}
function abrirReajuste() {
  if (!podeRodar()) return;
  mostrar('telaReajuste');
  previa = null; $('rjAplicar').disabled = true; $('rjAplicar').textContent = 'Aplicar no painel';
  dialogo('dlgReajuste', [['max', 'Escolhe o reajuste e clica em <b>Ver como fica</b>. Nada muda no painel até você aplicar!']]);
  porta.postMessage({ tipo: 'reajuste_preview', params: { ...paramsReajuste(), valor: 0 } });
}
$('rjEscopo').onchange = () => { $('rjCatBox').hidden = $('rjEscopo').value !== 'categoria'; };
['rjEscopo', 'rjCategoria', 'rjTipo', 'rjValor', 'rjArred'].forEach(id => $(id).addEventListener('input', () => { $('rjAplicar').disabled = true; }));
$('rjPrever').onclick = () => porta.postMessage({ tipo: 'reajuste_preview', params: paramsReajuste() });
// Reajuste fora do comum (ex.: digitou 100 em vez de 10): a MIA avisa antes de aplicar.
function reajusteGrande() {
  const { tipo, valor } = paramsReajuste();
  if (tipo === 'percentual' && Math.abs(valor) > 30) return `${valor > 0 ? '+' : ''}${valor}%`;
  if (tipo !== 'percentual' && Math.abs(valor) > 10) return `${valor > 0 ? '+' : '−'} R$ ${Math.abs(valor).toFixed(2).replace('.', ',')} em cada produto`;
  return '';
}
function desenharPrevia(m) {
  const sel = $('rjCategoria'), atual = sel.value;
  sel.innerHTML = m.categorias.map(c => `<option${c === atual ? ' selected' : ''}>${esc(c)}</option>`).join('');
  if (!paramsReajuste().valor) return;
  previa = m;
  $('rjTitulo').textContent = m.lista.length ? `${m.lista.length} produto(s) vão mudar` : 'Nenhum produto muda';
  $('rjLinhas').innerHTML = m.lista.map(x => {
    const baixa = Number(x.depois.replace(',', '.')) < Number(x.antes.replace(/\./g, '').replace(',', '.'));
    return `<tr data-id="${esc(x.id)}"><td>${esc(x.nome)}</td><td class="motivo">${esc(x.categoria)}</td><td class="antes">R$ ${esc(x.antes)}</td><td class="depois${baixa ? ' baixa' : ''}">R$ ${esc(x.depois)}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="motivo">Nenhum produto com preço seria alterado.</td></tr>';
  $('rjAplicar').disabled = !m.lista.length;
  dialogo('dlgReajuste', m.lista.length
    ? [['mia', `Conferi: <b>${m.lista.length}</b> produto(s) mudam. Os de preço zero (preço pelos níveis) ficaram de fora.`],
       ...(reajusteGrande() ? [['mia', `⚠️ <b>Atenção:</b> é um reajuste grande (${esc(reajusteGrande())}). Confira se não digitou um zero a mais.`]] : []),
       ['max', 'Tá certo? Clica em <b>Aplicar</b> e eu faço um por um. Se arrepender, tem Desfazer!']]
    : [['mia', 'Com esse reajuste nenhum preço muda. Confere os campos?']]);
}
$('rjAplicar').onclick = () => {
  if (!previa?.lista?.length) return;
  doisToques($('rjAplicar'), () => {
    aplicando = { tipo: 'reajuste' };
    porta.postMessage({ tipo: 'aplicar', estab: previa.estab, rotulo: `Reajuste ${(() => { const p = paramsReajuste(); return (p.valor > 0 ? '+' : '') + (p.tipo === 'percentual' ? p.valor + '%' : 'R$ ' + String(p.valor).replace('.', ',')) + (p.escopo === 'loja' ? ' na loja toda' : ' em ' + p.categoria); })()}`, itens: previa.lista.map(x => ({ id: x.id, nome: x.nome, campo: 'preco', valor: x.depois })) });
  });
};

// ---------- histórico ----------
function desenharHistorico(lista) {
  dialogo('dlgHistorico', [['max', 'Aqui fica tudo que eu mudei no painel.'], ['mia', 'E eu anoto o valor de antes, pra dar pra <b>desfazer</b> 😉 Só precisa estar no mesmo estabelecimento.']]);
  const box = $('listaHistorico'); box.innerHTML = '';
  if (!lista.length) { box.appendChild(el('div', 'cartao vazio', '<img src="img/max.png" alt=""><h3>Nada alterado ainda</h3><p class="motivo">Quando a MIA mudar algo no painel, aparece aqui.</p>')); return; }
  const linha = (a) => {
    const quando = new Date(a.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return el('div', `cartao hist${a.desfeito ? ' desfeito' : ''}`, `
      <div class="ico">${ICONE[a.campo] || '✏️'}</div>
      <div><div class="titulo">${esc(a.nome)}</div>
        <div class="mud">${mudanca(a)}</div>
        <div class="meta">${esc(a.estab)} · ${quando}${a.quem ? ' · ' + esc(a.quem) : ''}</div></div>
      ${a.desfeito ? '<span class="selo">↩ Desfeito</span>' : a.campo === 'pedido' ? '<span class="selo">🧾 Lançado</span>' : `<button class="botao mini" data-desfazer="${a.uid}">↩ Desfazer</button>`}`);
  };
  // Itens do mesmo lote (reajuste, "aplicar em todos", cardápio criado) viram um cartão só, com "Desfazer todos".
  const vistos = new Set();
  for (const a of lista.slice(0, 400)) {
    if (box.childElementCount >= 150) break;
    if (!a.lote) { box.appendChild(linha(a)); continue; }
    if (vistos.has(a.lote)) continue;
    vistos.add(a.lote);
    const grupo = lista.filter(x => x.lote === a.lote);
    if (grupo.length === 1) { box.appendChild(linha(a)); continue; }
    const pendentes = grupo.filter(x => !x.desfeito && x.campo !== 'pedido').length;
    const quando = new Date(a.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const d = el('details', `cartao hist lote${pendentes ? '' : ' desfeito'}`);
    d.innerHTML = `<summary><div class="ico">🧺</div>
      <div><div class="titulo">${esc(a.loteNome || 'Alterações em lote')}</div>
        <div class="mud">${grupo.length} alterações${pendentes < grupo.length ? ` · ${grupo.length - pendentes} já desfeita(s)` : ''} · clique para ver</div>
        <div class="meta">${esc(a.estab)} · ${quando}${a.quem ? ' · ' + esc(a.quem) : ''}</div></div>
      ${pendentes ? `<button class="botao mini perigo-lote" data-desfazer-lote="${esc(a.lote)}">↩ Desfazer todos (${pendentes})</button>` : '<span class="selo">↩ Desfeito</span>'}</summary>`;
    const dentro = el('div', 'lote-itens'); grupo.forEach(x => dentro.appendChild(linha(x))); d.appendChild(dentro);
    box.appendChild(d);
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-desfazer-lote]'); if (!b) return;
  e.preventDefault(); // não abrir/fechar o grupo
  doisToques(b, () => porta.postMessage({ tipo: 'desfazer_lote', lote: b.dataset.desfazerLote }));
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-desfazer]'); if (!b) return;
  doisToques(b, () => porta.postMessage({ tipo: 'desfazer', uid: b.dataset.desfazer }));
});

// ======================= v0.13: ordem estratégica dos produtos =======================
document.addEventListener('click', (e) => {
  const mv = e.target.closest('[data-mover]'), um = e.target.closest('[data-ordemprod]'), todas = e.target.closest('[data-ordemprod-todas]');
  if (!mv && !um && !todas) return;
  const m = melhoriasNaTela; if (!m?.ordem_produtos) return;
  if (mv) { // ajuste manual: troca o produto com o vizinho
    const [gi, i, d] = mv.dataset.mover.split(':').map(Number);
    const it = m.ordem_produtos[gi].itens; const j = i + d; if (j < 0 || j >= it.length) return;
    [it[i], it[j]] = [it[j], it[i]];
    it[i].motivo = it[i].motivo.replace(/ · (ajustado por você)$/, '') + ' · ajustado por você'; it[j].motivo = it[j].motivo.replace(/ · (ajustado por você)$/, '') + ' · ajustado por você';
    return desenharAba('ordemprod');
  }
  const idx = um ? [Number(um.dataset.ordemprod)] : m.ordem_produtos.map((g, i) => g.aplicada ? -1 : i).filter(i => i >= 0);
  const itens = idx.flatMap(gi => m.ordem_produtos[gi].itens.map((x, i) => ({ id: x.id, nome: x.nome, campo: 'posicao', valor: i + 1, antes: x.antes })).filter(x => x.antes !== x.valor).map(({ antes, ...x }) => x));
  if (!itens.length) { idx.forEach(gi => { m.ordem_produtos[gi].aplicada = true; }); return desenharAba('ordemprod'); }
  doisToques(um || todas, () => {
    aplicando = { tipo: 'ordemprod', indices: idx };
    porta.postMessage({ tipo: 'aplicar', estab: m.estab, rotulo: idx.length === 1 ? `Ordem estratégica: ${m.ordem_produtos[idx[0]].categoria}` : `Ordem estratégica: ${idx.length} categorias`, itens });
  });
});

// ======================= v0.7: melhorias aplicáveis (categorias e ordem) =======================
document.addEventListener('click', (e) => {
  const bc = e.target.closest('[data-aplicar-cat]');
  const bo = e.target.closest('[data-aplicar-ordem]');
  if (!bc && !bo) return;
  const m = melhoriasNaTela; if (!m) return;
  if (bc) { const c = m.categorias[Number(bc.dataset.aplicarCat)]; doisToques(bc, () => porta.postMessage({ tipo: 'categoria_renomear', estab: m.estab, atual: c.atual, sugerido: c.sugerido })); }
  if (bo) doisToques(bo, () => porta.postMessage({ tipo: 'ordem_aplicar', estab: m.estab, ordem: m.ordem_categorias.map(c => c.categoria) }));
});

// ======================= v0.7: Criar cardápio =======================
let crAnexos = [];   // { nome, tipo, dados, url }
let rascunho = null; // o que a MIA leu + edições do atendente

function abrirCriar() {
  mostrar('telaCriar');
  dialogo('dlgCriar', [
    ['mia', `Bora montar o cardápio do <b>${esc(estabAtual)}</b>! 📸 Me manda as fotos do cardápio, o PDF ou cola a lista em texto. Eu leio tudo, separo as categorias e escrevo descrições que dão água na boca 😋`],
    ['max', 'Antes de gravar eu te mostro tudo numa tabela pra conferir. Só cadastro quando você mandar! 🚀']]);
  desenharMiniaturas();
}

async function adicionarArquivos(files) {
  for (const f of files) {
    if (!/^image\/|application\/pdf/.test(f.type)) continue;
    const pdf = f.type === 'application/pdf';
    const dados = pdf ? await paraBase64(f) : await reduzirImagem(f);
    crAnexos.push({ nome: f.name || 'print.png', tipo: pdf ? f.type : 'image/jpeg', dados, url: pdf ? '' : 'data:image/jpeg;base64,' + dados });
  }
  desenharMiniaturas();
}
function desenharMiniaturas() {
  const box = $('crMiniaturas'); box.innerHTML = '';
  crAnexos.forEach((a, i) => box.appendChild(el('div', 'mini', `${a.url ? `<img src="${a.url}" alt="">` : `📄<br>${esc(a.nome)}`}<button data-tirar="${i}" title="Tirar">×</button>`)));
}
$('crMiniaturas').onclick = (e) => { const b = e.target.closest('[data-tirar]'); if (b) { crAnexos.splice(Number(b.dataset.tirar), 1); desenharMiniaturas(); } };
$('crArquivo').onchange = async (e) => { const c = e.currentTarget; await adicionarArquivos([...c.files]); c.value = ''; };
const soltar = $('soltar');
['dragenter', 'dragover'].forEach(t => soltar.addEventListener(t, (e) => { e.preventDefault(); soltar.classList.add('arrastando'); }));
['dragleave', 'drop'].forEach(t => soltar.addEventListener(t, (e) => { e.preventDefault(); soltar.classList.remove('arrastando'); }));
soltar.addEventListener('drop', (e) => adicionarArquivos([...e.dataTransfer.files]));
document.addEventListener('paste', (e) => {
  if ($('telaCriar').hidden) return;
  const files = [...e.clipboardData.files];
  if (files.length) { e.preventDefault(); adicionarArquivos(files); }
});

$('crLer').onclick = () => {
  const texto = $('crTexto').value.trim();
  if (!crAnexos.length && !texto) return maxAvisa('Manda pelo menos uma foto, um PDF ou cola o cardápio em texto 😉', 'erro', 'Faltou o cardápio');
  carregar('A MIA está lendo o cardápio…', 'mia', 'telaCriar');
  porta.postMessage({ tipo: 'criar_ler', anexos: crAnexos.map(({ nome, tipo, dados }) => ({ nome, tipo, dados })), texto });
};

// ---------- revisão ----------
const reais = (n) => (n == null || n === '' || isNaN(n)) ? '' : Number(n).toFixed(2).replace('.', ',');
// Aceita 12,50 · 12.50 · 1.234,56 · R$ 12,50 (antes, "12.50" virava R$ 1.250,00).
const lerReais = (t) => {
  let v = String(t ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!v) return null;
  const m = v.match(/^(-?[\d.,]*?)[.,](\d{1,2})$/);
  v = m ? m[1].replace(/[.,]/g, '') + '.' + m[2] : v.replace(/[.,]/g, '');
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const temTamanho = (p) => (p.niveis || []).some(n => n.tipo === 'substituir');
const semPreco = (p) => p.incluir !== false && !temTamanho(p) && !(Number(p.preco) > 0);

function desenharRevisao(m) {
  rascunho = m;
  rascunho.categorias.forEach(c => c.produtos.forEach(p => { if (p.incluir === undefined) p.incluir = p.app !== false; if (p.fotoEscolhida === undefined) p.fotoEscolhida = p.fotos?.[0]?.id || null; }));
  mostrar('telaRevisao');
  $('rvGravar').disabled = false; $('rvGravar').textContent = '🚀 Cadastrar no painel';
  $('rvBarraBox').hidden = true; $('rvStatus').textContent = '';
  const box = $('rvCategorias'); box.innerHTML = '';
  const opcoesExist = (sel) => `<option value="">🆕 Categoria nova</option>` + m.existentes.map(e => `<option value="${esc(e.id)}"${e.id === sel ? ' selected' : ''}>Usar: ${esc(e.nome)}</option>`).join('');
  m.categorias.forEach((c, ci) => {
    const card = el('section', 'cartao rv-cat');
    card.innerHTML = `<div class="topo"><input value="${esc(c.idExistente ? c.nomeExistente : c.nome)}" data-cat-nome="${ci}" ${c.idExistente ? 'disabled' : ''}><select data-cat-exist="${ci}">${opcoesExist(c.idExistente)}</select></div>`;
    c.produtos.forEach((p, pi) => card.appendChild(linhaProduto(p, ci, pi)));
    box.appendChild(card);
  });
  atualizarResumo();
  const todos = m.categorias.flatMap(c => c.produtos);
  const fora = todos.filter(p => p.app === false);
  dialogo('dlgRevisao', [
    ['mia', `Li <b>${todos.length}</b> produto(s) em <b>${m.categorias.length}</b> categoria(s), escrevi as descrições ✍️ e já escolhi fotos 📸${fora.length ? `. Deixei <b>${fora.length}</b> desmarcado(s) porque parecem não ir pro app (ex.: ${esc(fora[0].nome)}: ${esc(fora[0].fora_motivo || 'só no local')})` : ''}.`],
    ['max', 'Desmarca o que não vai, ajusta preço, estoque, descrição, opções e fotos. Quando estiver certinho, clica em <b>Cadastrar no painel</b>! 💪']]);
}

function htmlFoto(p) {
  if (!p.fotos?.length) return `<div class="rv-foto vazia" title="Sem foto sugerida">📷</div>`;
  const f = p.fotos.find(x => x.id === p.fotoEscolhida);
  return `<div class="rv-foto${f ? '' : ' sem'}" data-foto-trocar="1" title="Clique para trocar a foto">${f ? `<img src="${esc(f.thumb)}" alt="">` : '🚫'}<span>${f ? '🔄' : 'sem foto'}</span></div>`;
}
function htmlNiveis(p) {
  return (p.niveis || []).map((n, ni) => `<div class="rv-nivel"><div class="rv-nivel-tit">🧩 <b>${esc(n.titulo)}</b> <small>(escolhe ${n.min ?? 0} a ${n.max ?? 1}${n.tipo === 'substituir' ? ' · preço substitui' : ''})</small></div>
    ${(n.opcoes || []).map((o, oi) => `<div class="rv-op${o.incluir === false ? ' fora' : ''}" data-n="${ni}" data-o="${oi}">
      <input type="checkbox" ${o.incluir !== false ? 'checked' : ''} data-op="incluir" title="Incluir esta opção">
      ${o.thumb ? `<img src="${esc(o.thumb)}" class="${o.semFoto ? 'apagada' : ''}" data-op="foto" title="Clique para tirar/pôr a foto">` : '<span class="rv-op-semfoto">—</span>'}
      <input value="${esc(o.nome)}" data-op="nome"><input class="rv-op-preco" value="${reais(o.preco) || ''}" placeholder="0,00" data-op="preco"></div>`).join('')}</div>`).join('');
}
function linhaProduto(p, ci, pi) {
  const d = el('div', 'rv-prod' + (p.incluir === false ? ' fora' : ''));
  d.dataset.ci = ci; d.dataset.pi = pi;
  d.innerHTML = `<input type="checkbox" ${p.incluir !== false ? 'checked' : ''} data-campo="incluir" title="Cadastrar este produto">
    ${htmlFoto(p)}
    <div class="campos">
      <input class="nome" value="${esc(p.nome)}" data-campo="nome">
      ${p.app === false ? `<div class="rv-fora">🚫 Fora do app? ${esc(p.fora_motivo || 'parece ser só no local')}</div>` : ''}
      <textarea data-campo="descricao" rows="2">${esc(p.descricao || '')}</textarea>
      ${(p.niveis || []).length ? `<details class="rv-niveis"><summary>🧩 ${p.niveis.length} nível(is) de opções · ${p.niveis.reduce((s, n) => s + (n.opcoes || []).length, 0)} opções</summary>${htmlNiveis(p)}</details>` : ''}
      ${p.duvida ? `<div class="duvida">⚠️ ${esc(p.duvida)}</div>` : ''}
      <div class="res"></div>
    </div>
    <div class="rv-dir">
      ${temTamanho(p) ? '<div class="motivo">preço pelo tamanho</div>' : `<input class="preco-campo${semPreco(p) ? ' falta' : ''}" value="${reais(p.preco)}" placeholder="R$" data-campo="preco" title="Preço">`}
      <input class="estoque-campo" type="number" min="0" value="${p.estoque ?? ''}" placeholder="estoque" data-campo="estoque" title="Estoque (vazio = sem controle)">
    </div>`;
  return d;
}

$('rvCategorias').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.catNome) { rascunho.categorias[Number(t.dataset.catNome)].nome = t.value; return; }
  const linha = t.closest('.rv-prod'); if (!linha) return;
  const p = rascunho.categorias[linha.dataset.ci].produtos[linha.dataset.pi];
  const op = t.closest('.rv-op');
  if (op && t.dataset.op) {
    const o = p.niveis[op.dataset.n].opcoes[op.dataset.o];
    if (t.dataset.op === 'incluir') { o.incluir = t.checked; op.classList.toggle('fora', !t.checked); }
    if (t.dataset.op === 'nome') o.nome = t.value;
    if (t.dataset.op === 'preco') o.preco = lerReais(t.value) || 0;
    return;
  }
  const campo = t.dataset.campo;
  if (campo === 'incluir') { p.incluir = t.checked; linha.classList.toggle('fora', !t.checked); }
  if (campo === 'nome') p.nome = t.value;
  if (campo === 'descricao') p.descricao = t.value;
  if (campo === 'preco') { p.preco = lerReais(t.value); t.classList.toggle('falta', semPreco(p)); }
  if (campo === 'estoque') p.estoque = t.value === '' ? '' : Number(t.value);
  atualizarResumo();
});
$('rvCategorias').addEventListener('click', (e) => {
  const linha = e.target.closest('.rv-prod'); if (!linha) return;
  const p = rascunho.categorias[linha.dataset.ci].produtos[linha.dataset.pi];
  const tf = e.target.closest('[data-foto-trocar]');
  if (tf && p.fotos?.length) { // percorre as fotos sugeridas e, no fim, "sem foto"
    const ids = [...p.fotos.map(f => f.id), null];
    p.fotoEscolhida = ids[(ids.indexOf(p.fotoEscolhida) + 1) % ids.length];
    tf.outerHTML = htmlFoto(p);
  }
  const fo = e.target.closest('img[data-op="foto"]');
  if (fo) { const op = fo.closest('.rv-op'); const o = p.niveis[op.dataset.n].opcoes[op.dataset.o]; o.semFoto = !o.semFoto; fo.classList.toggle('apagada', o.semFoto); }
});
$('rvTodos').onclick = () => { rascunho?.categorias.forEach(c => c.produtos.forEach(p => { p.incluir = true; })); desenharRevisaoLista(); };
$('rvNenhum').onclick = () => { rascunho?.categorias.forEach(c => c.produtos.forEach(p => { p.incluir = false; })); desenharRevisaoLista(); };
function desenharRevisaoLista() {
  document.querySelectorAll('.rv-prod').forEach(l => { const p = rascunho.categorias[l.dataset.ci].produtos[l.dataset.pi]; l.classList.toggle('fora', p.incluir === false); l.querySelector('[data-campo="incluir"]').checked = p.incluir !== false; });
  atualizarResumo();
}
$('rvCategorias').addEventListener('change', (e) => {
  const t = e.target; if (!t.dataset.catExist) return;
  const c = rascunho.categorias[Number(t.dataset.catExist)];
  const ex = rascunho.existentes.find(x => x.id === t.value);
  c.idExistente = ex?.id; c.nomeExistente = ex?.nome;
  const inp = t.previousElementSibling; inp.disabled = !!ex; inp.value = ex ? ex.nome : c.nome;
});

function atualizarResumo() {
  const todos = rascunho.categorias.flatMap(c => c.produtos);
  const inc = todos.filter(p => p.incluir !== false);
  const faltam = inc.filter(semPreco);
  const novas = rascunho.categorias.filter(c => !c.idExistente && c.produtos.some(p => p.incluir !== false)).length;
  $('rvTotais').innerHTML = [`🍽 ${inc.length} de ${todos.length} produto(s)`, `🗂 ${novas} categoria(s) nova(s)`, `📸 ${inc.filter(p => p.fotoEscolhida).length} com foto`, `🧩 ${inc.filter(p => p.niveis?.length).length} com opções`, faltam.length ? `⚠️ ${faltam.length} sem preço` : '✅ preços ok']
    .map(t => `<span class="chip">${t}</span>`).join('');
  const av = [];
  if (rascunho.aberta) av.push('<div class="alerta-caixa">🟢 A loja está <b>aberta</b> agora. Pode cadastrar normalmente: produto novo não atrapalha quem já está com o carrinho montado.</div>');
  if (faltam.length) av.push(`<div class="alerta-caixa">⚠️ Sem preço (não serão cadastrados): ${faltam.slice(0, 5).map(p => esc(p.nome)).join(', ')}${faltam.length > 5 ? '…' : ''}</div>`);
  if (novas) av.push(`<div class="alerta-caixa">🗂 Categoria nova não pode ser excluída nem renomeada depois (só no Gerencial). Confira os nomes.</div>`);
  (rascunho.avisos || []).slice(0, 4).forEach(a => av.push(`<div class="alerta-caixa">💡 ${esc(a)}</div>`));
  $('rvAvisos').innerHTML = av.join('');
  $('rvGravar').disabled = !inc.filter(p => !semPreco(p)).length;
}

$('rvGravar').onclick = () => {
  const b = $('rvGravar');
  const inc = rascunho.categorias.flatMap(c => c.produtos).filter(p => p.incluir !== false && !semPreco(p));
  if (!inc.length) return;
  doisToques(b, () => {
    b.textContent = '⏳ Cadastrando…';
    $('rvBarraBox').hidden = false; $('rvBarra').style.width = '2%';
    const est = $('rvEstoque').value;
    const plano = { ativo: $('rvAtivo').checked, fotosProdutos: $('rvFotos').checked, fotosOpcoes: $('rvFotosOp').checked, descricoes: $('rvDesc').checked, estoque: est === '' ? '' : Number(est), categorias: rascunho.categorias.map(c => ({ nome: c.nome.trim(), idExistente: c.idExistente, nomeExistente: c.nomeExistente,
      produtos: c.produtos.map(p => ({ ...p, fotos: undefined, incluir: p.incluir !== false && !semPreco(p),
        niveis: (p.niveis || []).map(n => ({ ...n, opcoes: (n.opcoes || []).map(o => ({ ...o, fotoId: o.semFoto ? null : o.fotoId, thumb: undefined })) })) })) })) };
    porta.postMessage({ tipo: 'criar_gravar', estab: rascunho.estab, plano });
  });
};

function progressoGravacao(m) {
  $('rvBarraBox').hidden = false;
  $('rvBarra').style.width = Math.max(2, Math.round(100 * m.feito / Math.max(1, m.total))) + '%';
  $('rvStatus').textContent = `${m.feito}/${m.total} · ${m.texto}`;
}
function fimGravacao(m) {
  const n = m.feitos.length, f = m.falhas.length;
  $('rvBarra').style.width = '100%';
  $('rvGravar').textContent = f ? `✅ ${n} feitos · ${f} com erro` : `✅ ${n} cadastrado(s)`;
  $('rvStatus').textContent = (m.pulados.length ? `Já existiam (pulei): ${m.pulados.join(', ')}. ` : '') + (m.categoriasNovas.length ? `Categorias novas: ${m.categoriasNovas.join(', ')}.` : '');
  const okNomes = new Set(m.feitos.map(x => x.nome.trim().toLowerCase()));
  const erroPor = Object.fromEntries(m.falhas.map(x => [x.nome.trim().toLowerCase(), x.erro]));
  document.querySelectorAll('.rv-prod').forEach(l => {
    const p = rascunho.categorias[l.dataset.ci].produtos[l.dataset.pi]; const k = p.nome.trim().toLowerCase();
    if (okNomes.has(k)) { l.classList.add('ok'); l.querySelector('.res').textContent = '✓ No painel'; }
    else if (erroPor[k]) { l.classList.add('erro'); l.querySelector('.res').textContent = '✗ ' + erroPor[k]; }
  });
  dialogo('dlgRevisao', f
    ? [['max', `Cadastrei <b>${n}</b>, mas <b>${f}</b> deu erro (marcados em vermelho). Corrige e clica de novo: eu pulo os que já foram! 💪`]]
    : [['max', `Prontinho! <b>${n}</b> produto(s) no ar 🎉`], ['mia', 'Quer que eu rode uma <b>Varredura</b> pra conferir fotos e detalhes? Tudo também está no Histórico, com Desfazer.']]);
  maxAvisa(f ? `${n} cadastrados, ${f} com erro.` : `${n} produto(s) cadastrados e conferidos no painel!`, f ? 'erro' : 'ok', f ? 'Quase tudo ✅' : 'Cardápio no ar! 🚀');
  ultimaVarredura = null; ultimasMelhorias = null;
  if (f) { $('rvGravar').disabled = false; }
}

// ======================= v0.8: Fotos automáticas =======================
let fotos = null; // { estab, itens:[{tipo,id,nome,contexto,termo,candidatos,escolha}] }
function desenharFotos(m) {
  fotos = m;
  fotos.itens.forEach(it => { if (it.escolha === undefined) it.escolha = it.candidatos?.[0]?.id || null; });
  mostrar('telaFotos');
  $('ftAplicar').disabled = false; $('ftBarraBox').hidden = true;
  const box = $('ftLista'); box.innerHTML = '';
  if (!m.itens.length) {
    dialogo('dlgFotos', [['mia', `Conferi o <b>${esc(m.estab)}</b>: todos os produtos e opções já têm foto! 📸✨`], ['max', 'Cardápio que dá gosto de ver. Bora pra próxima missão!']]);
    box.appendChild(el('div', 'cartao vazio', '<img src="img/max.png" alt=""><h3>Tudo com foto!</h3>'));
    atualizarTotaisFotos(); return;
  }
  const np = m.itens.filter(i => i.tipo === 'produto').length, no = m.itens.length - np;
  dialogo('dlgFotos', [['mia', `No <b>${esc(m.estab)}</b> achei <b>${np}</b> produto(s) e <b>${no}</b> opção(ões) sem foto. Já escolhi a que achei mais bonita em cada um 😍 Troca à vontade!`],
    ['max', 'Quando estiver do seu gosto, clica em <b>Aplicar fotos</b> que eu subo uma por uma no painel. Dá pra desfazer no Histórico!']]);
  m.itens.forEach((it, i) => box.appendChild(cartaoFoto(it, i)));
  atualizarTotaisFotos();
}
function cartaoFoto(it, i) {
  const c = el('div', 'cartao ft-item' + (it.escolha ? '' : ' pulado'));
  c.dataset.i = i;
  const grade = (it.candidatos || []).map(f => `<img src="${esc(f.thumb)}" data-foto="${esc(f.id)}" class="${f.id === it.escolha ? 'escolhida' : ''}" title="${esc(f.alt || '')}${f.autor ? ' · foto de ' + esc(f.autor) : ''}" loading="lazy">`).join('');
  c.innerHTML = `<div class="cab"><b>${esc(it.nome)}</b><span class="tag ${it.tipo}">${it.tipo === 'produto' ? 'Produto' : 'Opção'}${it.contexto ? ' · ' + esc(it.contexto).slice(0, 28) : ''}</span></div>
    <div class="ft-grade">${grade || '<div class="ft-vazio">Não achei fotos com esse termo. Tente outro abaixo.</div>'}</div>
    <div class="ft-busca"><input value="${esc(it.termo || '')}" data-termo="${i}" title="Termo de busca (em inglês funciona melhor)"><button class="botao mini" data-buscar="${i}">🔄 Mais fotos</button><button class="botao mini" data-pular="${i}">${it.escolha ? 'Pular' : 'Usar'}</button></div>
    <div class="res motivo"></div>`;
  return c;
}
function atualizarTotaisFotos() {
  const n = fotos?.itens.filter(i => i.escolha).length || 0;
  $('ftTotais').innerHTML = [`🖼️ ${fotos?.itens.length || 0} sem foto`, `✅ ${n} escolhida(s)`].map(t => `<span class="chip">${t}</span>`).join('');
  $('ftAplicar').textContent = n ? `✅ Aplicar ${n} foto(s)` : '✅ Aplicar fotos';
  $('ftAplicar').disabled = !n;
}
$('ftLista').addEventListener('click', (e) => {
  const img = e.target.closest('img[data-foto]'), bus = e.target.closest('[data-buscar]'), pul = e.target.closest('[data-pular]');
  if (img) {
    const card = img.closest('.ft-item'), it = fotos.itens[card.dataset.i];
    it.escolha = img.dataset.foto;
    card.querySelectorAll('img').forEach(x => x.classList.toggle('escolhida', x === img));
    card.classList.remove('pulado'); card.querySelector('[data-pular]').textContent = 'Pular';
    atualizarTotaisFotos();
  }
  if (bus) {
    const i = bus.dataset.buscar, termo = document.querySelector(`[data-termo="${i}"]`).value.trim() || fotos.itens[i].nome;
    fotos.itens[i].termo = termo; bus.textContent = '⏳';
    porta.postMessage({ tipo: 'fotos_mais', chave: i, termo });
  }
  if (pul) {
    const card = pul.closest('.ft-item'), it = fotos.itens[pul.dataset.pular];
    if (it.escolha) { it._antes = it.escolha; it.escolha = null; } else it.escolha = it._antes || it.candidatos?.[0]?.id || null;
    card.classList.toggle('pulado', !it.escolha); pul.textContent = it.escolha ? 'Pular' : 'Usar';
    card.querySelectorAll('img').forEach(x => x.classList.toggle('escolhida', x.dataset.foto === it.escolha));
    atualizarTotaisFotos();
  }
});
$('ftLista').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.termo !== undefined) document.querySelector(`[data-buscar="${e.target.dataset.termo}"]`).click(); });
function maisFotos(m) {
  const it = fotos?.itens[m.chave]; if (!it) return;
  it.candidatos = m.candidatos; it.escolha = m.candidatos[0]?.id || null;
  const velho = document.querySelector(`.ft-item[data-i="${m.chave}"]`);
  velho.replaceWith(cartaoFoto(it, m.chave));
  atualizarTotaisFotos();
}
$('ftNenhuma').onclick = () => { fotos?.itens.forEach(it => { if (it.escolha) { it._antes = it.escolha; it.escolha = null; } }); desenharFotosLista(); };
function desenharFotosLista() { const box = $('ftLista'); box.innerHTML = ''; fotos.itens.forEach((it, i) => box.appendChild(cartaoFoto(it, i))); atualizarTotaisFotos(); }
$('ftAplicar').onclick = () => {
  const escolhas = fotos.itens.filter(i => i.escolha).map(i => ({ tipo: i.tipo, id: i.id, idCardapio: i.idCardapio, nome: i.nome, foto: i.escolha }));
  if (!escolhas.length) return;
  doisToques($('ftAplicar'), () => { aplicando = { tipo: 'fotos' }; porta.postMessage({ tipo: 'fotos_aplicar', estab: fotos.estab, escolhas }); });
};
function fimFotos(m) {
  aplicando = null;
  const okIds = new Set(m.feitos.map(x => String(x.id)));
  const erro = Object.fromEntries(m.falhas.map(f => [f.nome, f.erro]));
  document.querySelectorAll('.ft-item').forEach(card => {
    const it = fotos.itens[card.dataset.i];
    if (okIds.has(String(it.id))) { card.classList.add('ok'); card.querySelector('.res').textContent = '✓ Foto no painel'; it.escolha = null; }
    else if (erro[it.nome]) { card.classList.add('erro'); card.querySelector('.res').textContent = '✗ ' + erro[it.nome]; }
  });
  $('ftBarraBox').hidden = true;
  atualizarTotaisFotos();
  const n = m.feitos.length, f = m.falhas.length;
  maxAvisa(f ? `${n} foto(s) aplicada(s) e ${f} com erro.` : `${n} foto(s) no ar! O cardápio ficou outra coisa 😍`, f ? 'erro' : 'ok', f ? 'Quase tudo ✅' : 'Fotos aplicadas 📸');
  ultimaVarredura = null; ultimasMelhorias = null;
}

// ======================= v0.8: Ranking =======================
let ranking = null;
function abrirRanking() {
  mostrar('telaRanking');
  dialogo('dlgRanking', [['mia', 'Eu passo pelo cardápio de <b>cada parceiro</b> do jeito que o cliente vê no app e dou uma nota de 0 a 100 🏆 Leva uns 4 segundos por loja.'],
    ['max', 'O painel precisa estar no <b>Gerencial</b> (é de lá que vem a lista). Pode continuar usando o painel enquanto isso!']]);
  $('rkCriterio').hidden = false;
  if (!ranking) porta.postMessage({ tipo: 'ranking_ultimo' });
}
function estadoRanking(rodando) {
  $('rkRodar').hidden = rodando; $('rkCancelar').hidden = !rodando; $('rkBarraBox').hidden = !rodando;
}
$('rkRodar').onclick = () => { estadoRanking(true); $('rkBarra').style.width = '1%'; $('rkStatus').textContent = 'Começando…'; porta.postMessage({ tipo: 'ranking_rodar' }); };
$('rkCancelar').onclick = () => { porta.postMessage({ tipo: 'ranking_cancelar' }); $('rkStatus').textContent = 'Parando depois desta loja…'; };
function progressoRanking(m) {
  estadoRanking(true);
  $('rkBarra').style.width = Math.max(1, Math.round(100 * m.feito / Math.max(1, m.total))) + '%';
  const falta = Math.max(0, m.total - m.feito) * 4;
  $('rkStatus').textContent = m.nome ? `${m.feito + 1}/${m.total} · lendo ${m.nome} · faltam ~${Math.ceil(falta / 60)} min` : 'Finalizando…';
}
function fimRanking(m) { estadoRanking(false); desenharRanking(m); maxAvisa(m.completo ? 'Ranking pronto! 🏆' : 'Ranking parado no meio: mostrei o que deu tempo.', 'ok', 'MIA: terminei'); }
const corNota = (n) => n == null ? 'c' : n >= 80 ? 'v' : n >= 55 ? 'l' : 'r';
function desenharRanking(m) {
  ranking = m;
  const validos = m.itens.filter(i => i.nota != null).sort((a, b) => b.nota - a.nota || (b.totais?.produtos || 0) - (a.totais?.produtos || 0));
  const semNota = m.itens.filter(i => i.nota == null);
  ranking.ordem = [...validos, ...semNota];
  const ant = Object.fromEntries((m.anterior?.itens || []).map(i => [i.id, i.nota]));
  ranking.ant = ant;
  const quando = new Date(m.data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  $('rkStatus').textContent = `Último ranking: ${quando}${m.completo ? '' : ' (parcial)'} · ${validos.length} parceiros avaliados`;
  $('rkCopiar').hidden = false; $('rkTabelaBox').hidden = false;
  const med = (validos.reduce((s, i) => s + i.nota, 0) / Math.max(1, validos.length)).toFixed(0);
  const atencao = validos.filter(i => i.nota < 55).length;
  dialogo('dlgRanking', [['mia', `Avaliei <b>${validos.length}</b> cardápios. A média da cidade é <b>${med}</b>/100 e <b>${atencao}</b> parceiro(s) precisam de atenção. 👓`],
    ['max', 'Clica em <b>📲</b> ao lado de qualquer parceiro que eu preparo a mensagem pro WhatsApp dele!']]);
  $('rkPodio').innerHTML = validos.slice(0, 3).map((i, k) => `<div class="lugar l${k + 1}"><div class="med">${['🥇', '🥈', '🥉'][k]}</div><b>${esc(i.nome)}</b><div class="nt">${i.nota}</div><small>${i.totais.produtos} produtos · ${i.totais.semFoto} sem foto</small></div>`).join('');
  desenharLinhasRanking();
}
function desenharLinhasRanking() {
  const q = $('rkBusca').value.trim().toLowerCase();
  $('rkLinhas').innerHTML = ranking.ordem.map((i, k) => {
    if (q && !i.nome.toLowerCase().includes(q)) return '';
    const a = ranking.ant[i.id], d = (i.nota != null && a != null) ? i.nota - a : null;
    const delta = d == null ? '<span class="motivo">—</span>' : d > 0 ? `<span class="rk-delta sobe">▲ ${d}</span>` : d < 0 ? `<span class="rk-delta desce">▼ ${-d}</span>` : '<span class="motivo">=</span>';
    return `<tr data-k="${k}"><td>${i.nota != null ? k + 1 : ''}</td><td><b>${esc(i.nome)}</b><div class="motivo">${esc(i.segmento || i.aviso || '')}</div></td>
      <td><span class="rk-nota ${corNota(i.nota)}">${i.nota ?? '–'}</span></td><td>${delta}</td>
      <td>${i.totais?.produtos ?? '–'}</td><td>${i.totais?.semFoto ?? '–'}</td><td>${i.totais?.semDescricao ?? '–'}</td><td>${i.media ? '⭐ ' + i.media.toFixed(1) : '–'}</td>
      <td style="white-space:nowrap">${i.nota != null ? `<button class="botao mini" data-rk-ver="${k}">🔎</button> <button class="botao mini" data-rk-msg="${k}">📲</button>` : ''}</td></tr>`;
  }).join('');
}
$('rkBusca').addEventListener('input', desenharLinhasRanking);
$('rkLinhas').addEventListener('click', (e) => {
  const v = e.target.closest('[data-rk-ver]'), msg = e.target.closest('[data-rk-msg]');
  if (v) {
    const tr = v.closest('tr'), prox = tr.nextElementSibling;
    if (prox?.classList.contains('det')) { prox.remove(); return; }
    const i = ranking.ordem[v.dataset.rkVer];
    const det = el('tr', 'det', `<td></td><td colspan="8"><ul>${(i.problemas || []).map(p => `<li><b>${esc(p.titulo)}</b> (${p.qtd})${p.exemplos?.length ? ': ' + p.exemplos.slice(0, 3).map(esc).join(', ') : ''}</li>`).join('') || '<li>Nenhum problema encontrado 🎉</li>'}</ul>
      ${i.partes ? `<div class="rk-partes">${[['📸 Fotos', i.partes.fotos, 35], ['📝 Descrições', i.partes.descricoes, 30], ['🖼️ Fotos das opções', i.partes.opcoes, 10], ['🗂 Organização', i.partes.organizacao, 15], ['✅ Sem erros graves', i.partes.erros, 10]].map(([t, v, m]) => `<span class="chip">${t} <b>${v}</b>/${m}</span>`).join('')}</div>` : ''}
      <small class="motivo">${i.totais.opcoesSemFoto} opção(ões) de nível sem foto · ${i.totais.comOpcoes} produto(s) com opções</small></td>`);
    tr.after(det);
  }
  if (msg) {
    const i = ranking.ordem[msg.dataset.rkMsg];
    pedirMensagem({ estab: i.nome, nota: i.nota, totais: i.totais, problemas: (i.problemas || []).map(p => `${p.titulo} (${p.qtd})${p.exemplos?.length ? ': ' + p.exemplos.slice(0, 3).join(', ') : ''}`) });
  }
});
$('rkCopiar').onclick = async () => {
  const linhas = [['Posição', 'Parceiro', 'Nota', 'Produtos', 'Sem foto', 'Sem descrição', 'Opções sem foto', 'Média clientes', 'Segmento'].join('\t')]
    .concat(ranking.ordem.map((i, k) => [i.nota != null ? k + 1 : '', i.nome, i.nota ?? '', i.totais?.produtos ?? '', i.totais?.semFoto ?? '', i.totais?.semDescricao ?? '', i.totais?.opcoesSemFoto ?? '', i.media ?? '', i.segmento || ''].join('\t')));
  try { await navigator.clipboard.writeText(linhas.join('\n')); } catch { return maxAvisa('Não consegui copiar. Clique na janela da MIA e tente de novo.', 'erro', 'Ops'); }
  maxAvisa('Planilha copiada! É só colar no Excel ou no Google Planilhas.', 'ok', 'Copiado 📋');
};

// ======================= v0.8: Mensagem pro parceiro =======================
let ultimoPedidoMsg = null;
function pedirMensagem(dados) {
  ultimoPedidoMsg = dados;
  $('msgEstab').textContent = dados.estab; $('msgTexto').value = ''; $('msgTel').textContent = '';
  dialogo('dlgMsg', [['mia', 'Escrevendo uma mensagem simpática com as melhorias mais importantes… ✍️']]);
  $('modalMsg').hidden = false;
  porta.postMessage({ tipo: 'mensagem_parceiro', ...dados });
}
let telMsg = '';
function mostrarMensagem(m) {
  telMsg = m.telefone;
  $('msgTexto').value = m.texto;
  dialogo('dlgMsg', [['max', 'Prontinho! Dá uma revisada, ajusta o que quiser e manda pelo WhatsApp 📲']]);
  $('msgTel').textContent = m.telefone ? `WhatsApp do cadastro: +${m.telefone}` : 'Não achei o telefone desse parceiro (rode o Ranking uma vez no Gerencial para eu aprender a lista). O WhatsApp vai abrir pra você escolher o contato.';
}
$('msgFechar').onclick = () => { $('modalMsg').hidden = true; };
$('modalMsg').addEventListener('click', (e) => { if (e.target.id === 'modalMsg') $('modalMsg').hidden = true; });
$('msgCopiar').onclick = async () => { try { await navigator.clipboard.writeText($('msgTexto').value); maxAvisa('Mensagem copiada!', 'ok', 'Copiado 📋'); } catch { maxAvisa('Não consegui copiar. Selecione o texto e use Ctrl+C.', 'erro', 'Ops'); } };
$('msgRefazer').onclick = () => { if (ultimoPedidoMsg) pedirMensagem(ultimoPedidoMsg); };
$('msgWhats').onclick = () => {
  const t = encodeURIComponent($('msgTexto').value);
  window.open(telMsg ? `https://wa.me/${telMsg}?text=${t}` : `https://api.whatsapp.com/send?text=${t}`, '_blank');
};
$('msgParceiroVarredura').onclick = () => {
  const m = ultimaVarredura; if (!m) return;
  pedirMensagem({ estab: m.estab, nota: m.nota, totais: m.totais, problemas: m.problemas.map(p => `${p.titulo} (${p.itens.length})${p.itens.length ? ': ' + p.itens.slice(0, 3).join(', ') : ''}`),
    melhorias: ultimasMelhorias?.estab === m.estab ? { resumo: ultimasMelhorias.resumo, combos: (ultimasMelhorias.combos || []).map(c => c.nome) } : undefined });
};

// ======================= v0.9: Peça também (sugeridos) e combos dos "saem juntos" =======================
document.addEventListener('change', (e) => {
  const c = e.target.closest('[data-sg]'); if (!c) return;
  const g = melhoriasNaTela?.sugeridos?.[c.dataset.sg]; if (!g) return;
  g.sugeridos[c.dataset.k].fora = !c.checked;
});
document.addEventListener('click', (e) => {
  const bs = e.target.closest('[data-sugeridos]'), bc = e.target.closest('[data-combo-juntos]');
  const m = melhoriasNaTela; if (!m || (!bs && !bc)) return;
  if (bs) {
    const g = m.sugeridos[bs.dataset.sugeridos];
    const esc_ = g.sugeridos.filter(x => !x.fora);
    if (esc_.length < 3 || esc_.length > 5) return maxAvisa('O app só mostra o "peça também" com 3 a 5 produtos marcados.', 'erro', 'Quase!');
    doisToques(bs, () => porta.postMessage({ tipo: 'sugeridos_aplicar', estab: m.estab, produto_id: g.produto_id, produto: g.produto, ids: esc_.map(x => x.id), nomes: esc_.map(x => x.nome) }));
  }
  if (bc) {
    const j = m.juntos[bc.dataset.comboJuntos];
    doisToques(bc, () => porta.postMessage({ tipo: 'combo_criar', estab: m.estab, chave: bc.dataset.comboJuntos, nome: j.combo_nome, preco: j.combo_preco, ativo: false,
      descricao: `${j.a} + ${j.b} juntinhos com preço especial 🤩 A combinação que a galera mais pede! 😋` }));
  }
});
function aoSugeridosOk(m) {
  const g = melhoriasNaTela?.sugeridos?.find(x => String(x.produto_id) === String(m.produto_id)); if (g) g.aplicado = true;
  if (!$('telaMelhorias').hidden) desenharAba('sugeridos');
  maxAvisa('Pronto! O "peça também" já aparece no fim do pedido desse produto.', 'ok', 'Sugeridos no app ➕');
}
function aoComboOk(m) {
  const j = melhoriasNaTela?.juntos?.[m.chave]; if (j) j.criado = true;
  if (!$('telaMelhorias').hidden) desenharAba('juntos');
  maxAvisa(`"${m.nome}" criado (pausado) em 🔥 COMBOS. Coloque a foto e ative quando o estabelecimento aprovar!`, 'ok', 'Combo criado 🍔');
}
