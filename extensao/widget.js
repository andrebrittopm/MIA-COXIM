// widget.js — o MAX flutuante dentro do painel do Mais Delivery.
// Fica num "shadow DOM" para não brigar com o CSS do painel.
(() => {
  if (window.__miaWidget) return;
  window.__miaWidget = true;
  if (window.top !== window) return; // não roda dentro de iframes
  // Código do Marketing (designer) não opera o painel: o MAX flutuante não aparece.
  chrome.storage.local.get('perfil').then(({ perfil }) => { if (perfil !== 'marketing') iniciarWidget(); });
  function iniciarWidget() {
  // a fonte vem de dentro da extensão (o Windows não tem Nunito); fica no documento porque o shadow DOM não carrega @font-face
  if (!document.getElementById('mia-fonte')) {
    const f = document.createElement('style'); f.id = 'mia-fonte';
    f.textContent = `@font-face { font-family: "MIA Nunito"; src: url("${chrome.runtime.getURL('fontes/nunito.woff')}") format("woff"); font-weight: 200 1000; font-display: swap; }`;
    document.head.appendChild(f);
  }

  const img = (n) => chrome.runtime.getURL('img/' + n);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const host = document.createElement('div');
  host.id = 'mia-widget';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000; right: 0; bottom: 0;';
  document.documentElement.appendChild(host);
  const raiz = host.attachShadow({ mode: 'open' });

  raiz.innerHTML = `
<style>
  :host { --verm: #e3141c; --verm-esc: #b30d14; --lar: #ff7a00; --ama: #ffc23d; --verde: #1fb36b; --creme: #fff7ec; --borda: #f0e2d2; --txt: #2b1a14; --suave: #7a6a62; }
  * { box-sizing: border-box; font-family: "MIA Nunito", "Nunito", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  [hidden] { display: none !important; }
  .bolha { position: fixed; right: 22px; bottom: 96px; width: 66px; height: 66px; border-radius: 50%; border: 3px solid #fff; padding: 0; cursor: pointer;
    background: var(--ama) center/cover no-repeat; box-shadow: 0 8px 22px rgba(120,30,10,.35); transition: transform .15s; }
  .bolha:hover { transform: scale(1.07) rotate(-4deg); }
  .bolha .ping { position: absolute; top: -2px; right: -2px; width: 18px; height: 18px; border-radius: 50%; background: var(--verde); border: 3px solid #fff; }
  .dica-bolha { position: fixed; right: 96px; bottom: 112px; background: #fff; color: var(--txt); font-size: 13px; font-weight: 700; padding: 8px 12px; border-radius: 14px;
    box-shadow: 0 6px 18px rgba(0,0,0,.15); animation: surgir .4s ease-out; white-space: nowrap; }
  .janela { position: fixed; right: 22px; bottom: 96px; width: 390px; height: min(600px, calc(100vh - 120px)); display: flex; flex-direction: column;
    background: var(--creme); border-radius: 22px; overflow: hidden; box-shadow: 0 18px 50px rgba(60,10,0,.35); animation: surgir .25s cubic-bezier(.2,1.3,.4,1); color: var(--txt); font-size: 14px; }
  @keyframes surgir { from { opacity: 0; transform: translateY(16px) scale(.97); } to { opacity: 1; transform: none; } }
  .topo { display: flex; align-items: center; gap: 10px; padding: 12px 14px; color: #fff; background: linear-gradient(120deg, var(--verm), var(--verm-esc) 60%, var(--lar) 150%); }
  .topo img { width: 44px; height: 44px; border-radius: 50%; background: var(--ama); border: 2px solid #fff; object-fit: cover; }
  .topo .nome { flex: 1; line-height: 1.15; } .topo b { font-size: 16px; } .topo small { display: block; font-size: 11.5px; opacity: .95; }
  .topo small i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #9ff0c6; margin-right: 4px; font-style: normal; }
  .ico { background: rgba(255,255,255,.2); border: 0; color: #fff; width: 30px; height: 30px; border-radius: 10px; cursor: pointer; font-size: 15px; }
  .msgs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .m { max-width: 88%; padding: 8px 12px; border-radius: 16px; white-space: pre-wrap; line-height: 1.4; }
  .linha-fala { display: flex; gap: 6px; align-items: flex-end; align-self: flex-start; max-width: 92%; }
  .linha-fala.max { align-self: flex-start; }
  .linha-fala img { width: 28px; height: 28px; border-radius: 50%; flex: none; object-fit: cover; }
  .linha-fala.mia img { background: #ffd3e0; } .linha-fala.max img { background: var(--ama); }
  .linha-fala .m { max-width: 100%; background: #fff; box-shadow: 0 2px 8px rgba(120,40,10,.08); border-bottom-left-radius: 6px; }
  .linha-fala.max .m { background: #fff4dc; }
  .quem { display: block; font-size: 10px; font-weight: 800; letter-spacing: .6px; margin-bottom: 1px; }
  .mia .quem { color: #c2185b; } .max .quem { color: var(--lar); }
  .topo .duo { display: flex; } .topo .duo img + img { margin-left: -12px; } .topo .duo img.mia { background: #ffd3e0; z-index: 1; }
  .m.eu { background: var(--verm); color: #fff; align-self: flex-end; border-bottom-right-radius: 6px; }
  .m.erro { background: #fde8e8; color: #8a1010; }
  .m.status { align-self: center; background: transparent; color: var(--suave); font-size: 12px; padding: 0; }
  .card { background: #fff; border-radius: 16px; padding: 12px; box-shadow: 0 2px 8px rgba(120,40,10,.08); align-self: stretch; }
  .card h4 { margin: 0 0 6px; font-size: 14px; }
  .nota { display: flex; align-items: center; gap: 12px; }
  .anel { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 20px; flex: none;
    background: radial-gradient(closest-side, #fff 74%, transparent 75%), conic-gradient(var(--c) calc(var(--p) * 1%), var(--borda) 0); }
  .linha { display: flex; gap: 6px; align-items: flex-start; font-size: 13px; margin: 4px 0; }
  .tag { font-size: 9.5px; font-weight: 700; color: #fff; padding: 2px 6px; border-radius: 6px; flex: none; margin-top: 2px; }
  .t-erro { background: var(--verm); } .t-aviso { background: var(--lar); } .t-dica { background: #d99a00; }
  .barra { height: 8px; background: var(--borda); border-radius: 99px; overflow: hidden; margin-top: 6px; }
  .barra div { height: 100%; width: 0; background: linear-gradient(90deg, var(--ama), var(--lar), var(--verm)); transition: width .4s; }
  .btn { border: 0; border-radius: 10px; padding: 7px 12px; font-weight: 700; font-size: 12.5px; cursor: pointer; }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn.v { background: var(--verm); color: #fff; } .btn.l { background: var(--lar); color: #fff; } .btn.c { background: var(--creme); color: var(--txt); border: 1px solid var(--borda); }
  .acoes { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--borda); background: #fff; }
  .chip { border: 1.5px solid var(--borda); background: var(--creme); color: var(--txt); border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
  .chip:hover { border-color: var(--lar); }
  .chip.forte { background: var(--verm); border-color: var(--verm); color: #fff; }
  .opcoes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
  .opcoes button { border: 1.5px solid var(--borda); background: var(--creme); border-radius: 12px; padding: 9px 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; text-align: left; color: var(--txt); }
  .opcoes button:hover { border-color: var(--lar); background: #fff4dc; }
  .opcoes small { display: block; font-weight: 600; color: var(--suave); font-size: 11px; margin-top: 2px; }
  .chip.breve { opacity: .6; }
  .entrada { display: flex; gap: 6px; padding: 10px 12px; background: #fff; align-items: center; }
  .entrada textarea { resize: none; max-height: 110px; font-family: inherit; line-height: 1.35; flex: 1; border: 1.5px solid var(--borda); background: var(--creme); border-radius: 14px; padding: 9px 12px; font-size: 13.5px; color: var(--txt); outline: none; }
  .entrada textarea:focus { border-color: var(--lar); }
  .clipe { cursor: pointer; font-size: 18px; }
  .enviar { width: 40px; height: 40px; border-radius: 12px; border: 0; background: var(--verm); color: #fff; font-size: 16px; cursor: pointer; }
  .anexos { font-size: 11px; color: var(--suave); padding: 0 12px; background: #fff; }
</style>

<button class="bolha" title="Falar com o MAX"><span class="ping"></span></button>
<div class="dica-bolha" hidden>Oi! Precisa de ajuda com o cardápio? 🦊</div>

<div class="janela" hidden>
  <div class="topo">
    <div class="duo"><img class="mia" alt="MIA"><img class="max" alt="MAX"></div>
    <div class="nome"><b>MIA &amp; MAX</b><small><i></i><span class="estab">Mais Delivery</span></small></div>
    <button class="ico" data-a="central" title="Abrir a Central">⤢</button>
    <button class="ico" data-a="fechar" title="Fechar">✕</button>
  </div>
  <div class="msgs"></div>
  <div class="chips">
    <button class="chip forte" data-a="varredura">🔍 Varredura</button>
    <button class="chip" data-a="melhorias">✨ Melhorias</button>
    <button class="chip" data-a="combos">🍔 Combos</button>
    <button class="chip" data-a="pedir" data-p="Pausar o produto " data-d="Qual produto quer pausar? Digita o nome (pode ser só um pedaço) 👇">⏸ Pausar produto</button>
    <button class="chip" data-a="pedir" data-p="Ativar o produto " data-d="Qual produto quer ativar de volta? 👇">▶ Ativar</button>
    <button class="chip" data-a="pedir" data-p="Mudar o preço do produto  para R$ " data-d="Me diz o produto e o preço novo. Ex.: mudar o preço do X-Salada para R$ 26 👇">💲 Mudar preço</button>
    <button class="chip" data-a="pedir" data-p="Ajustar o estoque do produto  para " data-d="Qual produto e quantos tem? Ex.: estoque da Coca lata para 20 (ou 0 para esgotado) 👇">📦 Estoque</button>
    <button class="chip" data-a="anexar" data-p="Troca a foto do produto " data-d="Anexa a foto no 📎 e me diz de qual produto é. Ex.: troca a foto do X-Salada 👇">📷 Trocar foto</button>
    <button class="chip forte" data-a="pedido">🧾 Lançar pedido</button>
    <button class="chip" data-a="pedir" data-p="Cadastrar produto novo: " data-d="Me diz o produto, o preço e a categoria. Ex.: cadastrar Coca-Cola 2 L por R$ 14 em Bebidas. Eu escrevo a descrição caprichada 😋👇">🆕 Novo produto</button>
    <button class="chip" data-a="central" data-t="criar">📸 Criar cardápio</button>
    <button class="chip" data-a="central" data-t="fotos">🖼️ Fotos automáticas</button>
  </div>
  <div class="anexos"></div>
  <div class="entrada">
    <label class="clipe" title="Anexar foto ou PDF">📎<input type="file" accept="image/*,application/pdf" multiple hidden></label>
    <textarea rows="1" placeholder="Fala comigo do seu jeito…"></textarea>
    <button class="enviar" title="Enviar">➤</button>
  </div>
</div>`;

  const $ = (s) => raiz.querySelector(s);
  $('.bolha').style.backgroundImage = `url("${img('max-rosto.png')}")`;
  $('.topo img.mia').src = img('mia-rosto.png'); $('.topo img.max').src = img('max-rosto.png');
  const msgs = $('.msgs');
  let anexos = [];
  let modoPedido = null; // como o pedido chegou (digitado, colado, print, papel)
  let ocupado = false;
  let progresso = null;

  // ---------- conexão com o background ----------
  let porta;
  function conectar() {
    // Depois de atualizar a extensão, o chat antigo que ficou na aba perde a ligação: some sozinho.
    if (!chrome.runtime?.id) { host.remove(); return; }
    try { porta = chrome.runtime.connect({ name: 'mia' }); }
    catch { host.remove(); return; }
    porta.onMessage.addListener(receber);
    porta.onDisconnect.addListener(() => setTimeout(conectar, 500));
  }
  conectar();

  // ---------- abrir / fechar ----------
  const abrir = (sim) => {
    $('.janela').hidden = !sim; $('.bolha').hidden = sim; $('.dica-bolha').hidden = true;
    try { sessionStorage.setItem('mia-aberto', sim ? '1' : ''); } catch {}
    if (sim) { porta.postMessage({ tipo: 'qual_estab' }); $('.entrada textarea').focus(); }
  };
  $('.bolha').onclick = () => abrir(true);
  let aberto = false; try { aberto = sessionStorage.getItem('mia-aberto') === '1'; } catch {}
  if (aberto) setTimeout(() => abrir(true), 0);
  else setTimeout(() => { if ($('.janela').hidden) { $('.dica-bolha').hidden = false; setTimeout(() => { $('.dica-bolha').hidden = true; }, 6000); } }, 1500);


  function add(classe, html, comoTexto = true) {
    const d = document.createElement('div');
    d.className = classe;
    if (comoTexto) d.textContent = html; else d.innerHTML = html;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  function fala(quem, texto) {
    const d = document.createElement('div'); d.className = 'linha-fala ' + quem;
    d.innerHTML = `<img src="${img(quem + '-rosto.png')}" alt=""><div class="m"><b class="quem">${quem.toUpperCase()}</b></div>`;
    d.querySelector('.m').appendChild(document.createTextNode(texto));
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  }
  function porFalante(texto) {
    const partes = []; let atual = ['mia', ''];
    for (const linha of String(texto).split('\n')) {
      const m = linha.match(/^\s*\**(MIA|MAX)\**\s*:\s*(.*)$/i);
      if (m) { if (atual[1].trim()) partes.push(atual); atual = [m[1].toLowerCase(), m[2]]; }
      else atual[1] += (atual[1] ? '\n' : '') + linha;
    }
    if (atual[1].trim()) partes.push(atual);
    return partes;
  }

  fala('mia', 'Oi! 👓 Eu sou a MIA: faço a varredura do cardápio e sugiro melhorias e combos.');
  fala('max', 'E eu sou o MAX! Pauso produto, mudo preço, troco foto e lanço pedido pelo print — sempre com a sua confirmação. Bora? 🦊');

  function receber(m) {
    if (m.tipo === 'estab') {
      $('.estab').textContent = !m.atual ? 'Painel não identificado' : m.atual === 'Gerencial' ? 'Gerencial' : m.atual;
    }
    if (m.tipo === 'progresso' && progresso) {
      progresso.querySelector('.etapa').textContent = m.etapa;
      progresso.querySelector('.barra div').style.width = m.pct + '%';
    }
    if (m.tipo === 'varredura_ok') { fimTrabalho(); mostrarVarredura(m); }
    if (m.tipo === 'melhorias_ok') { fimTrabalho(); mostrarMelhorias(m); }
    if (m.tipo === 'falha') {
      fimTrabalho();
      if (m.texto === 'MAX_GERENCIAL') fala('mia', 'Você está no Gerencial 😅 Escolhe um estabelecimento no seletor ⇄ e chama a gente de novo!');
      else fala('mia', 'Ops, deu ruim aqui: ' + m.texto);
    }
    if (m.tipo === 'resposta') porFalante(m.texto).forEach(([q, t]) => fala(q, t.trim()));
    if (m.tipo === 'erro') add('m erro', '⚠ ' + m.texto);
    if (m.tipo === 'falha_leve') { fala('mia', 'Não deu: ' + m.texto); raiz.querySelectorAll('[data-a="desfazer"]:disabled').forEach(b => { b.disabled = false; b.textContent = '↩ Desfazer'; }); }
    if (m.tipo === 'status') { ocupado = !!m.texto; $('.enviar').disabled = ocupado; const s = raiz.querySelector('.m.status'); if (m.texto) (s || add('m status', '')).textContent = m.texto; else s?.remove(); }
    if (m.tipo === 'confirmar') confirmar(m.texto);
    if (m.tipo === 'alterado' && m.alteracao.campo === 'pedido') {
      const x = m.alteracao;
      add('card', `<div style="font-size:13px">✅ <b>Pedido lançado</b> para <b>${esc(x.nome)}</b> · R$ ${esc(Number(x.depois).toFixed(2).replace('.', ','))}<br><span style="color:var(--suave)">Já está na tela de Pedidos do painel.</span></div>`, false);
    } else if (m.tipo === 'alterado' && m.alteracao.campo === 'foto') {
      const x = m.alteracao;
      add('card', `<div style="font-size:13px">✅ <b>Foto</b> de <b>${esc(x.nome)}</b> trocada</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px">${x.antes ? `<img src="${esc(x.antes)}" style="width:56px;height:56px;object-fit:cover;border-radius:10px;opacity:.55">→` : ''}<img src="${esc(x.depois)}" style="width:72px;height:72px;object-fit:cover;border-radius:10px"></div>
        <div class="acoes"><button class="btn c" data-a="desfazer" data-uid="${x.uid}">↩ Desfazer</button></div>`, false);
    } else if (m.tipo === 'alterado' && m.alteracao.campo === 'criado') {
      const x = m.alteracao;
      add('card', `<div style="font-size:13px">🆕 <b>${esc(x.nome)}</b> cadastrado em <b>${esc(x.depois)}</b></div>
        <div class="acoes"><button class="btn c" data-a="desfazer" data-uid="${x.uid}">↩ Desfazer (excluir)</button></div>`, false);
    } else if (m.tipo === 'alterado' && (m.alteracao.campo === 'ordem' || m.alteracao.campo === 'categoria')) {
      add('card', `<div style="font-size:13px">✅ <b>${esc(m.alteracao.nome)}</b> atualizado no app</div>`, false);
    } else if (m.tipo === 'alterado') {
      const x = m.alteracao, f = (c, v) => c === 'preco' ? `R$ ${v}` : c === 'ativo' ? (v ? 'ativo' : 'pausado') : c === 'estoque' ? String(v) : `"${String(v || '').slice(0, 50)}"`;
      const nome = { posicao: 'Posição', nome: 'Nome', bebida: 'Bebida', preco: 'Preço', ativo: 'Situação', estoque: 'Estoque', descricao: 'Descrição', foto_opcao: 'Foto da opção', sugeridos: 'Peça também' }[x.campo] || 'Alteração';
      add('card', `<div style="font-size:13px">✅ <b>${esc(nome)}</b> de <b>${esc(x.nome)}</b><br><s style="color:var(--suave)">${esc(f(x.campo, x.antes))}</s> → <b>${esc(f(x.campo, x.depois))}</b></div>
        <div class="acoes"><button class="btn c" data-a="desfazer" data-uid="${x.uid}">↩ Desfazer</button></div>`, false);
    }
    if (m.tipo === 'desfeito') fala('max', `↩ Desfeito! ${m.alteracao.nome} voltou como estava.`);
  }

  function iniciarTrabalho(titulo) {
    progresso = add('card', `<h4>${esc(titulo)}</h4><div class="etapa" style="font-size:12.5px;color:var(--suave)">Começando…</div><div class="barra"><div></div></div>`, false);
  }
  function fimTrabalho() { progresso?.remove(); progresso = null; }

  function mostrarVarredura(m) {
    const cor = m.nota >= 80 ? 'var(--verde)' : m.nota >= 55 ? 'var(--lar)' : 'var(--verm)';
    const ordem = { erro: 0, aviso: 1, dica: 2 };
    const top = [...m.problemas].sort((a, b) => ordem[a.nivel] - ordem[b.nivel]).slice(0, 4);
    const conta = (n) => m.problemas.filter(p => p.nivel === n).length;
    add('card', `
      <div class="nota"><div class="anel" style="--p:${m.nota};--c:${cor}">${m.nota}</div>
        <div><h4>Varredura · ${esc(m.estab)}</h4><div style="font-size:12.5px;color:var(--suave)">${conta('erro')} erros · ${conta('aviso')} avisos · ${conta('dica')} dicas</div></div></div>
      ${top.map(p => `<div class="linha"><span class="tag t-${p.nivel}">${p.nivel.toUpperCase()}</span><span><b>${esc(p.titulo)}</b>${p.itens.length ? ` (${p.itens.length})` : ''}</span></div>`).join('')}
      <div class="acoes"><button class="btn v" data-a="central" data-t="varredura">Ver relatório completo</button><button class="btn c" data-a="melhorias">✨ Melhorias</button></div>`, false);
    if (m.nota >= 85) { fala('mia', 'Cardápio caprichado! Quase nada pra arrumar 🤩'); fala('max', 'Aí sim! 🏆'); }
    else { fala('mia', 'Comece pelos itens vermelhos. O relatório completo tá na Central 👓'); fala('max', 'Preço, estoque ou pausar algo? Me fala que eu resolvo!'); }
  }

  function mostrarMelhorias(m) {
    const d = (m.descricoes || []).slice(0, 2);
    const c = (m.combos || [])[0];
    fala('mia', m.resumo || 'Separei umas ideias pra vender mais!');
    add('card', `
      <h4>✨ Melhorias · ${esc(m.estab)}</h4>
      ${d.map(x => `<div class="linha">📝<span><b>${esc(x.produto)}</b><br>${esc(x.sugerida)}</span></div>`).join('')}
      ${c ? `<div class="linha">🍔<span><b>${esc(c.nome)}</b> por R$ ${esc(c.preco_sugerido)} <s style="color:var(--suave)">R$ ${esc(c.soma)}</s></span></div>` : ''}
      <div style="font-size:12px;color:var(--suave);margin-top:4px">${(m.descricoes || []).length} descrições · ${(m.combos || []).length} combos · ${(m.nomes || []).length} nomes · ordem das categorias</div>
      <div class="acoes"><button class="btn l" data-a="central" data-t="melhorias">Ver tudo na Central</button></div>`, false);
  }

  function confirmar(texto) {
    const c = add('card', `<h4>Confirma esta ação?</h4><div style="font-size:13px;white-space:pre-line"></div><div class="acoes"><button class="btn v">Confirmar</button><button class="btn c">Cancelar</button></div>`, false);
    c.querySelector('div').textContent = texto;
    const [sim, nao] = c.querySelectorAll('button');
    const r = (ok) => { porta.postMessage({ tipo: 'confirmacao', ok }); sim.disabled = nao.disabled = true; c.querySelector('h4').textContent = ok ? 'Confirmado ✓' : 'Cancelado'; };
    sim.onclick = () => r(true); nao.onclick = () => r(false);
  }

  // ---------- botões ----------
  raiz.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'fechar') return abrir(false);
    if (a === 'central') return porta.postMessage({ tipo: 'abrir_central', tela: b.dataset.t || '' });
    if (a === 'breve') return fala('max', `Ainda tô aprendendo a ${b.dataset.o} 💪 Chega nas próximas versões!`);
    if (a === 'pedir') {
      fala('max', b.dataset.d);
      const campo = $('.entrada textarea'); campo.value = b.dataset.p; campo.focus();
      const pos = b.dataset.p.indexOf('  '); if (pos >= 0) campo.setSelectionRange(pos + 1, pos + 1);
      return;
    }
    if (a === 'pedido') {
      fala('max', 'Bora lançar! 🧾 Como o pedido chegou?');
      add('card', `<div class="opcoes">
        <button data-a="ped-modo" data-m="digitar">⌨️ Digitar<small>eu escrevo os dados</small></button>
        <button data-a="ped-modo" data-m="colar">📋 Colar conversa<small>texto do WhatsApp</small></button>
        <button data-a="ped-modo" data-m="print">📱 Print<small>imagem do WhatsApp</small></button>
        <button data-a="ped-modo" data-m="papel">📝 Foto do papel<small>pedido anotado</small></button></div>`, false);
      return;
    }
    if (a === 'ped-modo') {
      const campo = $('.entrada textarea');
      const m = b.dataset.m;
      modoPedido = { digitar: 'digitado', colar: 'conversa colada do WhatsApp', print: 'print do WhatsApp', papel: 'foto de um papel anotado' }[m];
      b.closest('.opcoes').querySelectorAll('button').forEach(x => { x.disabled = true; x.style.opacity = x === b ? 1 : .4; });
      if (m === 'digitar') { fala('mia', 'Escreve do seu jeito, numa mensagem só: telefone, endereço (ou "retirada"), itens ou valor e pagamento. O que faltar eu pergunto 😉'); campo.placeholder = 'Ex.: 66 99999-0000, Rua 17 nº 242 Setor Norte, 2 X-Salada, Pix pago'; campo.focus(); }
      if (m === 'colar') { fala('mia', 'Cola aqui a conversa com o pedido (Ctrl+V) e envia 👇'); campo.placeholder = 'Cole a conversa do WhatsApp aqui…'; campo.focus(); }
      if (m === 'print' || m === 'papel') { fala('max', m === 'print' ? 'Escolhe o print do WhatsApp 📱' : 'Escolhe a foto do papel 📝 (tira bem de pertinho, com boa luz)'); $('.clipe input').click(); }
      return;
    }
    if (a === 'anexar') {
      fala('max', b.dataset.d);
      const campo = $('.entrada textarea'); campo.value = b.dataset.p; campo.focus();
      if (!anexos.length) $('.clipe input').click();
      return;
    }
    if (a === 'desfazer') {
      if (!b.dataset.armado) { b.dataset.armado = '1'; b.textContent = 'Confirmar?'; return; }
      b.disabled = true; b.textContent = '⏳'; return porta.postMessage({ tipo: 'desfazer', uid: b.dataset.uid });
    }
    if (progresso || ocupado) return fala('max', 'Calma, tô terminando a tarefa anterior! ⏳');
    if (a === 'varredura') { add('m eu', '🔍 Varredura'); iniciarTrabalho('Fazendo a varredura…'); porta.postMessage({ tipo: 'varredura' }); }
    if (a === 'melhorias' || a === 'combos') { add('m eu', a === 'combos' ? '🍔 Combos' : '✨ Melhorias'); iniciarTrabalho('Buscando melhorias…'); porta.postMessage({ tipo: 'melhorias' }); }
  });

  // ---------- chat ----------
  function enviar() {
    const campo = $('.entrada textarea');
    let texto = campo.value.trim();
    if ((!texto && !anexos.length) || ocupado) return;
    add('m eu', (texto || (modoPedido ? 'Lança esse pedido' : '')) + (anexos.length ? `\n📎 ${anexos.map(a => a.nome).join(', ')}` : ''));
    if (modoPedido) texto = `[Lançar pedido · dados: ${modoPedido}]\n${texto || 'Lança esse pedido.'}`;
    porta.postMessage({ tipo: 'comando', texto: texto || 'Veja o anexo.', anexos });
    campo.value = ''; anexos = []; $('.anexos').textContent = '';
    modoPedido = null; campo.placeholder = 'Fala comigo do seu jeito…';
  }
  $('.enviar').onclick = enviar;
  $('.entrada textarea').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
  // cresce conforme o texto (até ~5 linhas)
  $('.entrada textarea').addEventListener('input', (e) => { const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 110) + 'px'; });

  $('.clipe input').onchange = async (e) => {
    const campoArquivo = e.currentTarget; // guardar já: dentro do shadow DOM o e.target vira null depois do await
    for (const f of [...campoArquivo.files]) {
      const dados = f.type === 'application/pdf' ? await b64(f) : await reduzir(f);
      anexos.push({ nome: f.name, tipo: f.type === 'application/pdf' ? f.type : 'image/jpeg', dados });
    }
    $('.anexos').textContent = '📎 ' + anexos.map(a => a.nome).join(', ');
    campoArquivo.value = '';
    // Print ou foto do papel: já envia direto, sem precisar digitar nada.
    if (anexos.length && modoPedido && /print|papel/.test(modoPedido)) enviar();
  };
  const b64 = (f) => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); });
  async function reduzir(f) {
    const im = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(im.width, im.height));
    const c = new OffscreenCanvas(Math.round(im.width * k), Math.round(im.height * k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return b64(await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
  }
  } // iniciarWidget
})();
