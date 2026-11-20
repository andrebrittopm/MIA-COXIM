// cardapio.js — criar cardápio, categorias, ordem e exclusão (v0.7).
// Mapeado e testado no Estabelecimento Teste em 10/10/2026.
import { PAINEL, conferirEstabelecimento, produtosAtuais } from './painel.js';

async function rodar(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'ISOLATED' });
  return r?.result;
}

// Palavras que o painel recusa em nome/descrição de produto.
export const PROIBIDAS = /\b(pix|cnpj|comprovante|whatsapp?|e-?mail|email|whats|cpf|telefone|contato)\b/gi;
export const limparTexto = (t) => String(t || '').replace(PROIBIDAS, '').replace(/\s{2,}/g, ' ').trim();

// ---------- funções injetadas ----------

// Categorias do estabelecimento, na ordem do app.
async function pg_categoriasEstab() {
  const d = new DOMParser().parseFromString(await fetch('categoria_ordem.php', { credentials: 'include' }).then(r => r.text()), 'text/html');
  return [...d.querySelectorAll('li.dd-item')].map(li => ({ id: li.dataset.id, nome: li.innerText.trim() }));
}

async function pg_salvarOrdem(ids) {
  await fetch('produtos.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ categoriaOrdem: JSON.stringify(ids.map(id => ({ id: Number(id) }))) }) });
  const d = new DOMParser().parseFromString(await fetch('categoria_ordem.php', { credentials: 'include' }).then(r => r.text()), 'text/html');
  return [...d.querySelectorAll('li.dd-item')].map(li => li.dataset.id);
}

// Cria a categoria e devolve o id (o maior id com aquele nome exato).
async function pg_criarCategoria(nome) {
  const fd = new FormData(); fd.append('action', 'ins'); fd.append('idCategoria', ''); fd.append('dsCategoria', nome); fd.append('flgAtivo', '1');
  await fetch('categoria_item.php', { method: 'POST', body: fd, credentials: 'include' });
  const d = new DOMParser().parseFromString(await fetch('categoria_item.php', { credentials: 'include' }).then(r => r.text()), 'text/html');
  const ids = [...d.querySelectorAll('table tbody tr')].map(tr => [...tr.cells].map(c => c.innerText.trim()))
    .filter(c => c[1] === nome.trim()).map(c => Number(c[0])).filter(Boolean);
  return ids.length ? String(Math.max(...ids)) : null;
}

async function pg_lojaAberta() {
  const fd0 = new FormData(); fd0.append('action', 'new'); fd0.append('idCardapio', '0');
  const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', body: fd0, credentials: 'include' }).then(r => r.text()), 'text/html');
  const id = d.querySelector('#frmCadastro [name=idRestaurante]')?.value;
  if (!id) return null;
  const r = await fetch('ajax_operacao.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ nrOperacao: 81, idRestaurante: id }) }).then(r => r.json()).catch(() => ({}));
  return !!r.flgAberto;
}

// Cria UM produto. p = { nome, descricao, preco, idCategoria, bebida, ativo, ordem, niveis:[{titulo,min,max,tipo,opcoes:[{nome,preco,descricao}]}], foto:{b64,tipo} }
async function pg_criarProduto(p) {
  const fd0 = new FormData(); fd0.append('action', 'new'); fd0.append('idCardapio', '0');
  const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', body: fd0, credentials: 'include' }).then(r => r.text()), 'text/html');
  const f = d.querySelector('#frmCadastro');
  if (!f) return { ok: false, erro: 'Não consegui abrir o cadastro de produto (sessão expirada?).' };
  const fd = new FormData(f);
  for (const [k, v] of [...fd.entries()]) if (v instanceof File) fd.delete(k);
  const br = (n) => Number(n || 0).toFixed(2).replace('.', ',');
  const niveis = p.niveis || [];
  fd.set('action', 'ins'); fd.set('idCardapio', '0');
  fd.set('dsNome', p.nome); fd.set('dsDescricao', p.descricao || '');
  fd.set('idCategoria', p.idCategoria); fd.set('idSubCategoria', '0');
  fd.set('idTipoProduto', p.bebida ? '1' : '0');
  fd.set('vlItem', br(p.preco)); fd.set('qtEstoque', String(Number.isFinite(p.estoque) ? p.estoque : 999999)); fd.set('nrOrdem', String(p.ordem || 1));
  fd.set('qtSabores', '0'); fd.set('qtAdicionais', '0'); fd.set('flgAdicionais', '0'); fd.set('flgSabores', '0');
  fd.set('flgNiveis', niveis.length ? '1' : '0'); fd.set('flgSalvaNiveis', niveis.length ? '1' : '0');
  fd.set('flgAtivo', p.ativo === false ? '0' : '1');
  niveis.forEach((n, i) => {
    const rel = String(Date.now() % 100000 + i * 7 + Math.floor(Math.random() * 1000));
    fd.append('idRelacaoNivel[]', rel); fd.append('idNivel[]', '0'); fd.append('nrOrdemNivel[]', String(i + 1));
    fd.append('dsTitulo[]', n.titulo); fd.append('qtMinOpcao[]', String(n.min ?? 0)); fd.append('qtMaxOpcao[]', String(n.max ?? 1));
    fd.append('nivelPor[]', '2'); fd.append('nivelPorOld[]', '0');
    fd.append('flgTipoPreco[]', n.tipo === 'substituir' ? '1' : '0'); fd.append('flgMostrarPreco[]', '1'); fd.append('flgAtivoNivel[]', '1');
    for (const o of n.opcoes || []) {
      fd.append('idRelacaoOpcao[]', rel); fd.append('idOpcao[]', '0');
      fd.append('dsNomeOpcao[]', o.nome); fd.append('dsDescricaoOpcao[]', o.descricao || '');
      fd.append('vlItemOpcao[]', br(o.preco)); fd.append('dsImagemOpcaoNivel[]', '');
      fd.append('idTipoOpcao[]', o.bebida ? '1' : '0'); fd.append('flgAtivoOpcao[]', '1');
    }
  });
  if (p.foto?.b64) {
    let blob = new Blob([Uint8Array.from(atob(p.foto.b64), c => c.charCodeAt(0))], { type: p.foto.tipo || 'image/jpeg' });
    for (let lado = 1400; blob.size > 1900000 && lado >= 500; lado -= 300) {
      const im = await createImageBitmap(blob); const k = Math.min(1, lado / Math.max(im.width, im.height));
      const c = new OffscreenCanvas(Math.round(im.width * k), Math.round(im.height * k));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    }
    fd.set('dsImagem', blob, 'foto.jpg');
  }
  const r = await fetch('produto_detalhe.php', { method: 'POST', body: fd, credentials: 'include' });
  const url = decodeURIComponent(r.url);
  return { ok: /dsRetorno=OK/.test(r.url) || /sucesso/i.test(url), url: url.slice(-160) };
}

// Exclui produtos e os níveis "por produto" deles (senão ficam órfãos).
async function pg_excluirProduto(id) {
  const fd0 = new FormData(); fd0.append('action', 'edt'); fd0.append('idCardapio', id);
  const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', body: fd0, credentials: 'include' }).then(r => r.text()), 'text/html');
  // Os níveis vêm de outra chamada (a mesma que a tela usa).
  const idCategoria = d.querySelector('#frmCadastro [name=idCategoria]')?.value || '0';
  const h = await fetch('ajax_opcoes_niveis.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ idCategoria, idSubCategoria: '', idCardapio: id }) }).then(r => r.text());
  const dn = new DOMParser().parseFromString('<div>' + h + '</div>', 'text/html');
  const niveis = [...dn.querySelectorAll('[name="idNivel[]"]')].map(i => i.value);
  const porProduto = [...dn.querySelectorAll('[name="nivelPor[]"]')].map(s => s.value);
  for (const [i, n] of niveis.entries()) if (porProduto[i] === '2' && Number(n) > 0) {
    await fetch('ajax_operacao.php', { method: 'POST', credentials: 'include', body: new URLSearchParams({ nrOperacao: 207, idNivelCardapio: n }) });
  }
  const fd = new FormData(); fd.append('action', 'del'); fd.append('idCardapio[]', id);
  await fetch('produtos.php', { method: 'POST', body: fd, credentials: 'include' });
  return { niveis: niveis.length };
}

// Muda a categoria de um produto (reenviando o formulário, como na edição de descrição).
async function pg_moverProduto(id, idCategoria) {
  const fd0 = new FormData(); fd0.append('action', 'edt'); fd0.append('idCardapio', id);
  const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', body: fd0, credentials: 'include' }).then(r => r.text()), 'text/html');
  const f = d.querySelector('#frmCadastro');
  if (!f) return { ok: false };
  const fd = new FormData(f);
  for (const [k, v] of [...fd.entries()]) if (v instanceof File && !v.size) fd.delete(k);
  const antes = fd.get('idCategoria');
  fd.set('action', 'upd'); fd.set('flgSalvaNiveis', '0'); fd.set('idCategoria', idCategoria); fd.set('idSubCategoria', '0');
  const r = await fetch('produto_detalhe.php', { method: 'POST', body: fd, credentials: 'include' });
  return { ok: /dsRetorno=OK/.test(r.url) || /sucesso/i.test(decodeURIComponent(r.url)), antes };
}

// ---------- API ----------
export const categoriasEstab = (tab) => rodar(tab, pg_categoriasEstab);
export const lojaAberta = (tab) => rodar(tab, pg_lojaAberta);

export async function salvarOrdem(tab, estab, ids) {
  await conferirEstabelecimento(tab, estab);
  const depois = await rodar(tab, pg_salvarOrdem, [ids]);
  const esperado = ids.map(String);
  if (esperado.some((id, i) => depois[i] !== id)) throw new Error('O painel não confirmou a nova ordem das categorias.');
  return depois;
}

// Guarda as categorias criadas, para não duplicar se a criação for interrompida e refeita.
async function categoriaJaCriada(estab, nome) {
  const { catsCriadas = {} } = await chrome.storage.local.get('catsCriadas');
  return catsCriadas[`${estab}|${nome}`];
}
async function anotarCategoria(estab, nome, id) {
  const { catsCriadas = {} } = await chrome.storage.local.get('catsCriadas');
  catsCriadas[`${estab}|${nome}`] = id;
  await chrome.storage.local.set({ catsCriadas });
}

export async function criarCategoria(tab, estab, nome) {
  await conferirEstabelecimento(tab, estab);
  nome = nome.trim();
  const cats = await categoriasEstab(tab);
  const lembrada = await categoriaJaCriada(estab, nome);
  // a categoria lembrada só vale se ainda existe (pode ter sido apagada pelo Gerencial)
  const existente = cats.find(c => c.nome === nome) || (lembrada && cats.find(c => String(c.id) === String(lembrada)));
  if (existente) return { id: existente.id, nova: false };
  const id = await rodar(tab, pg_criarCategoria, [nome]);
  if (!id) throw new Error(`O painel não confirmou a criação da categoria "${nome}".`);
  await anotarCategoria(estab, nome, id);
  return { id, nova: true };
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Cria um produto e devolve { id, nome, categoria } conferindo na lista de produtos.
export async function criarProduto(tab, estab, p, nomeCategoria) {
  await conferirEstabelecimento(tab, estab);
  const antes = await produtosAtuais(tab);
  const ja = antes.find(x => norm(x.nome) === norm(p.nome) && norm(x.categoria) === norm(nomeCategoria));
  if (ja) return { id: ja.id, nome: ja.nome, categoria: ja.categoria, jaExistia: true };
  const dados = { ...p, nome: limparTexto(p.nome), descricao: limparTexto(p.descricao) };
  const r = await rodar(tab, pg_criarProduto, [dados]);
  const idsAntes = new Set(antes.map(x => x.id));
  const novo = (await produtosAtuais(tab)).find(x => !idsAntes.has(x.id) && norm(x.nome) === norm(dados.nome));
  if (!novo) throw new Error(`O painel não confirmou o cadastro de "${p.nome}"${r?.ok ? '' : ' (o formulário voltou com erro)'}.`);
  return { id: novo.id, nome: novo.nome, categoria: novo.categoria, valor: novo.valor };
}

export async function excluirProduto(tab, estab, id) {
  await conferirEstabelecimento(tab, estab);
  const p = (await produtosAtuais(tab)).find(x => x.id === String(id));
  if (!p) return { jaNaoExistia: true };
  await rodar(tab, pg_excluirProduto, [String(id)]);
  if ((await produtosAtuais(tab)).some(x => x.id === String(id))) throw new Error(`O painel não confirmou a exclusão de "${p.nome}".`);
  return { nome: p.nome };
}

export async function moverProduto(tab, estab, id, idCategoria) {
  await conferirEstabelecimento(tab, estab);
  const r = await rodar(tab, pg_moverProduto, [String(id), String(idCategoria)]);
  if (!r?.ok) throw new Error('O painel não confirmou a troca de categoria.');
  return r;
}

export { PAINEL };
