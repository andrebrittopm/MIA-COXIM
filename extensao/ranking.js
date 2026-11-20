// ranking.js — "Ranking dos parceiros": nota do cardápio de TODOS os estabelecimentos.
// Não troca o estabelecimento do painel (a central continua trabalhando normalmente):
// lê a lista no Gerencial e o cardápio pela loja pública do app, como o cliente vê.
import { verificar } from './analise.js';

const LOJA = 'https://maisdeliveryapp.com.br/web/loja.php?id=';

async function rodar(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'ISOLATED' });
  return r?.result;
}

// ---------- injetadas ----------
async function pg_listaEstabelecimentos() {
  const r = await fetch('lista_estabelecimentos.php', { credentials: 'include' });
  const d = new DOMParser().parseFromString(await r.text(), 'text/html');
  const cab = [...d.querySelectorAll('table thead th')].map(t => t.innerText.trim());
  const col = (n) => cab.indexOf(n);
  if (col('ID') < 0 || col('Nome') < 0) return { erro: 'GERENCIAL' };
  return { lista: [...d.querySelectorAll('table tbody tr')].map(tr => {
    const c = [...tr.cells].map(x => x.innerText.trim());
    // "Situação" é uma caixa de seleção: vale a opção marcada (Ativo = aberto agora, Fechado = fora do horário, Inativo, Arquivado).
    const sel = tr.cells[col('Situação')]?.querySelector('select');
    const situacao = sel ? ((sel.querySelector('option[selected]') || sel.options[sel.selectedIndex])?.text || '').trim()
      : (c[col('Nome')].match(/\((\w+)\)\s*$/)?.[1] || '');
    return { id: c[col('ID')], nome: c[col('Nome')].replace(/\s*\((Ativo|Inativo|Fechado|Arquivado)\)\s*$/i, ''), telefone: c[col('Telefone')] || '',
      segmento: c[col('Segmento')] || '', situacao };
  }).filter(e => e.id) };
}

// Assinatura do cardápio guardado pelo app (para saber quando ele trocou de loja).
function pg_assinaturaMenu() {
  const t = localStorage.getItem('@mais/delivery/shop/menu') || '';
  let h = 0; for (let i = 0; i < t.length; i += 7) h = (h * 31 + t.charCodeAt(i)) | 0;
  return t.length + ':' + h;
}

// Espera a loja pública carregar o estabelecimento pedido e devolve o que o app guardou.
// Só aceita quando a loja E o cardápio já são do estabelecimento novo (o app grava os dois em momentos diferentes).
async function pg_lerLojaPublica(id, assinaturaAntiga) {
  const assinatura = (t) => { let h = 0; for (let i = 0; i < t.length; i += 7) h = (h * 31 + t.charCodeAt(i)) | 0; return t.length + ':' + h; };
  let desde = 0;
  for (let i = 0; i < 70; i++) {
    let sh = null;
    try { sh = JSON.parse(localStorage.getItem('@mais/delivery/shop')); } catch {}
    const txt = localStorage.getItem('@mais/delivery/shop/menu') || '';
    if (sh?.idRestaurante === String(id)) {
      if (!desde) desde = Date.now();
      const outra = [...txt.matchAll(/"idRestaurante":"(\d+)"/g)].some(m => m[1] !== String(id));
      const mudou = assinatura(txt) !== assinaturaAntiga;
      // só aceita quando o cardápio também já é o da loja nova
      if (!outra && mudou) {
        await new Promise(r => setTimeout(r, 300));
        let menu = null;
        try { menu = JSON.parse(localStorage.getItem('@mais/delivery/shop/menu')); } catch {}
        return { shop: { nome: sh.dsNome, media: sh.vlMedia, fechado: sh.flgFechado, categoria: sh.dsCategoria }, menu };
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return { erro: 'A loja pública não carregou a tempo.' };
}

// ---------- conversão para o formato da Varredura ----------
function paraCardapio(menu) {
  const produtos = [], niveis = [];
  for (const c of menu?.categorias || []) {
    const blocos = [{ nome: '', produtos: c.produtos || [] }, ...(c.subcategorias || []).map(s => ({ nome: s.dsSubCategoria || '', produtos: s.produtos || [] }))];
    for (const b of blocos) for (const p of b.produtos) {
      produtos.push({ id: p.idCardapio, nome: p.dsNome, categoria: c.dsCategoria, subcategoria: b.nome, descricao: (p.dsDescricao || '').trim(),
        foto: !!p.dsImagem, valor: String(p.vlItem || '0').replace('.', ','), niveis: p.flgNiveis === '1' ? 'Sim' : 'Não',
        sabores: Number(p.qtSabores || 0), adicionais: Number(p.qtAdicionais || 0), ativo: true, disponivel: 'Sim', estoque: '', bebida: undefined,
        opcoesSemFoto: (p.niveis || []).reduce((s, n) => s + (n.opcoesNivel || []).filter(o => !o.dsImagem).length, 0),
        opcoesTotal: (p.niveis || []).reduce((s, n) => s + (n.opcoesNivel || []).length, 0) });
      for (const n of p.niveis || []) niveis.push({ titulo: n.dsTitulo, por: 'produto', produto: p.dsNome, categoria: '' });
    }
  }
  return { produtos, niveis };
}

// Nota do ranking (0–100), proporcional ao tamanho do cardápio, para comparar lojas grandes e pequenas:
//  📸 fotos dos produtos 35 · 📝 descrições boas (25+ letras) 30 · 🖼️ fotos das opções 10 · 🗂 organização 15 · ✅ sem erros graves 10
export function notaRanking(cardapio, problemas) {
  const P = cardapio.produtos, n = Math.max(1, P.length);
  const fotos = P.filter(p => p.foto).length / n;
  const desc = P.filter(p => (p.descricao || '').length >= 25).length / n;
  const totOp = P.reduce((s, p) => s + (p.opcoesTotal || 0), 0), semOp = P.reduce((s, p) => s + (p.opcoesSemFoto || 0), 0);
  const opcoes = totOp ? 1 - semOp / totOp : 1;
  const tem = (t) => problemas.some(p => p.titulo === t);
  const org = 15 - 4 * ['Nomes com padrão misturado', 'Categorias com um produto só', 'Categoria mostrando o nome do estabelecimento', 'Categorias sem emoji', 'Níveis inconsistentes no mesmo grupo'].filter(tem).length;
  const graves = 10 - 5 * ['Produtos duplicados', 'Palavra proibida no nome ou descrição', 'Preço R$ 0,00', 'Preço fora da curva'].filter(tem).length;
  const partes = { fotos: Math.round(35 * fotos), descricoes: Math.round(30 * desc), opcoes: Math.round(10 * opcoes), organizacao: Math.max(0, org), erros: Math.max(0, graves) };
  return { nota: Object.values(partes).reduce((a, b) => a + b, 0), partes };
}

function resumo(cardapio) {
  const P = cardapio.produtos;
  return { produtos: P.length, categorias: new Set(P.map(p => p.categoria)).size,
    semFoto: P.filter(p => !p.foto).length, semDescricao: P.filter(p => !p.descricao).length,
    comOpcoes: P.filter(p => p.niveis === 'Sim').length, opcoesSemFoto: P.reduce((s, p) => s + p.opcoesSemFoto, 0) };
}

function abrirEEsperar(tabId, url) {
  return new Promise(res => {
    let pronto = false;
    const f = (id, info, tab) => {
      if (id === tabId && info.status === 'complete' && /maisdeliveryapp\.com\.br\/pwa\//.test(tab.url || '')) { pronto = true; chrome.tabs.onUpdated.removeListener(f); res(); }
    };
    chrome.tabs.onUpdated.addListener(f);
    chrome.tabs.update(tabId, { url });
    setTimeout(() => { if (!pronto) { chrome.tabs.onUpdated.removeListener(f); res(); } }, 20000);
  });
}

// ---------- API ----------
export async function listaParceiros(tabPainel) {
  const r = await rodar(tabPainel, pg_listaEstabelecimentos);
  if (!r || r.erro) throw new Error('Para o ranking, deixe o painel no login Gerencial (é de lá que vem a lista dos parceiros).');
  await chrome.storage.local.set({ parceiros: r.lista });
  return r.lista;
}

// controle = { cancelado:false }; progresso(feito, total, nome)
export async function rodarRanking({ tabPainel, progresso, controle, somenteAtivos = true }) {
  let lista = await listaParceiros(tabPainel);
  // Parceiros em operação: abertos agora (Ativo) ou fora do horário (Fechado). Fora: Inativo e Arquivado.
  if (somenteAtivos) lista = lista.filter(e => /^(ativo|fechado)$/i.test(e.situacao) && !/teste/i.test(e.nome));
  const aba = await chrome.tabs.create({ url: 'about:blank', active: false });
  const itens = [];
  try {
    for (const [i, e] of lista.entries()) {
      if (controle.cancelado) break;
      progresso(i, lista.length, e.nome);
      try {
        let antiga = '';
        try { antiga = await rodar(aba.id, pg_assinaturaMenu); } catch {}
        await abrirEEsperar(aba.id, LOJA + btoa(e.id));
        let r = null;
        for (let t = 0; t < 3 && !r; t++) { try { r = await rodar(aba.id, pg_lerLojaPublica, [e.id, antiga || '']); } catch { await new Promise(x => setTimeout(x, 800)); } }
        if (!r || r.erro) throw new Error(r?.erro || 'sem resposta');
        const cardapio = paraCardapio(r.menu);
        if (!cardapio.produtos.length) { itens.push({ ...e, nota: null, aviso: 'Sem produtos no app' }); continue; }
        const problemas = verificar(cardapio).filter(p => !/inativos|Estoque baixo/.test(p.titulo));
        const nr = notaRanking(cardapio, problemas);
        itens.push({ ...e, nota: nr.nota, partes: nr.partes, media: r.shop.media ? Number(r.shop.media) : null, totais: resumo(cardapio),
          problemas: problemas.map(p => ({ nivel: p.nivel, titulo: p.titulo, qtd: p.itens.length, exemplos: p.itens.slice(0, 5) })) });
      } catch (err) { itens.push({ ...e, nota: null, aviso: 'Não consegui ler: ' + err.message }); }
    }
  } finally { chrome.tabs.remove(aba.id).catch(() => {}); }
  progresso(lista.length, lista.length, '');
  const resultado = { data: Date.now(), itens, completo: !controle.cancelado };
  const { rankings = [] } = await chrome.storage.local.get('rankings');
  rankings.unshift(resultado);
  await chrome.storage.local.set({ rankings: rankings.slice(0, 10) });
  return { ...resultado, anterior: rankings[1] || null };
}

export async function ultimosRankings() {
  const { rankings = [] } = await chrome.storage.local.get('rankings');
  return rankings;
}
