// app-coleta.js — roda na página do app do cliente (maisdeliveryapp.com.br/pwa), no mundo da página.
// Guarda na memória da aba as respostas públicas que o PRÓPRIO app já buscou (promoções, novidades,
// segmentos, destaques), para a aba Marketing da MIA ler. Não envia nada para lugar nenhum,
// não grava nada e ignora operações de usuário (dados pessoais, endereços, pedidos).
(() => {
  if (window.__miaColeta) return;
  const PERMITIDAS = new Set(['18', '19', '20', '33', '49', '50', '51', '53', '68', '172']);
  const guardadas = (window.__miaColeta = []);
  const guardar = (corpo, texto) => {
    try {
      const pedido = typeof corpo === 'string' ? JSON.parse(corpo) : null;
      const op = String(pedido?.nr_operacao ?? '');
      if (!PERMITIDAS.has(op)) return;
      const dados = JSON.parse(texto);
      guardadas.push({ op, quando: Date.now(), dados });
      if (guardadas.length > 40) guardadas.shift();
    } catch { /* resposta que não é JSON: ignora */ }
  };
  const abrir = XMLHttpRequest.prototype.open, enviar = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__miaUrl = String(u || ''); return abrir.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (corpo) {
    if (/operacao_oapi/.test(this.__miaUrl)) this.addEventListener('load', () => { try { guardar(corpo, this.responseText); } catch {} });
    return enviar.apply(this, arguments);
  };
  const f = window.fetch;
  window.fetch = function (u, o = {}) {
    const p = f.apply(this, arguments);
    if (/operacao_oapi/.test(String(u?.url || u))) p.then(r => r.clone().text()).then(t => guardar(o.body, t)).catch(() => {});
    return p;
  };
})();
