#!/usr/bin/env node
/**
 * Validação repetível da arquitetura por capacidade (live fast path vs.
 * "Fotografar código") e do fallback ImageCapture → input de câmera nativo —
 * mesmo padrão de validate-fixtures.mjs/validate-decoder-benchmark.mjs:
 * abre o app de verdade (dev server + Chromium real via Playwright), nunca
 * uma simulação da lógica.
 *
 * Como rodar:
 *   1. `npm run dev` num terminal.
 *   2. `npm install --no-save playwright-core` (se ainda não instalado).
 *   3. `node src/features/nfeReader/testFixtures/validate-photo-capture.mjs`
 *
 * Cobre (ver README, seção "Live fast path vs. Fotografar código"):
 *   1. Sem BarcodeDetector nativo → "Fotografar código" é a ação principal,
 *      "Escanear código de barras" não aparece, "Tentar scanner ao vivo
 *      (experimental)" aparece.
 *   2. Com BarcodeDetector nativo (mockado) → "Escanear código de barras" é
 *      a ação principal, "Fotografar código" não aparece como principal.
 *   3. Live fast path expira sem achar a chave (nativo mockado para nunca
 *      detectar nada) → fecha sozinho e abre "Fotografar código" automaticamente.
 *   4. ImageCapture indisponível → clicar "Fotografar código" aciona o input
 *      de câmera nativo (file chooser) em vez de mostrar a tela de preview.
 *   5. `takePhoto()` lança em tempo de execução → mesmo fallback (file
 *      chooser), sem crash.
 *   6. Pipeline de foto sem regressão: ImageCapture mockado devolvendo uma
 *      fixture sintética real (clean.png) → a análise encontra a mesma chave
 *      que o pipeline de arquivo já encontra para essa fixture.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.NFE_DEV_SERVER_URL || 'http://localhost:5173'
const CHAVE_SINTETICA = '42260112345678000199550010000000011000000014'

let pass = 0
let fail = 0
function report(label, ok, extra = '') {
  const icon = ok ? '✓' : '✗'
  console.log(`${icon} ${label}${extra ? ' — ' + extra : ''}`)
  if (ok) pass++
  else fail++
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
  const launch = (args = []) =>
    chromium
      .launch({ executablePath: chromePath, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...args] })
      .catch(() => chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...args] }))

  const openPage = async (browser, { mockNative = false, nativeAlwaysEmpty = false, imageCaptureMode = 'default', fixtureBase64 = null } = {}) => {
    const context = await browser.newContext({ permissions: ['camera'], hasTouch: true, viewport: { width: 390, height: 844 } })
    const page = await context.newPage()

    await page.addInitScript(
      ({ mockNative, nativeAlwaysEmpty, imageCaptureMode, fixtureBase64 }) => {
        if (mockNative) {
          window.BarcodeDetector = class {
            static async getSupportedFormats() {
              return ['code_128']
            }
            async detect() {
              return nativeAlwaysEmpty ? [] : []
            }
          }
        } else {
          // Garante estado limpo mesmo se o Chromium real do ambiente expuser BarcodeDetector.
          window.BarcodeDetector = undefined
        }

        if (imageCaptureMode === 'unavailable') {
          window.ImageCapture = undefined
        } else if (imageCaptureMode === 'throws') {
          window.ImageCapture = class {
            constructor() {}
            async takePhoto() {
              throw new DOMException('takePhoto não suportado neste aparelho (mock de teste).', 'NotSupportedError')
            }
          }
        } else if (imageCaptureMode === 'fixture') {
          window.ImageCapture = class {
            constructor() {}
            async takePhoto() {
              const res = await fetch(`data:image/png;base64,${fixtureBase64}`)
              return res.blob()
            }
          }
        }
      },
      { mockNative, nativeAlwaysEmpty, imageCaptureMode, fixtureBase64 },
    )

    await page.goto(`${BASE_URL}/#/leitura-automatica`, { waitUntil: 'networkidle' })
    return { context, page }
  }

  // Um navegador NOVO por cenário (não só um contexto novo): a câmera fake
  // do Chromium (--use-fake-device-for-media-stream) se mostrou instável
  // depois de várias aquisições de getUserMedia em contextos sucessivos
  // dentro do MESMO processo de navegador — observado como um
  // "NotFoundError" tratado corretamente pelo produto (mensagem "Nenhuma
  // câmera compatível..." + botão "Selecionar arquivo"), mas que não reflete
  // um problema real do app, só do processo compartilhado de teste. Mesma
  // categoria de flakiness de ferramenta já observada em rodadas anteriores
  // (contextos rápidos demais sobre um dispositivo fake compartilhado).

  // --- Cenário 1: sem nativo — Fotografar código é a ação principal -------
  {
    const browser = await launch()
    const { context, page } = await openPage(browser, { mockNative: false })
    await page.waitForTimeout(300) // tempo para isNativeCode128Supported() resolver
    const hasPhotoBtn = await page.locator('button:has-text("Fotografar código")').count()
    const hasScanBtn = await page.locator('button:has-text("Escanear código de barras")').count()
    const hasExperimental = await page.locator('button:has-text("Tentar scanner ao vivo (experimental)")').count()
    report('Cenário 1: sem nativo → "Fotografar código" aparece', hasPhotoBtn === 1)
    report('Cenário 1: sem nativo → "Escanear código de barras" não aparece', hasScanBtn === 0)
    report('Cenário 1: sem nativo → link experimental aparece', hasExperimental === 1)
    await context.close()
    await browser.close()
  }

  // --- Cenário 2: com nativo mockado — Escanear é a ação principal --------
  {
    const browser = await launch()
    const { context, page } = await openPage(browser, { mockNative: true, nativeAlwaysEmpty: true })
    await page.waitForTimeout(300)
    const hasScanBtn = await page.locator('button:has-text("Escanear código de barras")').count()
    const hasPhotoBtnPrimary = await page.locator('.nfe-source-actions button:has-text("Fotografar código")').count()
    report('Cenário 2: com nativo → "Escanear código de barras" aparece', hasScanBtn === 1)
    report('Cenário 2: com nativo → "Fotografar código" NÃO é ação principal', hasPhotoBtnPrimary === 0)
    await context.close()
    await browser.close()
  }

  // --- Cenário 3: live fast path expira → abre Fotografar código sozinho --
  {
    const browser = await launch()
    const { context, page } = await openPage(browser, { mockNative: true, nativeAlwaysEmpty: true })
    await page.waitForTimeout(300)
    await page.click('button:has-text("Escanear código de barras")')
    await page.waitForSelector('.nfe-scanner-overlay', { timeout: 5000 })
    const openedPhotoScreen = await page
      .waitForSelector('[aria-label="Fotografar código da NF-e"]', { timeout: 6000 })
      .then(() => true)
      .catch(() => false)
    const scannerStillOpen = (await page.locator('.nfe-scanner-overlay[aria-label="Escanear código de barras da NF-e"]').count()) > 0
    report('Cenário 3: timeout do fast path abre "Fotografar código" automaticamente', openedPhotoScreen)
    report('Cenário 3: o scanner ao vivo fechou sozinho (não ficou os dois abertos)', !scannerStillOpen)
    await context.close()
    await browser.close()
  }

  // --- Cenário 4: ImageCapture indisponível → cai para input nativo -------
  {
    const browser = await launch()
    const { context, page } = await openPage(browser, { mockNative: false, imageCaptureMode: 'unavailable' })
    await page.waitForTimeout(300)
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null)
    await page.click('.nfe-source-actions >> button:has-text("Fotografar código")')
    const chooser = await fileChooserPromise
    const previewShown = (await page.locator('[aria-label="Fotografar código da NF-e"]').count()) > 0
    report('Cenário 4: ImageCapture indisponível aciona o seletor de arquivo nativo', Boolean(chooser))
    report('Cenário 4: nunca mostra a tela de preview quebrada', !previewShown)
    await context.close()
    await browser.close()
  }

  // --- Cenário 5: takePhoto() lança → cai para input nativo, sem crash ----
  // Nota: o botão principal da página ("Fotografar código") e o obturador
  // dentro do overlay (.nfe-photocapture-shutter) têm o MESMO texto — por
  // isso o obturador é sempre clicado pela classe CSS, nunca por texto, para
  // não ambiguar com o botão da página por trás do overlay.
  {
    const browser = await launch()
    const { context, page } = await openPage(browser, { mockNative: false, imageCaptureMode: 'throws' })
    page.on('pageerror', (err) => report('Cenário 5: sem exceção não tratada na página', false, err.message))
    await page.waitForTimeout(300)
    await page.click('.nfe-source-actions >> button:has-text("Fotografar código")')
    await page.waitForSelector('.nfe-photocapture-shutter', { timeout: 5000 })
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null)
    await page.click('.nfe-photocapture-shutter')
    const chooser = await fileChooserPromise
    report('Cenário 5: takePhoto() lançando cai para o seletor de arquivo nativo', Boolean(chooser))
    await context.close()
    await browser.close()
  }

  // --- Cenário 6: pipeline de foto sem regressão (fixture real) -----------
  {
    const browser = await launch()
    const fixtureBase64 = readFileSync(join(HERE, 'clean.png')).toString('base64')
    const { context, page } = await openPage(browser, { mockNative: false, imageCaptureMode: 'fixture', fixtureBase64 })
    await page.waitForTimeout(300)
    await page.click('.nfe-source-actions >> button:has-text("Fotografar código")')
    await page.waitForSelector('.nfe-photocapture-shutter', { timeout: 5000 })
    await page.click('.nfe-photocapture-shutter')
    await page.waitForSelector('h2:has-text("2. Revisão")', { timeout: 10000 }).catch(() => {})
    const reviewVisible = (await page.locator('h2:has-text("2. Revisão")').count()) > 0
    let chaveValue = null
    if (reviewVisible) {
      chaveValue = await page
        .locator('.form-grid input')
        .evaluateAll((inputs) => inputs.map((i) => i.value).find((v) => v && v.length === 44))
    }
    report('Cenário 6: pipeline de foto encontra a chave da fixture sintética', chaveValue === CHAVE_SINTETICA, String(chaveValue))
    await context.close()
    await browser.close()
  }

  console.log(`\n${pass} passou(aram), ${fail} falhou(aram).`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Falha ao rodar a validação:', err)
  process.exit(1)
})
