// calendario.js — datas que rendem post e banner no delivery (Brasil).
// Só datas conhecidas e fixas (ou calculáveis). Datas locais da cidade a equipe cria no quadro.

const FIXAS = [
  ['01-01', 'Ano Novo', 'Feriado: muita gente em casa, de ressaca de festa. Bom dia pra lanche, pizza e marmita.'],
  ['03-08', 'Dia da Mulher', 'Homenagem às clientes e às parceiras donas de loja.'],
  ['03-15', 'Dia do Consumidor', 'Data clássica de cupom e frete grátis.'],
  ['04-21', 'Tiradentes', 'Feriado nacional.'],
  ['05-01', 'Dia do Trabalho', 'Feriado nacional: churrasco, pizza e porções.'],
  ['05-28', 'Dia do Hambúrguer', 'Data perfeita para as hamburguerias do app.'],
  ['06-12', 'Dia dos Namorados', 'Jantar a dois, combos de casal, sobremesas e açaí.'],
  ['06-24', 'São João', 'Festa junina: comidas típicas, milho, caldos, doces.'],
  ['07-07', 'Dia do Chocolate', 'Sobremesas, açaí, sorvetes e doces.'],
  ['07-10', 'Dia da Pizza', 'Dia das pizzarias do app.'],
  ['07-20', 'Dia do Amigo', 'Combos para dividir com a galera.'],
  ['07-26', 'Dia dos Avós', 'Homenagem de família.'],
  ['07-27', 'Dia do Motociclista', 'Homenagem aos entregadores do Mais Delivery.'],
  ['09-07', 'Independência do Brasil', 'Feriado nacional.'],
  ['09-15', 'Dia do Cliente', 'Agradecer quem pede no app: cupom, cashback, sorteio.'],
  ['09-23', 'Dia do Sorvete', 'Sorveterias e açaiterias.'],
  ['10-12', 'Dia das Crianças', 'Combos infantis, lanches, sorvetes e doces.'],
  ['10-15', 'Dia do Professor', 'Homenagem.'],
  ['10-31', 'Halloween', 'Artes temáticas, doces e lanches "assustadores".'],
  ['11-02', 'Finados', 'Feriado nacional (tom respeitoso, sem promoção agressiva).'],
  ['11-15', 'Proclamação da República', 'Feriado nacional.'],
  ['11-20', 'Consciência Negra', 'Feriado nacional.'],
  ['12-24', 'Véspera de Natal', 'Ceia, sobremesas, encomendas.'],
  ['12-25', 'Natal', 'Feriado: almoço de família, lojas com horário especial.'],
  ['12-31', 'Réveillon', 'Bebidas, gelo, petiscos e porções para a virada.'],
];

function pascoa(ano) { // algoritmo de Meeus/Jones/Butcher
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451), mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}
const somar = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function enesimoDiaSemana(ano, mes, diaSemana, n) { // n-ésimo domingo/quinta... do mês (mes 0–11)
  const d = new Date(ano, mes, 1); const desl = (diaSemana - d.getDay() + 7) % 7;
  return new Date(ano, mes, 1 + desl + 7 * (n - 1));
}
const FERIADOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
function quintoDiaUtil(ano, mes) {
  let d = new Date(ano, mes, 1), uteis = 0;
  const feriado = (x) => FERIADOS.includes(`${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
  while (true) { if (d.getDay() !== 0 && d.getDay() !== 6 && !feriado(d)) uteis++; if (uteis === 5) return d; d = somar(d, 1); }
}

function datasDoAno(ano) {
  const out = FIXAS.map(([md, nome, dica]) => ({ data: new Date(ano, Number(md.slice(0, 2)) - 1, Number(md.slice(3))), nome, dica }));
  const p = pascoa(ano);
  out.push({ data: somar(p, -47), nome: 'Carnaval', dica: 'Feriadão: bebidas, gelo, petiscos, açaí.' });
  out.push({ data: somar(p, -2), nome: 'Sexta-feira Santa', dica: 'Peixes e pratos sem carne vermelha.' });
  out.push({ data: p, nome: 'Páscoa', dica: 'Chocolates, ovos de páscoa, sobremesas e almoço de família.' });
  out.push({ data: somar(p, 60), nome: 'Corpus Christi', dica: 'Feriado: emenda de fim de semana.' });
  out.push({ data: enesimoDiaSemana(ano, 4, 0, 2), nome: 'Dia das Mães', dica: 'Almoço de domingo, sobremesas, presentes. Uma das maiores datas do delivery.' });
  out.push({ data: enesimoDiaSemana(ano, 7, 0, 2), nome: 'Dia dos Pais', dica: 'Churrasco, hambúrguer, porções e cerveja.' });
  out.push({ data: somar(enesimoDiaSemana(ano, 10, 4, 4), 1), nome: 'Black Friday', dica: 'Semana de promoções: combos, cupons e frete grátis.' });
  for (let m = 0; m < 12; m++) out.push({ data: quintoDiaUtil(ano, m), nome: 'Dia do pagamento (5º dia útil)', dica: 'Salário na conta: pedido maior, combo família, pizza.', mensal: true });
  return out;
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Datas dos próximos `dias` dias (padrão 45), com o prazo sugerido para a arte ficar pronta.
export function proximasDatas(hoje = new Date(), dias = 45) {
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const fim = somar(ini, dias);
  return [...datasDoAno(ini.getFullYear()), ...datasDoAno(ini.getFullYear() + 1)]
    .filter(x => x.data >= ini && x.data <= fim)
    .sort((a, b) => a.data - b.data)
    .map(x => {
      const antecedencia = x.mensal ? 3 : 7;
      const prazo = somar(x.data, -antecedencia);
      return { data: iso(x.data), nome: x.nome, dica: x.dica, faltam: Math.round((x.data - ini) / 864e5), prazo: iso(prazo < ini ? ini : prazo), mensal: !!x.mensal };
    });
}

// Faixas de horário dos banners do app.
export const PERIODOS = [
  { id: 'cafe', nome: 'Café da manhã', de: 6, ate: 10, emoji: '☕' },
  { id: 'almoco', nome: 'Almoço', de: 10, ate: 14, emoji: '🍛' },
  { id: 'tarde', nome: 'Lanche da tarde', de: 14, ate: 18, emoji: '🥪' },
  { id: 'jantar', nome: 'Jantar', de: 18, ate: 22, emoji: '🍕' },
  { id: 'noite', nome: 'Fome da madrugada', de: 22, ate: 26, emoji: '🌙' },
];
