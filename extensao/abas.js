// abas.js — seletor "🦊 Central | 📣 Marketing" no topo das duas telas.
// Dentro da janela da MIA (mia.html) as duas telas ficam abertas lado a lado (iframes) e o seletor só troca qual aparece,
// sem recarregar e sem perder o que estava na tela. Aberta sozinha, a página troca de endereço.
(() => {
  const aqui = location.pathname.includes('marketing') ? 'marketing' : 'central';
  const dentroDaJanela = window.parent !== window;
  const estilo = document.createElement('style');
  estilo.textContent = `
    .abas-topo { display: flex; gap: 4px; background: rgba(0,0,0,.18); padding: 4px; border-radius: 14px; flex: none; }
    .abas-topo button { position: relative; border: 0; background: transparent; color: #fff; font: inherit; font-weight: 700; font-size: 13.5px;
      padding: 7px 14px; border-radius: 10px; cursor: pointer; white-space: nowrap; opacity: .85; display: inline-flex; align-items: center; gap: 6px; }
    .abas-topo button:hover { opacity: 1; background: rgba(255,255,255,.12); }
    .abas-topo button.ativa { background: #fff; color: #b30d14; opacity: 1; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
    .abas-topo .selo-aba { font-style: normal; font-size: 11px; font-weight: 800; background: #ffc23d; color: #4a2a00; border-radius: 999px; padding: 1px 7px; }
    .abas-topo[hidden] { display: none !important; }
    @media (max-width: 640px) { .abas-topo button { padding: 6px 9px; font-size: 12px; } .abas-topo .rot { display: none; } }`;
  document.head.appendChild(estilo);

  function montar() {
    const nav = document.getElementById('abasTopo');
    if (!nav) return;
    nav.innerHTML = `<button type="button" data-aba="central" class="${aqui === 'central' ? 'ativa' : ''}" title="Varredura, melhorias, cardápios e pedidos">🦊 <span class="rot">Central</span></button>
      <button type="button" data-aba="marketing" class="${aqui === 'marketing' ? 'ativa' : ''}" title="Quadro de artes com o designer">📣 <span class="rot">Marketing</span><i class="selo-aba" id="seloAbaMkt" hidden></i></button>`;
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-aba]'); if (!b || b.dataset.aba === aqui) return;
      window.miaTrocarAba(b.dataset.aba);
    });
    // código do Marketing (designer) não tem a Central: o seletor some
    chrome.storage.local.get('perfil').then(({ perfil }) => { nav.hidden = perfil === 'marketing'; });
  }
  window.miaTrocarAba = (aba, extra = '') => {
    if (dentroDaJanela) window.parent.postMessage({ mia: 'aba', aba, extra }, location.origin);
    else location.href = (aba === 'marketing' ? 'marketing.html' : 'central.html') + extra;
  };
  // número no seletor (artes esperando aprovação), usado pelas duas telas
  window.miaSeloMarketing = (n) => {
    const s = document.getElementById('seloAbaMkt'); if (!s) return;
    s.hidden = !n; s.textContent = n;
    if (dentroDaJanela) window.parent.postMessage({ mia: 'selo', n }, location.origin);
  };
  window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.mia === 'selo') { const s = document.getElementById('seloAbaMkt'); if (s) { s.hidden = !e.data.n; s.textContent = e.data.n; } } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
})();
