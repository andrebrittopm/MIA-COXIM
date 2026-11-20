// Servidor da MIA Coxim (Cloudflare Worker) — base v4 (13/10/2026): lixeira no quadro (30 dias para restaurar) + limite diário de uso da IA (v3)
// Guarda a chave da Anthropic, confere o código de acesso e guarda o quadro de Marketing.
//
// Variáveis (Cloudflare → Worker → Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY   (secret)  chave criada em console.anthropic.com
//   CODIGOS             (secret)  JSON {"codigo-secreto": "Nome do atendente", ...}  → perfil CENTRAL (tudo liberado)
//   CODIGOS_MARKETING   (secret, opcional) JSON {"codigo-secreto": "Nome do designer", ...} → perfil MARKETING (só a aba Marketing)
//   PIXABAY_KEY        (secret)  chave gratuita de pixabay.com (API documentation) — usada pelas "Fotos automáticas"
//   UNSPLASH_KEY       (secret)  Access Key gratuita de unsplash.com/developers — segundo banco de fotos (opcional se houver PIXABAY_KEY)
//   MODELO              (texto, opcional) padrão: claude-sonnet-5-5
//   LIMITE_CENTRAL      (texto, opcional) chamadas de IA por pessoa por dia no perfil central. Padrão: 400
//   LIMITE_MARKETING    (texto, opcional) chamadas de IA por pessoa por dia no perfil marketing. Padrão: 60
// Armazenamento (Settings → Bindings → KV namespace):
//   QUADRO              KV namespace onde fica o quadro de Marketing e as artes anexadas.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-codigo-mia',
};

// Política de privacidade (exigida pela Chrome Web Store): https://<servidor>/privacidade
const PRIVACIDADE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MIA – Política de privacidade</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#2b1a14}h1{color:#b30d14}h2{margin-top:28px}</style></head><body>
<h1>MIA – Mais Inteligência Artificial</h1><p><b>Política de privacidade</b> · atualizada em 12/10/2026</p>
<p>A extensão MIA é uma ferramenta interna da central do Mais Delivery Coxim (MS), usada apenas pelos atendentes autorizados para operar o painel administrativo dos estabelecimentos parceiros.</p>
<h2>Quais dados a extensão acessa</h2>
<ul><li>Dados do painel administrativo do Mais Delivery abertos pelo próprio atendente: cardápios, produtos, preços, categorias, descrições, fotos e, ao lançar pedidos, nome, telefone e endereço do cliente informados pelo atendente.</li>
<li>Imagens e textos que o atendente anexa ou digita na conversa (cardápios, prints de pedidos).</li>
<li>O código de acesso do atendente.</li></ul>
<p>A extensão não coleta histórico de navegação, senhas ou dados de outros sites.</p>
<h2>Como os dados são usados</h2>
<ul><li>Para executar as tarefas pedidas pelo atendente (analisar e corrigir cardápios, cadastrar produtos, lançar pedidos).</li>
<li>O texto e as imagens necessários para cada tarefa são enviados ao servidor da MIA (Cloudflare) e processados pela API da Anthropic (Claude). Não são usados para publicidade nem vendidos a terceiros.</li>
<li>O histórico de alterações (para o botão Desfazer) e as configurações ficam guardados somente no navegador do atendente. Dos pedidos lançados, o histórico guarda só o primeiro nome do cliente, o número do pedido e o valor, e apaga esses registros depois de 30 dias.</li>
<li>O quadro de Marketing (cartões de tarefas, comentários e artes anexadas pela equipe) fica guardado no servidor da MIA na Cloudflare, acessível só a quem tem código de acesso.</li>
<li>Para sugerir fotos de produtos, a MIA pesquisa fotos gratuitas no Pixabay e no Unsplash (por meio do servidor da MIA); só o termo de busca (ex.: "x-bacon") é enviado.</li></ul>
<h2>Compartilhamento</h2><p>Os dados não são compartilhados com ninguém além dos provedores necessários para o funcionamento (Cloudflare e Anthropic) e do próprio painel Mais Delivery.</p>
<h2>Contato</h2><p>Mais Delivery Coxim – andrebrittocoxim@gmail.com</p></body></html>`;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } });

// ---------- quem está pedindo ----------
function lerJSON(txt) { try { return JSON.parse(txt || '{}') || {}; } catch { return null; } }
function identificar(req, env) {
  const codigo = req.headers.get('x-codigo-mia') || '';
  if (!codigo) return null;
  const central = lerJSON(env.CODIGOS), mkt = lerJSON(env.CODIGOS_MARKETING);
  if (central === null) throw new Error('CODIGOS mal configurado no servidor');
  if (central[codigo]) {
    const v = central[codigo];
    return typeof v === 'object' ? { nome: v.nome || 'Atendente', perfil: v.perfil === 'marketing' ? 'marketing' : 'central' } : { nome: String(v), perfil: 'central' };
  }
  if (mkt && mkt[codigo]) return { nome: String(mkt[codigo]?.nome || mkt[codigo]), perfil: 'marketing' };
  return null;
}

// ---------- quadro de Marketing ----------
const COLUNAS = ['ideias', 'afazer', 'criando', 'aprovacao', 'publicado', 'arquivado', 'lixeira'];
const DIAS_LIXEIRA = 30; // cartão na lixeira pode ser restaurado por 30 dias; depois some (com as artes)
const CAMPOS_LIVRES = ['titulo', 'tipo', 'descricao', 'texto_arte', 'legenda', 'formatos', 'loja', 'produtos', 'prazo', 'publicar_em',
  'horario', 'etiquetas', 'checklist', 'responsavel', 'cor', 'dados'];
const LIMITE_ANEXO = 8 * 1024 * 1024; // 8 MB por arquivo
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const agora = () => new Date().toISOString();
const limpar = (s, n = 4000) => String(s ?? '').slice(0, n);

function sanearCartao(c, base = {}) {
  const out = { ...base };
  for (const k of CAMPOS_LIVRES) if (k in c) {
    const v = c[k];
    if (k === 'formatos' || k === 'etiquetas' || k === 'produtos') out[k] = Array.isArray(v) ? v.slice(0, 20).map(x => limpar(x, 200)) : [];
    else if (k === 'checklist') out[k] = Array.isArray(v) ? v.slice(0, 30).map(x => ({ t: limpar(x?.t, 300), ok: !!x?.ok })) : [];
    else if (k === 'dados') out[k] = v && typeof v === 'object' && JSON.stringify(v).length <= 6000 ? v : {};
    else out[k] = limpar(v, k === 'descricao' || k === 'legenda' ? 6000 : 600);
  }
  return out;
}

async function lerQuadro(env) {
  const q = await env.QUADRO.get('quadro', 'json');
  return q || { versao: 0, cartoes: [] };
}

async function gravarQuadro(env, q) {
  // limpeza: arquivados há mais de 90 dias e lixeira há mais de 30 saem do quadro (e as artes deles)
  const limite = Date.now() - 90 * 864e5, limiteLixo = Date.now() - DIAS_LIXEIRA * 864e5;
  const fora = q.cartoes.filter(c => (c.coluna === 'arquivado' && Date.parse(c.atualizado_em || c.criado_em) < limite)
    || (c.coluna === 'lixeira' && Date.parse(c.lixeira_em || c.atualizado_em || c.criado_em) < limiteLixo));
  for (const c of fora) for (const a of c.anexos || []) await env.QUADRO.delete('a:' + a.id);
  q.cartoes = q.cartoes.filter(c => !fora.includes(c));
  q.versao = (q.versao || 0) + 1;
  q.atualizado = agora();
  await env.QUADRO.put('quadro', JSON.stringify(q));
  return q;
}

function registrar(c, quem, texto) {
  c.historico = [...(c.historico || []), { quem: quem.nome, texto, data: agora() }].slice(-30);
  c.atualizado_em = agora();
}

async function acaoQuadro(env, quem, corpo) {
  const q = await lerQuadro(env);
  const achar = (id) => q.cartoes.find(c => c.id === id);
  const ehCentral = quem.perfil === 'central';
  const acao = corpo?.acao;

  if (acao === 'criar' || acao === 'criar_varios') {
    const lista = acao === 'criar' ? [corpo.cartao] : (corpo.cartoes || []);
    if (acao === 'criar_varios' && !ehCentral) return { erro: 'Só a central gera sugestões da MIA.', status: 403 };
    const criados = [];
    for (const bruto of lista.slice(0, 40)) {
      if (!bruto?.titulo) continue;
      const chave = limpar(bruto.chave, 200);
      if (chave && q.cartoes.some(c => c.chave === chave)) continue; // a MIA não repete a mesma sugestão
      const coluna = COLUNAS.includes(bruto.coluna) && bruto.coluna !== 'arquivado' ? bruto.coluna : (bruto.origem === 'mia' ? 'ideias' : 'afazer');
      const c = sanearCartao(bruto, { id: novoId(), coluna, origem: bruto.origem === 'mia' ? 'mia' : 'pessoa', chave,
        criado_por: quem.nome, criado_em: agora(), comentarios: [], anexos: [], historico: [] });
      c.ordem = Math.max(0, ...q.cartoes.filter(x => x.coluna === coluna).map(x => x.ordem || 0)) + 1;
      registrar(c, quem, c.origem === 'mia' ? 'MIA sugeriu este cartão' : 'criou o cartão');
      q.cartoes.push(c); criados.push(c.id);
    }
    if (q.cartoes.length > 400) return { erro: 'O quadro está cheio (400 cartões). Arquive ou exclua alguns.', status: 400 };
    return { quadro: await gravarQuadro(env, q), criados };
  }

  const c = achar(corpo?.id);
  if (!c) return { erro: 'Cartão não encontrado (alguém pode ter excluído).', status: 404 };

  if (acao === 'atualizar') {
    Object.assign(c, sanearCartao(corpo.campos || {}, c));
    registrar(c, quem, 'editou o cartão');
  } else if (acao === 'mover') {
    if (!COLUNAS.includes(corpo.coluna)) return { erro: 'Coluna inválida', status: 400 };
    const de = c.coluna;
    c.coluna = corpo.coluna;
    if (c.coluna === 'lixeira' && de !== 'lixeira') { c.coluna_antes = de; c.lixeira_em = agora(); c.lixeira_por = quem.nome; }
    if (c.coluna !== 'lixeira') { delete c.lixeira_em; delete c.lixeira_por; }
    // reordena a coluna de destino colocando o cartão na posição pedida
    const destino = q.cartoes.filter(x => x.coluna === corpo.coluna && x.id !== c.id).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    const pos = Math.max(0, Math.min(destino.length, Number.isFinite(corpo.posicao) ? corpo.posicao : destino.length));
    destino.splice(pos, 0, c);
    destino.forEach((x, i) => { x.ordem = i + 1; });
    if (de !== c.coluna) registrar(c, quem, c.coluna === 'lixeira' ? 'mandou para a lixeira' : de === 'lixeira' ? `restaurou da lixeira para "${c.coluna}"` : `moveu de "${de}" para "${c.coluna}"`);
  } else if (acao === 'comentar') {
    const texto = limpar(corpo.texto, 2000).trim();
    if (!texto) return { erro: 'Comentário vazio', status: 400 };
    c.comentarios = [...(c.comentarios || []), { id: novoId(), autor: quem.nome, texto, data: agora() }].slice(-100);
    c.atualizado_em = agora();
  } else if (acao === 'anexar') {
    const bin = Uint8Array.from(atob(String(corpo.b64 || '')), ch => ch.charCodeAt(0));
    if (!bin.length) return { erro: 'Arquivo vazio', status: 400 };
    if (bin.length > LIMITE_ANEXO) return { erro: 'Arquivo grande demais (máximo 8 MB).', status: 400 };
    if ((c.anexos || []).length >= 12) return { erro: 'Máximo de 12 arquivos por cartão.', status: 400 };
    const id = novoId(), tipo = limpar(corpo.tipo || 'application/octet-stream', 100);
    await env.QUADRO.put('a:' + id, bin, { metadata: { tipo, nome: limpar(corpo.nome, 120) } });
    c.anexos = [...(c.anexos || []), { id, nome: limpar(corpo.nome || 'arquivo', 120), tipo, tamanho: bin.length, autor: quem.nome, data: agora() }];
    registrar(c, quem, `anexou ${c.anexos.at(-1).nome}`);
  } else if (acao === 'remover_anexo') {
    const a = (c.anexos || []).find(x => x.id === corpo.anexo);
    if (!a) return { erro: 'Arquivo não encontrado', status: 404 };
    if (!ehCentral && a.autor !== quem.nome) return { erro: 'Só quem anexou (ou a central) pode remover.', status: 403 };
    await env.QUADRO.delete('a:' + a.id);
    c.anexos = c.anexos.filter(x => x.id !== a.id);
    registrar(c, quem, `removeu ${a.nome}`);
  } else if (acao === 'excluir') {
    if (!ehCentral) return { erro: 'Só a central exclui de vez. Você pode mandar para a lixeira (dá para restaurar por 30 dias).', status: 403 };
    if (c.coluna !== 'lixeira') return { erro: 'Mande para a lixeira primeiro. Excluir de vez é só para o que já está na lixeira.', status: 400 };
    for (const a of c.anexos || []) await env.QUADRO.delete('a:' + a.id);
    q.cartoes = q.cartoes.filter(x => x.id !== c.id);
  } else {
    return { erro: 'Ação inválida', status: 400 };
  }
  return { quadro: await gravarQuadro(env, q) };
}

// ---------- limite diário de uso da IA ----------
// Uma chave por pessoa por dia no KV: uso:AAAA-MM-DD:Nome → {n, in, out}. Serve de trava de custo e de relatório (/uso).
// Se o KV falhar (ou não existir), a MIA continua funcionando: o limite nunca derruba o atendimento.
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // dia em Brasília
const chaveUso = (quem, dia = hoje()) => `uso:${dia}:${quem.nome}`;
function limiteDe(quem, env) {
  const v = Number(quem.perfil === 'central' ? env.LIMITE_CENTRAL : env.LIMITE_MARKETING);
  return v > 0 ? v : (quem.perfil === 'central' ? 400 : 60);
}
async function lerUso(env, quem) {
  if (!env.QUADRO) return null;
  try { return (await env.QUADRO.get(chaveUso(quem), 'json')) || { n: 0, in: 0, out: 0 }; } catch { return null; }
}
async function somarUso(env, quem, uso, usage) {
  if (!env.QUADRO || !uso) return;
  const novo = { n: uso.n + 1, in: uso.in + (usage?.input_tokens || 0) + (usage?.cache_read_input_tokens || 0) + (usage?.cache_creation_input_tokens || 0), out: uso.out + (usage?.output_tokens || 0) };
  try { await env.QUADRO.put(chaveUso(quem), JSON.stringify(novo), { expirationTtl: 40 * 86400 }); } catch {}
}

// ---------- fotos automáticas (Pixabay + Unsplash) ----------
// A extensão pede /fotos?q=termo&n=4. As chaves ficam só aqui (secrets PIXABAY_KEY e UNSPLASH_KEY; basta uma delas).
// Os bancos são consultados juntos e as fotos saem intercaladas. Cada banco tem cache de 6 h no KV (o Pixabay pede cache
// de até 24 h e os links das imagens dele expiram em 24 h) e, se um cair ou estourar o limite, o outro continua respondendo.
// Cada foto devolve um "id" = "px"/"un" + dados da imagem em base64url, para a extensão baixar depois sem outra consulta.
const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const HOST_PIXABAY = /^https:\/\/(cdn\.)?pixabay\.com\//;
const HOST_UNSPLASH = /^https:\/\/images\.unsplash\.com\//;
const falha = (erro, status, espera) => Object.assign(new Error(erro), { status, espera });

async function viaPixabay(env, q, n) {
  const u = new URL('https://pixabay.com/api/');
  u.search = new URLSearchParams({ key: env.PIXABAY_KEY, q, lang: 'en', image_type: 'photo', safesearch: 'true',
    order: 'popular', min_width: '600', per_page: String(Math.min(n + 8, 30)) });
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(10000) }); } catch { throw falha('o Pixabay não respondeu', 502); }
  if (r.status === 429) throw falha('limite do Pixabay atingido (100 buscas por minuto)', 429, 20);
  if (!r.ok) throw falha(`o Pixabay respondeu ${r.status}${r.status === 400 ? ' (confira a chave PIXABAY_KEY)' : ''}`, 502);
  const j = await r.json().catch(() => null);
  return (j?.hits || []).filter(h => HOST_PIXABAY.test(h.largeImageURL || '')).slice(0, n).map(h => ({
    id: 'px' + b64url(h.largeImageURL),
    thumb: String(h.webformatURL || h.previewURL || '').replace('_640', '_340'),
    autor: h.user || '', alt: h.tags || '', origem: 'pixabay',
  }));
}

async function viaUnsplash(env, q, n) {
  const u = new URL('https://api.unsplash.com/search/photos');
  u.search = new URLSearchParams({ query: q, per_page: String(Math.min(n + 4, 30)), content_filter: 'high' });
  let r;
  try { r = await fetch(u, { headers: { Authorization: 'Client-ID ' + env.UNSPLASH_KEY, 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(10000) }); }
  catch { throw falha('o Unsplash não respondeu', 502); }
  if (r.status === 403 || r.status === 429) throw falha('limite do Unsplash atingido (50 buscas por hora no modo demo)', 429, 60);
  if (r.status === 401) throw falha('chave do Unsplash inválida (confira UNSPLASH_KEY: use a Access Key)', 502);
  if (!r.ok) throw falha(`o Unsplash respondeu ${r.status}`, 502);
  const j = await r.json().catch(() => null);
  return (j?.results || []).filter(p => HOST_UNSPLASH.test(p.urls?.regular || '')).slice(0, n).map(p => ({
    id: 'un' + b64url(JSON.stringify([p.urls.regular, p.links?.download_location || ''])),
    thumb: p.urls.thumb || p.urls.small || '',
    autor: p.user?.name || '', alt: p.alt_description || p.description || '', origem: 'unsplash',
  }));
}

async function comCache(env, fonte, q, n, buscar) {
  const ck = `foto:${fonte}:${q.toLowerCase()}:${n}`;
  if (env.QUADRO) { try { const c = await env.QUADRO.get(ck, 'json'); if (c) return c; } catch {} }
  const fotos = await buscar();
  if (env.QUADRO && fotos.length) { try { await env.QUADRO.put(ck, JSON.stringify(fotos), { expirationTtl: 6 * 3600 }); } catch {} }
  return fotos;
}

async function buscarFotosMulti(env, termo, qtd) {
  const fontes = [];
  if (env.PIXABAY_KEY) fontes.push(['Pixabay', viaPixabay]);
  if (env.UNSPLASH_KEY) fontes.push(['Unsplash', viaUnsplash]);
  if (!fontes.length) return { erro: 'Falta uma chave de fotos no servidor (PIXABAY_KEY e/ou UNSPLASH_KEY).', status: 503 };
  const q = String(termo || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (q.length < 2) return { fotos: [] };
  const n = Math.min(Math.max(Math.floor(qtd) || 4, 1), 12);
  const res = await Promise.all(fontes.map(async ([nome, f]) => {
    try { return { nome, fotos: await comCache(env, nome, q, n, () => f(env, q, n)) }; }
    catch (e) { return { nome, erro: e.message, status: e.status || 502, espera: e.espera }; }
  }));
  const ok = res.filter(r => r.fotos);
  if (!ok.length) {
    return { erro: res.map(r => `${r.nome}: ${r.erro}`).join(' · '), status: res.some(r => r.status === 429) ? 429 : 502, espera: Math.max(...res.map(r => r.espera || 0)) || undefined };
  }
  // intercala: 1ª de cada banco, 2ª de cada banco...
  const fotos = [];
  for (let i = 0; fotos.length < n && ok.some(r => i < r.fotos.length); i++) for (const r of ok) if (r.fotos[i] && fotos.length < n) fotos.push(r.fotos[i]);
  return { fotos, fontes: ok.map(r => r.nome), avisos: res.filter(r => r.erro).map(r => `${r.nome}: ${r.erro}`) };
}

// O Unsplash pede que se avise quando uma foto é de fato usada (download_location).
async function avisarUsoUnsplash(env, dl) {
  if (!env.UNSPLASH_KEY || !/^https:\/\/api\.unsplash\.com\/photos\/[\w-]+\/download(\?[\w=&.%-]*)?$/.test(dl || '')) return false;
  try { await fetch(dl, { headers: { Authorization: 'Client-ID ' + env.UNSPLASH_KEY, 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(8000) }); return true; }
  catch { return false; }
}

// ---------- rotas ----------
export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') {
      let qtd = 0, qtdMkt = 0;
      try { qtd = Object.keys(JSON.parse(env.CODIGOS || '{}')).length; qtdMkt = Object.keys(JSON.parse(env.CODIGOS_MARKETING || '{}')).length; } catch {}
      return json({ status: 'MIA online 🦊', versao: 4, chave_configurada: !!env.ANTHROPIC_API_KEY, codigos_cadastrados: qtd, codigos_marketing: qtdMkt,
        quadro_configurado: !!env.QUADRO, fotos_configurado: !!(env.PIXABAY_KEY || env.UNSPLASH_KEY), pixabay: !!env.PIXABAY_KEY, unsplash: !!env.UNSPLASH_KEY, modelo: env.MODELO || 'claude-sonnet-5-5' });
    }
    if (req.method === 'GET' && url.pathname === '/privacidade') return new Response(PRIVACIDADE, { headers: { 'content-type': 'text/html; charset=utf-8' } });

    let quem;
    try { quem = identificar(req, env); } catch (e) { return json({ erro: e.message }, 500); }
    if (!quem) return json({ erro: 'Código de acesso inválido. Peça um código à administração.' }, 401);

    if (req.method === 'GET' && url.pathname === '/eu') return json({ ...quem, limite_dia: limiteDe(quem, env) });

    // Uso de hoje (e dos últimos dias): só a central vê.
    if (req.method === 'GET' && url.pathname === '/uso') {
      if (quem.perfil !== 'central') return json({ erro: 'Só a central vê o uso.' }, 403);
      if (!env.QUADRO) return json({ erro: 'Falta o KV "QUADRO".' }, 503);
      const dias = Math.min(Number(url.searchParams.get('dias')) || 1, 31);
      const desde = new Date(Date.now() - 3 * 3600e3 - (dias - 1) * 86400e3).toISOString().slice(0, 10);
      const lista = [];
      let cursor;
      do {
        const r = await env.QUADRO.list({ prefix: 'uso:', cursor });
        for (const k of r.keys) { const [, dia, ...nome] = k.name.split(':'); if (dia >= desde) lista.push({ dia, nome: nome.join(':'), ...(await env.QUADRO.get(k.name, 'json')) }); }
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
      return json({ hoje: hoje(), uso: lista.sort((a, b) => b.dia.localeCompare(a.dia) || b.n - a.n) });
    }

    // Fotos automáticas: só a central.
    if (req.method === 'GET' && url.pathname === '/fotos') {
      if (quem.perfil !== 'central') return json({ erro: 'Só a central busca fotos.' }, 403);
      const r = await buscarFotosMulti(env, url.searchParams.get('q'), Number(url.searchParams.get('n')));
      if (r.erro) return json({ erro: r.erro, espera: r.espera }, r.status || 502);
      return json(r);
    }
    if (req.method === 'GET' && url.pathname === '/foto-uso') {
      if (quem.perfil !== 'central') return json({ erro: 'Só a central usa fotos.' }, 403);
      ctx.waitUntil(avisarUsoUnsplash(env, url.searchParams.get('d')));
      return json({ ok: true });
    }

    if (url.pathname === '/quadro' || url.pathname.startsWith('/anexo/')) {
      if (!env.QUADRO) return json({ erro: 'O quadro de Marketing ainda não foi ligado no servidor (falta o KV "QUADRO").' }, 503);
      if (req.method === 'GET' && url.pathname === '/quadro') return json(await lerQuadro(env));
      if (req.method === 'POST' && url.pathname === '/quadro') {
        const corpo = await req.json().catch(() => null);
        const r = await acaoQuadro(env, quem, corpo);
        if (r.erro) return json({ erro: r.erro }, r.status || 400);
        return json(r);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/anexo/')) {
        const id = url.pathname.split('/')[2] || '';
        const { value, metadata } = await env.QUADRO.getWithMetadata('a:' + id, 'arrayBuffer');
        if (!value) return json({ erro: 'Arquivo não encontrado' }, 404);
        return new Response(value, { headers: { 'content-type': metadata?.tipo || 'application/octet-stream', ...CORS } });
      }
      return json({ erro: 'Rota inválida' }, 404);
    }

    if (req.method !== 'POST' || url.pathname !== '/mensagem') return json({ erro: 'Rota inválida' }, 404);

    const corpo = await req.json().catch(() => null);
    if (!corpo?.messages) return json({ erro: 'Pedido inválido' }, 400);
    // Perfil Marketing: a IA só escreve texto (pautas, briefings, legendas). Nada de ferramentas do painel.
    const tools = quem.perfil === 'central' ? corpo.tools : undefined;

    const uso = await lerUso(env, quem);
    const limite = limiteDe(quem, env);
    if (uso && uso.n >= limite) {
      return json({ erro: `Limite de hoje atingido (${limite} pedidos à IA para ${quem.nome}). Amanhã libera de novo; se for urgente, fale com a administração.`, limite: true }, 429);
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.MODELO || 'claude-sonnet-5-5',
        max_tokens: Math.min(Number(corpo.max_tokens) || 8000, quem.perfil === 'central' ? 8000 : 4000),
        system: corpo.system,
        ...(tools ? { tools } : {}),
        messages: corpo.messages,
      }),
    });
    const dados = await r.json();
    if (!r.ok) return json({ erro: dados?.error?.message || 'Erro na IA' }, r.status);
    console.log(`[MIA] ${quem.nome} (${quem.perfil}) · in=${dados.usage?.input_tokens} out=${dados.usage?.output_tokens} · hoje ${(uso?.n || 0) + 1}/${limite}`);
    const gravar = somarUso(env, quem, uso, dados.usage);
    if (ctx?.waitUntil) ctx.waitUntil(gravar); else await gravar;
    return json(dados);
  },
};
