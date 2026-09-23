/**
 * Vocabulário e contadores de diagnóstico compartilhados pelo pipeline
 * estático (barcodeReader.js) e pelo scanner ao vivo (liveScanner.js) — para
 * saber ONDE uma leitura está falhando, não só que falhou:
 *
 *   A. nenhum barcode detectado                → NOT_FOUND
 *   B. barcode detectado, mas não é CODE_128    → WRONG_FORMAT (ver nota abaixo)
 *   C. CODE_128 decodificado, mas não tem 44 dígitos → INVALID_LENGTH
 *   D. 44 dígitos, mas dígito verificador não bate   → INVALID_DV
 *   E. chave de NF-e válida                          → VALID
 *
 * Nota sobre WRONG_FORMAT: como todo decoder deste módulo (ZXing e o
 * BarcodeDetector nativo) já é restrito a `code_128`/CODE_128 nos hints/
 * `formats`, esse caso é estruturalmente raro — só apareceria se os hints
 * fossem afrouxados no futuro. Mantido na taxonomia por completude.
 *
 * Pura lógica, sem DOM/Canvas — testável em Node puro.
 */
import { normalizarChave, validarChaveNFe } from './chaveNFe.js'

export const DECODE_OUTCOME = Object.freeze({
  NOT_FOUND: 'not_found',
  WRONG_FORMAT: 'wrong_format',
  INVALID_LENGTH: 'invalid_length',
  INVALID_DV: 'invalid_dv',
  VALID: 'valid',
})

/**
 * Classifica o texto bruto devolvido por um decoder de barcode (ZXing ou
 * BarcodeDetector nativo) em um dos cinco desfechos acima. Nunca lança —
 * texto inesperado (`null`/vazio) classifica como NOT_FOUND.
 */
export function classifyDecodedText(rawText) {
  if (!rawText) return DECODE_OUTCOME.NOT_FOUND
  const chave = normalizarChave(rawText)
  if (chave.length !== 44) return DECODE_OUTCOME.INVALID_LENGTH
  if (!validarChaveNFe(chave)) return DECODE_OUTCOME.INVALID_DV
  return DECODE_OUTCOME.VALID
}

/**
 * Contador simples de diagnóstico — usado tanto no pipeline estático (soma
 * as ~64 tentativas de recorte/contraste/rotação/deskew de uma única foto)
 * quanto no scanner ao vivo (soma tentativas ao longo do tempo, até
 * encontrar uma chave ou o usuário cancelar). Nunca guarda a chave em si,
 * só contagens — seguro para logar em `console.debug`.
 */
export function createDiagnosticsCounter() {
  const counts = {
    attempts: 0,
    [DECODE_OUTCOME.NOT_FOUND]: 0,
    [DECODE_OUTCOME.WRONG_FORMAT]: 0,
    [DECODE_OUTCOME.INVALID_LENGTH]: 0,
    [DECODE_OUTCOME.INVALID_DV]: 0,
    [DECODE_OUTCOME.VALID]: 0,
  }
  return {
    /** Registra uma tentativa e seu desfecho. */
    record(outcome) {
      counts.attempts += 1
      counts[outcome] = (counts[outcome] || 0) + 1
    },
    /** Cópia imutável dos contadores atuais — segura para logar/expor a um painel de dev. */
    summary() {
      return { ...counts }
    },
  }
}
