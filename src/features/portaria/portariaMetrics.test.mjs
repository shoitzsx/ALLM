import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mockTodayArrivals, STATUS_META } from './mockPortariaData.js'
import { needsAttention, summarizeArrivals } from './portariaMetrics.js'

// D-1 — indicadores do Painel do dia da Portaria. Calculados só a partir da lista de chegadas
// que a página tem em memória (hoje, simulada). Nenhum horário, previsão, espera ou permanência
// é derivado aqui: o modelo não tem esses eventos.

const arrival = (overrides = {}) => ({ id: Math.random().toString(36).slice(2), codigo: 'CHG-1', numeroNf: '1', fornecedor: 'F', status: 'REGISTRADA', criadoEm: '08:00', ...overrides })

test('resumo da lista simulada inicial: total, registradas, pendentes e sem NF vêm do array', () => {
  const s = summarizeArrivals(mockTodayArrivals)
  assert.equal(s.total, mockTodayArrivals.length)
  assert.equal(s.registradas, mockTodayArrivals.filter((a) => a.status === 'REGISTRADA').length)
  assert.equal(s.pendentes, mockTodayArrivals.filter((a) => a.status === 'PENDENTE').length)
  assert.equal(s.semNf, mockTodayArrivals.filter((a) => !String(a.numeroNf || '').trim()).length)
})

test('distribuição por status segue STATUS_META (rótulo e tom) e conta status desconhecido à parte', () => {
  const s = summarizeArrivals([arrival(), arrival({ status: 'PENDENTE' }), arrival({ status: 'PENDENTE' }), arrival({ status: 'OUTRO' }), arrival({ status: undefined })])
  assert.deepEqual(s.porStatus.map((i) => [i.key, i.label, i.tone, i.total]), Object.entries(STATUS_META).map(([key, meta]) => [key, meta.label, meta.tone, key === 'REGISTRADA' ? 1 : 2]))
  assert.equal(s.statusDesconhecido, 2)
  assert.equal(s.total, 5)
  assert.equal(s.porStatus.find((i) => i.key === 'PENDENTE').share, 2 / 5)
})

test('adicionar uma chegada simulada (como confirmArrival faz) atualiza todos os indicadores', () => {
  const antes = summarizeArrivals(mockTodayArrivals)
  const nova = arrival({ id: 'nova', status: 'REGISTRADA', numeroNf: '' })
  const depois = summarizeArrivals([nova, ...mockTodayArrivals])
  assert.equal(depois.total, antes.total + 1)
  assert.equal(depois.registradas, antes.registradas + 1)
  assert.equal(depois.pendentes, antes.pendentes)
  assert.equal(depois.semNf, antes.semNf + 1)
  assert.equal(depois.atencao[0].id, 'nova')
})

test('atenção: pendente OU sem NF identificada — nada além disso (não presume veículo no pátio)', () => {
  assert.equal(needsAttention(arrival()), false)
  assert.equal(needsAttention(arrival({ status: 'PENDENTE' })), true)
  assert.equal(needsAttention(arrival({ numeroNf: '  ' })), true)
  assert.equal(needsAttention(arrival({ numeroNf: null })), true)
  const s = summarizeArrivals(mockTodayArrivals)
  assert.deepEqual(s.atencao.map((a) => a.id), mockTodayArrivals.filter((a) => a.status === 'PENDENTE' || !a.numeroNf).map((a) => a.id))
})

test('lista vazia ou ausente: tudo zero, sem divisão por zero', () => {
  for (const vazio of [[], null, undefined]) {
    const s = summarizeArrivals(vazio)
    assert.equal(s.total, 0)
    assert.equal(s.registradas, 0)
    assert.equal(s.pendentes, 0)
    assert.equal(s.semNf, 0)
    assert.deepEqual(s.atencao, [])
    assert.ok(s.porStatus.every((i) => i.total === 0 && i.share === 0))
  }
})

test('não altera o array nem os objetos recebidos e é determinístico', () => {
  const lista = Object.freeze(mockTodayArrivals.map((a) => Object.freeze({ ...a })))
  const before = JSON.stringify(lista)
  assert.deepEqual(summarizeArrivals(lista), summarizeArrivals(lista))
  assert.equal(JSON.stringify(lista), before)
})

test('o resumo não expõe métricas que o modelo não sustenta (espera, permanência, previstas, aguardando)', () => {
  const s = summarizeArrivals(mockTodayArrivals)
  for (const chave of ['tempoMedioEspera', 'tempoMedioPermanencia', 'previstas', 'aguardando', 'saidas']) assert.equal(chave in s, false, chave)
})
