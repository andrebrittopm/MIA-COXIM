// historico.js — toda gravação fica registrada com o "antes", para poder desfazer.
// As escritas passam por uma fila: a Central e o MAX flutuante gravam ao mesmo tempo sem uma apagar a outra.
const CHAVE = 'alteracoes';
const LIMITE = 400;
const DIAS_PEDIDO = 30; // pedidos lançados (dados de cliente) somem do histórico depois de 30 dias

export const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || 'Cliente';
// Limpa dados de cliente: pedidos com mais de 30 dias saem; os demais ficam só com o primeiro nome.
function enxugar(lista) {
  const corte = Date.now() - DIAS_PEDIDO * 86400e3;
  return lista.filter(x => x.campo !== 'pedido' || x.quando >= corte).map(x => {
    if (x.campo !== 'pedido') return x;
    const [cliente, ...resto] = String(x.nome || '').split(' · ');
    return { ...x, nome: [primeiroNome(cliente), ...resto].join(' · ') };
  });
}

let fila = Promise.resolve();
function emFila(tarefa) {
  const p = fila.then(tarefa, tarefa);
  fila = p.catch(() => {});
  return p;
}

export function registrar(alt, quem) {
  return emFila(async () => {
    const { [CHAVE]: lista = [] } = await chrome.storage.local.get(CHAVE);
    const item = { ...alt, uid: crypto.randomUUID(), quando: Date.now(), quem: quem || '', desfeito: false };
    lista.unshift(item);
    await chrome.storage.local.set({ [CHAVE]: enxugar(lista).slice(0, LIMITE) });
    return item;
  });
}

export async function listar() {
  const { [CHAVE]: lista = [] } = await chrome.storage.local.get(CHAVE);
  return enxugar(lista);
}

// Ao abrir a MIA: aplica a limpeza no que já estava guardado (versões antigas guardavam o nome completo).
export function limparAntigos() {
  return emFila(async () => {
    const { [CHAVE]: lista = [] } = await chrome.storage.local.get(CHAVE);
    const limpa = enxugar(lista);
    if (JSON.stringify(limpa) !== JSON.stringify(lista)) await chrome.storage.local.set({ [CHAVE]: limpa });
  });
}

export function marcarDesfeito(uid) {
  return emFila(async () => {
    const { [CHAVE]: lista = [] } = await chrome.storage.local.get(CHAVE);
    const i = lista.findIndex(x => x.uid === uid);
    if (i >= 0) { lista[i].desfeito = true; await chrome.storage.local.set({ [CHAVE]: lista }); }
    return lista[i];
  });
}

export async function buscar(uid) {
  return (await listar()).find(x => x.uid === uid);
}
