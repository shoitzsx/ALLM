/**
 * Extração de texto embutido e renderização da primeira página de um PDF,
 * usando pdfjs-dist inteiramente no navegador (sem serviço externo).
 */
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

// A partir da v5/v6, o pdf.js monta o nome de arquivo de wasm/cmaps/fontes em
// tempo de execução (ex.: `${wasmUrl}jbig2.wasm`), então o bundler não consegue
// enxergar essas dependências para empacotá-las — elas precisam ser servidas
// como arquivos estáticos comuns. `scripts/copy-pdfjs-assets.mjs` (rodado no
// `npm install`) copia esses diretórios de node_modules/pdfjs-dist para
// public/pdfjs/. Sem isso, imagens JBIG2/JPX (comuns em NF digitalizada) falham
// ao decodificar: "Ensure that the wasmUrl API parameter is provided.".
const PDFJS_ASSETS_BASE = `${import.meta.env.BASE_URL}pdfjs/`

async function loadPdf(file) {
  const buffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({
    data: buffer,
    cMapUrl: `${PDFJS_ASSETS_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSETS_BASE}standard_fonts/`,
    iccUrl: `${PDFJS_ASSETS_BASE}iccs/`,
    wasmUrl: `${PDFJS_ASSETS_BASE}wasm/`,
  })
  return loadingTask.promise
}

/** Concatena o texto selecionável das primeiras páginas do PDF. */
export async function extractPdfText(file, { maxPages = 3 } = {}) {
  const pdf = await loadPdf(file)
  const pageCount = Math.min(pdf.numPages, maxPages)
  const chunks = []
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    chunks.push(content.items.map((item) => item.str).join(' '))
  }
  return chunks.join('\n')
}

// Resolução alvo para leitura de código de barras/OCR: NF digitalizada
// precisa de pelo menos ~250-300 DPI para o CODE_128 e os dígitos da chave
// ficarem legíveis (1 ponto PDF = 1/72"; escala 300/72 ≈ 4.17 ≈ 300 DPI).
// MAX_RENDER_DIMENSION é um teto de pixels no maior lado para não deixar o
// canvas (e as cópias feitas a cada recorte/rotação/threshold em
// barcodeReader.js e ocrReader.js) consumir memória demais em páginas fora
// do padrão A4/Carta.
const BARCODE_RENDER_SCALE = 300 / 72
const MAX_RENDER_DIMENSION = 4200

/** Renderiza a primeira página em um canvas, usado para tentar ler o código de barras. */
export async function renderPdfFirstPageToCanvas(file, { scale = BARCODE_RENDER_SCALE } = {}) {
  const pdf = await loadPdf(file)
  const page = await pdf.getPage(1)
  const baseViewport = page.getViewport({ scale: 1 })
  const projectedMax = Math.max(baseViewport.width, baseViewport.height) * scale
  const effectiveScale = projectedMax > MAX_RENDER_DIMENSION ? scale * (MAX_RENDER_DIMENSION / projectedMax) : scale
  const viewport = page.getViewport({ scale: effectiveScale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D indisponível ao renderizar a página do PDF.')
  }

  await page.render({ canvasContext: context, viewport, canvas }).promise

  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new Error(`Render da página produziu um canvas inválido (${canvas.width}x${canvas.height}).`)
  }

  return canvas
}
