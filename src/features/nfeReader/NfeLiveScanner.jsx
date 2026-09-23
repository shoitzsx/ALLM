import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Flashlight, FlashlightOff, RefreshCw, SwitchCamera, X } from 'lucide-react'
import { listCameras, startLiveScan } from './liveScanner.js'

const STATE = {
  REQUESTING: 'requesting_permission',
  SCANNING: 'scanning',
  FOUND: 'found',
  ERROR: 'error',
  PAUSED: 'paused',
}

function isSecureContextForCamera() {
  if (window.isSecureContext) return true
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

function describeError(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
    return 'Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador ou use "Selecionar arquivo".'
  }
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
    return 'Nenhuma câmera compatível foi encontrada neste dispositivo.'
  }
  if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
    return 'Não foi possível acessar a câmera — ela pode estar em uso por outro aplicativo.'
  }
  if (!isSecureContextForCamera()) {
    return 'A câmera exige conexão segura (HTTPS). Em desenvolvimento local use "localhost"; um endereço de IP em http:// não tem acesso à câmera em celulares.'
  }
  return 'Não foi possível iniciar a câmera. Use "Selecionar arquivo" como alternativa.'
}

/**
 * Scanner de código de barras ao vivo, em tela cheia. Só existe enquanto
 * `open` é `true`: abre a câmera ao montar/abrir, encerra a câmera (ZXing +
 * todas as tracks do MediaStream) ao fechar por qualquer motivo — cancelar,
 * chave encontrada, aba perder visibilidade, ou o componente deixar de estar
 * aberto. Nunca deixa a câmera ligada "esquecida" em segundo plano.
 */
export default function NfeLiveScanner({ open, onClose, onKeyFound }) {
  const videoRef = useRef(null)
  const cancelButtonRef = useRef(null)
  const controlsRef = useRef(null)
  const [state, setState] = useState(STATE.REQUESTING)
  const [errorMessage, setErrorMessage] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [cameras, setCameras] = useState([])
  const [cameraIndex, setCameraIndex] = useState(0)

  const stopScan = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
  }, [])

  const start = useCallback(
    async (deviceId) => {
      setState(STATE.REQUESTING)
      setErrorMessage('')
      setTorchOn(false)
      try {
        const controls = await startLiveScan({
          videoElement: videoRef.current,
          deviceId,
          onValidKey: (chave) => {
            setState(STATE.FOUND)
            navigator.vibrate?.(100)
            window.setTimeout(() => {
              onKeyFound(chave)
              onClose()
            }, 550)
          },
        })
        controlsRef.current = controls
        setTorchAvailable(Boolean(controls.switchTorch))
        setState(STATE.SCANNING)
        const list = await listCameras()
        setCameras(list)
      } catch (err) {
        console.error('[NFe][scanner] Falha ao iniciar câmera.', { name: err?.name, message: err?.message })
        setErrorMessage(describeError(err))
        setState(STATE.ERROR)
      }
    },
    [onKeyFound, onClose],
  )

  // Abre a câmera quando o scanner é aberto; para tudo ao fechar/desmontar.
  useEffect(() => {
    if (!open) return undefined
    start(undefined)
    cancelButtonRef.current?.focus()
    return () => stopScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Não deixa a câmera ligada em segundo plano: para ao perder visibilidade,
  // retoma (se o scanner ainda estiver aberto) ao voltar a ficar visível.
  useEffect(() => {
    if (!open) return undefined
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopScan()
        setState((current) => (current === STATE.FOUND ? current : STATE.PAUSED))
      } else if (document.visibilityState === 'visible') {
        setState((current) => {
          if (current === STATE.PAUSED) start(cameras[cameraIndex]?.deviceId)
          return current
        })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [open, start, stopScan, cameras, cameraIndex])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        stopScan()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, stopScan])

  const toggleTorch = async () => {
    if (!controlsRef.current?.switchTorch) return
    try {
      await controlsRef.current.switchTorch(!torchOn)
      setTorchOn((current) => !current)
    } catch (err) {
      console.error('[NFe][scanner] Falha ao acionar lanterna.', { name: err?.name, message: err?.message })
    }
  }

  const switchCamera = () => {
    if (cameras.length < 2) return
    stopScan()
    const nextIndex = (cameraIndex + 1) % cameras.length
    setCameraIndex(nextIndex)
    start(cameras[nextIndex].deviceId)
  }

  const handleCancel = () => {
    stopScan()
    onClose()
  }

  if (!open) return null

  return (
    <div className="nfe-scanner-overlay" role="dialog" aria-modal="true" aria-label="Escanear código de barras da NF-e">
      <header className="nfe-scanner-header">
        <button className="nfe-scanner-cancel" type="button" onClick={handleCancel} ref={cancelButtonRef}>
          <X size={18} /> Cancelar
        </button>
        <strong>Escanear NF-e</strong>
        <span className="nfe-scanner-header-spacer" aria-hidden="true" />
      </header>

      <div className="nfe-scanner-stage">
        <video ref={videoRef} className="nfe-scanner-video" playsInline muted autoPlay />

        {state === STATE.SCANNING ? (
          <div className="nfe-scanner-frame">
            <span className="nfe-scanner-frame-box" aria-hidden="true" />
            <p>Posicione o código de barras da NF-e dentro da área</p>
          </div>
        ) : null}

        {state === STATE.FOUND ? (
          <div className="nfe-scanner-feedback nfe-scanner-feedback-ok">
            <CheckCircle2 size={40} />
            <strong>Chave da NF-e localizada</strong>
          </div>
        ) : null}

        {state === STATE.REQUESTING ? (
          <div className="nfe-scanner-feedback">
            <RefreshCw className="spin" size={26} />
            <strong>Solicitando acesso à câmera…</strong>
          </div>
        ) : null}

        {state === STATE.PAUSED ? (
          <div className="nfe-scanner-feedback">
            <strong>Câmera pausada</strong>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => start(cameras[cameraIndex]?.deviceId)}>
              Retomar
            </button>
          </div>
        ) : null}

        {state === STATE.ERROR ? (
          <div className="nfe-scanner-feedback nfe-scanner-feedback-error">
            <AlertTriangle size={26} />
            <p>{errorMessage}</p>
            <button className="btn btn-secondary btn-sm" type="button" onClick={handleCancel}>
              Usar "Selecionar arquivo"
            </button>
          </div>
        ) : null}
      </div>

      <footer className="nfe-scanner-footer">
        <span className="nfe-scanner-status" aria-live="polite">
          {state === STATE.SCANNING ? 'Câmera ativa — aponte para o código de barras' : null}
          {state === STATE.REQUESTING ? 'Aguardando permissão da câmera' : null}
          {state === STATE.FOUND ? 'Chave localizada' : null}
          {state === STATE.ERROR ? 'Câmera indisponível' : null}
          {state === STATE.PAUSED ? 'Câmera pausada' : null}
        </span>
        <div className="nfe-scanner-footer-actions">
          {torchAvailable ? (
            <button
              className="icon-button nfe-scanner-icon-btn"
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? 'Desligar lanterna' : 'Ligar lanterna'}
            >
              {torchOn ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
            </button>
          ) : null}
          {cameras.length > 1 ? (
            <button className="icon-button nfe-scanner-icon-btn" type="button" onClick={switchCamera} aria-label="Trocar câmera">
              <SwitchCamera size={18} />
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  )
}
