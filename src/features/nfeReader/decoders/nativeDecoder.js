/**
 * Adapter do BarcodeDetector nativo para o benchmark de diagnóstico. Não
 * reimplementa nada: só cronometra e encaminha para
 * `nativeBarcodeDetector.js` (o mesmo módulo já usado em produção pelo
 * pipeline estático e pelo scanner ao vivo) e devolve o formato padronizado
 * de `decoderTypes.js`.
 */
import { detectCode128Native, isNativeCode128Supported } from '../nativeBarcodeDetector.js'
import { buildDecodeResult, ENGINE, unavailableResult } from './decoderTypes.js'

export async function isNativeAvailable() {
  return isNativeCode128Supported()
}

/**
 * `source` — qualquer `CanvasImageSource` aceito por `BarcodeDetector.detect`
 * (canvas, vídeo, ImageBitmap). Nunca lança: falha vira `error` no resultado.
 */
export async function decodeWithNativeBarcodeDetector(source) {
  const available = await isNativeAvailable()
  if (!available) return unavailableResult(ENGINE.NATIVE)

  const startedAt = performance.now()
  try {
    const rawValue = await detectCode128Native(source)
    return buildDecodeResult(ENGINE.NATIVE, { available: true, rawValue, decodeTimeMs: performance.now() - startedAt })
  } catch (err) {
    return buildDecodeResult(ENGINE.NATIVE, { available: true, error: err?.message || String(err), decodeTimeMs: performance.now() - startedAt })
  }
}
