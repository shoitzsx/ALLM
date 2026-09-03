/**
 * Copia, de node_modules para public/, os arquivos estáticos que pdf.js e
 * tesseract.js resolvem em tempo de execução por caminho/nome de arquivo
 * fixo (ex.: `${wasmUrl}jbig2.wasm`) em vez de import — o bundler não
 * enxerga essas dependências dinâmicas, então precisam ser servidas como
 * arquivos estáticos comuns, de onde o Vite serve tudo verbatim (dev e
 * build). Roda automaticamente no `npm install` (script "postinstall").
 *
 * pdf.js → public/pdfjs/{wasm,cmaps,standard_fonts,iccs}/
 *   Sem isso, PDFs escaneados com imagens JBIG2/JPX (comum em digitalização)
 *   falham ao decodificar: "Ensure that the wasmUrl API parameter is provided.".
 *
 * tesseract.js → public/tesseract/{worker.min.js, core/}
 *   Worker e núcleo WASM ficam locais (sem CDN). O dado de idioma treinado
 *   (eng.traineddata.gz, dezenas de MB) continua vindo do CDN oficial do
 *   tesseract.js na primeira execução por navegador — ver
 *   src/features/nfeReader/ocrReader.js para o porquê dessa escolha.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(rootDir, 'public')

function copyPdfjsAssets() {
  const sourceDir = join(rootDir, 'node_modules', 'pdfjs-dist')
  if (!existsSync(sourceDir)) {
    console.warn('[copy-vendor-assets] pdfjs-dist não encontrado em node_modules; pulando.')
    return
  }
  const targetDir = join(publicDir, 'pdfjs')
  mkdirSync(targetDir, { recursive: true })
  for (const folder of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) {
    const from = join(sourceDir, folder)
    if (!existsSync(from)) continue
    cpSync(from, join(targetDir, folder), { recursive: true })
  }
  console.log('[copy-vendor-assets] pdf.js: wasm/cmaps/standard_fonts/iccs → public/pdfjs/')
}

function copyTesseractAssets() {
  const workerSrc = join(rootDir, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
  const coreDir = join(rootDir, 'node_modules', 'tesseract.js-core')
  if (!existsSync(workerSrc) || !existsSync(coreDir)) {
    console.warn('[copy-vendor-assets] tesseract.js/tesseract.js-core não encontrados em node_modules; pulando.')
    return
  }
  const targetDir = join(publicDir, 'tesseract')
  mkdirSync(targetDir, { recursive: true })
  copyFileSync(workerSrc, join(targetDir, 'worker.min.js'))
  cpSync(coreDir, join(targetDir, 'core'), {
    recursive: true,
    filter: (src) => !src.endsWith('.md'),
  })
  console.log('[copy-vendor-assets] tesseract.js: worker.min.js + core/*.wasm → public/tesseract/')
}

mkdirSync(publicDir, { recursive: true })
copyPdfjsAssets()
copyTesseractAssets()
