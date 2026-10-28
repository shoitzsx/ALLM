import test from 'node:test'
import assert from 'node:assert/strict'
import { TOUCH_KEYPAD_QUERY, prefersTouchKeypad, subscribeToInteractionChanges } from './inputModality.js'

/** matchMedia falso a partir de um conjunto de consultas verdadeiras (sem largura, sem user-agent). */
const media = (...truthy) => (query) => ({ matches: truthy.includes(query) })
const Q = TOUCH_KEYPAD_QUERY

test('celular/tablet só de toque: ponteiro impreciso, sem hover, sem mouse → teclado do ALM', () => {
  assert.equal(prefersTouchKeypad(media(Q.primaryPointerCoarse, Q.primaryHoverNone)), true)
})

test('computador com mouse e teclado: sem teclado integrado por padrão', () => {
  assert.equal(prefersTouchKeypad(media(Q.anyPointerFine)), false)
  assert.equal(prefersTouchKeypad(media()), false)
})

test('notebook com tela de toque: ponteiro primário é fino → sem teclado integrado', () => {
  assert.equal(prefersTouchKeypad(media(Q.anyPointerFine)), false)
})

test('tablet com mouse/trackpad conectado (any-pointer: fine) → teclado do dispositivo', () => {
  assert.equal(prefersTouchKeypad(media(Q.primaryPointerCoarse, Q.primaryHoverNone, Q.anyPointerFine)), false)
})

test('exige as DUAS condições primárias: só ponteiro impreciso ou só sem hover não basta', () => {
  assert.equal(prefersTouchKeypad(media(Q.primaryPointerCoarse)), false)
  assert.equal(prefersTouchKeypad(media(Q.primaryHoverNone)), false)
})

test('a decisão vem das capacidades, nunca da largura da tela nem do user-agent', () => {
  // Janela estreita de desktop e tela larga de celular em paisagem: só a consulta de capacidade conta.
  const narrowDesktop = (query) => ({ matches: query === Q.anyPointerFine || query === '(max-width: 320px)' })
  const wideLandscapePhone = (query) => ({ matches: query === Q.primaryPointerCoarse || query === Q.primaryHoverNone || query === '(min-width: 900px)' })
  assert.equal(prefersTouchKeypad(narrowDesktop), false)
  assert.equal(prefersTouchKeypad(wideLandscapePhone), true)
  const asked = []
  prefersTouchKeypad((query) => {
    asked.push(query)
    return { matches: true }
  })
  assert.ok(asked.length > 0)
  for (const query of asked) {
    assert.ok(Object.values(Q).includes(query), `consulta inesperada: ${query}`)
    assert.doesNotMatch(query, /width|height|orientation|userAgent/i)
  }
})

test('sem matchMedia (ou com falha) cai no padrão seguro: sem teclado integrado', () => {
  assert.equal(prefersTouchKeypad(undefined), false)
  assert.equal(prefersTouchKeypad(null), false)
  assert.equal(prefersTouchKeypad(() => {
    throw new Error('boom')
  }), false)
  assert.equal(prefersTouchKeypad(() => null), false)
})

test('assina e cancela mudanças de dispositivo (addEventListener e addListener antigo)', () => {
  const calls = []
  const make = (modern) => (query) => (modern
    ? { addEventListener: (t, fn) => calls.push(['add', query, t, fn]), removeEventListener: (t, fn) => calls.push(['remove', query, t, fn]) }
    : { addListener: (fn) => calls.push(['addListener', query, fn]), removeListener: (fn) => calls.push(['removeListener', query, fn]) })
  const onChange = () => {}
  const stop = subscribeToInteractionChanges({ matchMedia: make(true) }, onChange)
  assert.equal(calls.filter((c) => c[0] === 'add').length, 3)
  stop()
  assert.equal(calls.filter((c) => c[0] === 'remove').length, 3)
  calls.length = 0
  const stopOld = subscribeToInteractionChanges({ matchMedia: make(false) }, onChange)
  assert.equal(calls.filter((c) => c[0] === 'addListener').length, 3)
  stopOld()
  assert.equal(calls.filter((c) => c[0] === 'removeListener').length, 3)
  assert.equal(typeof subscribeToInteractionChanges(undefined, onChange), 'function')
})
