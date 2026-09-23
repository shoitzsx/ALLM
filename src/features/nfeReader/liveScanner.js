/**
 * Leitura contínua de CODE_128 ao vivo pela câmera traseira, para o scanner
 * de "Leitura automática de NF-e" em celular/tablet.
 *
 * Reaproveita @zxing/browser (já usado por barcodeReader.js) e os MESMOS
 * hints de decodificação (`buildCode128Hints`, barcodeReader.js) — sem
 * `DecodeHintType.TRY_HARDER`, pela mesma razão documentada lá: esse hint
 * dispara `image.rotateCounterClockwise()` dentro do `OneDReader.decode` do
 * ZXing ao falhar a primeira tentativa, e essa rotação interna tenta criar um
 * canvas temporário próprio — o caminho exato do bug "Could not create a
 * Canvas element." já visto em produção. `decodeFromConstraints` roda o
 * MESMO `decodeFromCanvas` por trás dos panos a cada frame (ver
 * node_modules/@zxing/browser/esm/readers/BrowserCodeReader.js, método
 * `scan`), então sem TRY_HARDER nos hints o bug simplesmente não pode
 * disparar aqui também.
 *
 * Qualquer código de barras decodificado passa pela MESMA validação de chave
 * de NF-e usada no resto do módulo (`normalizarChave` + `validarChaveNFe`,
 * chaveNFe.js) antes de ser aceito — um CODE_128 que não seja uma chave válida
 * de 44 dígitos com DV correto é ignorado e a leitura continua. Isso evita
 * falso positivo com outros códigos de barras (etiqueta, código de produto,
 * código da transportadora) que a câmera possa enxergar.
 *
 * Este arquivo depende de APIs de navegador (getUserMedia, HTMLVideoElement)
 * e não roda no test runner do Node — mesma situação de barcodeReader.js/
 * ocrReader.js/pdfExtractor.js (ver README.md, seção "Testes").
 */
import { BrowserMultiFormatReader } from '@zxing/browser'
import { buildCode128Hints } from './barcodeReader.js'
import { normalizarChave, validarChaveNFe } from './chaveNFe.js'

// Mais ágil que o padrão da lib (500ms/500ms): a decodificação em si é barata
// (mesmo decodeFromCanvas de sempre sobre um frame de vídeo), o gargalo real
// é a câmera entregar frames — não há necessidade de esperar tanto entre
// tentativas para uma leitura ao vivo parecer responsiva. 100ms é o valor
// pedido para testar (~10 tentativas/s no teto); se isso se mostrar pesado
// demais em aparelho físico (CPU/bateria/temperatura), suba de volta para
// algo entre 150-200ms — é só este número, nada mais no pipeline depende dele.
const SCAN_OPTIONS = {
  delayBetweenScanAttempts: 100,
  delayBetweenScanSuccess: 400,
}

// 1280x720 (HD) em vez de 1920x1080 (Full HD): a chave de 44 dígitos em
// CODE_128 não precisa da resolução máxima da câmera para ficar legível — é
// texto/barras relativamente grandes na página, não letras miúdas. HD reduz
// a quantidade de pixels que o ZXing varre a cada tentativa (menos de 60% dos
// pixels de 1080p) sem deixar as barras finas do código ilegíveis. `ideal`
// (nunca `exact`): o navegador ainda negocia livremente com o hardware
// disponível, sem falhar em câmeras que não entreguem exatamente 1280x720.
const CAMERA_WIDTH_IDEAL = 1280
const CAMERA_HEIGHT_IDEAL = 720

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
 * Aplica foco contínuo quando a câmera realmente expõe suporte a isso — pura
 * feature detection, igual ao torch já existente: só tenta se
 * `getCapabilities()` listar `focusMode` incluindo `"continuous"`. Sem esse
 * suporte (ex.: Safari, que historicamente não expõe `getCapabilities()` em
 * todo dispositivo), simplesmente não faz nada — nunca lança, nunca esconde
 * o scanner. Não é a mesma coisa que o torch (que o próprio @zxing/browser já
 * resolve prontinho); aqui é a track de vídeo direto, por isso o try/catch
 * próprio.
 */
async function tryApplyContinuousFocus(controls) {
  try {
    if (typeof controls.streamVideoCapabilitiesGet !== 'function') return false
    const capabilities = controls.streamVideoCapabilitiesGet(() => true)
    if (!capabilities?.focusMode?.includes?.('continuous')) return false
    await controls.streamVideoConstraintsApply({ advanced: [{ focusMode: 'continuous' }] })
    return true
  } catch (err) {
    console.debug('[NFe][scanner] foco contínuo não aplicado (sem suporte ou falha ao negociar).', {
      name: err?.name,
      message: err?.message,
    })
    return false
  }
}

/**
 * Inicia a leitura contínua em um <video>, preferindo a câmera traseira.
 *
 * `onValidKey(chave)` é chamado no máximo uma vez, só quando um frame decodifica
 * para uma chave de NF-e válida — a leitura já está parada nesse momento
 * (chamada de dentro do callback do próprio ZXing, antes de notificar quem
 * chamou, para nenhum frame seguinte poder disparar um segundo callback).
 *
 * Erros de `getUserMedia` (permissão negada, sem câmera, etc.) propagam para
 * quem chamou — não são tratados aqui, a mensagem amigável é responsabilidade
 * da UI (NfeLiveScanner.jsx).
 *
 * Retorna `{ stop, switchTorch }`: `switchTorch` só existe (não é `null`)
 * quando a câmera realmente expõe suporte a torch (checado pelo próprio
 * @zxing/browser via `MediaStreamTrack.getCapabilities()`).
 *
 * Instrumentação (`console.debug` só, nunca visível ao usuário, nunca loga a
 * chave inteira — só métricas): tempo até a câmera ficar pronta, resolução
 * real negociada pelo navegador, e — ao encontrar uma chave — quantas
 * tentativas de decodificação isso levou e quanto tempo passou.
 */
export async function startLiveScan({ videoElement, deviceId, onValidKey, onDecodeAttempt }) {
  const startedAt = performance.now()
  let attempts = 0

  const reader = new BrowserMultiFormatReader(buildCode128Hints(), SCAN_OPTIONS)
  const constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: CAMERA_WIDTH_IDEAL },
      height: { ideal: CAMERA_HEIGHT_IDEAL },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  }

  let found = false

  // O 3º argumento do callback (`liveControls`) é a mesma referência que este
  // `decodeFromConstraints` vai resolver mais abaixo — mas chega aqui de
  // forma síncrona a cada frame, então usamos ELE (não a variável de fora)
  // para parar a leitura imediatamente: o primeiro frame já pode decodificar
  // com sucesso antes deste `await` terminar de resolver.
  const controls = await reader.decodeFromConstraints(constraints, videoElement, (result, _err, liveControls) => {
    if (found) return
    attempts += 1
    onDecodeAttempt?.()
    if (!result) return

    const chave = normalizarChave(result.getText())
    if (chave.length === 44 && validarChaveNFe(chave)) {
      found = true
      liveControls.stop()
      const elapsedS = ((performance.now() - startedAt) / 1000).toFixed(1)
      console.debug(`[NFe][scanner] chave encontrada em ${elapsedS}s após ${attempts} tentativa(s)`)
      onValidKey(chave)
    }
  })

  const readyMs = Math.round(performance.now() - startedAt)
  console.debug(`[NFe][scanner] câmera pronta em ${readyMs}ms`)
  try {
    const settings = controls.streamVideoSettingsGet?.(() => true)
    if (settings) console.debug(`[NFe][scanner] stream ${settings.width}x${settings.height}`)
  } catch (err) {
    console.debug('[NFe][scanner] não foi possível ler a resolução real do stream.', { name: err?.name })
  }

  const continuousFocusApplied = await tryApplyContinuousFocus(controls)
  if (continuousFocusApplied) console.debug('[NFe][scanner] foco contínuo aplicado')

  return {
    stop: () => {
      if (found) return
      controls.stop()
    },
    switchTorch: typeof controls.switchTorch === 'function' ? controls.switchTorch : null,
  }
}
