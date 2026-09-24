import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, PencilLine, RefreshCw, Upload, X } from 'lucide-react'
import { buildConstraints } from './liveScanner.js'
import { describeError } from './NfeLiveScanner.jsx'
import { blobToCanvas, isImageCaptureSupported, takePhotoViaImageCapture } from './photoCapture.js'
import { analyzeNfeCanvas } from './extractor.js'

const STATE = {
  REQUESTING: 'requesting_permission',
  PREVIEW: 'preview',
  CAPTURING: 'capturing',
  FOUND: 'found',
  FAILED: 'failed',
  ERROR: 'error',
}

/**
 * Tela de "Fotografar código da NF-e" — caminho principal quando o
 * `BarcodeDetector` nativo não existe (ou quando o live fast path expira,
 * ver `NfeLiveScanner.jsx`/`NfeReaderPage.jsx`).
 *
 * Método A: `ImageCapture` API sobre a MediaStreamTrack de vídeo já aberta
 * (`photoCapture.js`) — preview ao vivo nesta própria tela, com moldura
 * horizontal larga. Método B, fallback automático (feature detection, nunca
 * user-agent): se `ImageCapture` não existir OU `takePhoto()` lançar em
 * tempo de execução, esta tela se fecha e `onFallbackToFilePicker()` aciona
 * o MESMO input de câmera nativo já usado por "Tirar foto"
 * (`NfeReaderPage.jsx`, `cameraInputRef`) — sem duplicar esse caminho.
 *
 * A foto capturada por `ImageCapture` é analisada com `analyzeNfeCanvas`
 * (extractor.js) — o MESMO pipeline robusto (fast path ZBar/ZXing → recorte/
 * margem/deskew → OCR) usado em qualquer outra foto do módulo, nunca uma
 * lógica de decodificação paralela.
 */
export default function NfePhotoCapture({ open, onClose, onKeyFound, onFallbackToFilePicker, onManualFill }) {
  const videoRef = useRef(null)
  const cancelButtonRef = useRef(null)
  const streamRef = useRef(null)
  const [state, setState] = useState(STATE.REQUESTING)
  const [errorMessage, setErrorMessage] = useState('')
  const [failureMessage, setFailureMessage] = useState('')
  const [lastFailedResult, setLastFailedResult] = useState(null)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const fallbackToFilePicker = useCallback(() => {
    stopStream()
    onFallbackToFilePicker?.()
  }, [stopStream, onFallbackToFilePicker])

  // Abre a câmera para o preview desta tela (Método A) — só se ImageCapture
  // existir; sem suporte, nem tenta: encaminha direto pro Método B (input de
  // câmera nativo), sem mostrar uma tela quebrada.
  useEffect(() => {
    if (!open) return undefined
    if (!isImageCaptureSupported()) {
      console.debug('[NFe][foto] ImageCapture indisponível neste navegador — usando input de câmera nativo.')
      fallbackToFilePicker()
      return undefined
    }

    let cancelled = false
    setState(STATE.REQUESTING)
    setErrorMessage('')
    setFailureMessage('')
    setLastFailedResult(null)
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
        setState(STATE.PREVIEW)
        cancelButtonRef.current?.focus()
      } catch (err) {
        if (cancelled) return
        console.error('[NFe][foto] Falha ao abrir câmera para captura de foto.', { name: err?.name, message: err?.message })
        setErrorMessage(describeError(err))
        setState(STATE.ERROR)
      }
    })()

    return () => {
      cancelled = true
      stopStream()
    }
  }, [open, fallbackToFilePicker, stopStream])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        stopStream()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, stopStream])

  const handleCancel = () => {
    stopStream()
    onClose()
  }

  const handleCapture = async () => {
    const stream = streamRef.current
    const videoTrack = stream?.getVideoTracks()?.[0]
    if (!videoTrack) return

    let blob
    try {
      blob = await takePhotoViaImageCapture(videoTrack)
    } catch (err) {
      // takePhoto() pode lançar dependendo do aparelho mesmo com ImageCapture
      // presente (comportamento inconsistente entre implementações) — cai
      // para o input de câmera nativo em vez de travar a tela.
      console.debug('[NFe][foto] takePhoto() falhou — usando input de câmera nativo.', { name: err?.name, message: err?.message })
      fallbackToFilePicker()
      return
    }

    setState(STATE.CAPTURING)
    setFailureMessage('')
    try {
      const { canvas, originalWidth, originalHeight, width, height, downscaled } = await blobToCanvas(blob)
      if (import.meta.env.DEV) {
        console.debug('[NFe][foto] arquivo capturado:', { tipo: blob.type, tamanhoBytes: blob.size })
        console.debug('[NFe][foto] imagem recebida:', `${originalWidth}x${originalHeight}`)
        console.debug(
          '[NFe][foto] imagem entregue ao ZBar e ao ZXing (mesmo canvas, sem redução adicional entre um e outro):',
          `${width}x${height}${downscaled ? ' (reduzida por segurança de memória — ver log acima)' : ''}`,
        )
      }

      const result = await analyzeNfeCanvas(canvas)
      if (result.chaveValida) {
        setState(STATE.FOUND)
        navigator.vibrate?.(100)
        window.setTimeout(() => {
          onKeyFound(result.chaveInterpretada.chave)
          onClose()
        }, 550)
      } else {
        setLastFailedResult(result)
        setFailureMessage(result.warnings[0] || 'Não conseguimos ler o código de barras.')
        setState(STATE.FAILED)
      }
    } catch (err) {
      console.error('[NFe][foto] Falha ao processar a foto capturada.', { name: err?.name, message: err?.message })
      setFailureMessage('Não conseguimos ler o código de barras.')
      setState(STATE.FAILED)
    }
  }

  const handleRetry = () => {
    setFailureMessage('')
    setLastFailedResult(null)
    setState(STATE.PREVIEW)
  }

  const handleManualFill = () => {
    stopStream()
    onManualFill?.(lastFailedResult)
  }

  if (!open) return null

  return (
    <div className="nfe-scanner-overlay" role="dialog" aria-modal="true" aria-label="Fotografar código da NF-e">
      <header className="nfe-scanner-header">
        <button className="nfe-scanner-cancel" type="button" onClick={handleCancel} ref={cancelButtonRef}>
          <X size={18} /> Cancelar
        </button>
        <strong>Fotografar código da NF-e</strong>
        <span className="nfe-scanner-header-spacer" aria-hidden="true" />
      </header>

      <div className="nfe-scanner-stage">
        <video ref={videoRef} className="nfe-scanner-video" playsInline muted autoPlay />

        {state === STATE.PREVIEW ? (
          <div className="nfe-photocapture-frame">
            <span className="nfe-photocapture-frame-box" aria-hidden="true" />
            <p className="nfe-scanner-hint">Enquadre o código inteiro e deixe espaço nas laterais.</p>
          </div>
        ) : null}

        {state === STATE.CAPTURING ? (
          <div className="nfe-scanner-feedback">
            <RefreshCw className="spin" size={26} />
            <strong>Analisando código…</strong>
          </div>
        ) : null}

        {state === STATE.FAILED ? (
          <div className="nfe-scanner-feedback nfe-scanner-feedback-error">
            <AlertTriangle size={26} />
            <strong>Não conseguimos ler o código de barras.</strong>
            <p>{failureMessage}</p>
          </div>
        ) : null}

        {state === STATE.FOUND ? (
          <div className="nfe-scanner-feedback nfe-scanner-feedback-ok">
            <span className="nfe-scanner-success-ring">
              <CheckCircle2 size={40} />
            </span>
            <strong>Chave da NF-e localizada</strong>
          </div>
        ) : null}

        {state === STATE.REQUESTING ? (
          <div className="nfe-scanner-feedback">
            <RefreshCw className="spin" size={26} />
            <strong>Solicitando acesso à câmera…</strong>
          </div>
        ) : null}

        {state === STATE.ERROR ? (
          <div className="nfe-scanner-feedback nfe-scanner-feedback-error">
            <AlertTriangle size={26} />
            <p>{errorMessage}</p>
            <button className="btn btn-secondary btn-sm" type="button" onClick={fallbackToFilePicker}>
              Usar "Selecionar arquivo"
            </button>
          </div>
        ) : null}
      </div>

      <footer className="nfe-scanner-footer nfe-photocapture-footer">
        {state === STATE.PREVIEW ? (
          <button className="btn btn-primary nfe-photocapture-shutter" type="button" onClick={handleCapture}>
            <Camera size={18} /> Fotografar código
          </button>
        ) : null}

        {state === STATE.FAILED ? (
          <div className="nfe-photocapture-failed-actions">
            <button className="btn btn-primary" type="button" onClick={handleRetry}>
              <Camera size={16} /> Tirar outra foto
            </button>
            <button className="btn btn-secondary" type="button" onClick={fallbackToFilePicker}>
              <Upload size={16} /> Selecionar arquivo
            </button>
            <button className="btn btn-secondary" type="button" onClick={handleManualFill}>
              <PencilLine size={16} /> Preencher manualmente
            </button>
          </div>
        ) : null}
      </footer>
    </div>
  )
}
