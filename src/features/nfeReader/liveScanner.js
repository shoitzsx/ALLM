/**
 * Leitura contínua de CODE_128 ao vivo pela câmera traseira, para o scanner
 * de "Leitura automática de NF-e" em celular/tablet.
 *
 * Dois decoders possíveis, nunca os dois ao mesmo tempo (ver `startLiveScan`
 * mais abaixo para a decisão de arquitetura):
 *
 *   - `BarcodeDetector` nativo do navegador, quando disponível e com suporte
 *     a `code_128` (`nativeBarcodeDetector.js`) — mais rápido, mas só existe
 *     em Chromium/Chrome/Edge/Android Chrome.
 *   - @zxing/browser (já usado por barcodeReader.js), universal — o caminho
 *     que continua funcionando em qualquer navegador, incluindo Safari/iOS,
 *     onde `BarcodeDetector` não existe.
 *
 * O caminho ZXing usa os MESMOS hints de decodificação (`buildCode128Hints`,
 * barcodeReader.js) — sem `DecodeHintType.TRY_HARDER`, pela mesma razão
 * documentada lá: esse hint dispara `image.rotateCounterClockwise()` dentro
 * do `OneDReader.decode` do ZXing ao falhar a primeira tentativa, e essa
 * rotação interna tenta criar um canvas temporário próprio — o caminho exato
 * do erro "Could not create a Canvas element." já visto em produção.
 * `decodeFromConstraints` roda o MESMO `decodeFromCanvas` por trás dos panos
 * a cada frame (ver node_modules/@zxing/browser/esm/readers/
 * BrowserCodeReader.js, método `scan`), então sem TRY_HARDER nos hints o bug
 * simplesmente não pode disparar aqui também.
 *
 * Qualquer texto decodificado — nativo ou ZXing — passa pela MESMA validação
 * de chave de NF-e usada no resto do módulo (`normalizarChave` +
 * `validarChaveNFe`, chaveNFe.js) antes de ser aceito: nenhuma validação
 * paralela. Um CODE_128 que não seja uma chave válida de 44 dígitos com DV
 * correto é ignorado e a leitura continua — evita falso positivo com outros
 * códigos de barras (etiqueta, código de produto, código da transportadora)
 * que a câmera possa enxergar.
 *
 * Este arquivo depende de APIs de navegador (getUserMedia, HTMLVideoElement)
 * e não roda no test runner do Node — mesma situação de barcodeReader.js/
 * ocrReader.js/pdfExtractor.js (ver README.md, seção "Testes").
 */
import { BrowserMultiFormatReader } from '@zxing/browser'
import { buildCode128Hints } from './barcodeReader.js'
import { normalizarChave, validarChaveNFe } from './chaveNFe.js'
import { isNativeCode128Supported } from './nativeBarcodeDetector.js'
import { classifyDecodedText, createDiagnosticsCounter, DECODE_OUTCOME } from './decodeDiagnostics.js'

// Mais ágil que o padrão da lib (500ms/500ms): a decodificação em si é barata
// (mesmo decodeFromCanvas de sempre sobre um frame de vídeo), o gargalo real
// é a câmera entregar frames — não há necessidade de esperar tanto entre
// tentativas para uma leitura ao vivo parecer responsiva. 100ms é o valor
// pedido para testar (~10 tentativas/s no teto); se isso se mostrar pesado
// demais em aparelho físico (CPU/bateria/temperatura), suba de volta para
// algo entre 150-200ms — é só este número, nada mais no pipeline depende dele.
// Mantido em 100ms nesta rodada (ver README): o problema investigado não era
// falta de tentativas, era o pipeline nunca corrigir pequena inclinação —
// isso já foi endereçado em barcodeReader.js/estágio de deskew, não aqui.
const SCAN_DELAY_MS = 100
const SCAN_OPTIONS = {
  delayBetweenScanAttempts: SCAN_DELAY_MS,
  delayBetweenScanSuccess: 400,
}

// 1280x720 (HD) em vez de 1920x1080 (Full HD): a chave de 44 dígitos em
// CODE_128 não precisa da resolução máxima da câmera para ficar legível — é
// texto/barras relativamente grandes na página, não letras miúdas. HD reduz
// a quantidade de pixels que o decoder varre a cada tentativa (menos de 60%
// dos pixels de 1080p) sem deixar as barras finas do código ilegíveis.
// `ideal` (nunca `exact`): o navegador ainda negocia livremente com o
// hardware disponível, sem falhar em câmeras que não entreguem exatamente
// 1280x720. Mantido nesta rodada — o problema investigado (foto só do
// código de barras falhando) não tinha evidência de ser falta de resolução;
// ver relatório.
const CAMERA_WIDTH_IDEAL = 1280
const CAMERA_HEIGHT_IDEAL = 720

// Diagnóstico ao vivo (painel de dev, NfeLiveScanner.jsx) é atualizado no
// máximo a este intervalo — nunca a cada tentativa individual, que a essa
// cadência seria ~10 renders React por segundo à toa.
const DIAGNOSTICS_THROTTLE_MS = 500

/**
 * Lista as câmeras disponíveis. Os `label`s só vêm preenchidos depois que a
 * permissão de câmera já foi concedida pelo menos uma vez nesta origem —
 * chamar isso após o primeiro `startLiveScan` bem-sucedido, não antes.
 * Nunca lança: falha em enumerar devolve lista vazia.
 */
export async function listCameras() {
  try {
    return await BrowserMultiFormatReader.listVideoInputDevices()
  } catch (err) {
    console.error('[NFe][scanner] Não foi possível listar câmeras.', { name: err?.name, message: err?.message })
    return []
  }
}

/**
 * Captura o frame atual de um `<video>` já em reprodução para um canvas novo
 * — usado pela ação "Capturar e analisar" (NfeLiveScanner.jsx). Devolve um
 * Canvas, não um File: quem chamar pode passar direto para
 * `analyzeNfeCanvas`/`readCode128FromCanvas` sem serializar para
 * PNG/JPEG só para ler de volta depois.
 */
export function captureCurrentFrame(videoElement) {
  const canvas = document.createElement('canvas')
  canvas.width = videoElement.videoWidth
  canvas.height = videoElement.videoHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Canvas 2D indisponível ao capturar o frame da câmera.')
  }
  ctx.drawImage(videoElement, 0, 0)
  return canvas
}

/**
 * Aplica foco contínuo quando a câmera realmente expõe suporte a isso — pura
 * feature detection, igual ao torch. Recebe um pequeno adaptador
 * `{ getCapabilities, applyConstraints }` em vez de acoplar direto aos
 * controls do ZXing ou a um MediaStreamTrack, para funcionar nos dois
 * decoders (ver `adaptZxingControls`/`adaptMediaStreamTrack` abaixo) sem
 * duplicar esta lógica. Sem suporte (ex.: Safari, que historicamente não
 * expõe `getCapabilities()` em todo dispositivo), simplesmente não faz nada
 * — nunca lança, nunca esconde o scanner.
 *
 * Diagnóstico (dev only): loga `focusMode`/largura/altura reais das
 * capabilities quando disponíveis, e a mera disponibilidade de
 * `focusDistance`/`zoom` (sem alterar zoom — fora de escopo nesta rodada).
 */
async function tryApplyContinuousFocus(adapter) {
  try {
    const capabilities = adapter.getCapabilities?.()
    if (!capabilities) return false
    console.debug('[NFe][scanner] capabilities da câmera:', {
      focusMode: capabilities.focusMode,
      width: capabilities.width,
      height: capabilities.height,
      focusDistanceDisponivel: 'focusDistance' in capabilities,
      zoomDisponivel: 'zoom' in capabilities,
    })
    if (!capabilities.focusMode?.includes?.('continuous')) return false
    await adapter.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
    return true
  } catch (err) {
    console.debug('[NFe][scanner] foco contínuo não aplicado (sem suporte ou falha ao negociar).', {
      name: err?.name,
      message: err?.message,
    })
    return false
  }
}

function adaptZxingControls(controls) {
  return {
    getCapabilities: () => controls.streamVideoCapabilitiesGet?.(() => true),
    applyConstraints: (constraints) => controls.streamVideoConstraintsApply(constraints),
  }
}

function adaptMediaStreamTrack(track) {
  return {
    getCapabilities: () => track.getCapabilities?.(),
    applyConstraints: (constraints) => track.applyConstraints(constraints),
  }
}

/**
 * Exportada para o benchmark de diagnóstico (NfeScannerBenchmark.jsx)
 * reaproveitar EXATAMENTE a mesma configuração de câmera usada em produção
 * (1280x720 ideal, facingMode environment) — requisito do benchmark: os três
 * engines precisam ser comparados sob a mesma configuração de câmera, nunca
 * uma configuração diferente por decoder.
 */
export function buildConstraints(deviceId) {
  return {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: CAMERA_WIDTH_IDEAL },
      height: { ideal: CAMERA_HEIGHT_IDEAL },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  }
}

/** Cria o callback comum de "cheguei num texto decodificado" — validação, diagnóstico e disparo de sucesso, iguais nos dois decoders. */
function createResultHandler({ startedAt, onValidKey, onDecodeAttempt, onDiagnostics }) {
  const diagnostics = createDiagnosticsCounter()
  let found = false
  let lastDiagnosticsEmitAt = 0

  const handle = (rawText) => {
    if (found) return false
    const outcome = classifyDecodedText(rawText)
    diagnostics.record(outcome)
    onDecodeAttempt?.()

    const now = performance.now()
    if (onDiagnostics && now - lastDiagnosticsEmitAt >= DIAGNOSTICS_THROTTLE_MS) {
      lastDiagnosticsEmitAt = now
      onDiagnostics({ ...diagnostics.summary(), elapsedMs: Math.round(now - startedAt) })
    }

    if (outcome !== DECODE_OUTCOME.VALID) return false
    found = true
    const chave = normalizarChave(rawText)
    const summary = diagnostics.summary()
    const elapsedS = ((now - startedAt) / 1000).toFixed(1)
    console.debug(`[NFe][scanner] chave encontrada em ${elapsedS}s após ${summary.attempts} tentativa(s)`)
    onValidKey(chave)
    return true
  }

  return { handle, isFound: () => found, diagnostics }
}

/** Caminho ZXing (universal) — decodeFromConstraints cuida de getUserMedia, torch, lifecycle. */
async function startZxingLiveScan({ videoElement, deviceId, startedAt, onValidKey, onDecodeAttempt, onDiagnostics, onStreamReady }) {
  const reader = new BrowserMultiFormatReader(buildCode128Hints(), SCAN_OPTIONS)
  const resultHandler = createResultHandler({ startedAt, onValidKey, onDecodeAttempt, onDiagnostics })

  // O 3º argumento do callback (`liveControls`) é a mesma referência que este
  // `decodeFromConstraints` vai resolver mais abaixo — mas chega aqui de
  // forma síncrona a cada frame, então usamos ELE (não a variável de fora)
  // para parar a leitura imediatamente: o primeiro frame já pode decodificar
  // com sucesso antes deste `await` terminar de resolver.
  const controls = await reader.decodeFromConstraints(buildConstraints(deviceId), videoElement, (result, _err, liveControls) => {
    const text = result?.getText() || null
    if (resultHandler.handle(text)) liveControls.stop()
  })

  const settings = controls.streamVideoSettingsGet?.(() => true)
  logCameraReady(startedAt, settings)
  onStreamReady?.({ width: settings?.width, height: settings?.height, readyMs: Math.round(performance.now() - startedAt) })
  const focusApplied = await tryApplyContinuousFocus(adaptZxingControls(controls))
  if (focusApplied) console.debug('[NFe][scanner] foco contínuo aplicado (ZXing)')

  return {
    stop: () => {
      if (resultHandler.isFound()) return
      controls.stop()
    },
    switchTorch: typeof controls.switchTorch === 'function' ? controls.switchTorch : null,
  }
}

/**
 * Caminho nativo (`BarcodeDetector`) — mais rápido quando disponível, mas
 * precisamos gerenciar `getUserMedia`/lifecycle nós mesmos (o ZXing não
 * participa deste caminho, evitando dois decoders lendo o mesmo vídeo ao
 * mesmo tempo). Reusa as mesmas APIs padrão de MediaStreamTrack que o
 * @zxing/browser usa por baixo dos panos para torch/capabilities — não é
 * reinvenção, é a mesma plataforma.
 */
async function startNativeLiveScan({ videoElement, deviceId, startedAt, onValidKey, onDecodeAttempt, onDiagnostics, onStreamReady }) {
  const stream = await navigator.mediaDevices.getUserMedia(buildConstraints(deviceId))
  videoElement.srcObject = stream
  videoElement.muted = true
  videoElement.playsInline = true
  await videoElement.play().catch(() => {})

  const videoTrack = stream.getVideoTracks()[0]
  const detector = new globalThis.BarcodeDetector({ formats: ['code_128'] })
  const resultHandler = createResultHandler({ startedAt, onValidKey, onDecodeAttempt, onDiagnostics })

  let stopped = false
  let timeoutId = null

  const loop = async () => {
    if (stopped || resultHandler.isFound()) return
    let rawText = null
    try {
      const results = await detector.detect(videoElement)
      rawText = results?.[0]?.rawValue || null
    } catch (err) {
      // detect() pode lançar se o vídeo ainda não tiver um frame pronto — trata como "nada encontrado" e tenta de novo.
      console.debug('[NFe][scanner] BarcodeDetector.detect() falhou nesta tentativa.', { name: err?.name })
    }
    if (stopped) return
    if (resultHandler.handle(rawText)) return
    timeoutId = window.setTimeout(loop, SCAN_DELAY_MS)
  }
  loop()

  const nativeSettings = videoTrack.getSettings?.()
  logCameraReady(startedAt, nativeSettings)
  onStreamReady?.({ width: nativeSettings?.width, height: nativeSettings?.height, readyMs: Math.round(performance.now() - startedAt) })
  const focusApplied = await tryApplyContinuousFocus(adaptMediaStreamTrack(videoTrack))
  if (focusApplied) console.debug('[NFe][scanner] foco contínuo aplicado (nativo)')

  const capabilities = videoTrack.getCapabilities?.()
  const torchSupported = Boolean(capabilities?.torch)

  const stop = () => {
    if (stopped) return
    stopped = true
    window.clearTimeout(timeoutId)
    stream.getTracks().forEach((track) => track.stop())
  }

  return {
    stop,
    switchTorch: torchSupported
      ? async (on) => {
          await videoTrack.applyConstraints({ advanced: [{ torch: on }] })
        }
      : null,
  }
}

function logCameraReady(startedAt, settings) {
  const readyMs = Math.round(performance.now() - startedAt)
  console.debug(`[NFe][scanner] câmera pronta em ${readyMs}ms`)
  if (settings?.width && settings?.height) {
    console.debug(`[NFe][scanner] stream ${settings.width}x${settings.height}`)
  }
}

/**
 * Inicia a leitura contínua em um <video>, preferindo a câmera traseira.
 * Escolhe o decoder uma única vez por sessão de leitura: `BarcodeDetector`
 * nativo se o navegador suportar `code_128`, senão ZXing — nunca os dois ao
 * mesmo tempo (ver comentário de topo do arquivo).
 *
 * `onValidKey(chave)` é chamado no máximo uma vez, só quando um frame
 * decodifica para uma chave de NF-e válida — a leitura já está parada nesse
 * momento. `onDecodeAttempt` (opcional) é chamado a cada tentativa, sem
 * argumentos — usado só como heartbeat de atividade, se quem chamar quiser;
 * não é usado aqui para atualizar UI. `onDiagnostics(summary)` (opcional) é
 * chamado com os contadores de `decodeDiagnostics.js` + `elapsedMs`, no
 * máximo a cada `DIAGNOSTICS_THROTTLE_MS` — pensado para um painel de debug
 * em desenvolvimento (NfeLiveScanner.jsx), nunca visível em produção.
 * `onStreamReady({ width, height, readyMs })` (opcional) é chamado uma única
 * vez, quando a câmera fica pronta — mesma finalidade de diagnóstico.
 *
 * Erros de `getUserMedia` (permissão negada, sem câmera, etc.) propagam para
 * quem chamou — não são tratados aqui, a mensagem amigável é responsabilidade
 * da UI (NfeLiveScanner.jsx).
 *
 * Retorna `{ stop, switchTorch }`: `switchTorch` só existe (não é `null`)
 * quando a câmera realmente expõe suporte a torch.
 */
export async function startLiveScan({ videoElement, deviceId, onValidKey, onDecodeAttempt, onDiagnostics, onStreamReady }) {
  const startedAt = performance.now()
  const nativeSupported = await isNativeCode128Supported()
  const args = { videoElement, deviceId, startedAt, onValidKey, onDecodeAttempt, onDiagnostics, onStreamReady }

  if (nativeSupported) {
    console.debug('[NFe][scanner] usando BarcodeDetector nativo (code_128 suportado pelo navegador)')
    return startNativeLiveScan(args)
  }
  console.debug('[NFe][scanner] BarcodeDetector nativo indisponível — usando ZXing')
  return startZxingLiveScan(args)
}
