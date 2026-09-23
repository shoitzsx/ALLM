#!/usr/bin/env node
/**
 * Validação repetível de imagem → barcode → chave, contra o decoder REAL do
 * módulo (não uma simulação) — pede exatamente o que a tarefa de robustez do
 * scanner descreveu: "quero uma maneira repetível de testar: imagem →
 * barcode → chave", já que o ambiente Node puro não tem Canvas DOM para
 * `npm test` cobrir isso (ver README.md do módulo, seção "Testes").
 *
 * Como rodar:
 *   1. `npm run dev` num terminal (precisa do servidor em http://localhost:5173).
 *   2. Instalar o driver do Playwright uma vez, sem adicionar ao projeto:
 *        npm install --no-save playwright-core
 *   3. `node src/features/nfeReader/testFixtures/validate-fixtures.mjs`
 *
 * Por que `--no-save`/sem dependência nova no projeto: isto é uma ferramenta
 * de desenvolvimento opcional, não código que roda no app — não faz sentido
 * pesar o bundle/instalação de todo mundo por causa dela (mesmo raciocínio
 * de "não adicionar biblioteca sem necessidade" do resto do módulo).
 *
 * O script abre uma aba real, desenha cada fixture num <canvas> e chama
 * `readCode128FromCanvas` (barcodeReader.js) do jeito que o app realmente
 * usa — os mesmos estágios (nativo/imagem inteira/recortes/margem
 * artificial/deskew) documentados em barcodeReader.js. Cada fixture tem uma
 * expectativa (`shouldDecode: true/false`) baseada no que foi medido
 * empiricamente ao construir o estágio de deskew — ver README.md deste
 * diretório para os números completos.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.NFE_DEV_SERVER_URL || 'http://localhost:5173'

// A mesma chave sintética usada para gerar todas as fixtures (ver README.md
// deste diretório) — nunca um CNPJ/NF real.
const CHAVE_SINTETICA = '42260112345678000199550010000000011000000014'

const FIXTURES = [
  { file: 'clean.png', shouldDecode: true, note: 'margem generosa, sem inclinação' },
  { file: 'tight-margin.png', shouldDecode: true, note: 'margem pequena, mas ainda presente' },
  { file: 'zero-margin.png', shouldDecode: true, note: 'barras tocando a borda da imagem' },
  { file: 'rotated-90deg.png', shouldDecode: true, note: 'rotação cardeal — já coberta sem deskew' },
  { file: 'low-res.png', shouldDecode: true, note: 'módulo de barra de 1px' },
  { file: 'low-contrast.png', shouldDecode: true, note: 'barras cinza sobre fundo quase branco' },
  { file: 'tilted-2deg.png', shouldDecode: true, note: 'dentro da tolerância sem deskew (~2°)' },
  { file: 'tilted-6deg.png', shouldDecode: true, note: 'recuperado pelo estágio de deskew' },
  {
    file: 'tilted-10deg.png',
    shouldDecode: false,
    note: 'fora do alcance do conjunto de ângulos de deskew atual — limitação conhecida, ver README',
  },
  { file: 'tight-margin-tilted-4deg.png', shouldDecode: true, note: 'margem pequena + inclinação combinadas — recuperado pelo deskew' },
]

async function main() {
  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch {
    console.error('playwright-core não encontrado. Rode: npm install --no-save playwright-core')
    process.exit(1)
  }

  const chromePath = process.env.NFE_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const browser = await chromium.launch({ executablePath: chromePath, headless: true }).catch(async () => {
    // Sem Chrome do sistema num caminho conhecido: tenta o Chromium baixado pelo Playwright, se houver.
    return chromium.launch({ headless: true })
  })
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await context.newPage()
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })

  let pass = 0
  let fail = 0
  for (const fixture of FIXTURES) {
    const filePath = join(HERE, fixture.file)
    const b64 = readFileSync(filePath).toString('base64')
    const result = await page.evaluate(async ({ b64, chave }) => {
      const barcodeMod = await import('/src/features/nfeReader/barcodeReader.js')
      const chaveMod = await import('/src/features/nfeReader/chaveNFe.js')
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
      const text = await barcodeMod.readCode128FromCanvas(canvas)
      const decodedKey = text ? chaveMod.normalizarChave(text) : null
      return { decoded: Boolean(text), matches: decodedKey === chave }
    }, { b64, chave: CHAVE_SINTETICA })

    const ok = result.decoded === fixture.shouldDecode && (!result.decoded || result.matches)
    if (ok) pass++
    else fail++
    const icon = ok ? '✓' : '✗'
    console.log(
      `${icon} ${fixture.file.padEnd(32)} esperado=${fixture.shouldDecode} obtido=${result.decoded} chave_confere=${result.matches} — ${fixture.note}`,
    )
  }

  console.log(`\n${pass} passou(aram), ${fail} falhou(aram), de ${FIXTURES.length} fixtures.`)
  await context.close()
  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Falha ao rodar a validação:', err)
  process.exit(1)
})
