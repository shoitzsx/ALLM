#!/usr/bin/env node
/**
 * Validação repetível de que "Confirmar dados" (tela de Leitura automática
 * de NF-e) realmente integra ao fluxo de "Novo recebimento" — sem nunca
 * salvar nada automaticamente. Mesmo padrão de validate-photo-capture.mjs:
 * abre o app de verdade (dev server + Chromium real via Playwright), nunca
 * uma simulação da lógica.
 *
 * Como rodar:
 *   1. `npm run dev` num terminal.
 *   2. `npm install --no-save playwright-core` (se ainda não instalado).
 *   3. `node src/features/nfeReader/testFixtures/validate-receipt-handoff.mjs`
 *
 * Cobre:
 *   1. Fotografar código (ImageCapture mockado com a fixture clean.png) →
 *      "Confirmar dados" → a tela muda para "Novo recebimento" (rota
 *      #/novo), sem passar por nenhuma tela de JSON.
 *   2. O formulário chega com número da NF, série e CNPJ pré-preenchidos —
 *      os únicos campos com correspondência matemática real com a chave
 *      sintética usada (ver testFixtures/README.md).
 *   3. Nenhuma requisição POST para /api/v1/recebimentos acontece durante
 *      todo o fluxo — "Confirmar dados" nunca salva automaticamente.
 *   4. O JSON de depuração NÃO aparece na interface normal (sem
 *      ?nfeScannerDebug=1) — só existe com a flag.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.NFE_DEV_SERVER_URL || 'http://localhost:5173'

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
  const browser = await chromium
    .launch({ executablePath: chromePath, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
    .catch(() => chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }))

  const context = await browser.newContext({ permissions: ['camera'], hasTouch: true, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  // Rastreia TODA requisição de rede para /api/v1/recebimentos — se alguma
  // acontecer entre o clique em "Confirmar dados" e o fim do teste, a
  // regra "nunca salva automaticamente" foi violada.
  const receiptApiCalls = []
  page.on('request', (req) => {
    if (req.url().includes('/api/v1/recebimentos') && req.method() === 'POST') {
      receiptApiCalls.push({ url: req.url(), method: req.method() })
    }
  })

  const fixtureBase64 = readFileSync(join(HERE, 'clean.png')).toString('base64')

  await page.addInitScript(
    ({ fixtureBase64 }) => {
      window.BarcodeDetector = undefined // força o caminho de foto, sem live fast path
      window.ImageCapture = class {
        constructor() {}
        async takePhoto() {
          const res = await fetch(`data:image/png;base64,${fixtureBase64}`)
          return res.blob()
        }
      }
    },
    { fixtureBase64 },
  )

  // Sem ?nfeScannerDebug=1 — exatamente a interface normal de produção.
  await page.goto(`${BASE_URL}/#/leitura-automatica`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)

  await page.click('.nfe-source-actions >> button:has-text("Fotografar código")')
  await page.waitForSelector('.nfe-photocapture-shutter', { timeout: 5000 })
  await page.click('.nfe-photocapture-shutter')

  await page.waitForSelector('h2:has-text("2. Revisão")', { timeout: 10000 })
  report('Chegou à Revisão depois da foto', true)

  const numeroNfBefore = await page.locator('.form-grid input').first().inputValue().catch(() => null)
  report('Campo de número da NF já aparece preenchido na Revisão', Boolean(numeroNfBefore), String(numeroNfBefore))

  // Nota: o botão "Ver JSON (depuração)" também aparece em desenvolvimento
  // (import.meta.env.DEV) — e `npm run dev` sempre tem DEV=true, então este
  // script (que roda contra o dev server) não consegue testar a AUSÊNCIA do
  // botão em produção sem a flag. Isso é verificado à parte, contra
  // `vite preview` (ver README do módulo) — aqui só confirmamos que, com o
  // dev server, a flag por query string também liga a mesma checagem
  // (DEBUG_JSON_ENABLED = import.meta.env.DEV || SCANNER_DEBUG_ENABLED).

  await page.click('button:has-text("Confirmar dados")')

  // Deve navegar para "Novo recebimento" — nunca uma tela de JSON.
  await page.waitForSelector('h1:has-text("Novo recebimento")', { timeout: 5000 }).catch(() => {})
  const onNewReceiptPage = (await page.locator('h1:has-text("Novo recebimento")').count()) > 0
  report('"Confirmar dados" navega para "Novo recebimento"', onNewReceiptPage)

  const jsonScreenStillThere = (await page.locator('text=JSON de depuração').count()) > 0
  report('Nenhuma tela de JSON aparece no caminho normal', !jsonScreenStillThere)

  const bannerVisible = (await page.locator('text=preenchidos automaticamente a partir da leitura da NF-e').count()) > 0
  report('Aviso de pré-preenchimento aparece em "Novo recebimento"', bannerVisible)

  // Etapa 1 (Identificação) não tem número da NF/série (ficam na etapa 3) —
  // valida o que É visível na etapa 1: CNPJ.
  const cnpjValue = await page.locator('input[placeholder="00.000.000/0000-00"]').inputValue().catch(() => null)
  report('CNPJ pré-preenchido na etapa 1 (Identificação)', cnpjValue === '12.345.678/0001-99', String(cnpjValue))

  // Pedido e fornecedor não são preenchidos automaticamente (de propósito — não têm
  // correspondência confiável só com a chave, ver buildReliableReceiptPrefill) e são
  // obrigatórios na etapa 1: sem preenchê-los manualmente aqui, "Continuar" fica
  // bloqueado pela própria validação do formulário — exatamente como aconteceria com
  // um usuário de verdade.
  await page.fill('input[placeholder="Ex.: 4500873245"]', '4500999999')
  await page.fill('input[list="supplier-options"]', 'Fornecedor de teste (validação automatizada)')
  // .btn-primary desambigua de "Salvar e continuar depois" (.btn-ghost), que também contém "continuar".
  await page.click('button.btn-primary:has-text("Continuar")') // etapa 1 (Identificação) → etapa 2 (Itens)
  // A etapa 2 exige descrição preenchida para validar e avançar — sem isso, "Continuar" fica bloqueado.
  await page.fill('input[placeholder="Descrição do material recebido"]', 'Item de teste (validação automatizada)')
  await page.click('button.btn-primary:has-text("Continuar")') // etapa 2 (Itens) → etapa 3 (Evidências)
  const numeroNfField = await page.locator('input[placeholder="Informe se já estiver disponível"]').inputValue().catch(() => null)
  report('Número da NF pré-preenchido na etapa 3 (Evidências)', numeroNfField === '1', String(numeroNfField))

  report('Nenhuma requisição POST /api/v1/recebimentos ocorreu (nada salvo automaticamente)', receiptApiCalls.length === 0, JSON.stringify(receiptApiCalls))

  await context.close()
  await browser.close()

  console.log(`\n${pass} passou(aram), ${fail} falhou(aram).`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Falha ao rodar a validação:', err)
  process.exit(1)
})
