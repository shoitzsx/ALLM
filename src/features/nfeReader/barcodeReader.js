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
 *
 * ESTÁGIOS (investigado com fixtures sintéticas reais — ver
 * testFixtures/README.md — não só suposição): uma foto boa (bem enquadrada,
 * pouco ou nenhum desvio de ângulo) resolve no Estágio 1 e nunca chega perto
 * dos estágios mais caros. `readCode128FromCanvas` tenta, em ordem, cada um
 * só se o anterior não achou nada:
 *
 *   1. BarcodeDetector nativo (se o navegador suportar) + ZXing na imagem
 *      inteira, original/contraste, 4 rotações cardeais.
 *   2. Os CROP_VARIANTS de sempre (para fotos da página inteira da NF).
 *   2b. Imagem inteira com margem branca artificial (recupera fotos onde o
 *       código foi enquadrado rente demais, sem quiet zone real).
 *   3. A mesma imagem com margem, em pequenas inclinações de correção
 *      (deskew) — só roda se nada acima resolveu. Medido: sem este estágio,
 *      o pipeline decodifica de forma confiável até ~2° de desvio de câmera
 *      e falha a partir de 3°; com ele, a maioria (não 100%, a reamostragem
 *      do canvas em cada ângulo não é perfeitamente previsível) dos casos
 *      entre 3° e 10° passa a ser recuperada.
 */
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser'
import { DecodeHintType, NotFoundException } from '@zxing/library'
import { cloneToDomCanvas, cropCanvas, padCanvasWithWhite, rotateCanvas, thresholdCanvas, upscaleCanvas } from './canvasUtils.js'
import { detectCode128Native } from './nativeBarcodeDetector.js'
import { classifyDecodedText, DECODE_OUTCOME } from './decodeDiagnostics.js'

const ROTATION_ANGLES = [0, 90, 180, 270]

// Ângulos de correção de pequena inclinação, tentados só no Estágio 3 (ver
// comentário de topo do arquivo para a evidência por trás do range).
const DESKEW_ANGLES = [-11, -8, -5, -3, 3, 5, 8, 11]

const PAD_RATIO = 0.08

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

/**
 * Hints do ZXing compartilhados por toda leitura de CODE_128 do módulo —
 * estático (este arquivo) e ao vivo pela câmera (liveScanner.js). Nunca inclui
 * `DecodeHintType.TRY_HARDER`: ver o comentário no topo deste arquivo sobre o
 * bug de rotação interna do ZXing. Uma única fonte evita duas implementações
 * divergentes de "o que conta como código de barras aceitável" no projeto.
 */
export function buildCode128Hints() {
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

function tryZxingDecode(reader, canvas, label, onAttempt) {
  try {
    const result = reader.decodeFromCanvas(canvas)
    const text = result?.getText() || null
    onAttempt?.(classifyDecodedText(text), label)
    return text
  } catch (err) {
    if (err instanceof NotFoundException) {
      console.debug(`[NFe] CODE_128 não encontrado (${label})`)
      onAttempt?.(DECODE_OUTCOME.NOT_FOUND, label)
      return null
    }
    logUnexpectedError(`decodificar "${label}"`, err)
    onAttempt?.(DECODE_OUTCOME.NOT_FOUND, label)
    return null
  }
}

function widenIfNarrow(canvas) {
  return canvas.width < MIN_DECODE_WIDTH ? upscaleCanvas(canvas, UPSCALE_FACTOR) : canvas
}

/** Tenta original + contraste num canvas já pronto, nos ângulos dados. Retorna o texto ou `null`. */
function tryAnglesAndContrast(reader, baseCanvas, label, angles, onAttempt) {
  const processedVariants = [{ variantLabel: 'original', canvas: baseCanvas }]
  try {
    processedVariants.push({ variantLabel: 'contraste', canvas: thresholdCanvas(baseCanvas, THRESHOLD_LEVEL) })
  } catch (err) {
    logUnexpectedError(`aplicar contraste em "${label}"`, err)
  }

  for (const processed of processedVariants) {
    for (const angle of angles) {
      const fullLabel = `${label}, ${processed.variantLabel}, ${angle}°`
      let candidateCanvas
      try {
        candidateCanvas = angle === 0 ? processed.canvas : rotateCanvas(processed.canvas, angle)
      } catch (err) {
        logUnexpectedError(`rotacionar "${fullLabel}"`, err)
        continue
      }
      console.debug(`[NFe] Tentando CODE_128 - ${fullLabel}`)
      const text = tryZxingDecode(reader, candidateCanvas, fullLabel, onAttempt)
      if (text) return text
    }
  }
  return null
}

/**
 * Tenta ler um CODE_128 num canvas, em estágios (ver comentário de topo do
 * arquivo para a ordem e o porquê de cada um), parando no primeiro sucesso.
 * Retorna o texto decodificado ou `null` se nada funcionar. Nunca lança: uma
 * falha em uma tentativa não pode impedir as próximas.
 *
 * `onAttempt(outcome, label)` — opcional, `decodeDiagnostics.js` — é chamado
 * a cada tentativa individual, para instrumentação (console.debug/painel de
 * dev). Retrocompatível: quem não passar `onAttempt` continua funcionando
 * exatamente como antes.
 */
export async function readCode128FromCanvas(sourceCanvas, { onAttempt } = {}) {
  if (!sourceCanvas) return null
  if (typeof document === 'undefined' || typeof sourceCanvas.getContext !== 'function') {
    console.error('[NFe][barcode] Ambiente sem suporte a Canvas DOM válido.')
    return null
  }

  const reader = new BrowserMultiFormatReader(buildCode128Hints())

  // --- Estágio 1: fast path (nativo + ZXing na imagem inteira) --------------
  try {
    const nativeText = await detectCode128Native(sourceCanvas)
    const outcome = classifyDecodedText(nativeText)
    onAttempt?.(outcome, 'nativo, imagem inteira')
    if (outcome !== DECODE_OUTCOME.NOT_FOUND) {
      console.log('[NFe] CODE_128 encontrado (BarcodeDetector nativo, imagem inteira)')
      return nativeText
    }
  } catch (err) {
    logUnexpectedError('BarcodeDetector nativo', err)
  }

  let wholeImage = null
  try {
    wholeImage = widenIfNarrow(cloneToDomCanvas(sourceCanvas))
  } catch (err) {
    logUnexpectedError('preparar imagem inteira', err)
  }

  if (wholeImage) {
    const text = tryAnglesAndContrast(reader, wholeImage, 'imagem inteira', ROTATION_ANGLES, onAttempt)
    if (text) {
      console.log('[NFe] CODE_128 encontrado (imagem inteira, ZXing)')
      return text
    }
  }

  // --- Estágio 2: recortes de página inteira ---------------------------------
  for (const variant of CROP_VARIANTS) {
    if (!variant.region) continue // "página inteira" já foi coberta no Estágio 1
    let baseCanvas
    try {
      const { x, y, width, height } = variant.region(sourceCanvas.width, sourceCanvas.height)
      baseCanvas = widenIfNarrow(cropCanvas(sourceCanvas, x, y, width, height))
    } catch (err) {
      logUnexpectedError(`preparar recorte "${variant.label}"`, err)
      continue
    }
    const text = tryAnglesAndContrast(reader, baseCanvas, variant.label, ROTATION_ANGLES, onAttempt)
    if (text) {
      console.log(`[NFe] CODE_128 encontrado (${variant.label})`)
      return text
    }
  }

  // --- Estágio 2b: margem branca artificial -----------------------------------
  // Recupera fotos em que o código foi enquadrado rente demais (sem quiet
  // zone real) — ver padCanvasWithWhite em canvasUtils.js.
  let padded = null
  try {
    padded = widenIfNarrow(padCanvasWithWhite(sourceCanvas, PAD_RATIO))
  } catch (err) {
    logUnexpectedError('adicionar margem artificial', err)
  }

  if (padded) {
    const text = tryAnglesAndContrast(reader, padded, 'margem artificial', ROTATION_ANGLES, onAttempt)
    if (text) {
      console.log('[NFe] CODE_128 encontrado (margem artificial)')
      return text
    }

    // --- Estágio 3: pequenas inclinações (deskew), último recurso -----------
    const deskewText = tryAnglesAndContrast(reader, padded, 'margem artificial + deskew', DESKEW_ANGLES, onAttempt)
    if (deskewText) {
      console.log('[NFe] CODE_128 encontrado (deskew)')
      return deskewText
    }
  }

  console.log('[NFe] CODE_128 não encontrado em nenhum estágio (nativo/recorte/contraste/rotação/margem/deskew).')
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
