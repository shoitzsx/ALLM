/**
 * Leitura de código de barras CODE_128 (formato da chave impressa no DANFE) a
 * partir de um canvas, 100% no navegador.
 *
 * Por que sem `DecodeHintType.TRY_HARDER`: com esse hint ligado, o
 * `OneDReader.decode` da @zxing/library entra sozinho em
 * `image.rotateCounterClockwise()` quando a primeira tentativa falha
 * (node_modules/@zxing/library/esm/core/oned/OneDReader.js:44-47). Essa
 * rotação interna é o caminho exato do erro "Could not create a Canvas
 * element." visto em produção — sem o hint, esse código nunca roda. A
 * cobertura de rotação que o TRY_HARDER daria é reimplementada aqui de forma
 * explícita (`rotateCanvas`), fora do ZXing, com canvases DOM normais.
 *
 * Não tentamos "resolver" digitalizações ruins só insistindo mais no ZXing:
 * depois de um conjunto razoável de recortes/rotações/contraste, quem chama
 * este módulo (extractor.js) segue para o fallback de OCR (ocrReader.js).
 *
 * Filosofia: qualquer falha aqui degrada para "não encontrado" — nunca deve
 * derrubar `analyzeNfeFile`. NotFoundException é o resultado normal de uma
 * tentativa sem sucesso; qualquer outro erro é logado com detalhe.
 */
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser'
import { DecodeHintType, NotFoundException } from '@zxing/library'
import { cloneToDomCanvas, cropCanvas, rotateCanvas, thresholdCanvas, upscaleCanvas } from './canvasUtils.js'

const ROTATION_ANGLES = [0, 90, 180, 270]

// Abaixo dessa largura, o recorte é ampliado (com suavização desligada, para
// não borrar as barras) antes de ir pro decoder — um recorte pequeno demais
// tende a comprimir demais as barras finas do CODE_128.
const MIN_DECODE_WIDTH = 1200
const UPSCALE_FACTOR = 2

// Um único nível de limiar (threshold) já cobre boa parte dos casos de baixo
// contraste sem multiplicar demais o número de tentativas — múltiplos níveis
// de threshold ficam para quando isso não bastar (aí entra o fallback de OCR
// em ocrReader.js, que é o caminho certo para digitalização realmente ruim).
const THRESHOLD_LEVEL = 160

// Recortes tentados, em proporção do canvas (não em pixels fixos, para não
// depender do tamanho/layout de uma NF específica). O código de barras do
// DANFE costuma ocupar uma faixa relativamente pequena no topo da página;
// regiões menores/mais específicas vêm primeiro (mais baratas e com menos
// ruído de texto ao redor), a página inteira é a última tentativa.
export const CROP_VARIANTS = [
  { label: 'topo 25%', region: (width, height) => ({ x: 0, y: 0, width, height: Math.round(height * 0.25) }) },
  { label: 'topo 35%', region: (width, height) => ({ x: 0, y: 0, width, height: Math.round(height * 0.35) }) },
  {
    label: 'topo direito',
    region: (width, height) => ({
      x: Math.round(width * 0.35),
      y: 0,
      width: Math.round(width * 0.65),
      height: Math.round(height * 0.35),
    }),
  },
  {
    label: 'topo esquerdo',
    region: (width, height) => ({ x: 0, y: 0, width: Math.round(width * 0.65), height: Math.round(height * 0.35) }),
  },
  { label: 'metade superior', region: (width, height) => ({ x: 0, y: 0, width, height: Math.round(height * 0.5) }) },
  { label: 'página inteira', region: null },
]

function buildHints() {
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128])
  return hints
}

function logUnexpectedError(context, err) {
  console.error('[NFe][barcode]', {
    context,
    name: err?.name,
    message: err?.message,
    stack: err?.stack,
  })
}

function tryDecode(reader, canvas, label) {
  try {
    const result = reader.decodeFromCanvas(canvas)
    return result?.getText() || null
  } catch (err) {
    if (err instanceof NotFoundException) {
      console.debug(`[NFe] CODE_128 não encontrado (${label})`)
      return null
    }
    logUnexpectedError(`decodificar "${label}"`, err)
    return null
  }
}

/**
 * Tenta ler um CODE_128 no canvas, testando recortes (topo 25%/35%,
 * topo direito/esquerdo, metade superior, página inteira), cada um em
 * original e com limiar de contraste, e dentro de cada versão as 4
 * rotações — sem depender da rotação automática interna do ZXing. Recortes
 * estreitos são ampliados (sem suavização) antes de decodificar. Retorna o
 * texto decodificado ou `null` se nenhuma combinação funcionar. Nunca lança:
 * uma falha em uma combinação não pode impedir as próximas.
 */
export async function readCode128FromCanvas(sourceCanvas) {
  if (!sourceCanvas) return null
  if (typeof document === 'undefined' || typeof sourceCanvas.getContext !== 'function') {
    console.error('[NFe][barcode] Ambiente sem suporte a Canvas DOM válido.')
    return null
  }

  const reader = new BrowserMultiFormatReader(buildHints())

  for (const variant of CROP_VARIANTS) {
    let baseCanvas
    try {
      baseCanvas = variant.region
        ? (() => {
            const { x, y, width, height } = variant.region(sourceCanvas.width, sourceCanvas.height)
            return cropCanvas(sourceCanvas, x, y, width, height)
          })()
        : cloneToDomCanvas(sourceCanvas)

      if (baseCanvas.width < MIN_DECODE_WIDTH) {
        baseCanvas = upscaleCanvas(baseCanvas, UPSCALE_FACTOR)
      }
    } catch (err) {
      logUnexpectedError(`preparar recorte "${variant.label}"`, err)
      continue
    }

    const processedVariants = [{ label: 'original', canvas: baseCanvas }]
    try {
      processedVariants.push({ label: 'contraste', canvas: thresholdCanvas(baseCanvas, THRESHOLD_LEVEL) })
    } catch (err) {
      logUnexpectedError(`aplicar contraste em "${variant.label}"`, err)
    }

    for (const processed of processedVariants) {
      for (const angle of ROTATION_ANGLES) {
        const label = `${variant.label}, ${processed.label}, ${angle}°`
        console.debug(`[NFe] Tentando CODE_128 - ${label}`)

        let candidateCanvas
        try {
          candidateCanvas = angle === 0 ? processed.canvas : rotateCanvas(processed.canvas, angle)
        } catch (err) {
          logUnexpectedError(`rotacionar "${label}"`, err)
          continue
        }

        const text = tryDecode(reader, candidateCanvas, label)
        if (text) {
          console.log(`[NFe] CODE_128 encontrado (${label})`)
          return text
        }
      }
    }
  }

  console.log('[NFe] CODE_128 não encontrado em nenhuma combinação de recorte/contraste/rotação.')
  return null
}

/** Carrega um arquivo de imagem (foto da NF) em um canvas para leitura de código de barras/OCR. */
export async function loadImageFileToCanvas(file) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'))
      img.src = objectUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('Canvas 2D indisponível ao carregar imagem selecionada.')
    }
    context.drawImage(image, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
