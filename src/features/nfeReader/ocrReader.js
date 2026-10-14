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
 *
 * Regiões tentadas, em ordem (`CROP_VARIANTS` = `OCR_CROP_ORDER`, ver
 * pageRegions.js): "topo direito", "topo 35%", "página inteira" — a
 * primeira é nova e mais restrita que "topo 35%" (mesma geometria usada
 * pelo código de barras), reduzindo o texto de outras colunas da página que
 * acaba sendo reconhecido junto. Um recorte estreito é ampliado com um
 * fator calculado (`computeUpscaleFactor`, canvasUtils.js — 2× a 3×
 * conforme a largura), não fixo em 2×.
 */
import { createWorker, PSM } from 'tesseract.js'
import { encontrouSequenciaDe44Digitos, findValidNfeKeys } from './chaveNFe.js'
import { cloneToDomCanvas, computeUpscaleFactor, cropCanvas, upscaleCanvas } from './canvasUtils.js'
import { OCR_CROP_ORDER } from './pageRegions.js'
import { agora, devLogGroup } from './devLog.js'

const ASSETS_BASE = `${import.meta.env.BASE_URL}tesseract/`

const MIN_OCR_WIDTH = 1400
const MAX_OCR_UPSCALE_FACTOR = 3

// OCR é bem mais lento que o ZXing, então o conjunto de regiões tentadas
// continua pequeno (3, não um salto grande): "topo direito" (geometria
// compartilhada com o código de barras — ver pageRegions.js — mais estreita
// que "topo 35%", logo com menos texto de outras colunas da página) tentada
// primeiro, depois as duas regiões de sempre como fallback (nunca perde
// capacidade: só adiciona uma tentativa mais específica antes delas).
const CROP_VARIANTS = OCR_CROP_ORDER

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
 *
 * `candidataInvalidaEncontrada` distingue "nenhuma região tinha nada
 * parecido com 44 dígitos" de "alguma região tinha uma sequência de 44
 * dígitos, mas nenhuma passou na validação (DV ou semântica)" — foi assim
 * que um falso positivo real passou pela Portaria antes da validação
 * semântica existir (ver chaveNFe.js, validarChaveNFe).
 */
export async function findNfeKeysWithOcr(sourceCanvas) {
  if (!sourceCanvas) return { chaves: [], candidataInvalidaEncontrada: false }
  if (typeof document === 'undefined' || typeof sourceCanvas.getContext !== 'function') {
    console.error('[NFe][ocr] Ambiente sem suporte a Canvas DOM válido.')
    return { chaves: [], candidataInvalidaEncontrada: false }
  }

  let worker
  try {
    worker = await getWorker()
  } catch (err) {
    logUnexpectedError('inicializar worker', err)
    return { chaves: [], candidataInvalidaEncontrada: false }
  }

  let candidataInvalidaEncontrada = false
  // Resumo agrupado por região — só impresso em DEV (ver devLog.js); a
  // antiga linha "analisando região..." por tentativa foi removida (OCR só
  // tem 3 regiões agora, não é a fonte do log excessivo, mas mantém o mesmo
  // formato de diagnóstico do código de barras).
  const tentativas = []

  for (const variant of CROP_VARIANTS) {
    let candidate
    try {
      candidate = variant.region
        ? (() => {
            const { x, y, width, height } = variant.region(sourceCanvas.width, sourceCanvas.height)
            return cropCanvas(sourceCanvas, x, y, width, height)
          })()
        : cloneToDomCanvas(sourceCanvas)

      const factor = computeUpscaleFactor(candidate.width, MIN_OCR_WIDTH, MAX_OCR_UPSCALE_FACTOR)
      if (factor > 1) candidate = upscaleCanvas(candidate, factor)
    } catch (err) {
      logUnexpectedError(`preparar região "${variant.label}"`, err)
      continue
    }

    const inicio = agora()
    try {
      const { data } = await worker.recognize(candidate)
      const texto = data?.text || ''
      const totalCaracteres = texto.replace(/\s+/g, '').length
      tentativas.push(`${variant.label}: ${totalCaracteres} chars (${Math.round(agora() - inicio)}ms)`)
      const chaves = findValidNfeKeys(texto)
      if (chaves.length) {
        console.log(`[NFe] Chave encontrada por OCR na região "${variant.label}".`)
        devLogGroup('OCR', tentativas)
        return { chaves, candidataInvalidaEncontrada: false }
      }
      if (encontrouSequenciaDe44Digitos(texto)) candidataInvalidaEncontrada = true
    } catch (err) {
      logUnexpectedError(`reconhecer região "${variant.label}"`, err)
      tentativas.push(`${variant.label}: erro`)
    }
  }

  console.log('[NFe] OCR não encontrou uma chave válida em nenhuma região tentada.')
  devLogGroup('OCR', tentativas)
  return { chaves: [], candidataInvalidaEncontrada }
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
