import test from 'node:test'
import assert from 'node:assert/strict'
import { isScannerDebugEnabled } from './scannerDebug.js'

function withWindow(search, fn) {
  const original = globalThis.window
  globalThis.window = { location: { search } }
  try {
    return fn()
  } finally {
    if (original === undefined) delete globalThis.window
    else globalThis.window = original
  }
}

test('flag ausente: desativado', () => {
  withWindow('', () => assert.equal(isScannerDebugEnabled(), false))
})

test('?nfeScannerDebug=1 ativa', () => {
  withWindow('?nfeScannerDebug=1', () => assert.equal(isScannerDebugEnabled(), true))
})

test('flag com outro valor não ativa', () => {
  withWindow('?nfeScannerDebug=true', () => assert.equal(isScannerDebugEnabled(), false))
})

test('flag combinada com outros parâmetros continua funcionando', () => {
  withWindow('?foo=bar&nfeScannerDebug=1', () => assert.equal(isScannerDebugEnabled(), true))
})

test('sem window (ambiente não-browser) não lança, devolve false', () => {
  const original = globalThis.window
  delete globalThis.window
  try {
    assert.equal(isScannerDebugEnabled(), false)
  } finally {
    if (original !== undefined) globalThis.window = original
  }
})
