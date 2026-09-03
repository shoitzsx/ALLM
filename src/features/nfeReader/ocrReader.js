/**
 * OCR de último recurso, usado só quando nem o texto do PDF nem o código de
 * barras acharam uma chave válida — comum em digitalizações de baixa
 * qualidade, onde nem bibliotecas profissionais de leitura de código de
 * barras conseguem decodificar. Roda inteiramente no navegador via
 * tesseract.js.
 *
 * Ativos self-hosted: o worker (`worker.min.js`) e o núcleo WASM
 * (`tesseract-core*.wasm.js`) são copiados de node_modules para
 * public/tesseract/ pelo mesmo mecanismo usado para o pdf.js
 * (scripts/copy-vendor-assets.mjs, rodado no `npm install`) — não dependem
 * de CDN. O dado de idioma treinado (`eng.traineddata.gz`, dezenas de MB)
 * continua vindo do CDN oficial do tesseract.js na primeira execução em cada
 * navegador; depois fica em cache no IndexedDB do próprio navegador. Isso é
 * o padrão recomendado pela própria lib (ver
 * node_modules/tesseract.js/docs/local-installation.md) — auto-hospedar um
 * pacote de idioma inteiro só para reconhecer dígitos não compensa aqui.
 *
 * O reconhecimento é restrito a dígitos e separadores comuns
 * (tessedit_char_whitelist) para focar exatamente no que interessa (a chave
 * de 44 dígitos) — isso também acelera bastante o OCR comparado a
 * reconhecer o texto inteiro da página.
 */
import { createWorker, PSM } from 'tesseract.js'
import { findValidNfeKeys } from './chaveNFe.js'
import { cloneToDomCanvas, cropCanvas, upscaleCanvas } from './canvasUtils.js'

const ASSETS_BASE = `${import.meta.env.BASE_URL}tesseract/`

const MIN_OCR_WIDTH = 1400
const UPSCALE_FACTOR = 2

// OCR é bem mais lento que o ZXing, então o conjunto de regiões tentadas é
// deliberadamente menor que o do código de barras: a chave costuma estar
// impressa perto do topo da página (abaixo/perto do próprio código de
// barras), então tentamos aí primeiro e só recorremos à página inteira por
// último.
const CROP_VARIANTS = [
  { label: 'topo 35%', region: (width, height) => ({ x: 0, y: 0, width, height: Math.round(height * 0.35) }) },
  { label: 'página inteira', region: null },
]

let workerPromise = null

function createOcrWorker() {
  return createWorker('eng', 1, {
    workerPath: `${ASSETS_BASE}worker.min.js`,
    corePath: `${ASSETS_BASE}core/`,
  }).then(async (worker) => {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789 .-',
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    })
    return worker
  })
}

function getWorker() {
  if (!workerPromise) workerPromise = createOcrWorker()
  return workerPromise
}

function logUnexpectedError(context, err) {
  console.error('[NFe][ocr]', { context, name: err?.name, message: err?.message, stack: err?.stack })
}

/**
 * Roda OCR sobre um canvas de página inteira, tentando algumas regiões perto
 * do topo antes da página inteira, e retorna as chaves de 44 dígitos válidas
 * encontradas — reaproveitando a mesma validação de `findValidNfeKeys` usada
 * para o texto do PDF. Nunca lança: uma falha em uma região não pode impedir
 * as próximas, e o método como um todo nunca deve derrubar quem o chamou.
 */
export async function findNfeKeysWithOcr(sourceCanvas) {
  if (!sourceCanvas) return []
  if (typeof document === 'undefined' || typeof sourceCanvas.getContext !== 'function') {
    console.error('[NFe][ocr] Ambiente sem suporte a Canvas DOM válido.')
    return []
  }

  let worker
  try {
    worker = await getWorker()
  } catch (err) {
    logUnexpectedError('inicializar worker', err)
    return []
  }

  for (const variant of CROP_VARIANTS) {
    let candidate
    try {
      candidate = variant.region
        ? (() => {
            const { x, y, width, height } = variant.region(sourceCanvas.width, sourceCanvas.height)
            return cropCanvas(sourceCanvas, x, y, width, height)
          })()
        : cloneToDomCanvas(sourceCanvas)

      if (candidate.width < MIN_OCR_WIDTH) {
        candidate = upscaleCanvas(candidate, UPSCALE_FACTOR)
      }
    } catch (err) {
      logUnexpectedError(`preparar região "${variant.label}"`, err)
      continue
    }

    try {
      console.debug(`[NFe] OCR analisando região "${variant.label}" (${candidate.width}x${candidate.height})...`)
      const { data } = await worker.recognize(candidate)
      const texto = data?.text || ''
      console.log(`[NFe] OCR (${variant.label}) reconheceu ${texto.replace(/\s+/g, '').length} caractere(s).`)
      const chaves = findValidNfeKeys(texto)
      if (chaves.length) return chaves
    } catch (err) {
      logUnexpectedError(`reconhecer região "${variant.label}"`, err)
    }
  }

  console.log('[NFe] OCR não encontrou uma chave válida em nenhuma região tentada.')
  return []
}

/** Libera o worker do tesseract.js. Chame ao desmontar a tela, se aplicável. */
export async function terminateOcrWorker() {
  if (!workerPromise) return
  const pendingWorker = workerPromise
  workerPromise = null
  try {
    const worker = await pendingWorker
    await worker.terminate()
  } catch (err) {
    logUnexpectedError('terminate', err)
  }
}
