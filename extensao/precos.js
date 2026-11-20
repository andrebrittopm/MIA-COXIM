// precos.js — cálculo do reajuste de preços (usado pelo chat e pela tela de Reajuste).
import { numBR, valorBR } from './painel.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// tipo: 'percentual' | 'valor'; valor: +10 = aumenta 10% (ou R$ 10), -5 = desconto
// arredondar: '90' (termina em ,90), '00' (inteiro), '50' (,00 ou ,50), 'nao'
export function calcularReajuste(produtos, { escopo = 'loja', categoria = '', tipo = 'percentual', valor = 0, arredondar = 'nao' }) {
  const alvo = produtos.filter(p => numBR(p.valor) > 0 && (escopo === 'loja' || norm(p.categoria) === norm(categoria)));
  return alvo.map(p => {
    const antes = numBR(p.valor);
    let novo = tipo === 'percentual' ? antes * (1 + Number(valor) / 100) : antes + Number(valor);
    if (arredondar === '90') novo = Math.max(0.9, Math.round(novo - 0.9) + 0.9); // ,90 mais próximo
    else if (arredondar === '00') novo = Math.max(1, Math.round(novo));
    else if (arredondar === '50') novo = Math.max(0.5, Math.round(novo * 2) / 2);
    novo = Math.round(novo * 100) / 100;
    return { id: p.id, nome: p.nome, categoria: p.categoria, antes: p.valor, depois: valorBR(novo) };
  }).filter(x => numBR(x.antes) !== numBR(x.depois) && numBR(x.depois) > 0);
}

export function textoReajuste(lista, max = 8) {
  const linhas = lista.slice(0, max).map(x => `• ${x.nome}: R$ ${x.antes} → R$ ${x.depois}`);
  if (lista.length > max) linhas.push(`• … e mais ${lista.length - max} produto(s)`);
  return linhas.join('\n');
}
