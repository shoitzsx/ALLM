/**
 * Heurísticas fracas (regex) sobre o texto extraído do PDF, para campos que
 * a chave de acesso não cobre. Ao contrário da chave (matemática), aqui não
 * há garantia — por isso esses campos nunca recebem confiança "alta".
 */

/** Data de emissão, buscada perto da palavra "emissão". Confiança: conferir. */
export function findDataEmissao(texto) {
  if (!texto) return null
  const match = texto.match(/emiss[aã]o[^0-9]{0,20}(\d{2}\/\d{2}\/\d{4})/i)
  return match ? { value: match[1] } : null
}

/** Valor total da nota. Confiança: conferir. */
export function findValorTotal(texto) {
  if (!texto) return null
  const match =
    texto.match(/valor\s+total\s+da\s+nota[^0-9]{0,20}([\d.,]+\d)/i) ||
    texto.match(/valor\s+total[^0-9]{0,20}([\d.,]+\d)/i)
  return match ? { value: match[1] } : null
}

/** Pedido de compra citado no corpo do texto. Heurística fraca: confiança baixa. */
export function findPedido(texto) {
  if (!texto) return null
  const match = texto.match(/pedido(?:\s+de\s+compra)?[^0-9]{0,15}(\d{4,12})/i)
  return match ? { value: match[1] } : null
}
