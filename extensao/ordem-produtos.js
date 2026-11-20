// ordem-produtos.js — "Ordem estratégica" dos produtos dentro de cada categoria (sem IA, sem custo).
// Regra: carro-chefe no topo, depois o que mais fatura (vendas × preço), item de menor ticket no fim; pausados por último.
// Sem vendas suficientes: com foto antes de sem foto, e do maior para o menor preço.

const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const valorNum = (v) => Number(String(v || '0').replace(/\./g, '').replace(',', '.')) || 0;
const reais = (n) => 'R$ ' + n.toFixed(2).replace('.', ',');

export function ordemEstrategica(produtos, qtdPorChave = {}) {
  const grupos = new Map();
  for (const p of produtos) {
    const k = `${p.categoria}|||${p.subcategoria || ''}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const saida = [];
  for (const [k, lista] of grupos) {
    if (lista.length < 2) continue;
    const [categoria, subcategoria] = k.split('|||');
    const positivos = lista.map(p => valorNum(p.valor)).filter(v => v > 0).sort((a, b) => a - b);
    const mediana = positivos.length ? positivos[Math.floor(positivos.length / 2)] : 0;
    const itens = lista.map(p => {
      const precoReal = valorNum(p.valor);
      const qtd = Number(qtdPorChave?.[chave(p.nome)] || 0);
      return { p, qtd, preco: precoReal || mediana, precoReal, ativo: p.ativo !== false && p.disponivel !== 'Não', foto: p.foto !== false };
    });
    const temVendas = itens.reduce((s, x) => s + x.qtd, 0) >= 3;
    const chefe = temVendas ? itens.filter(x => x.ativo).sort((a, b) => b.qtd - a.qtd)[0] : null;
    itens.sort((a, b) =>
      (b.ativo - a.ativo)
      || (chefe ? (b === chefe) - (a === chefe) : 0)
      || (temVendas ? (b.qtd * b.preco) - (a.qtd * a.preco) : 0)
      || (temVendas ? 0 : (b.foto - a.foto))
      || (b.preco - a.preco)
      || ((Number(a.p.ordem) || 0) - (Number(b.p.ordem) || 0)));
    const ativos = itens.filter(x => x.ativo);
    const ultimoAtivo = ativos[ativos.length - 1];
    const novos = itens.map((x, i) => {
      const motivo = !x.ativo ? '⏸ pausado: fica no fim'
        : x === chefe ? `🏆 carro-chefe · vendeu ${x.qtd}x no mês`
        : x.qtd > 0 ? `vendeu ${x.qtd}x · ${x.precoReal ? reais(x.precoReal) : 'preço pelos níveis'}`
        : `${x.precoReal ? reais(x.precoReal) : 'preço pelos níveis'}${x.foto ? '' : ' · sem foto'}${temVendas ? ' · sem vendas no mês' : ''}`;
      return { id: String(x.p.id), nome: x.p.nome, antes: Number(x.p.ordem) || 0, depois: i + 1,
        motivo: x === ultimoAtivo && ativos.length > 2 && x !== chefe && x.precoReal > 0 && x.precoReal <= Math.min(...ativos.map(y => y.precoReal || Infinity)) ? motivo + ' · menor ticket, vai pro fim' : motivo };
    });
    // Posição atual = ordem do painel (empates pela ordem da lista).
    const atual = [...lista].sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0)).map(p => String(p.id));
    const muda = novos.some((x, i) => x.id !== atual[i]); // só quando a sequência no app muda de fato
    if (muda) saida.push({ categoria, subcategoria, comVendas: temVendas, itens: novos });
  }
  return saida;
}
