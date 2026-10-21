import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDecodedText, createDiagnosticsCounter, DECODE_OUTCOME } from './decodeDiagnostics.js'

// Chave sintética (fictícia), com dígito verificador válido — a mesma dos fixtures de imagem.
const CHAVE_EXEMPLO = '42260112345678000199550010000000011000000014'

test('classifyDecodedText: null/vazio conta como not_found', () => {
  assert.equal(classifyDecodedText(null), DECODE_OUTCOME.NOT_FOUND)
  assert.equal(classifyDecodedText(''), DECODE_OUTCOME.NOT_FOUND)
})

test('classifyDecodedText: texto com menos ou mais de 44 dígitos conta como invalid_length', () => {
  assert.equal(classifyDecodedText('123456'), DECODE_OUTCOME.INVALID_LENGTH)
  assert.equal(classifyDecodedText(CHAVE_EXEMPLO + '9'), DECODE_OUTCOME.INVALID_LENGTH)
})

test('classifyDecodedText: 44 dígitos com DV errado conta como invalid_dv', () => {
  const dvErrado = CHAVE_EXEMPLO.slice(0, 43) + '0'
  assert.equal(classifyDecodedText(dvErrado), DECODE_OUTCOME.INVALID_DV)
})

test('classifyDecodedText: chave válida conta como valid', () => {
  assert.equal(classifyDecodedText(CHAVE_EXEMPLO), DECODE_OUTCOME.VALID)
})

test('classifyDecodedText: normaliza antes de classificar (aceita espaços)', () => {
  assert.equal(classifyDecodedText('4226 0112 3456 7800 0199 5500 1000 0000 0110 0000 0014'), DECODE_OUTCOME.VALID)
})

test('createDiagnosticsCounter: acumula contagens e nunca perde uma tentativa', () => {
  const counter = createDiagnosticsCounter()
  counter.record(DECODE_OUTCOME.NOT_FOUND)
  counter.record(DECODE_OUTCOME.NOT_FOUND)
  counter.record(DECODE_OUTCOME.INVALID_LENGTH)
  counter.record(DECODE_OUTCOME.INVALID_DV)
  counter.record(DECODE_OUTCOME.VALID)
  const summary = counter.summary()
  assert.equal(summary.attempts, 5)
  assert.equal(summary.not_found, 2)
  assert.equal(summary.invalid_length, 1)
  assert.equal(summary.invalid_dv, 1)
  assert.equal(summary.valid, 1)
})

test('createDiagnosticsCounter: summary() é uma cópia, não referência viva', () => {
  const counter = createDiagnosticsCounter()
  const first = counter.summary()
  counter.record(DECODE_OUTCOME.VALID)
  assert.equal(first.attempts, 0, 'a cópia anterior não deve mudar com registros posteriores')
  assert.equal(counter.summary().attempts, 1)
})
