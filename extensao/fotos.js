// fotos.js — "Fotos automáticas": acha produtos e opções de nível sem foto, busca fotos gratuitas
// (Pixabay e Unsplash, licença livre para uso comercial; a busca passa pelo servidor da MIA, que guarda as chaves) e aplica as escolhidas no painel.
import { conferirEstabelecimento } from './painel.js';

async function rodar(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'ISOLATED' });
  return r?.result;
}
// O "id" de cada foto vem pronto do servidor: "px" (Pixabay) ou "un" (Unsplash) + dados da imagem em base64url.
const deB64u = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
function dadosFoto(id) {
  const s = String(id), t = s.slice(0, 2);
  try {
    if (t === 'px') return { url: deB64u(s.slice(2)), dl: '', ok: /^https:\/\/(cdn\.)?pixabay\.com\//.test(deB64u(s.slice(2))) };
    if (t === 'un') { const [url, dl] = JSON.parse(deB64u(s.slice(2))); return { url, dl: dl || '', ok: /^https:\/\/images\.unsplash\.com\//.test(url) }; }
  } catch {}
  return { url: '', dl: '', ok: false };
}
export function urlFoto(id) {
  const d = dadosFoto(id);
  if (!d.ok) throw new Error('Endereço de foto não permitido.');
  return d.url;
}
// O Unsplash pede que se avise quando a foto é usada; falhar aqui nunca atrapalha o trabalho.
async function avisarUso(id) {
  try {
    const { dl } = dadosFoto(id);
    if (!dl) return;
    const { servidor = MIA.servidor, codigo } = await chrome.storage.local.get(['servidor', 'codigo']);
    if (!servidor || !codigo) return;
    await fetch(`${servidor.replace(/\/$/, '')}/foto-uso?d=${encodeURIComponent(dl)}`, { headers: { 'x-codigo-mia': codigo }, signal: AbortSignal.timeout(8000) });
  } catch {}
}
const FOTOS_PAINEL = 'https://maisdeliveryfranquia.com.br/api/';

// ---------- injetadas no painel ----------

// Opções de nível de vários produtos: [{idCardapio, idCategoria}] → opções com foto/sem foto.
async function pg_opcoesDosProdutos(ids) {
  const out = [];
  for (const id of ids) {
    try {
      const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ action: 'edt', idCardapio: id }) }).then(r => r.text()), 'text/html');
      const idCategoria = d.querySelector('#frmCadastro [name=idCategoria]')?.value || '0';
      const h = await fetch('ajax_opcoes_niveis.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ idCategoria, idSubCategoria: '', idCardapio: id }) }).then(r => r.text());
      const dn = new DOMParser().parseFromString('<div>' + h + '</div>', 'text/html');
      const v = (n) => [...dn.querySelectorAll(`[name="${n}"]`)].map(e => e.value);
      const niveis = Object.fromEntries(v('idRelacaoNivel[]').map((rel, i) => [rel, v('dsTitulo[]')[i]]));
      v('idOpcao[]').forEach((idOpcao, i) => out.push({
        idOpcao, idCardapio: id, nome: v('dsNomeOpcao[]')[i], descricao: v('dsDescricaoOpcao[]')[i],
        nivel: niveis[v('idRelacaoOpcao[]')[i]] || '', img: v('dsImagemOpcaoNivel[]')[i] || '',
      }));
    } catch (e) { /* produto ignorado */ }
  }
  return out;
}

// Troca a foto de UMA opção (tela "Opções de níveis"). Devolve o caminho antigo e o novo.
async function pg_fotoOpcao(idOpcao, b64, tipo, idCardapio) {
  const viaNiveis = async () => {
    if (!idCardapio) return null;
    const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ action: 'edt', idCardapio }) }).then(r => r.text()), 'text/html');
    const idCategoria = d.querySelector('#frmCadastro [name=idCategoria]')?.value || '0';
    const h = await fetch('ajax_opcoes_niveis.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ idCategoria, idSubCategoria: '', idCardapio }) }).then(r => r.text());
    const dn = new DOMParser().parseFromString('<div>' + h + '</div>', 'text/html');
    const ids = [...dn.querySelectorAll('[name="idOpcao[]"]')].map(e => e.value);
    const imgs = [...dn.querySelectorAll('[name="dsImagemOpcaoNivel[]"]')].map(e => e.value);
    const i = ids.indexOf(String(idOpcao));
    return i >= 0 ? (imgs[i] || '') : null;
  };
  const ler = async () => new DOMParser().parseFromString(await fetch('opcoes_nivel_cardapio.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ action: 'edt', idOpcaoNivel: idOpcao }) }).then(r => r.text()), 'text/html');
  const d = await ler();
  const f = [...d.forms].find(x => x.querySelector('[name=dsNome]'));
  if (!f) return { ok: false, erro: 'Não consegui abrir a opção.' };
  const antes = (await viaNiveis()) ?? (d.querySelector('img[src*="opcoes_niveis"]')?.getAttribute('src') || '');
  let blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: tipo || 'image/jpeg' });
  for (let lado = 1200; blob.size > 1900000 && lado >= 400; lado -= 300) {
    const im = await createImageBitmap(blob); const k = Math.min(1, lado / Math.max(im.width, im.height));
    const c = new OffscreenCanvas(Math.round(im.width * k), Math.round(im.height * k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  }
  const fd = new FormData(f);
  for (const [k, v] of [...fd.entries()]) if (v instanceof File) fd.delete(k);
  fd.set('action', 'upd');
  fd.set('dsImagem', blob, 'opcao.jpg');
  await fetch('opcoes_nivel_cardapio.php', { method: 'POST', body: fd, credentials: 'include' });
  let depois = await viaNiveis();
  if (depois == null) depois = (await ler()).querySelector('img[src*="opcoes_niveis"]')?.getAttribute('src') || '';
  return { ok: !!depois && depois !== antes, antes, depois, nome: fd.get('dsNome') };
}

// ---------- busca de fotos ----------
// Pede ao servidor da MIA (rota /fotos). Devolve [{ id, thumb, autor, alt }].
export async function buscarFotos(termo, qtd = 4) {
  const { servidor = MIA.servidor, codigo } = await chrome.storage.local.get(['servidor', 'codigo']);
  if (!servidor || !codigo) throw new Error('Configure o endereço do servidor e o seu código de acesso na Central (⚙).');
  const ep = `${servidor.replace(/\/$/, '')}/fotos?q=${encodeURIComponent(termo)}&n=${qtd}`;
  for (let tentativa = 1; ; tentativa++) {
    let r, d;
    try { r = await fetch(ep, { headers: { 'x-codigo-mia': codigo }, signal: AbortSignal.timeout(20000) }); d = await r.json().catch(() => ({})); }
    catch { throw new Error('A busca de fotos não respondeu (sem conexão com o servidor).'); }
    if (r.status === 429 && tentativa < 3) { await new Promise(res => setTimeout(res, (d.espera || 20) * 1000)); continue; }
    if (!r.ok) throw new Error(d.erro || 'A busca de fotos não respondeu (' + r.status + ').');
    return d.fotos || [];
  }
}

export async function baixarB64(id) {
  const r = await fetch(urlFoto(id), { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('Não consegui baixar a foto escolhida (' + r.status + ').');
  const blob = await r.blob();
  if (!/^image\/(jpeg|png|webp)/.test(blob.type)) throw new Error('O arquivo baixado não é uma imagem.');
  if (blob.size < 2000 || blob.size > 6_000_000) throw new Error('A foto baixada tem um tamanho inválido.');
  avisarUso(id);
  return { b64: await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); }), tipo: blob.type };
}

// ---------- API ----------
// cardapio = resultado de lerCardapioCompleto. Devolve a lista do que está sem foto.
export async function semFoto(tab, cardapio, { opcoes = true, limite = 60 } = {}) {
  const itens = cardapio.produtos.filter(p => p.foto === false).map(p => ({ tipo: 'produto', id: p.id, nome: p.nome, contexto: p.categoria, descricao: p.descricao || '' }));
  if (opcoes) {
    const comNiveis = cardapio.produtos.filter(p => p.niveis === 'Sim').map(p => p.id).slice(0, 40);
    const ops = comNiveis.length ? await rodar(tab, pg_opcoesDosProdutos, [comNiveis]) : [];
    const vistas = new Set();
    for (const o of ops || []) {
      if (o.img || vistas.has(o.idOpcao)) continue;
      vistas.add(o.idOpcao);
      itens.push({ tipo: 'opcao', id: o.idOpcao, idCardapio: o.idCardapio, nome: o.nome, contexto: o.nivel, descricao: o.descricao || '' });
    }
  }
  return itens.slice(0, limite);
}

export async function opcoesDoProduto(tab, idCardapio) {
  return (await rodar(tab, pg_opcoesDosProdutos, [[String(idCardapio)]])) || [];
}

export async function aplicarFotoOpcao(tab, estab, idOpcao, foto, idCardapio = '') {
  await conferirEstabelecimento(tab, estab);
  const r = await rodar(tab, pg_fotoOpcao, [String(idOpcao), foto.b64, foto.tipo, String(idCardapio || '')]);
  if (!r?.ok) throw new Error(r?.erro || 'O painel não confirmou a foto da opção.');
  const abs = (p) => p ? (p.startsWith('http') ? p : FOTOS_PAINEL + p.replace(/^\/+/, '').replace(/^api\//, '')) : '';
  return { id: String(idOpcao), nome: r.nome, campo: 'foto_opcao', antes: abs(r.antes), depois: abs(r.depois) };
}
