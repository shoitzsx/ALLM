/**
 * Adapter ZXing para o benchmark de diagnóstico. Não cria uma segunda
 * implementação: `decodeWithZxing` cronometra e encaminha para
 * `decodeCode128RawZxing` (barcodeReader.js) — a mesma configuração de hints
 * (CODE_128 apenas, nunca TRY_HARDER, ver comentário no topo de
 * barcodeReader.js) usada em produção, só que numa única tentativa (sem
 * recorte/rotação/deskew), para comparar o decoder "cru" contra os outros
 * engines na mesma imagem.
 *
 * `decodeWithZxingPipeline` cobre o Nível B do benchmark ("pipeline atual") —
 * chama `readCode128FromCanvas`, o MESMO pipeline de estágios que roda em
 * produção (que, hoje, já tenta o nativo primeiro internamente — ver
 * barcodeReader.js). Não é um "pipeline só de ZXing" isolado: é
 * deliberadamente o pipeline de produção como um todo, porque não faz sentido
 * fabricar variantes de deskew/margem por engine que não existem de verdade —
 * o benchmark reporta esse nível como "pipeline atual (produção)", não como
 * resultado por engine.
 */
import { decodeCode128RawZxing, readCode128FromCanvas } from '../barcodeReader.js'
import { buildDecodeResult, ENGINE } from './decoderTypes.js'

/** ZXing é a base do módulo — sempre disponível, sem feature detection (ao contrário de native/zbar). */
export async function isZxingAvailable() {
  return true
}

export async function decodeWithZxing(canvas) {
  const startedAt = performance.now()
  try {
    const rawValue = decodeCode128RawZxing(canvas)
    return buildDecodeResult(ENGINE.ZXING, { available: true, rawValue, decodeTimeMs: performance.now() - startedAt })
  } catch (err) {
    return buildDecodeResult(ENGINE.ZXING, { available: true, error: err?.message || String(err), decodeTimeMs: performance.now() - startedAt })
  }
}

/** Nível B do benchmark — ver comentário de topo do arquivo. */
export async function decodeWithProductionPipeline(canvas) {
  const startedAt = performance.now()
  try {
    const rawValue = await readCode128FromCanvas(canvas)
    return buildDecodeResult(ENGINE.ZXING, { available: true, rawValue, decodeTimeMs: performance.now() - startedAt })
  } catch (err) {
    return buildDecodeResult(ENGINE.ZXING, { available: true, error: err?.message || String(err), decodeTimeMs: performance.now() - startedAt })
  }
}
