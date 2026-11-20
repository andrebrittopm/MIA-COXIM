// painel.js — tudo que a MIA sabe fazer no painel Mais Delivery.
// Cada função roda DENTRO da aba do painel (via chrome.scripting), então usa
// o login que já está aberto. Nenhuma senha passa pela extensão.

export const PAINEL = 'https://painel.maisdeliveryempresas.com.br/painel/';

// ---------- funções injetadas na página (precisam ser autossuficientes) ----------

function pg_estabelecimentoAtual(sufixoCidade) {
  // sufixoCidade: ex. 'Coxim' → tira o " - Coxim" do fim do nome da loja (vem de config.js)
  const tiraSufixo = (n) => sufixoCidade ? n.replace(new RegExp(' - ' + sufixoCidade.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '') : n;
  const nav = (document.querySelector('.navbar, nav') || document.body).innerText;
  const lista = [...document.querySelectorAll('a')]
    .filter(a => /login\.php\?index=/.test(a.getAttribute('href') || ''))
    .map(a => ({ nome: tiraSufixo(a.innerText.trim()), link: a.getAttribute('href') }));
  // O nome MAIS LONGO que aparece no topo ganha ("Tchê Burguer e Sorvetes" antes de "Tchê Burguer"),
  // senão um nome curto contido em outro faria a trava de segurança aceitar a loja errada.
  // Em Coxim o topo mostra o nome CURTO ("MEKI LANCHE FELIZ | FECHADO") enquanto a lista tem o nome completo
  // ("MEKI LANCHE FELIZ - TESTES"): se o título do topo bate com o começo de UM único nome da lista, é essa loja.
  const titulo = (nav.match(/([^\n|]+?)\s*\|\s*(?:ABERTO|FECHADO)/i) || [])[1]?.trim();
  const porTitulo = titulo ? lista.map(e => e.nome).filter(n => n === titulo || n.startsWith(titulo + ' - ')) : [];
  const atual = (porTitulo.length === 1 ? porTitulo[0] : null) ||
    lista.map(e => e.nome).filter(n => n && nav.includes(n)).sort((a, b) => b.length - a.length)[0] ||
    (/Gerencial/.test(nav) ? 'Gerencial' : null);
  return { atual, total: lista.length, lista };
}

async function pg_lerTabela(url) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 30000);
  const html = await fetch(url, { signal: ctrl.signal, credentials: 'include' }).then(r => r.text());
  const d = new DOMParser().parseFromString(html, 'text/html');
  const tabela = d.querySelector('table');
  if (!tabela) return { erro: 'Tabela não encontrada (sessão expirada?)' };
  const cab = [...tabela.querySelectorAll('thead th')].map(th => th.innerText.trim());
  const linhas = [...tabela.querySelectorAll('tbody tr')].map(tr => {
    const o = {};
    [...tr.children].forEach((td, i) => {
      const nome = cab[i];
      if (!nome || nome === 'Ação') return; // ignora caixinha de seleção e botões
      const inp = td.querySelector('input:not([type=hidden])');
      o[nome] = inp ? (inp.type === 'checkbox' ? inp.checked : inp.value) : td.innerText.trim();
    });
    return o;
  }).filter(o => Object.values(o).some(v => v !== ''));
  return { linhas, total: linhas.length };
}

// Lê a descrição de vários produtos abrindo a tela de edição de cada um (só leitura).
async function pg_detalhes(ids) {
  const fila = [...ids];
  const out = [];
  async function trabalhador() {
    while (fila.length) {
      const id = fila.shift();
      try {
        const fd = new FormData(); fd.append('action', 'edt'); fd.append('idCardapio', id);
        const t = await fetch('produto_detalhe.php', { method: 'POST', body: fd, credentials: 'include' }).then(r => r.text());
        const d = new DOMParser().parseFromString(t, 'text/html');
        const f = d.querySelector('#frmCadastro');
        out.push({ id, descricao: (d.querySelector('#dsDescricao')?.value || '').trim(), tipo: d.querySelector('#idTipoProduto')?.value, foto: !!f?.querySelector('img'), ok: !!d.querySelector('#dsNome') });
      } catch (e) { out.push({ id, erro: String(e) }); }
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
  return out;
}

// ---------- API usada pelo background ----------

// Lê o cardápio inteiro: produtos + níveis + descrições. "progresso" recebe (feito, total).
export async function lerCardapioCompleto(tabId, progresso = () => {}) {
  const prod = await listarProdutos(tabId);
  const niv = await listarNiveis(tabId);
  if (prod?.erro) throw new Error(prod.erro);
  const produtos = prod.linhas.map(p => ({
    id: p['# ID'], categoria: p['Categoria'], subcategoria: p['Subcategoria'], nome: p['Nome'],
    ordem: p['Ordem'], niveis: p['Níveis'], sabores: Number(p['Sabores'] || 0), adicionais: Number(p['Adicionais'] || 0),
    valor: p['Valor'], estoque: p['Estoque'], ativo: p['Ativo?'], disponivel: p['Disponível?'], descricao: null,
  }));
  const ids = produtos.map(p => p.id);
  const porId = Object.fromEntries(produtos.map(p => [p.id, p]));
  for (let i = 0; i < ids.length; i += 12) {
    const lote = await rodarNaAba(tabId, pg_detalhes, [ids.slice(i, i + 12)]);
    for (const d of lote || []) if (porId[d.id] && d.ok) { porId[d.id].descricao = d.descricao; porId[d.id].bebida = d.tipo === '1'; porId[d.id].foto = d.foto; }
    progresso(Math.min(i + 12, ids.length), ids.length);
  }
  // Muitas descrições sem ler = sessão caiu no meio. Melhor parar do que analisar um cardápio pela metade.
  const semLer = produtos.filter(p => p.descricao === null).length;
  if (semLer > Math.max(3, produtos.length * 0.2)) throw new Error(`Não consegui ler ${semLer} de ${produtos.length} produtos (a sessão do painel pode ter expirado). Atualize o painel e tente de novo.`);
  const niveis = (niv?.linhas || []).map(n => ({
    id: n['# ID'], categoria: n['Categoria'], subcategoria: n['Subcategoria'], produto: n['Produto'],
    ordem: n['Ordem'], titulo: n['Titulo'], ativo: n['Ativo'], por: n['Produto'] ? 'produto' : 'categoria',
  }));
  return { produtos, niveis };
}

async function rodarNaAba(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'ISOLATED' });
  return r?.result;
}

export async function estabelecimentoAtual(tabId) {
  const r = await rodarNaAba(tabId, pg_estabelecimentoAtual, [MIA.sufixoLoja]);
  return { atual: r.atual, total_estabelecimentos: r.total };
}

export async function listarEstabelecimentos(tabId, busca = '') {
  const r = await rodarNaAba(tabId, pg_estabelecimentoAtual, [MIA.sufixoLoja]);
  const b = busca.toLowerCase();
  return r.lista.filter(e => !b || e.nome.toLowerCase().includes(b)).map(e => e.nome);
}

// Troca SEMPRE pelo nome (o "index" do link muda quando a lista muda).
export async function trocarEstabelecimento(tabId, nome) {
  const r = await rodarNaAba(tabId, pg_estabelecimentoAtual, [MIA.sufixoLoja]);
  const alvo = r.lista.filter(e => e.nome.toLowerCase() === nome.toLowerCase());
  if (alvo.length !== 1) {
    const parecidos = r.lista.filter(e => e.nome.toLowerCase().includes(nome.toLowerCase())).map(e => e.nome);
    return { ok: false, erro: `Estabelecimento "${nome}" não encontrado exatamente.`, parecidos };
  }
  await chrome.tabs.update(tabId, { url: PAINEL + alvo[0].link });
  await esperarCarregar(tabId);
  const depois = await rodarNaAba(tabId, pg_estabelecimentoAtual, [MIA.sufixoLoja]);
  return { ok: depois.atual?.toLowerCase() === nome.toLowerCase(), atual: depois.atual };
}

export async function listarProdutos(tabId) {
  return rodarNaAba(tabId, pg_lerTabela, [PAINEL + 'produtos.php']);
}

export async function listarNiveis(tabId) {
  return rodarNaAba(tabId, pg_lerTabela, [PAINEL + 'nivel_cardapio.php']);
}

// Trava de segurança: antes de qualquer gravação, confere o estabelecimento.
export async function conferirEstabelecimento(tabId, esperado) {
  const { atual } = await estabelecimentoAtual(tabId);
  if (!atual || atual.toLowerCase() !== String(esperado).toLowerCase()) {
    throw new Error(`Trava de segurança: o painel está em "${atual}", mas a tarefa é para "${esperado}". Nada foi gravado.`);
  }
}

function esperarCarregar(tabId) {
  return new Promise(res => {
    const f = (id, info) => {
      if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); res(); }
    };
    chrome.tabs.onUpdated.addListener(f);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(f); res(); }, 20000);
  });
}

// ======================= GRAVAÇÃO =======================
// Regra de ouro: confere o estabelecimento, guarda o "antes", grava e RELÊ para confirmar.

async function pg_op(dados) {
  const r = await fetch('ajax_operacao.php', { method: 'POST', body: new URLSearchParams(dados), credentials: 'include' });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { bruto: t.slice(0, 200) }; }
}

async function pg_lerForm(id) {
  const fd = new FormData(); fd.append('action', 'edt'); fd.append('idCardapio', id);
  const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', body: fd, credentials: 'include' }).then(r => r.text()), 'text/html');
  const f = d.querySelector('#frmCadastro');
  if (!f) return null;
  return Object.fromEntries([...new FormData(f).entries()].filter(([, v]) => !(v instanceof File)));
}

// Reenvia o produto inteiro trocando só os campos pedidos (testado: preserva foto e níveis).
async function pg_editarProduto(id, mudancas) {
  const fd0 = new FormData(); fd0.append('action', 'edt'); fd0.append('idCardapio', id);
  const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', body: fd0, credentials: 'include' }).then(r => r.text()), 'text/html');
  const f = d.querySelector('#frmCadastro');
  if (!f) return { ok: false, erro: 'Não consegui abrir o produto para edição.' };
  const fd = new FormData(f);
  for (const [k, v] of [...fd.entries()]) if (v instanceof File && !v.size) fd.delete(k);
  fd.set('action', 'upd'); fd.set('flgSalvaNiveis', '0');
  for (const [k, v] of Object.entries(mudancas)) fd.set(k, v);
  const r = await fetch('produto_detalhe.php', { method: 'POST', body: fd, credentials: 'include' });
  return { ok: /dsRetorno=OK/.test(r.url) || /sucesso/i.test(decodeURIComponent(r.url)) };
}

// Foto atual do produto (endereço da imagem) — '' quando não tem foto.
async function pg_fotoAtual(id) {
  const fd = new FormData(); fd.append('action', 'edt'); fd.append('idCardapio', id);
  const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', body: fd, credentials: 'include' }).then(r => r.text()), 'text/html');
  return d.querySelector('#frmCadastro img')?.getAttribute('src') || '';
}

// Envia uma foto nova (base64) no formulário do produto. Testado em 10/10/2026: troca só a foto.
async function pg_trocarFoto(id, b64, tipo) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  let blob = new Blob([bin], { type: tipo || 'image/jpeg' });
  // O painel aceita até 2 MB: reduz se precisar.
  for (let lado = 1400; blob.size > 1900000 && lado >= 500; lado -= 300) {
    const im = await createImageBitmap(blob);
    const k = Math.min(1, lado / Math.max(im.width, im.height));
    const c = new OffscreenCanvas(Math.round(im.width * k), Math.round(im.height * k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  }
  const fd0 = new FormData(); fd0.append('action', 'edt'); fd0.append('idCardapio', id);
  const d = new DOMParser().parseFromString(await fetch('produto_detalhe.php', { method: 'POST', body: fd0, credentials: 'include' }).then(r => r.text()), 'text/html');
  const f = d.querySelector('#frmCadastro');
  if (!f) return { ok: false, erro: 'Não consegui abrir o produto para edição.' };
  const fd = new FormData(f);
  for (const [k, v] of [...fd.entries()]) if (v instanceof File) fd.delete(k);
  fd.set('action', 'upd'); fd.set('flgSalvaNiveis', '0');
  fd.set('dsImagem', blob, 'foto.jpg');
  const r = await fetch('produto_detalhe.php', { method: 'POST', body: fd, credentials: 'include' });
  return { ok: /dsRetorno=OK/.test(r.url), tamanho: blob.size };
}

export async function produtosAtuais(tabId) {
  const r = await listarProdutos(tabId);
  if (r?.erro) throw new Error(r.erro);
  return r.linhas.map(p => ({ id: p['# ID'], nome: p['Nome'], categoria: p['Categoria'], subcategoria: p['Subcategoria'],
    valor: p['Valor'], estoque: p['Estoque'], ativo: p['Ativo?'], niveis: p['Níveis'], ordem: p['Ordem'] }));
}

export const valorBR = (n) => Number(n).toFixed(2).replace('.', ',');
// Lê valores em reais escritos de qualquer jeito: 16,50 · 16.5 · 1.234,56 · 1,234.56 · "R$ 16,50" · 16.
// Regra: o ÚLTIMO separador seguido de 1 ou 2 dígitos é o decimal; os outros são de milhar.
export function paraNumero(v) {
  if (typeof v === 'number') return v;
  let t = String(v ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!t) return NaN;
  const m = t.match(/^(-?[\d.,]*?)[.,](\d{1,2})$/);
  if (m) t = m[1].replace(/[.,]/g, '') + '.' + m[2];
  else t = t.replace(/[.,]/g, '');
  return Number(t);
}
export const numBR = paraNumero;

// campo: 'preco' | 'ativo' | 'estoque' | 'descricao' | 'foto' (valor = { b64, tipo })
const FORM = { descricao: 'dsDescricao', nome: 'dsNome', bebida: 'idTipoProduto' }; // campo da MIA → campo do formulário do painel
// listaPronta (opcional): lista de produtos já lida — em lote (reajuste), poupa uma leitura do painel por produto.
export async function gravarCampo(tabId, estab, id, campo, valor, listaPronta) {
  await conferirEstabelecimento(tabId, estab);
  const lista = listaPronta || await produtosAtuais(tabId);
  const p = lista.find(x => x.id === String(id));
  if (!p) throw new Error(`Produto ${id} não encontrado neste estabelecimento.`);

  let antes, resposta;
  if (campo === 'preco') {
    antes = p.valor;
    const n = paraNumero(valor);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Preço inválido para "${p.nome}": "${valor}".`);
    const v = valorBR(n);
    resposta = await rodarNaAba(tabId, pg_op, [{ nrOperacao: 31, idCardapio: id, vlItem: v }]);
    valor = v;
  } else if (campo === 'ativo') {
    antes = p.ativo;
    resposta = await rodarNaAba(tabId, pg_op, [{ nrOperacao: 27, idCardapio: id, flgAtivo: valor ? 1 : 0 }]);
  } else if (campo === 'posicao') {
    // Posição do produto dentro da categoria (op 153, a mesma do campo "Ordem" da lista de produtos). Testado em 14/10/2026.
    antes = Number(p.ordem) || 0;
    const n = Math.round(Number(valor));
    if (!(n >= 0)) throw new Error(`Posição inválida para "${p.nome}".`);
    resposta = await rodarNaAba(tabId, pg_op, [{ nrOperacao: 153, idCardapio: id, nrOrdem: n }]);
    valor = n;
  } else if (campo === 'estoque') {
    antes = p.estoque;
    resposta = await rodarNaAba(tabId, pg_op, [{ nrOperacao: 113, idCardapio: id, qtEstoque: Number(valor) }]);
  } else if (campo === 'descricao' || campo === 'nome' || campo === 'bebida') {
    // Campos do formulário do produto: o painel reenvia o produto inteiro trocando só este campo.
    const chave = FORM[campo];
    const form = await rodarNaAba(tabId, pg_lerForm, [id]);
    if (!form) throw new Error(`Não consegui abrir "${p.nome}" no painel (sessão expirada?).`);
    antes = campo === 'bebida' ? form[chave] === '1' : (form[chave] ?? '');
    if (campo === 'nome' && !String(valor).trim()) throw new Error('O nome não pode ficar vazio.');
    resposta = await rodarNaAba(tabId, pg_editarProduto, [id, { [chave]: campo === 'bebida' ? (valor ? '1' : '0') : String(valor).trim() }]);
  } else if (campo === 'foto') {
    antes = await rodarNaAba(tabId, pg_fotoAtual, [id]);
    resposta = await rodarNaAba(tabId, pg_trocarFoto, [id, valor.b64, valor.tipo]);
    const nova = await rodarNaAba(tabId, pg_fotoAtual, [id]);
    if (!resposta?.ok || !nova || nova === antes) throw new Error(`O painel não confirmou a troca da foto de "${p.nome}".`);
    return { id: p.id, nome: p.nome, categoria: p.categoria, campo, antes, depois: nova };
  } else throw new Error('Campo desconhecido: ' + campo);

  // Confere relendo (o estoque, por exemplo, não devolve resposta nenhuma).
  let agora;
  if (FORM[campo]) { const f = await rodarNaAba(tabId, pg_lerForm, [id]); agora = campo === 'bebida' ? f?.[FORM.bebida] === '1' : f?.[FORM[campo]]; }
  else {
    const q = (await produtosAtuais(tabId)).find(x => x.id === String(id));
    agora = campo === 'preco' ? q?.valor : campo === 'ativo' ? q?.ativo : campo === 'posicao' ? q?.ordem : q?.estoque;
  }
  const confere = (campo === 'estoque' || campo === 'posicao') ? Number(agora) === Number(valor)
    : campo === 'preco' ? numBR(agora) === numBR(valor)
    : (campo === 'ativo' || campo === 'bebida') ? agora === !!valor
    : String(agora ?? '').trim() === String(valor).trim();
  if (!confere) throw new Error(`O painel não confirmou a alteração de ${campo} em "${p.nome}" (resposta: ${JSON.stringify(resposta).slice(0, 120)}).`);
  if (listaPronta) { if (campo === 'preco') p.valor = agora; else if (campo === 'ativo') p.ativo = agora; else if (campo === 'estoque') p.estoque = agora; else if (campo === 'posicao') p.ordem = agora; }
  return { id: p.id, nome: p.nome, categoria: p.categoria, campo, antes, depois: (campo === 'ativo' || campo === 'bebida') ? !!valor : (FORM[campo] ? String(valor).trim() : valor) };
}
