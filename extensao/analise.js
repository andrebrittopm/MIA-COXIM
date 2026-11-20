// analise.js — regras da Varredura que não precisam de IA (rápidas e gratuitas).
// Cada problema: { nivel: 'erro'|'aviso'|'dica', titulo, detalhe, itens: [textos], acoes?: [ação por item], grupo?: ação do grupo }
// Ação por item (botão na Varredura): { tipo: 'aplicar'|'preco'|'texto'|'estoque', id, nome, campo, valor, rotulo }
// Ação do grupo: { tipo: 'missao', acao: 'fotos'|'melhorias', rotulo }

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const valorNum = (v) => Number(String(v || '0').replace(/\./g, '').replace(',', '.')) || 0;

// "X-BACON ESPECIAL 2L" → "X-Bacon Especial 2L" (sugestão; o atendente pode editar antes de corrigir).
const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'na', 'no', 'em', 'a', 'o', 'ao', 'à', 'p/', 'c/']);
export function formatoTitulo(t) {
  return String(t || '').toLowerCase().split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w) || !w) return w;
    if (i > 0 && MINUSCULAS.has(w)) return w;
    if (/\d/.test(w)) return w.replace(/^(\d+)(ml|l|g|kg|cm)$/i, (_, n, u) => n + (u.toLowerCase() === 'l' ? 'L' : u.toLowerCase()));
    return w.split('-').map(x => x ? x[0].toUpperCase() + x.slice(1) : x).join('-');
  }).join('');
}

export function verificar({ produtos, niveis }) {
  const P = [];
  const add = (nivel, titulo, detalhe, itens = [], extra = {}) => { if (itens.length || !Array.isArray(itens)) P.push({ nivel, titulo, detalhe, itens, ...extra }); };
  // Versão com ação: lista de produtos → textos + botões.
  const addP = (nivel, titulo, detalhe, lista, texto, acao, extra = {}) =>
    add(nivel, titulo, detalhe, lista.map(texto), { acoes: lista.map(p => ({ id: p.id, nome: p.nome, ...acao(p) })), ...extra });

  // 1. Sem descrição / descrição curta
  add('erro', 'Produtos sem descrição', 'Produto sem descrição vende menos: o cliente não sabe o que vai receber.',
    produtos.filter(p => p.descricao === '').map(p => p.nome), { grupo: { tipo: 'missao', acao: 'melhorias', rotulo: '✨ A MIA escreve as descrições' } });
  add('dica', 'Descrições muito curtas', 'Menos de 25 letras. Dá para contar ingredientes, tamanho e o que serve.',
    produtos.filter(p => p.descricao && p.descricao.length < 25).map(p => `${p.nome} — "${p.descricao}"`), { grupo: { tipo: 'missao', acao: 'melhorias', rotulo: '✨ A MIA melhora as descrições' } });

  // 1b. Sem foto
  add('aviso', 'Produtos sem foto', 'Foto boa é o que mais vende no app. Peça ao parceiro ou use uma imagem de banco gratuito.',
    produtos.filter(p => p.foto === false).map(p => p.nome), { grupo: { tipo: 'missao', acao: 'fotos', rotulo: '📷 Adicionar fotos' } });

  // 2. Preço zerado (pode ser normal se o preço vem dos níveis)
  addP('aviso', 'Preço R$ 0,00', 'Confira se o preço vem dos níveis (tipo "substituir o valor"). Se não, o produto está saindo de graça.',
    produtos.filter(p => valorNum(p.valor) === 0), p => `${p.nome} (níveis: ${p.niveis})`,
    p => ({ tipo: 'preco', campo: 'preco', valor: '', rotulo: p.niveis === 'Sim' ? 'Só se não vier dos níveis' : '' }));

  // 3. Nomes duplicados
  const vistos = {};
  produtos.forEach(p => { const k = norm(p.nome); (vistos[k] = vistos[k] || []).push(p); });
  add('erro', 'Produtos duplicados', 'Mesmo nome cadastrado mais de uma vez.',
    Object.values(vistos).filter(g => g.length > 1).map(g => `${g[0].nome} (${g.length}x: ${g.map(p => p.categoria).join(' / ')})`));

  // 4. Padrão de escrita misturado
  const letras = produtos.filter(p => /[a-zà-ú]/i.test(p.nome));
  const caixaAlta = letras.filter(p => p.nome === p.nome.toUpperCase());
  if (caixaAlta.length && caixaAlta.length < letras.length) {
    addP('dica', 'Nomes com padrão misturado', `${caixaAlta.length} em CAIXA ALTA e ${letras.length - caixaAlta.length} em letras normais. Padronizar deixa o cardápio mais bonito.`,
      caixaAlta, p => p.nome, p => ({ tipo: 'texto', campo: 'nome', valor: formatoTitulo(p.nome) }));
  }

  // 5. Inativos / indisponíveis
  add('dica', 'Produtos inativos ou indisponíveis', 'Não aparecem para o cliente. Se não voltam mais, vale remover.',
    produtos.filter(p => p.ativo === false || p.disponivel === 'Não').map(p => p.nome));

  // 6. Estoque baixo
  addP('aviso', 'Estoque baixo', 'Com estoque abaixo de 10 o produto pode sumir do app no meio do dia.',
    produtos.filter(p => p.estoque !== '' && Number(p.estoque) < 10), p => `${p.nome} (${p.estoque})`,
    () => ({ tipo: 'estoque', campo: 'estoque', valor: '999999' }));

  // 7. Mesma categoria/subcategoria com uso de níveis inconsistente
  const grupos = {};
  produtos.forEach(p => { const k = `${p.categoria} › ${p.subcategoria || '—'}`; (grupos[k] = grupos[k] || []).push(p); });
  add('aviso', 'Níveis inconsistentes no mesmo grupo', 'Na mesma categoria/subcategoria, uns produtos usam níveis e outros não. O cliente pode ficar sem escolher opções.',
    Object.entries(grupos).filter(([, g]) => g.some(p => p.niveis === 'Sim') && g.some(p => p.niveis === 'Não' && !p.sabores && !p.adicionais))
      .map(([k, g]) => `${k}: sem níveis → ${g.filter(p => p.niveis === 'Não').map(p => p.nome).join(', ')}`));

  // 8. Níveis órfãos ou sem uso
  const nomesProd = new Set(produtos.map(p => norm(p.nome)));
  const cats = new Set(produtos.map(p => norm(p.categoria)));
  add('aviso', 'Níveis de produto que não existe mais', 'Sobraram de produtos apagados. Podem ser removidos.',
    niveis.filter(n => n.por === 'produto' && !nomesProd.has(norm(n.produto))).map(n => `${n.titulo} (produto: ${n.produto})`));
  add('dica', 'Níveis em categoria sem produtos', 'Nível por categoria que nenhum produto usa hoje.',
    niveis.filter(n => n.por === 'categoria' && !cats.has(norm(n.categoria))).map(n => `${n.titulo} (categoria: ${n.categoria})`));

  // 9. Categoria com um produto só
  const porCat = {};
  produtos.forEach(p => { porCat[p.categoria] = (porCat[p.categoria] || 0) + 1; });
  add('dica', 'Categorias com um produto só', 'Muitas categorias pequenas deixam o cardápio comprido. Avalie juntar.',
    Object.entries(porCat).filter(([, n]) => n === 1).map(([c]) => c));

  // 10. Bebidas mal marcadas (a marcação avisa o entregador que o pedido tem bebida)
  const pareceBebida = (p) => /\b(refri|refrigerante|coca|guaran[aá]|fanta|sprite|pepsi|suco|cerveja|chopp|[aá]gua|energ[eé]tico|red ?bull|monster|ch[aá] gelado|h2oh|schweppes|vinho|vodka|whisky|drink|caipirinha|lata|long ?neck|garrafa)\b/i.test(norm(p.nome) + ' ' + norm(p.categoria))
    && !/\b(a[cç]a[ií]|picol[eé]|sorvete|bolo|torta|pudim|frango|carne|pizza|lanche|burg)/i.test(norm(p.nome));
  addP('aviso', 'Bebida sem a marcação "Bebida"', 'O painel avisa o entregador quando o pedido tem bebida. Sem a marcação, esse aviso não aparece.',
    produtos.filter(p => p.bebida === false && pareceBebida(p)), p => p.nome,
    () => ({ tipo: 'aplicar', campo: 'bebida', valor: true, rotulo: '🥤 Marcar como bebida' }));
  addP('aviso', 'Comida marcada como bebida', 'Pode gerar alerta de bebida errado para o entregador.',
    produtos.filter(p => p.bebida === true && !pareceBebida(p) && /\b(lanche|burg|pizza|marmita|prato|por[cç][aã]o|espetinho|pastel|coxinha|a[cç]a[ií])/i.test(norm(p.nome))), p => p.nome,
    () => ({ tipo: 'aplicar', campo: 'bebida', valor: false, rotulo: '🍔 Tirar a marcação' }));

  // 11. Preço fora da curva na mesma categoria
  const precosCat = {};
  produtos.forEach(p => { const v = valorNum(p.valor); if (v > 0) (precosCat[p.categoria] = precosCat[p.categoria] || []).push({ p, v }); });
  const fora = [];
  Object.values(precosCat).filter(g => g.length >= 4).forEach(g => {
    const ord = g.map(x => x.v).sort((a, b) => a - b); const med = ord[Math.floor(ord.length / 2)];
    g.forEach(({ p, v }) => { if (v > med * 3 || v < med / 3) fora.push({ ...p, med }); });
  });
  addP('aviso', 'Preço fora da curva', 'Muito acima ou abaixo dos outros da mesma categoria. Pode ser erro de digitação (ex.: 3,50 virou 35,00).', fora,
    p => `${p.nome}: R$ ${p.valor} (o normal na categoria é perto de R$ ${p.med.toFixed(2).replace('.', ',')})`,
    p => ({ tipo: 'preco', campo: 'preco', valor: p.valor }));

  // 12. Itens sem complementos onde o cliente costuma escolher algo
  add('dica', 'Sem opções para o cliente escolher', 'Produtos que normalmente têm escolhas (tamanho, sabor, adicionais, ponto da carne) mas estão sem níveis, sabores ou adicionais.',
    produtos.filter(p => p.niveis === 'Não' && !p.sabores && !p.adicionais && /\b(a[cç]a[ií]|pizza|monte|marmita|hamb[uú]rguer|burger|lanche|espetinho|por[cç][aã]o|sorvete|cuscuz|tapioca|crepe|batata recheada|salada)/i.test(norm(p.nome) + ' ' + norm(p.categoria))).map(p => p.nome));

  // 13. Palavras que o painel recusa (o produto não salva mais na próxima edição)
  const proib = /\b(pix|cnpj|comprovante|whatsapp?|e-?mail|email|whats|cpf|telefone|contato)\b/i;
  add('erro', 'Palavra proibida no nome ou descrição', 'O painel recusa salvar produto com pix, cpf, cnpj, whatsapp, telefone, contato, email ou comprovante. Qualquer edição futura desse produto vai falhar.',
    produtos.filter(p => proib.test(p.nome) || proib.test(p.descricao || '')).map(p => p.nome));

  // 14. Categorias sem destaque: nome do estabelecimento aparecendo para o cliente, ou sem emoji
  const catsUnicas = [...new Set(produtos.map(p => p.categoria))];
  add('dica', 'Categoria mostrando o nome do estabelecimento', 'O app mostra o nome inteiro da categoria para o cliente. Um nome curto com emoji (ex.: "🍟 FRITAS") fica mais bonito. Dá para trocar em Melhorias › Categorias.',
    catsUnicas.filter(c => /\s-\s*\S|-\s+\S/.test(c)));
  const temEmoji = (t) => /\p{Extended_Pictographic}/u.test(t);
  const semEmoji = catsUnicas.filter(c => !temEmoji(c));
  if (semEmoji.length === catsUnicas.length && catsUnicas.length > 1)
    add('dica', 'Categorias sem emoji', 'Um emoji no começo da categoria ajuda o cliente a achar o que quer mais rápido.', semEmoji);

  return P;
}

export function nota(problemas) {
  const peso = { erro: 12, aviso: 5, dica: 1 };
  const desconto = problemas.reduce((s, p) => s + peso[p.nivel] * Math.min(p.itens.length || 1, 4), 0);
  return Math.max(0, Math.min(100, 100 - desconto));
}

// Resumo compacto do cardápio para mandar à IA (economiza custo).
export function resumoParaIA({ produtos, niveis }) {
  return {
    produtos: produtos.map(p => ({ id: p.id, cat: p.categoria, sub: p.subcategoria || undefined, nome: p.nome, desc: p.descricao || undefined, valor: p.valor, niveis: p.niveis, ordem: p.ordem })),
    niveis: niveis.map(n => ({ titulo: n.titulo, por: n.por, cat: n.categoria, sub: n.subcategoria || undefined, produto: n.produto || undefined })),
  };
}
