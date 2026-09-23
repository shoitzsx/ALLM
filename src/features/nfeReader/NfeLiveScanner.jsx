import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, Flashlight, FlashlightOff, RefreshCw, SwitchCamera, X } from 'lucide-react'
import { captureCurrentFrame, listCameras, startLiveScan } from './liveScanner.js'
import { analyzeNfeCanvas } from './extractor.js'

const STATE = {
  REQUESTING: 'requesting_permission',
  SCANNING: 'scanning',
  CAPTURING: 'capturing',
  FOUND: 'found',
  ERROR: 'error',
  PAUSED: 'paused',
}

function isSecureContextForCamera() {
  if (window.isSecureContext) return true
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

// Dicas por tempo enquanto SCANNING — nunca progresso falso ("50%", "quase
// pronto"), só orientação. Só uma visível por vez; avança por tempo decorrido
// (setTimeout, 2 timers, não um estado por tentativa de decode). Zerado a
// cada novo `start()` (nova câmera, retomar de pausa, etc.).
const HINT_STAGE_AFTER_MS = [3000, 7000]

// "Capturar e analisar" só aparece depois de um tempo — não de cara, senão
// vira o caminho padrão em vez de saída de emergência para quando a leitura
// contínua está demorando.
const CAPTURE_BUTTON_AFTER_MS = 6000

function hintForStage(stage, torchAvailable, isPortrait) {
  // Nunca sugerir aproximar demais: isso corta a quiet zone (margem clara)
  // que o CODE_128 precisa nas laterais para ser decodificado.
  if (stage === 0) return 'Enquadre o código inteiro e deixe espaço nas laterais.'
  if (stage === 1) return 'Mantenha o código centralizado e estável.'
  if (isPortrait) return 'Para facilitar a leitura, tente girar o celular.'
  return torchAvailable ? 'Deixe o código inteiro visível e use a lanterna.' : 'Aproxime a câmera com cuidado, sem cortar as laterais.'
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
  const [hintStage, setHintStage] = useState(0)
  const [showCaptureButton, setShowCaptureButton] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')
  const [isPortrait, setIsPortrait] = useState(
    () => window.matchMedia?.('(orientation: portrait)').matches ?? true,
  )
  // Só para um painel de diagnóstico em desenvolvimento (import.meta.env.DEV)
  // — nunca visível em produção. Ver decodeDiagnostics.js/liveScanner.js.
  const [diagnostics, setDiagnostics] = useState(null)
  const [streamInfo, setStreamInfo] = useState(null)

  const stopScan = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
  }, [])

  const start = useCallback(
    async (deviceId) => {
      setState(STATE.REQUESTING)
      setErrorMessage('')
      setCaptureMessage('')
      setTorchOn(false)
      setHintStage(0)
      setShowCaptureButton(false)
      setDiagnostics(null)
      setStreamInfo(null)

      const attemptStart = (id) =>
        startLiveScan({
          videoElement: videoRef.current,
          deviceId: id,
          onValidKey: (chave) => {
            setState(STATE.FOUND)
            navigator.vibrate?.(100)
            window.setTimeout(() => {
              onKeyFound(chave)
              onClose()
            }, 550)
          },
          ...(import.meta.env.DEV
            ? { onDiagnostics: setDiagnostics, onStreamReady: setStreamInfo }
            : null),
        })

      try {
        let controls
        try {
          controls = await attemptStart(deviceId)
        } catch (err) {
          // Um deviceId específico (troca de câmera, retomar após pausa/captura)
          // pode deixar de resolver entre uma chamada de getUserMedia e a
          // próxima (observado mesmo sem trocar de aparelho). Antes de mostrar
          // erro ao usuário, tenta de novo sem fixar o dispositivo — mesma
          // câmera preferencial por `facingMode`, só não trava num id específico.
          if (err?.name !== 'NotFoundError' || !deviceId) throw err
          console.debug('[NFe][scanner] deviceId não resolveu, tentando de novo sem fixar câmera.')
          controls = await attemptStart(undefined)
        }
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

  // Dica temporizada: só 2 timers agendados uma vez por sessão de leitura, não
  // um setState por tentativa de decode. A animação em si (linha do scanner)
  // é 100% CSS e roda independente disso — isto só troca uma linha de texto.
  useEffect(() => {
    if (state !== STATE.SCANNING) return undefined
    const timers = HINT_STAGE_AFTER_MS.map((delay, index) =>
      window.setTimeout(() => setHintStage(index + 1), delay),
    )
    return () => timers.forEach((timerId) => window.clearTimeout(timerId))
  }, [state])

  // "Capturar e analisar" só aparece depois de alguns segundos sem sucesso —
  // saída de emergência, não o caminho padrão. Mesmo padrão de timer único,
  // não ligado a tentativas de decode.
  useEffect(() => {
    if (state !== STATE.SCANNING) return undefined
    const timerId = window.setTimeout(() => setShowCaptureButton(true), CAPTURE_BUTTON_AFTER_MS)
    return () => window.clearTimeout(timerId)
  }, [state])

  // Orientação do aparelho — só para trocar o texto da dica (nunca trava a
  // tela numa orientação; ver hintForStage).
  useEffect(() => {
    const mediaQuery = window.matchMedia('(orientation: portrait)')
    const onChange = () => setIsPortrait(mediaQuery.matches)
    mediaQuery.addEventListener?.('change', onChange)
    return () => mediaQuery.removeEventListener?.('change', onChange)
  }, [])

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

  /**
   * Saída de emergência quando a leitura contínua está demorando: captura o
   * frame atual (Canvas, sem passar por File — `captureCurrentFrame`,
   * liveScanner.js) e reaproveita o MESMO pipeline robusto de código de
   * barras/OCR do upload/foto (`analyzeNfeCanvas`, extractor.js — recortes,
   * contraste, margem artificial, deskew, e OCR se nada disso resolver). Se
   * não encontrar nada, retoma a leitura contínua em vez de travar a tela.
   */
  const handleCaptureAndAnalyze = async () => {
    const video = videoRef.current
    if (!video) return
    stopScan()
    setState(STATE.CAPTURING)
    setCaptureMessage('')
    try {
      const canvas = captureCurrentFrame(video)
      const result = await analyzeNfeCanvas(canvas)
      if (result.chaveValida) {
        setState(STATE.FOUND)
        navigator.vibrate?.(100)
        window.setTimeout(() => {
          onKeyFound(result.chaveInterpretada.chave)
          onClose()
        }, 550)
      } else {
        const message = result.warnings[0] || 'Não foi possível localizar uma chave nesta captura.'
        // Dá tempo do usuário ler o aviso antes de `start()` reativar a câmera
        // e limpar `captureMessage` — retomar de imediato apagaria a mensagem
        // no mesmo instante em que ela apareceria.
        setCaptureMessage(message)
        window.setTimeout(() => start(cameras[cameraIndex]?.deviceId), 2000)
      }
    } catch (err) {
      console.error('[NFe][scanner] Falha ao capturar/analisar o frame.', { name: err?.name, message: err?.message })
      setCaptureMessage('Não foi possível analisar a imagem capturada.')
      window.setTimeout(() => start(cameras[cameraIndex]?.deviceId), 2000)
    }
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
            <span className="nfe-scanner-frame-box" aria-hidden="true">
              <span className="nfe-scanner-scanline" aria-hidden="true" />
            </span>
            <div className="nfe-scanner-copy">
              <p className="nfe-scanner-reading">
                Lendo código de barras<span className="nfe-scanner-dot" aria-hidden="true" />
              </p>
              <p className="nfe-scanner-hint">{hintForStage(hintStage, torchAvailable, isPortrait)}</p>
            </div>
            {showCaptureButton ? (
              <button className="nfe-scanner-capture-btn" type="button" onClick={handleCaptureAndAnalyze}>
                <Camera size={15} /> Capturar e analisar
              </button>
            ) : null}
          </div>
        ) : null}

        {state === STATE.CAPTURING ? (
          <div className="nfe-scanner-feedback">
            {captureMessage ? (
              <>
                <AlertTriangle size={26} />
                <strong>Nenhuma chave encontrada</strong>
                <p>{captureMessage}</p>
                <p className="nfe-scanner-hint">Retomando a leitura…</p>
              </>
            ) : (
              <>
                <RefreshCw className="spin" size={26} />
                <strong>Analisando imagem capturada…</strong>
              </>
            )}
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
          {state === STATE.CAPTURING ? 'Analisando captura' : null}
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

      {import.meta.env.DEV ? <DevDiagnosticsPanel diagnostics={diagnostics} streamInfo={streamInfo} /> : null}
    </div>
  )
}

/**
 * Painel de diagnóstico só em desenvolvimento (`import.meta.env.DEV`) — nunca
 * embutido/visível numa build de produção. Mostra o que `onDiagnostics`/
 * `onStreamReady` (liveScanner.js) reportam: tentativas, o que cada uma
 * classificou como (decodeDiagnostics.js), resolução real da câmera e tempo
 * decorrido. Nunca mostra a chave em si — só contagens.
 */
function DevDiagnosticsPanel({ diagnostics, streamInfo }) {
  return (
    <div className="nfe-scanner-devpanel">
      <strong>DEV</strong>
      {streamInfo ? (
        <span>
          {streamInfo.width}×{streamInfo.height} · pronta em {streamInfo.readyMs}ms
        </span>
      ) : null}
      {diagnostics ? (
        <span>
          tentativas {diagnostics.attempts} · não_encontrado {diagnostics.not_found} · tam_inválido{' '}
          {diagnostics.invalid_length} · dv_inválido {diagnostics.invalid_dv} · {Math.round(diagnostics.elapsedMs / 100) / 10}s
        </span>
      ) : (
        <span>aguardando tentativas…</span>
      )}
    </div>
  )
}
