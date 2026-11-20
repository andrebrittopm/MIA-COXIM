// marketing-ia.js — a MIA como assistente do setor de Marketing.
// Junta o calendário, o app do cliente, os horários fracos e o ranking, e sugere cartões para o quadro.

export const FORMATOS = {
  feed: { nome: 'Feed (Instagram/Facebook)', medida: '1080 × 1350 px' },
  story: { nome: 'Story / Status', medida: '1080 × 1920 px' },
  quadrado: { nome: 'Post quadrado', medida: '1080 × 1080 px' },
  banner_app: { nome: 'Banner do app', medida: '1326 × 376 px (o app mostra 663 × 188)' },
};

export const TIPOS = {
  data: '📅 Data comemorativa', promocao: '🔥 Promoção', produto: '🆕 Produto novo', parceiro: '🤝 Novo parceiro',
  horario: '⏰ Horário fraco', banner: '🕐 Banner por horário', segmento: '🏷️ Segmento', loja: '⭐ Loja destaque', livre: '✏️ Livre',
};

const MARCA = `Marca: Mais Delivery ${MIA.cidade} (${MIA.uf}), app de delivery da cidade. Cores: vermelho (#e3141c), vermelho escuro, laranja e amarelo.
Mascotes: MIA (raposa de óculos e rabo de cavalo, uniforme vermelho do Mais Delivery) e MAX (raposa entregador, rápido e animado).
Tom: alegre, próximo, de cidade do interior, com emojis na medida (sem exagero). Chamada padrão: "Peça agora no app Mais Delivery".
Medidas: Feed 1080×1350 · Story/Status 1080×1920 · Quadrado 1080×1080 · Banner do app 1326×376 (proporção 663×188, texto grande e pouco: aparece pequeno no celular).`;

export const SISTEMA_PAUTAS = `Você é a MIA, assistente do setor de Marketing do Mais Delivery. Você sugere pautas de arte para o designer gráfico, em cartões de um quadro estilo Trello.
${MARCA}

Regras:
- Use SOMENTE os dados recebidos (datas, promoções, produtos, lojas, horários). Nunca invente preço, desconto, cupom, loja ou produto.
  Se uma ideia depende de uma promoção que ainda não existe, escreva no briefing "PROPOSTA — combinar com a loja antes de publicar".
- Cada cartão é uma tarefa clara para o designer: o que criar, para onde (formatos) e até quando.
- Não repita pautas que já estão no quadro (lista "ja_no_quadro"). Use as "chave" no formato pedido para não duplicar.
- Priorize: 1) datas próximas com prazo curto; 2) promoções ativas sem arte; 3) horários fracos (banner/post para puxar pedido naquele período);
  4) novidades em produtos e novos parceiros; 5) banners do app por período do dia (café, almoço, lanche da tarde, jantar, madrugada) que faltam.
- Itens com maior_idade: só bebidas alcoólicas, e a arte leva "Proibido para menores de 18 anos · Beba com moderação". Outros itens +18 ficam fora das pautas.
- Entre 6 e 10 cartões, os mais úteis. Seja enxuto nos textos. Datas com tom respeitoso (Finados) não levam promoção.
- briefing: 3 a 5 linhas curtas, direto: objetivo, elementos visuais (foto do produto, mascote, cores), o que NÃO pode faltar.
- texto_arte: o texto que vai NA arte (curto: título + 1 linha + chamada).
- legenda: legenda pronta para Instagram/WhatsApp com emojis e chamada para o app (2 a 4 linhas) e, na última linha, 3 a 6 hashtags (sempre ${MIA.hashtag} e #MaisDelivery + as do tema/loja, sem acento). Para banner do app, legenda vazia.
- checklist: no máximo 4 itens curtos.

Formato de chave: "data:AAAA-MM-DD:<nome>", "promo:<loja>:<promoção>", "novo:<loja>:<produto>", "parceiro:<loja>", "horario:<dia>:<período>",
"banner:<período>", "loja:<loja>:<AAAA-MM>", "segmento:<segmento>:<AAAA-MM>" (tudo minúsculo, sem acento).

Responda SOMENTE com JSON:
{"resumo":"1 frase para a administração","cartoes":[{"chave":"","tipo":"data|promocao|produto|parceiro|horario|banner|segmento|loja|livre","titulo":"emoji + título curto",
"descricao":"briefing","texto_arte":"","legenda":"","formatos":["feed","story","quadrado","banner_app"],"loja":"","produtos":[""],
"prazo":"AAAA-MM-DD","publicar_em":"AAAA-MM-DD","horario":"período, se for banner/horário","checklist":[{"t":"item","ok":false}],"motivo":"por que agora (1 linha, com o dado que justificou)"}]}`;

export const SISTEMA_CARTAO = `Você é a MIA, assistente do setor de Marketing do Mais Delivery. Você melhora um cartão de pauta para o designer gráfico.
${MARCA}
Legenda: 2 a 4 linhas com emojis e a chamada para o app; na última linha, 3 a 6 hashtags (sempre ${MIA.hashtag} e #MaisDelivery + as do tema/loja, sem acento).
Regras: use só as informações do cartão, dos comentários da equipe e do pedido; nunca invente preço, desconto ou cupom. Mantenha o que estiver bom.
- Comentário da equipe (central ou designer) é decisão real: aplique no briefing, no texto da arte e na legenda.
- Cupom citado sem código: escreva [CÓDIGO DO CUPOM] no lugar do código e coloque no checklist "Confirmar código e validade do cupom". Desconto citado sem regra: deixe claro "válido por tempo limitado" e ponha no checklist "Confirmar regras do desconto".
- Se o tom do cartão dizia "sem promoção/sem cupom" e o comentário pede cupom, o comentário vale: ajuste o tom.
Responda SOMENTE com JSON: {"titulo":"","descricao":"briefing de 3 a 6 linhas","texto_arte":"","legenda":"","checklist":[{"t":"","ok":false}],"comentario":"1 frase do que mudou"}`;

// Monta o pedido de pautas com tudo o que a MIA sabe agora. Corta listas longas para caber.
export function pedidoPautas({ hoje, datas, app, horas, ranking, quadro }) {
  const ja = (quadro?.cartoes || []).filter(c => c.coluna !== 'arquivado' || Date.now() - Date.parse(c.atualizado_em || c.criado_em) < 60 * 864e5)
    .map(c => ({ chave: c.chave || '', titulo: c.titulo, coluna: c.coluna }));
  const semImagem = (l) => (l || []).map(({ imagem, idRestaurante, ...x }) => x);
  const dados = {
    hoje,
    datas_proximas: datas,
    app: app ? {
      banners_no_ar: semImagem(app.banners),
      feriados_cadastrados_no_app: app.feriados,
      promocoes_ativas: semImagem(app.promocoes),
      novos_parceiros: semImagem(app.novos_parceiros),
      novidades_em_produtos: semImagem((app.novidades || []).slice(0, 25)),
      mais_comprados_no_app: semImagem((app.queridinhos || []).slice(0, 15)),
      lojas_abertas_agora: (app.abertos || []).slice(0, 40).map(l => ({ nome: l.nome, segmento: l.segmento, nota: l.nota, cupom: l.cupom })),
    } : 'não consegui ler o app agora',
    horarios: horas || 'sem dados de horário (abra o painel no login Gerencial para a MIA ver a cidade toda)',
    melhores_cardapios_ranking: ranking || 'sem ranking recente',
    ja_no_quadro: ja,
  };
  return `Sugira as pautas desta semana para o quadro de Marketing. Dados de agora:\n${JSON.stringify(dados)}`;
}

// Filtra e completa as sugestões antes de irem para o quadro.
export function sanearPautas(r, hoje) {
  const okTipo = (t) => (t in TIPOS ? t : 'livre');
  return (r?.cartoes || []).filter(c => c?.titulo).slice(0, 14).map(c => ({
    origem: 'mia', coluna: 'ideias', chave: String(c.chave || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 200),
    tipo: okTipo(c.tipo), titulo: String(c.titulo).slice(0, 120),
    descricao: [c.descricao, c.motivo ? `\n💡 Por que agora: ${c.motivo}` : ''].filter(Boolean).join('\n'),
    texto_arte: c.texto_arte || '', legenda: c.legenda || '',
    formatos: (c.formatos || []).filter(f => f in FORMATOS), loja: c.loja || '', produtos: (c.produtos || []).filter(Boolean),
    prazo: /^\d{4}-\d{2}-\d{2}$/.test(c.prazo || '') && c.prazo >= hoje ? c.prazo : '', publicar_em: /^\d{4}-\d{2}-\d{2}$/.test(c.publicar_em || '') ? c.publicar_em : '',
    horario: c.horario || '', checklist: (c.checklist || []).filter(x => x?.t).map(x => ({ t: x.t, ok: false })),
  }));
}

// Resumo do último ranking (as lojas com cardápio caprichado rendem post de "loja destaque").
export function resumoRanking(rankings) {
  const r = rankings?.[0];
  if (!r || Date.now() - r.data > 45 * 864e5) return null;
  return r.itens.filter(i => i.nota != null).sort((a, b) => b.nota - a.nota).slice(0, 6).map(i => ({ loja: i.nome, nota: i.nota, segmento: i.segmento }));
}

// Lê a resposta da IA mesmo se ela vier cortada no meio: aproveita os cartões completos.
export function extrairPautas(texto) {
  const ini = texto.indexOf('{');
  if (ini < 0) throw new Error('A IA não devolveu o formato esperado. Tente de novo.');
  try { return JSON.parse(texto.slice(ini, texto.lastIndexOf('}') + 1)); } catch { /* cortada: segue abaixo */ }
  const resumo = (texto.match(/"resumo"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1];
  const lista = texto.indexOf('[', texto.indexOf('"cartoes"'));
  const cartoes = [];
  let prof = 0, comeco = -1, emTexto = false, escape = false;
  for (let i = lista + 1; i > 0 && i < texto.length; i++) {
    const ch = texto[i];
    if (emTexto) { if (escape) escape = false; else if (ch === '\\') escape = true; else if (ch === '"') emTexto = false; continue; }
    if (ch === '"') emTexto = true;
    else if (ch === '{') { if (prof === 0) comeco = i; prof++; }
    else if (ch === '}') { prof--; if (prof === 0 && comeco >= 0) { try { cartoes.push(JSON.parse(texto.slice(comeco, i + 1))); } catch {} comeco = -1; } }
    else if (ch === ']' && prof === 0) break;
  }
  if (!cartoes.length) throw new Error('A resposta da IA veio incompleta. Tente de novo.');
  return { resumo: resumo ? JSON.parse(`"${resumo}"`) : '', cartoes, cortada: true };
}
