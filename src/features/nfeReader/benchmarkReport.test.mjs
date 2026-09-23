import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiagnosticsReportText } from './benchmarkReport.js'
import { ENGINE } from './decoders/decoderTypes.js'

test('monta o texto com os campos esperados e sem dados fiscais', () => {
  const text = buildDiagnosticsReportText({
    browser: 'Chrome 130',
    platform: 'Android',
    viewport: '390x844',
    cameraResolution: '1280x720',
    orientation: 'portrait',
    autoEngine: 'BarcodeDetector nativo',
    results: [
      { engine: ENGINE.NATIVE, available: true, detected: false, validNfeKey: false, decodeTimeMs: null, error: null },
      { engine: ENGINE.ZXING, available: true, detected: true, validNfeKey: true, decodeTimeMs: 620, error: null },
      { engine: ENGINE.ZBAR, available: true, detected: true, validNfeKey: false, decodeTimeMs: 200, error: 'boom' },
    ],
  })

  assert.match(text, /^ALM NF-e Scanner Benchmark/)
  assert.match(text, /Browser: Chrome 130/)
  assert.match(text, /BarcodeDetector nativo:/)
  assert.match(text, /ZXing:/)
  assert.match(text, /ZBar \(WASM\):/)
  assert.match(text, /tempo de decode: 620ms/)
  assert.match(text, /erro técnico: boom/)

  // Nunca deve conter uma chave de 44 dígitos, CNPJ, ou os rótulos de dados fiscais proibidos.
  assert.equal(/\d{44}/.test(text), false)
  for (const forbidden of ['CNPJ', 'chave completa', 'pedido', 'valor', 'fornecedor']) {
    assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, `não deveria conter "${forbidden}"`)
  }
})

test('campos ausentes viram N/D, nunca undefined/vazio no texto', () => {
  const text = buildDiagnosticsReportText({ results: [] })
  assert.match(text, /Browser: N\/D/)
  assert.match(text, /Engine automático atual \(produção\): N\/D/)
})

test('inclui seção de teste ao vivo quando liveResults é passado', () => {
  const text = buildDiagnosticsReportText({
    results: [],
    liveResults: {
      [ENGINE.ZBAR]: { outcome: 'found', attempts: 12, elapsedMs: 1340 },
      [ENGINE.NATIVE]: null,
    },
  })
  assert.match(text, /Teste ao vivo \(até 10s por engine\):/)
  assert.match(text, /ZBar \(WASM\): found — 12 tentativa\(s\) em 1340ms/)
  assert.equal(text.includes('BarcodeDetector nativo: '), false)
})

test('sem liveResults, não inclui a seção', () => {
  const text = buildDiagnosticsReportText({ results: [] })
  assert.equal(text.includes('Teste ao vivo'), false)
})
