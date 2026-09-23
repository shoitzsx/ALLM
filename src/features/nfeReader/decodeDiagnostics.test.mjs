import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDecodedText, createDiagnosticsCounter, DECODE_OUTCOME } from './decodeDiagnostics.js'

const CHAVE_METALFORT = '42260748909580000160550010000082801675042868'

test('classifyDecodedText: null/vazio conta como not_found', () => {
  assert.equal(classifyDecodedText(null), DECODE_OUTCOME.NOT_FOUND)
  assert.equal(classifyDecodedText(''), DECODE_OUTCOME.NOT_FOUND)
})

test('classifyDecodedText: texto com menos ou mais de 44 dígitos conta como invalid_length', () => {
  assert.equal(classifyDecodedText('123456'), DECODE_OUTCOME.INVALID_LENGTH)
  assert.equal(classifyDecodedText(CHAVE_METALFORT + '9'), DECODE_OUTCOME.INVALID_LENGTH)
})

test('classifyDecodedText: 44 dígitos com DV errado conta como invalid_dv', () => {
  const dvErrado = CHAVE_METALFORT.slice(0, 43) + '0'
  assert.equal(classifyDecodedText(dvErrado), DECODE_OUTCOME.INVALID_DV)
})

test('classifyDecodedText: chave válida conta como valid', () => {
  assert.equal(classifyDecodedText(CHAVE_METALFORT), DECODE_OUTCOME.VALID)
})

test('classifyDecodedText: normaliza antes de classificar (aceita espaços)', () => {
  assert.equal(classifyDecodedText('4226 0748 9095 8000 0160 5500 1000 0082 8016 7504 2868'), DECODE_OUTCOME.VALID)
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
