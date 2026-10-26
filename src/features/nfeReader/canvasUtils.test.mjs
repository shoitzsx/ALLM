/**
 * Só a aritmética pura de canvasUtils.js (`computeUpscaleFactor`) — as
 * demais funções do arquivo exigem `document`/Canvas e não rodam sob
 * `node --test` (mesmo motivo pelo qual não existe um barcodeReader.test.mjs
 * ou ocrReader.test.mjs: ver README.md do módulo).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeUpscaleFactor } from './canvasUtils.js'

test('computeUpscaleFactor não amplia quando já está larga o bastante', () => {
  assert.equal(computeUpscaleFactor(1600, 1200, 3), 1)
  assert.equal(computeUpscaleFactor(1200, 1200, 3), 1, 'exatamente no limite não precisa ampliar')
})

test('computeUpscaleFactor calcula o fator mínimo para alcançar o alvo', () => {
  assert.equal(computeUpscaleFactor(600, 1200, 3), 2)
})

test('computeUpscaleFactor arredonda para cima (não pode ficar abaixo do alvo)', () => {
  // 1200/499 ≈ 2.405 — um fator 2 deixaria em 998px, ainda abaixo do alvo.
  assert.equal(computeUpscaleFactor(499, 1200, 3), 3)
})

test('computeUpscaleFactor nunca passa do teto, mesmo que o cálculo exato peça mais', () => {
  assert.equal(computeUpscaleFactor(100, 1200, 3), 3)
})

test('computeUpscaleFactor trata largura zero/ausente como "não ampliar" (evita divisão por zero)', () => {
  assert.equal(computeUpscaleFactor(0, 1200, 3), 1)
})
