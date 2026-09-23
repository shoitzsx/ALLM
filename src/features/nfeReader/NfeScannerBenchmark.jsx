import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, Copy, RefreshCw, X } from 'lucide-react'
import { buildConstraints, captureCurrentFrame } from './liveScanner.js'
import { describeError } from './NfeLiveScanner.jsx'
import { isNativeCode128Supported } from './nativeBarcodeDetector.js'
import {
  decodeWithNativeBarcodeDetector,
  decodeWithProductionPipeline,
  decodeWithZbar,
  decodeWithZxing,
  ENGINE,
  ENGINE_LABEL,
  isZbarAvailable,
} from './decoders/index.js'
import { LIVE_TEST_DURATION_MS, runLiveEngineTest } from './benchmarkLiveRunner.js'
import { computeFrameStats } from './imageStats.js'
import { summarizeCameraState } from './cameraCapabilities.js'
import { buildDiagnosticsReportText } from './benchmarkReport.js'

/**
 * Painel de diagnóstico/benchmark de decoders de código de barras — SÓ existe
 * quando `?nfeScannerDebug=1` está na URL (ver scannerDebug.js). Compara, de
 * forma controlada, os três engines disponíveis (BarcodeDetector nativo,
 * ZXing, ZBar/WASM) sobre a MESMA imagem/câmera, sem alterar qual engine o
 * scanner de produção usa (NfeLiveScanner.jsx/liveScanner.js continuam
 * exatamente como estavam).
 *
 * Nunca roda mais de um engine simultaneamente — nem no Modo A (sequencial,
 * uma imagem só), nem no Modo B (um botão ativo por vez).
 *
 * Este arquivo só é importado dinamicamente (React.lazy) por NfeReaderPage.jsx
 * — o código deste painel e do ZBar/WASM não fazem parte do bundle inicial
 * da aplicação (ver README, seção "Benchmark de decoders").
 */
export default function NfeScannerBenchmark({ open, onClose }) {
  const videoRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const streamRef = useRef(null)
  const abortRef = useRef(null)

  const [cameraState, setCameraState] = useState('requesting') // requesting | ready | error
  const [cameraErrorMessage, setCameraErrorMessage] = useState('')
  const [cameraSummary, setCameraSummary] = useState(null)
  const [nativeAvailable, setNativeAvailable] = useState(null)
  const [zbarAvailable, setZbarAvailable] = useState(null)

  const [capturingFrame, setCapturingFrame] = useState(false)
  const [frameStats, setFrameStats] = useState(null)
  const [frameResults, setFrameResults] = useState(null)
  const [pipelineResult, setPipelineResult] = useState(null)

  const [liveEngine, setLiveEngine] = useState(null)
  const [liveTick, setLiveTick] = useState(null)
  const [liveResults, setLiveResults] = useState({})

  const [copyStatus, setCopyStatus] = useState('')

  // Abre UMA câmera, com a MESMA configuração usada em produção — compartilhada pelos Modos A e B.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setCameraState('requesting')
    setCameraErrorMessage('')
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(buildConstraints(undefined))
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.muted = true
          videoRef.current.playsInline = true
          await videoRef.current.play().catch(() => {})
        }
        const track = stream.getVideoTracks()[0]
        const settings = track.getSettings?.() || {}
        const capabilities = track.getCapabilities?.() || {}
        console.debug('[NFe][benchmark] câmera pronta', settings)
        setCameraSummary(summarizeCameraState(settings, capabilities))
        setCameraState('ready')
      } catch (err) {
        if (cancelled) return
        console.error('[NFe][benchmark] Falha ao abrir câmera.', { name: err?.name, message: err?.message })
        setCameraErrorMessage(describeError(err))
        setCameraState('error')
      }
    })()
    return () => {
      cancelled = true
      abortRef.current?.abort()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [open])

  // Disponibilidade de cada engine neste navegador — checada uma vez.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    isNativeCode128Supported().then((supported) => {
      if (!cancelled) setNativeAvailable(supported)
    })
    isZbarAvailable().then((supported) => {
      if (!cancelled) setZbarAvailable(supported)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setFrameResults(null)
      setPipelineResult(null)
      setFrameStats(null)
      setLiveResults({})
      setCopyStatus('')
    }
  }, [open])

  const drawPreview = (sourceCanvas) => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    canvas.width = sourceCanvas.width
    canvas.height = sourceCanvas.height
    canvas.getContext('2d')?.drawImage(sourceCanvas, 0, 0)
  }

  /**
   * MODO A — captura UM frame e submete a MESMA imagem, em sequência, aos
   * três engines (nunca converte/recorta diferente para cada um), depois ao
   * pipeline completo de produção (Nível B).
   */
  const handleCaptureFrame = async () => {
    const video = videoRef.current
    if (!video || cameraState !== 'ready' || capturingFrame) return
    setCapturingFrame(true)
    setFrameResults(null)
    setPipelineResult(null)
    try {
      const canvas = captureCurrentFrame(video)
      drawPreview(canvas)
      setFrameStats(computeFrameStats(canvas))

      console.debug('[NFe][benchmark] frame capturado — iniciando comparação estática (nativo → ZXing → ZBar)')
      const nativeResult = await decodeWithNativeBarcodeDetector(canvas)
      const zxingResult = await decodeWithZxing(canvas)
      const zbarResult = await decodeWithZbar(canvas)
      const results = [nativeResult, zxingResult, zbarResult]
      setFrameResults(results)
      console.debug(
        '[NFe][benchmark] comparação estática concluída',
        results.map((r) => ({ engine: r.engine, available: r.available, detected: r.detected, validNfeKey: r.validNfeKey, decodeTimeMs: r.decodeTimeMs })),
      )

      const pipeline = await decodeWithProductionPipeline(canvas)
      setPipelineResult(pipeline)
      console.debug('[NFe][benchmark] pipeline de produção (Nível B)', { detected: pipeline.detected, validNfeKey: pipeline.validNfeKey, decodeTimeMs: pipeline.decodeTimeMs })
    } catch (err) {
      console.error('[NFe][benchmark] Falha ao capturar/comparar frame.', { name: err?.name, message: err?.message })
    } finally {
      setCapturingFrame(false)
    }
  }

  /** MODO B — testa um único engine ao vivo, por até 10s, nunca dois ao mesmo tempo. */
  const runLiveTest = async (engine) => {
    if (liveEngine || cameraState !== 'ready') return
    const controller = new AbortController()
    abortRef.current = controller
    setLiveEngine(engine)
    setLiveTick({ attempts: 0, elapsedMs: 0 })
    try {
      const summary = await runLiveEngineTest({
        videoElement: videoRef.current,
        engine,
        signal: controller.signal,
        onTick: setLiveTick,
      })
      setLiveResults((current) => ({ ...current, [engine]: summary }))
      console.debug(`[NFe][benchmark] teste ao vivo (${engine}) concluído`, { outcome: summary.outcome, attempts: summary.attempts, elapsedMs: summary.elapsedMs })
    } finally {
      setLiveEngine(null)
      setLiveTick(null)
      abortRef.current = null
    }
  }

  const handleCopyDiagnostics = async () => {
    const text = buildDiagnosticsReportText({
      browser: navigator.userAgent,
      platform: navigator.userAgentData?.platform || navigator.platform || 'N/D',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      cameraResolution: cameraSummary?.resolution,
      orientation: window.matchMedia?.('(orientation: portrait)').matches ? 'retrato' : 'paisagem',
      autoEngine: nativeAvailable == null ? 'N/D' : ENGINE_LABEL[nativeAvailable ? ENGINE.NATIVE : ENGINE.ZXING],
      results: frameResults || [],
      liveResults,
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('Copiado!')
    } catch {
      setCopyStatus('Não foi possível copiar automaticamente.')
    }
    window.setTimeout(() => setCopyStatus(''), 2500)
  }

  if (!open) return null

  const autoEngineLabel = nativeAvailable == null ? '…' : ENGINE_LABEL[nativeAvailable ? ENGINE.NATIVE : ENGINE.ZXING]

  return (
    <div className="nfe-benchmark-overlay" role="dialog" aria-modal="true" aria-label="Diagnóstico do scanner de NF-e">
      <header className="nfe-benchmark-header">
        <button className="nfe-scanner-cancel" type="button" onClick={onClose}>
          <X size={18} /> Fechar
        </button>
        <strong>Diagnóstico de leitura NF-e</strong>
        <span className="nfe-scanner-header-spacer" aria-hidden="true" />
      </header>

      <div className="nfe-benchmark-body">
        {cameraState === 'error' ? (
          <div className="info-strip warning"><AlertTriangle size={15} /><span>{cameraErrorMessage}</span></div>
        ) : null}

        <section className="nfe-benchmark-section">
          <h3>Câmera</h3>
          <video ref={videoRef} className="nfe-benchmark-video" playsInline muted autoPlay />
          <dl className="nfe-benchmark-facts">
            <div><dt>Câmera</dt><dd>{cameraSummary?.resolution || (cameraState === 'requesting' ? 'solicitando…' : 'N/D')}</dd></div>
            <div><dt>Facing mode</dt><dd>{cameraSummary?.facingMode || 'N/D'}</dd></div>
            <div><dt>Foco (suporta / atual)</dt><dd>{cameraSummary ? `${cameraSummary.focusModeCapability} / ${cameraSummary.focusModeCurrent}` : 'N/D'}</dd></div>
            <div><dt>Zoom (suporta / atual)</dt><dd>{cameraSummary ? `${cameraSummary.zoomCapability} / ${cameraSummary.zoomCurrent}` : 'N/D'}</dd></div>
            <div><dt>Engine automático atual (produção)</dt><dd>{autoEngineLabel}</dd></div>
            <div><dt>ZBar disponível</dt><dd>{zbarAvailable == null ? '…' : zbarAvailable ? 'sim' : 'não'}</dd></div>
          </dl>
        </section>

        <section className="nfe-benchmark-section">
          <h3>Modo A — frame capturado</h3>
          <p className="nfe-benchmark-hint">
            Enquadre o código de barras da DANFE e capture UM frame. A mesma imagem será testada, em sequência, nos
            três engines — comparação justa, sem recorte/rotação diferente para cada um.
          </p>
          <button
            className="btn btn-primary nfe-benchmark-btn-lg"
            type="button"
            disabled={cameraState !== 'ready' || capturingFrame}
            onClick={handleCaptureFrame}
          >
            {capturingFrame ? <RefreshCw className="spin" size={16} /> : <Camera size={16} />}
            {capturingFrame ? 'Comparando…' : 'Capturar frame para teste'}
          </button>

          {frameStats ? (
            <div className="nfe-benchmark-frame-preview">
              <canvas ref={previewCanvasRef} className="nfe-benchmark-canvas" />
              <dl className="nfe-benchmark-facts">
                <div><dt>Dimensões</dt><dd>{frameStats.width}×{frameStats.height}</dd></div>
                <div><dt>Luminosidade média</dt><dd>{frameStats.meanLuminance} / 255</dd></div>
                <div><dt>Contraste aproximado</dt><dd>{frameStats.stdDevContrast}</dd></div>
              </dl>
            </div>
          ) : null}

          {frameResults ? (
            <div className="nfe-benchmark-results">
              {frameResults.map((result) => (
                <EngineResultRow key={result.engine} result={result} />
              ))}
              {pipelineResult ? (
                <EngineResultRow result={pipelineResult} labelOverride="Pipeline atual (produção — nativo+ZXing+pré-processamento)" />
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="nfe-benchmark-section">
          <h3>Modo B — teste ao vivo (10s por engine)</h3>
          <p className="nfe-benchmark-hint">Um engine por vez. Para no primeiro sucesso ou em 10s.</p>
          <div className="nfe-benchmark-live-buttons">
            {[ENGINE.NATIVE, ENGINE.ZXING, ENGINE.ZBAR].map((engine) => (
              <button
                key={engine}
                className="btn btn-secondary nfe-benchmark-btn-lg"
                type="button"
                disabled={cameraState !== 'ready' || (liveEngine && liveEngine !== engine)}
                onClick={() => runLiveTest(engine)}
              >
                {liveEngine === engine ? <RefreshCw className="spin" size={15} /> : null}
                Testar {ENGINE_LABEL[engine]}
              </button>
            ))}
          </div>

          {liveEngine ? (
            <p className="nfe-benchmark-hint" aria-live="polite">
              Testando {ENGINE_LABEL[liveEngine]}… {((liveTick?.elapsedMs || 0) / 1000).toFixed(1)}s / {LIVE_TEST_DURATION_MS / 1000}s ·
              {' '}{liveTick?.attempts || 0} tentativa(s)
            </p>
          ) : null}

          <div className="nfe-benchmark-results">
            {[ENGINE.NATIVE, ENGINE.ZXING, ENGINE.ZBAR].map((engine) =>
              liveResults[engine] ? <LiveResultRow key={engine} engine={engine} summary={liveResults[engine]} /> : null,
            )}
          </div>
        </section>

        <section className="nfe-benchmark-section">
          <button className="btn btn-secondary nfe-benchmark-btn-lg" type="button" onClick={handleCopyDiagnostics}>
            <Copy size={15} /> Copiar diagnóstico
          </button>
          {copyStatus ? <span className="nfe-benchmark-copy-status">{copyStatus}</span> : null}
        </section>
      </div>
    </div>
  )
}

function EngineResultRow({ result, labelOverride }) {
  const label = labelOverride || ENGINE_LABEL[result.engine] || result.engine
  return (
    <div className="nfe-benchmark-result-row">
      <strong>{label}</strong>
      {!result.available ? (
        <span className="nfe-benchmark-result-line">Indisponível neste navegador</span>
      ) : (
        <>
          <span className="nfe-benchmark-result-line">
            {result.detected ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {result.detected ? 'CODE128 detectado' : 'Não detectou'}
            {result.detected ? ` · ${result.digitCount} dígito(s)` : ''}
          </span>
          <span className="nfe-benchmark-result-line">
            DV NF-e: {result.detected ? (result.validNfeKey ? 'válido' : 'inválido') : 'N/D'} · {result.decodeTimeMs != null ? `${result.decodeTimeMs}ms` : 'N/D'}
          </span>
          {result.error ? <span className="nfe-benchmark-result-line nfe-benchmark-result-error">Erro: {result.error}</span> : null}
        </>
      )}
    </div>
  )
}

function LiveResultRow({ engine, summary }) {
  const label = ENGINE_LABEL[engine] || engine
  const outcomeText = summary.outcome === 'found' ? 'Chave válida encontrada' : summary.outcome === 'timeout' ? `Não detectou em ${LIVE_TEST_DURATION_MS / 1000}s` : 'Interrompido'
  return (
    <div className="nfe-benchmark-result-row">
      <strong>{label}</strong>
      <span className="nfe-benchmark-result-line">{outcomeText}</span>
      <span className="nfe-benchmark-result-line">
        {summary.attempts} tentativa(s) · {summary.elapsedMs}ms
        {summary.anyBarcodeDetectedAtMs != null ? ` · 1º barcode em ${summary.anyBarcodeDetectedAtMs}ms` : ''}
      </span>
    </div>
  )
}
