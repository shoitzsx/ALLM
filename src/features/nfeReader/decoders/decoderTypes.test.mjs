import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDecodeResult, ENGINE, maskValue, unavailableResult } from './decoderTypes.js'

const CHAVE_VALIDA = '42260112345678000199550010000000011000000014'

test('maskValue mascara mantendo só prefixo/sufixo', () => {
  assert.equal(maskValue(CHAVE_VALIDA), `4226${'•'.repeat(36)}0014`)
})

test('maskValue com valor curto vira só bolinhas', () => {
  assert.equal(maskValue('123'), '•••')
})

test('maskValue com valor vazio devolve null', () => {
  assert.equal(maskValue(''), null)
  assert.equal(maskValue(null), null)
})

test('buildDecodeResult classifica chave válida', () => {
  const result = buildDecodeResult(ENGINE.ZXING, { available: true, rawValue: CHAVE_VALIDA, decodeTimeMs: 12.7 })
  assert.equal(result.engine, ENGINE.ZXING)
  assert.equal(result.available, true)
  assert.equal(result.detected, true)
  assert.equal(result.format, 'CODE_128')
  assert.equal(result.digitCount, 44)
  assert.equal(result.validNfeKey, true)
  assert.equal(result.maskedValue, `4226${'•'.repeat(36)}0014`)
  assert.equal(result.decodeTimeMs, 13)
  assert.equal(result.error, null)
})

test('buildDecodeResult classifica barcode detectado mas com chave inválida (DV errado)', () => {
  const invalida = CHAVE_VALIDA.slice(0, -1) + '9'
  const result = buildDecodeResult(ENGINE.NATIVE, { available: true, rawValue: invalida })
  assert.equal(result.detected, true)
  assert.equal(result.digitCount, 44)
  assert.equal(result.validNfeKey, false)
})

test('buildDecodeResult classifica barcode com menos de 44 dígitos', () => {
  const result = buildDecodeResult(ENGINE.ZBAR, { available: true, rawValue: '12345' })
  assert.equal(result.detected, true)
  assert.equal(result.digitCount, 5)
  assert.equal(result.validNfeKey, false)
})

test('buildDecodeResult sem rawValue é not-detected', () => {
  const result = buildDecodeResult(ENGINE.ZXING, { available: true, rawValue: null })
  assert.equal(result.detected, false)
  assert.equal(result.format, null)
  assert.equal(result.maskedValue, null)
  assert.equal(result.validNfeKey, false)
})

test('buildDecodeResult propaga erro técnico sem mascarar nada', () => {
  const result = buildDecodeResult(ENGINE.ZBAR, { available: true, error: 'boom' })
  assert.equal(result.error, 'boom')
  assert.equal(result.detected, false)
})

test('unavailableResult marca available=false sem inventar tempo', () => {
  const result = unavailableResult(ENGINE.NATIVE)
  assert.equal(result.available, false)
  assert.equal(result.decodeTimeMs, null)
  assert.equal(result.detected, false)
})
