import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LEVEL,
  FALLBACK_LEVEL,
  LEVEL_META,
  NOTIFICATION_LEVELS,
  displayTitle,
  normalizeLevel,
} from './levels.js'

test('existem exatamente os cinco níveis pedidos, e os valores antigos de pushToast continuam valendo', () => {
  assert.deepEqual(Object.keys(NOTIFICATION_LEVELS), ['SUCCESS', 'INFO', 'WARNING', 'ERROR', 'PROGRESS'])
  assert.equal(NOTIFICATION_LEVELS.SUCCESS, 'success')
  assert.equal(NOTIFICATION_LEVELS.ERROR, 'error')
  assert.deepEqual(Object.keys(LEVEL_META).sort(), Object.values(NOTIFICATION_LEVELS).sort())
})

test('durações, papel ARIA e rótulo de cada nível', () => {
  assert.equal(LEVEL_META.success.duration, 4400)
  assert.equal(LEVEL_META.info.duration, 5000)
  assert.equal(LEVEL_META.warning.duration, 6500)
  assert.equal(LEVEL_META.error.duration, 8000)
  assert.equal(LEVEL_META.progress.duration, null)

  assert.equal(LEVEL_META.error.role, 'alert')
  for (const level of ['success', 'info', 'warning', 'progress']) {
    assert.equal(LEVEL_META[level].role, 'status', level)
  }
  for (const meta of Object.values(LEVEL_META)) {
    assert.ok(meta.label.length > 0)
  }
})

test('as tabelas de nível são imutáveis', () => {
  assert.ok(Object.isFrozen(NOTIFICATION_LEVELS))
  assert.ok(Object.isFrozen(LEVEL_META))
  assert.ok(Object.isFrozen(LEVEL_META.error))
})

test('normalizeLevel: vazio vira SUCCESS (o type = "success" histórico)', () => {
  assert.equal(DEFAULT_LEVEL, 'success')
  for (const value of [undefined, null, '', '   ', 0, false]) {
    assert.equal(normalizeLevel(value), 'success', String(value))
  }
})

test('normalizeLevel: aceita caixa e espaços', () => {
  assert.equal(normalizeLevel('ERROR'), 'error')
  assert.equal(normalizeLevel(' Warning '), 'warning')
  assert.equal(normalizeLevel('progress'), 'progress')
  assert.equal(normalizeLevel(NOTIFICATION_LEVELS.INFO), 'info')
})

test('normalizeLevel: valor inválido cai em INFO, nunca em SUCCESS', () => {
  assert.equal(FALLBACK_LEVEL, 'info')
  for (const value of ['banana', 'warn', 42, {}, [], true, 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(normalizeLevel(value), 'info', String(value))
  }
})

test('normalizeLevel funciona em navegador sem Object.hasOwn (Safari < 15.4, Chrome < 93, Firefox < 92)', () => {
  // O build do Vite mira Safari 14 / Chrome 87 / Firefox 78 e não preenche APIs que faltam.
  const original = Object.hasOwn
  Object.hasOwn = undefined
  try {
    assert.equal(normalizeLevel('error'), 'error')
    assert.equal(normalizeLevel(' Progress '), 'progress')
    assert.equal(normalizeLevel(undefined), 'success')
    assert.equal(normalizeLevel('banana'), 'info')
    for (const herdado of ['__proto__', 'toString', 'hasOwnProperty', 'constructor']) {
      assert.equal(normalizeLevel(herdado), 'info', herdado)
    }
  } finally {
    Object.hasOwn = original
  }
})

test('displayTitle usa o título informado, ou o rótulo do nível quando não há', () => {
  assert.equal(displayTitle({ level: 'error', title: 'Falha ao salvar' }), 'Falha ao salvar')
  assert.equal(displayTitle({ level: 'error', title: '' }), 'Erro')
  assert.equal(displayTitle({ level: 'progress', title: '' }), 'Em andamento')
  assert.equal(displayTitle({ level: 'warning', title: '' }), 'Atenção')
})
