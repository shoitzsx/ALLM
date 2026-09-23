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
// tentativas para uma leitura ao vivo parecer responsiva.
const SCAN_OPTIONS = {
  delayBetweenScanAttempts: 200,
  delayBetweenScanSuccess: 400,
}

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
 */
export async function startLiveScan({ videoElement, deviceId, onValidKey, onDecodeAttempt }) {
  const reader = new BrowserMultiFormatReader(buildCode128Hints(), SCAN_OPTIONS)
  const constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
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
    onDecodeAttempt?.()
    if (!result) return

    const chave = normalizarChave(result.getText())
    if (chave.length === 44 && validarChaveNFe(chave)) {
      found = true
      liveControls.stop()
      onValidKey(chave)
    }
  })

  return {
    stop: () => {
      if (found) return
      controls.stop()
    },
    switchTorch: typeof controls.switchTorch === 'function' ? controls.switchTorch : null,
  }
}
