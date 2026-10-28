/**
 * Serialização segura de células CSV (H-2, CWE-1236 "CSV Injection").
 *
 * Um programa de planilha (Excel, LibreOffice Calc…) interpreta como FÓRMULA a célula de um CSV que
 * começa com = + - @. Como o ALM exporta texto digitado por pessoas (fornecedor, descrição, observações…),
 * toda célula passa por `csvField`, a única porta de saída para o CSV do frontend.
 *
 * Mitigação escolhida (a documentada pela OWASP para CSV aberto no Excel): a célula perigosa recebe um TAB
 * (0x09) na frente e vai entre aspas. O TAB faz a planilha tratar o conteúdo como texto.
 *   - "Perigosa" = o primeiro caractere depois de espaços/controles invisíveis é = + - @ (ou variante de
 *     largura total/sinal de menos Unicode), ou a célula já começa com TAB, CR ou LF. Olhar só o primeiro
 *     caractere não basta: " =1+1" e "\u00a0=1+1" também são tentativas.
 *   - Números puros (-5, +5, 1,5, -1,5) NÃO são alterados: não são fórmula e o CSV continua importável.
 *   - O texto "-" sozinho (marcador de "vazio") também não muda.
 *   - Aspas e o delimitador continuam escapados (RFC 4180), então nenhuma entrada cria célula ou linha extra.
 *
 * Impacto real: o valor BRUTO de uma célula neutralizada passa a ter um TAB inicial. Para uma pessoa abrindo
 * a planilha o TAB é invisível; para uma importação automática (script, ETL) o campo muda e precisa de
 * `trim()`/remoção do TAB inicial. Isso vale só para células que começavam com um caractere de fórmula.
 *
 * Limites (não há solução universal — OWASP e MITRE concordam): o TAB protege o Excel na abertura do arquivo;
 * não foi validado em Excel nem em LibreOffice reais neste ambiente, e a OWASP avisa que ao SALVAR e REABRIR
 * a planilha a proteção pode se perder. Esta função protege o arquivo exportado, não o que a pessoa faz depois.
 */

/** Prefixo aplicado a toda célula que poderia ser lida como fórmula. */
export const CSV_FORMULA_GUARD = '\t'

// Caracteres que iniciam fórmula: = + - @, as formas de largura total (＝ ＋ － ＠), as formas pequenas
// (﹦ ﹢ ﹣ ﹫) e o sinal de menos Unicode (−).
const FORMULA_CHARS = new Set(['=', '+', '-', '@', '＝', '＋', '－', '＠', '﹦', '﹢', '﹣', '﹫', '−'])

// Invisíveis que algumas planilhas ignoram antes do primeiro caractere: espaços (inclui NBSP e os Unicode),
// controles C0/C1, zero-width, hífen suave, BOM.
const LEADING_INVISIBLE = /^[\s\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2060-\u2064\ufeff]+/

// Número puro, com sinal opcional e separador decimal "." ou "," (pt-BR): não é fórmula.
const PLAIN_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/

/** A célula (já em texto) poderia ser interpretada como fórmula por uma planilha? */
export function needsFormulaGuard(text) {
  if (text === '' || text === '-') return false
  const first = text[0]
  if (first === '\t' || first === '\r' || first === '\n') return true
  if (PLAIN_NUMBER.test(text)) return false
  const rest = text.replace(LEADING_INVISIBLE, '')
  return rest !== '' && FORMULA_CHARS.has(rest[0])
}

/** Devolve o texto pronto para a célula: com o TAB na frente se for perigoso, igual se não for. */
export function neutralizeFormula(text) {
  return needsFormulaGuard(text) ? CSV_FORMULA_GUARD + text : text
}

/**
 * Uma célula CSV pronta para ser unida pelo delimitador. Entre aspas (RFC 4180, aspas internas dobradas) quando
 * tem o delimitador, aspas, CR/LF ou foi neutralizada. Número JS (typeof 'number') nunca é alterado.
 * `null`/`undefined` viram célula vazia.
 */
export function csvField(value, delimiter = ';') {
  if (typeof value === 'number') return String(value)
  const original = value == null ? '' : String(value)
  const text = neutralizeFormula(original)
  if (text !== original || text.includes(delimiter) || /["\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}
