/**
 * Motor do Modo B do benchmark de diagnóstico ("Live A/B/C") — testa UM
 * engine por vez, ao vivo, sobre a MESMA câmera/vídeo já aberto pelo painel
 * (NfeScannerBenchmark.jsx), nunca dois engines rodando ao mesmo tempo (evita
 * CPU/bateria/temperatura alta e mantém a comparação justa — cada teste usa
 * exatamente o mesmo hardware de câmera, a mesma configuração e o mesmo
 * intervalo entre tentativas).
 *
 * Cadência (`LIVE_TEST_DELAY_MS`) igual à do scanner de produção
 * (`liveScanner.js`, `SCAN_DELAY_MS`) — nenhum engine ganha vantagem de
 * cadência sobre outro.
 *
 * Sobre a métrica de "tentativas": como este runner é quem controla o laço
 * (captura um frame, chama o decoder, espera, repete) igualmente para os três
 * engines, "tentativas" é uma contagem genuinamente comparável aqui — ao
 * contrário do laço interno de cada API nativa (que não é controlado por nós
 * e não expõe esse número de forma equivalente entre si). Por isso o
 * benchmark ao vivo não precisa reportar "N/D" para tentativas: elas são
 * reais e comparáveis por construção deste harness.
 *
 * Depende de DOM (Canvas/performance.now/setTimeout) — não é testável em
 * Node puro, mesma situação de liveScanner.js (ver README, seção "Testes").
 */
import { captureCurrentFrame } from './liveScanner.js'
import { decodeWithNativeBarcodeDetector, decodeWithZbar, decodeWithZxing, ENGINE } from './decoders/index.js'

export const LIVE_TEST_DURATION_MS = 10000
const LIVE_TEST_DELAY_MS = 100

const DECODE_BY_ENGINE = {
  [ENGINE.NATIVE]: decodeWithNativeBarcodeDetector,
  [ENGINE.ZXING]: decodeWithZxing,
  [ENGINE.ZBAR]: decodeWithZbar,
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * `onTick(snapshot)` — chamado a cada tentativa, para atualizar cronômetro/
 * contador na UI. `signal` — um `AbortSignal` opcional para cancelar antes
 * dos 10s (ex.: usuário fechou o painel).
 *
 * Resolve com `{ outcome: 'found' | 'timeout' | 'aborted', attempts,
 * elapsedMs, lastResult, anyBarcodeDetectedAtMs }`. Nunca lança: uma falha de
 * decode em uma tentativa isolada já chega como `lastResult.error` (formato
 * de decoderTypes.js), não interrompe o laço.
 */
export async function runLiveEngineTest({ videoElement, engine, onTick, signal }) {
  const decode = DECODE_BY_ENGINE[engine]
  if (!decode) throw new Error(`Engine de benchmark desconhecido: ${engine}`)

  const startedAt = performance.now()
  let attempts = 0
  let anyBarcodeDetectedAtMs = null
  let lastResult = null

  while (performance.now() - startedAt < LIVE_TEST_DURATION_MS) {
    if (signal?.aborted) {
      return { outcome: 'aborted', attempts, elapsedMs: Math.round(performance.now() - startedAt), lastResult, anyBarcodeDetectedAtMs }
    }

    const canvas = captureCurrentFrame(videoElement)
    lastResult = await decode(canvas)
    attempts += 1
    const elapsedMs = Math.round(performance.now() - startedAt)
    if (lastResult.detected && anyBarcodeDetectedAtMs == null) anyBarcodeDetectedAtMs = elapsedMs
    onTick?.({ attempts, elapsedMs, lastResult, anyBarcodeDetectedAtMs })

    if (lastResult.validNfeKey) {
      return { outcome: 'found', attempts, elapsedMs, lastResult, anyBarcodeDetectedAtMs }
    }
    if (signal?.aborted) {
      return { outcome: 'aborted', attempts, elapsedMs, lastResult, anyBarcodeDetectedAtMs }
    }
    await sleep(LIVE_TEST_DELAY_MS)
  }

  return { outcome: 'timeout', attempts, elapsedMs: LIVE_TEST_DURATION_MS, lastResult, anyBarcodeDetectedAtMs }
}
