/**
 * Formato de resultado compartilhado pelos três adapters de decoder
 * (nativeDecoder.js, zxingDecoder.js, zbarDecoder.js) do benchmark de
 * diagnóstico do scanner de NF-e. Cada adapter só sabe decodificar pixels →
 * texto bruto; TODA a validação de chave de NF-e mora aqui, num único lugar
 * — nenhum engine implementa sua própria validação (regra explícita do
 * benchmark: a diferença entre engines deve ser só decodificação de pixels,
 * nunca critério de validação divergente).
 *
 * Pura lógica, sem DOM/Canvas — testável em Node puro.
 */
import { normalizarChave, validarChaveNFe } from '../chaveNFe.js'

export const ENGINE = Object.freeze({
  NATIVE: 'native',
  ZXING: 'zxing',
  ZBAR: 'zbar',
})

export const ENGINE_LABEL = Object.freeze({
  [ENGINE.NATIVE]: 'BarcodeDetector nativo',
  [ENGINE.ZXING]: 'ZXing',
  [ENGINE.ZBAR]: 'ZBar (WASM)',
})

const MASK_PREFIX = 4
const MASK_SUFFIX = 4

/**
 * Mascara um valor decodificado para exibição/exportação — nunca a chave
 * completa. Com 44 dígitos (chave de NF-e) fica "4226••••••••••••••••••••••
 * ••••••••••••••••1234"; qualquer coisa curta demais para valer a pena
 * mascarar parcialmente vira só bolinhas.
 */
export function maskValue(rawValue) {
  if (!rawValue) return null
  const digits = normalizarChave(rawValue)
  const base = digits || rawValue
  if (base.length <= MASK_PREFIX + MASK_SUFFIX) return '•'.repeat(base.length)
  return `${base.slice(0, MASK_PREFIX)}${'•'.repeat(base.length - MASK_PREFIX - MASK_SUFFIX)}${base.slice(-MASK_SUFFIX)}`
}

/**
 * Constrói o resultado padronizado de uma tentativa de decodificação.
 * `rawValue`/`decodeTimeMs`/`error` vêm do adapter específico; normalização e
 * validação da chave de NF-e são sempre feitas aqui (normalizarChave +
 * validarChaveNFe, chaveNFe.js — as mesmas funções usadas pelo resto do
 * módulo, nenhuma validação paralela).
 */
export function buildDecodeResult(engine, { available, rawValue = null, decodeTimeMs = null, error = null } = {}) {
  const normalizedValue = rawValue ? normalizarChave(rawValue) : null
  const detected = Boolean(rawValue)
  const validNfeKey = Boolean(normalizedValue && normalizedValue.length === 44 && validarChaveNFe(normalizedValue))
  return {
    engine,
    available: Boolean(available),
    detected,
    format: detected ? 'CODE_128' : null,
    digitCount: normalizedValue ? normalizedValue.length : 0,
    validNfeKey,
    maskedValue: detected ? maskValue(normalizedValue || rawValue) : null,
    decodeTimeMs: decodeTimeMs != null ? Math.round(decodeTimeMs) : null,
    error: error || null,
  }
}

/** Resultado padrão para um engine indisponível neste navegador — nunca lança, nunca inventa um decodeTimeMs. */
export function unavailableResult(engine) {
  return buildDecodeResult(engine, { available: false })
}
