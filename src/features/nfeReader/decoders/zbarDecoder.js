/**
 * Adapter ZBar para o benchmark de diagnóstico — cronometra e encaminha para
 * `zbarReader.js` (o primitivo compartilhado com o fast path de produção,
 * `extractor.js`), sem duplicar carregamento/decodificação. Mesmo padrão de
 * `nativeDecoder.js` sobre `nativeBarcodeDetector.js`.
 */
import { decodeCode128RawZbar, isZbarAvailable } from '../zbarReader.js'
import { buildDecodeResult, ENGINE, unavailableResult } from './decoderTypes.js'

export { isZbarAvailable }

/**
 * `source` — um HTMLCanvasElement ou um ImageData já pronto (evita reconverter
 * se quem chamar já tiver extraído o ImageData para outro propósito).
 */
export async function decodeWithZbar(source) {
  const available = await isZbarAvailable()
  if (!available) return unavailableResult(ENGINE.ZBAR)

  const startedAt = performance.now()
  try {
    const rawValue = await decodeCode128RawZbar(source)
    return buildDecodeResult(ENGINE.ZBAR, { available: true, rawValue, decodeTimeMs: performance.now() - startedAt })
  } catch (err) {
    return buildDecodeResult(ENGINE.ZBAR, { available: true, error: err?.message || String(err), decodeTimeMs: performance.now() - startedAt })
  }
}
