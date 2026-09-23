#!/usr/bin/env node
/**
 * Matriz comparativa dos três decoders (BarcodeDetector nativo, ZXing, ZBar)
 * contra as fixtures existentes (ver README.md deste diretório) — Nível A
 * (decoder cru, sem o pipeline de estágios) e Nível B (pipeline de produção
 * completo, que já mistura nativo+ZXing+pré-processamento — ver comentário em
 * decoders/zxingDecoder.js sobre por que o Nível B não é reportado por
 * engine).
 *
 * Como rodar (mesmo padrão de validate-fixtures.mjs):
 *   1. `npm run dev` num terminal.
 *   2. `npm install --no-save playwright-core` (se ainda não instalado).
 *   3. `node src/features/nfeReader/testFixtures/validate-decoder-benchmark.mjs`
 *
 * Variáveis de ambiente opcionais: NFE_DEV_SERVER_URL (padrão
 * http://localhost:5173) e NFE_CHROME_PATH (padrão o Chrome do Windows).
 *
 * Este script não decide "o melhor engine" — só gera a matriz medida. O
 * teste decisivo continua sendo a NF real em celular físico (ver README do
 * módulo, seção "Benchmark de decoders").
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.NFE_DEV_SERVER_URL || 'http://localhost:5173'

// Mesmas fixtures de validate-fixtures.mjs — ver README.md deste diretório
// para o que cada uma testa.
const FIXTURES = [
  'clean.png',
  'tight-margin.png',
  'zero-margin.png',
  'rotated-90deg.png',
  'low-res.png',
  'low-contrast.png',
  'tilted-2deg.png',
  'tilted-6deg.png',
  'tilted-10deg.png',
  'tight-margin-tilted-4deg.png',
]

function pad(str, len) {
  str = String(str)
  return str.length >= len ? str : str + ' '.repeat(len - str.length)
}

async function main() {
  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch {
    console.error('playwright-core não encontrado. Rode: npm install --no-save playwright-core')
    process.exit(1)
  }

  const chromePath = process.env.NFE_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const browser = await chromium
    .launch({ executablePath: chromePath, headless: true })
    .catch(async () => chromium.launch({ headless: true }))
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await context.newPage()
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })

  const rows = []
  for (const file of FIXTURES) {
    const filePath = join(HERE, file)
    const b64 = readFileSync(filePath).toString('base64')
    const result = await page.evaluate(async ({ b64 }) => {
      const decoders = await import('/src/features/nfeReader/decoders/index.js')

      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = `data:image/png;base64,${b64}`
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)

      const [native, zxing, zbar, pipeline] = await Promise.all([
        decoders.decodeWithNativeBarcodeDetector(canvas),
        decoders.decodeWithZxing(canvas),
        decoders.decodeWithZbar(canvas),
        (async () => {
          const { decodeWithProductionPipeline } = await import('/src/features/nfeReader/decoders/zxingDecoder.js')
          return decodeWithProductionPipeline(canvas)
        })(),
      ])

      return {
        native: { available: native.available, detected: native.detected, valid: native.validNfeKey, ms: native.decodeTimeMs, error: native.error },
        zxing: { available: zxing.available, detected: zxing.detected, valid: zxing.validNfeKey, ms: zxing.decodeTimeMs, error: zxing.error },
        zbar: { available: zbar.available, detected: zbar.detected, valid: zbar.validNfeKey, ms: zbar.decodeTimeMs, error: zbar.error },
        pipeline: { detected: pipeline.detected, valid: pipeline.validNfeKey, ms: pipeline.decodeTimeMs, error: pipeline.error },
      }
    }, { b64 })

    rows.push({ file, ...result })
  }

  console.log('\nNível A — decoder cru (mesma imagem, sem recorte/rotação/deskew):\n')
  const header = `${pad('fixture', 30)} ${pad('nativo', 22)} ${pad('zxing', 22)} ${pad('zbar', 22)}`
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const row of rows) {
    const cell = (r) => (r.available ? (r.detected ? (r.valid ? 'OK' : 'detectou/DV inválido') : 'não detectou') : 'indisponível') + (r.error ? ` (erro)` : '') + ` ${r.ms != null ? r.ms + 'ms' : ''}`
    console.log(`${pad(row.file, 30)} ${pad(cell(row.native), 22)} ${pad(cell(row.zxing), 22)} ${pad(cell(row.zbar), 22)}`)
  }

  console.log('\nNível B — pipeline de produção completo (nativo+ZXing+recorte+contraste+margem+deskew):\n')
  for (const row of rows) {
    const p = row.pipeline
    console.log(`${pad(row.file, 30)} ${p.detected ? (p.valid ? 'OK' : 'detectou/DV inválido') : 'não detectou'} ${p.ms != null ? p.ms + 'ms' : ''}`)
  }

  const summarize = (engine) => {
    const total = rows.length
    const ok = rows.filter((r) => r[engine].valid).length
    const avgMs = Math.round(rows.filter((r) => r[engine].ms != null).reduce((sum, r) => sum + r[engine].ms, 0) / (rows.filter((r) => r[engine].ms != null).length || 1))
    return `${ok}/${total} corretas, tempo médio ${avgMs}ms`
  }
  console.log('\nResumo Nível A:')
  console.log(`  BarcodeDetector nativo: ${summarize('native')}`)
  console.log(`  ZXing: ${summarize('zxing')}`)
  console.log(`  ZBar: ${summarize('zbar')}`)

  await context.close()
  await browser.close()
}

main().catch((err) => {
  console.error('Falha ao rodar o benchmark de fixtures:', err)
  process.exit(1)
})
