import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsAttention, STATUS_META, summarizeArrivals } from './portariaMetrics.js'

const arrival = (status, numeroNf = '123') => ({ status, numeroNf })

test('resumo da Portaria usa somente os estados reais do banco', () => {
  const list = [arrival('REGISTRADA'), arrival('REGISTRADA', null),
    arrival('VINCULADA'), arrival('CANCELADA'), arrival('OUTRO')]
  const result = summarizeArrivals(list)
  assert.equal(result.total, 5)
  assert.equal(result.registradas, 2)
  assert.equal(result.vinculadas, 1)
  assert.equal(result.canceladas, 1)
  assert.equal(result.semNf, 1)
  assert.equal(result.statusDesconhecido, 1)
  assert.deepEqual(result.porStatus.map(({ key, total }) => [key, total]),
    [['REGISTRADA', 2], ['VINCULADA', 1], ['CANCELADA', 1]])
  assert.equal(result.porStatus[0].share, 2 / 5)
  assert.deepEqual(Object.keys(STATUS_META), ['REGISTRADA', 'VINCULADA', 'CANCELADA'])
})

test('atenção indica chegada sem REC ou sem NF, sem presumir espera de veículo', () => {
  assert.equal(needsAttention(arrival('REGISTRADA')), true)
  assert.equal(needsAttention(arrival('VINCULADA')), false)
  assert.equal(needsAttention(arrival('VINCULADA', '')), true)
  assert.equal(needsAttention(arrival('CANCELADA')), false)
})

test('resumo vazio é estável e não altera as chegadas recebidas', () => {
  for (const empty of [[], null, undefined]) {
    const result = summarizeArrivals(empty)
    assert.equal(result.total, 0)
    assert.equal(result.registradas, 0)
    assert.equal(result.vinculadas, 0)
    assert.ok(result.porStatus.every(({ total, share }) => total === 0 && share === 0))
  }
  const list = Object.freeze([Object.freeze(arrival('REGISTRADA'))])
  assert.deepEqual(summarizeArrivals(list), summarizeArrivals(list))
})
