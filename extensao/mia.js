// mia.js — a janela da MIA: Central e Marketing abertas ao mesmo tempo, trocando pelo seletor do topo.
(async () => {
  const fC = document.getElementById('fCentral'), fM = document.getElementById('fMarketing');
  const TITULO = { central: 'Central da MIA – Mais Delivery', marketing: 'Marketing – MIA & MAX' };
  const { perfil } = await chrome.storage.local.get('perfil');
  const marketingSo = perfil === 'marketing';

  function mostrar(aba, extra = '') {
    if (marketingSo) aba = 'marketing';
    const f = aba === 'marketing' ? fM : fC;
    const pagina = aba === 'marketing' ? 'marketing.html' : 'central.html';
    if (!f.src || extra) f.src = pagina + extra; // carrega na primeira vez (ou abre direto numa tela, ex.: #varredura)
    fC.hidden = aba !== 'central'; fM.hidden = aba !== 'marketing';
    document.title = TITULO[aba];
    history.replaceState(null, '', aba === 'marketing' ? '#marketing' : location.pathname);
    try { sessionStorage.setItem('miaAba', aba); } catch {}
    f.focus();
  }

  // mia.html#marketing → Marketing · mia.html#varredura (ou outra tela) → Central já nessa tela
  function peloEndereco() {
    const h = location.hash.slice(1);
    if (h === 'marketing') return mostrar('marketing');
    if (h) return mostrar('central', '#' + h);
    let ultima = 'central'; try { ultima = sessionStorage.getItem('miaAba') || 'central'; } catch {}
    mostrar(ultima);
  }
  window.addEventListener('hashchange', peloEndereco);
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    if (e.data?.mia === 'aba') mostrar(e.data.aba, e.data.extra || '');
    if (e.data?.mia === 'selo') for (const f of [fC, fM]) if (f.contentWindow && f.contentWindow !== e.source) f.contentWindow.postMessage(e.data, location.origin);
  });
  // se o perfil mudar (código novo salvo), recarrega a janela
  chrome.storage.onChanged.addListener((m, area) => { if (area === 'local' && m.perfil && (m.perfil.newValue === 'marketing') !== marketingSo) location.reload(); });
  peloEndereco();
})();
