import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapChegadaToRecebimentoInput, normalizeChegadaInput, planInicioRecebimento } from './services/chegadasService.mjs'

// Chave sintética válida, compartilhada conceitualmente com os testes do leitor de NF-e.
const key = '42260112345678000195550010000000011000000017'
const arrival = {
  id: 'CHG-ID', status: 'REGISTRADA', recebimentoId: null,
  nfeChaveAcesso: key, numeroNf: '1', serieNf: '1',
  cnpjEmitente: '12345678000195', fornecedor: 'Empresa ABC',
}

test('normalizes a valid NF-e key and derives its identity without trusting client-owned fields', () => {
  const normalized = normalizeChegadaInput({
    nfeChaveAcesso: key, metodoLeitura: 'MANUAL', fornecedor: ' Empresa ABC ',
    id: 'client-id', codigo: 'CHG-FAKE', criadoPor: 'other-user',
    criadoEm: 'yesterday', recebimentoId: 'other-receipt',
  })
  assert.deepEqual(normalized, {
    nfeChaveAcesso: key, numeroNf: '1', serieNf: '1',
    cnpjEmitente: '12345678000195', fornecedor: 'Empresa ABC',
    metodoLeitura: 'MANUAL', confianca: null, observacoes: null,
  })
})

test('allows an unknown supplier and NF identification without a key', () => {
  const normalized = normalizeChegadaInput({
    numeroNf: '1', cnpjEmitente: '12.345.678/0001-95',
    metodoLeitura: 'MANUAL', fornecedor: ' ',
  })
  assert.equal(normalized.fornecedor, null)
  assert.equal(normalized.cnpjEmitente, '12345678000195')
  assert.equal(normalized.nfeChaveAcesso, null)
})

test('does not turn structured client values into supplier or reading-method text', () => {
  assert.throws(() => normalizeChegadaInput({
    nfeChaveAcesso: key, metodoLeitura: { value: 'MANUAL' },
  }), (error) => error.status === 422 && Boolean(error.details.metodoLeitura))
  assert.equal(normalizeChegadaInput({
    nfeChaveAcesso: key, metodoLeitura: 'MANUAL', fornecedor: { nome: 'Empresa ABC' },
  }).fornecedor, null)
})

test('rejects absent identification, reading method and inconsistent NF data', () => {
  assert.throws(() => normalizeChegadaInput({}), (error) =>
    error.status === 422 && error.code === 'VALIDATION_ERROR'
      && Boolean(error.details.numeroNf && error.details.cnpjEmitente && error.details.metodoLeitura))
  assert.throws(() => normalizeChegadaInput({ nfeChaveAcesso: key, numeroNf: '999', metodoLeitura: 'OCR' }), (error) =>
    error.status === 422 && Boolean(error.details.numeroNf))
  assert.throws(() => normalizeChegadaInput({ nfeChaveAcesso: '1'.repeat(44), metodoLeitura: 'OCR' }), (error) =>
    error.status === 422 && Boolean(error.details.nfeChaveAcesso))
  assert.throws(() => normalizeChegadaInput({
    nfeChaveAcesso: '40104994734000518550020000395041864220514400', metodoLeitura: 'OCR',
  }), (error) => error.status === 422 && Boolean(error.details.nfeChaveAcesso))
})

test('maps only arrival identity and new warehouse data into the receipt input', () => {
  const result = mapChegadaToRecebimentoInput(arrival, { pedido: ' 4500873245 ', tipo: 'Estoque' })
  assert.deepEqual(result, {
    pedido: '4500873245', tipo: 'Estoque', fornecedor: 'Empresa ABC',
    numeroNf: '1', serieNf: '1', cnpjFornecedor: '12345678000195',
    nfeChaveAcesso: key,
  })
  assert.equal(arrival.recebimentoId, null)
})

test('requires an order and a supplier when the arrival has no supplier', () => {
  assert.throws(() => mapChegadaToRecebimentoInput(arrival, {}), (error) =>
    error.status === 422 && Boolean(error.details.pedido))
  assert.throws(() => mapChegadaToRecebimentoInput({ ...arrival, fornecedor: null }, { pedido: '123' }), (error) =>
    error.status === 422 && Boolean(error.details.fornecedor))
  assert.equal(mapChegadaToRecebimentoInput({ ...arrival, fornecedor: null }, { pedido: '123', fornecedor: 'Empresa B' }).fornecedor, 'Empresa B')
})

test('does not allow the body to replace arrival identity or choose the actor', () => {
  assert.throws(() => mapChegadaToRecebimentoInput(arrival, {
    pedido: '123', numeroNf: '999', usuarioId: 'other-user',
  }), (error) => error.status === 422 && Boolean(error.details.body))
  assert.throws(() => mapChegadaToRecebimentoInput(arrival, {
    pedido: '123', fornecedor: 'Different supplier',
  }), (error) => error.status === 422 && Boolean(error.details.fornecedor))
})

test('the mapper cannot create a second receipt for an already linked arrival', () => {
  assert.throws(() => mapChegadaToRecebimentoInput({
    ...arrival, status: 'VINCULADA', recebimentoId: 'REC-ID',
  }, { pedido: '123' }), (error) =>
    error.status === 409 && error.code === 'ARRIVAL_ALREADY_LINKED')
})

test('a linked arrival plans a successful retry with the existing receipt', () => {
  const linked = { ...arrival, status: 'VINCULADA', recebimentoId: 'REC-ID' }
  assert.deepEqual(planInicioRecebimento(linked, { pedido: 'another order' }), {
    kind: 'existing', recebimentoId: 'REC-ID',
  })
  assert.deepEqual(planInicioRecebimento(linked, {}), {
    kind: 'existing', recebimentoId: 'REC-ID',
  })
  assert.equal(linked.recebimentoId, 'REC-ID')
})

test('an unlinked arrival plans a new receipt using only warehouse input', () => {
  assert.deepEqual(planInicioRecebimento(arrival, { pedido: '123' }), {
    kind: 'create',
    receiptInput: {
      pedido: '123', tipo: 'Estoque', fornecedor: 'Empresa ABC',
      numeroNf: '1', serieNf: '1', cnpjFornecedor: '12345678000195',
      nfeChaveAcesso: key,
    },
  })
})

test('an inconsistent persisted link cannot be treated as a successful retry', () => {
  assert.throws(() => planInicioRecebimento({
    ...arrival, status: 'VINCULADA', recebimentoId: null,
  }, {}), (error) => error.status === 409 && error.code === 'ARRIVAL_INVALID_DATA')
  assert.throws(() => planInicioRecebimento({
    ...arrival, status: 'REGISTRADA', recebimentoId: 'REC-ID',
  }, {}), (error) => error.status === 409 && error.code === 'ARRIVAL_INVALID_DATA')
})

test('rejects deleted and cancelled arrivals', () => {
  assert.throws(() => mapChegadaToRecebimentoInput({ ...arrival, excluidoEm: '2026-10-14T12:00:00Z' }, { pedido: '123' }), (error) =>
    error.status === 409 && error.code === 'ARRIVAL_DELETED')
  assert.throws(() => mapChegadaToRecebimentoInput({ ...arrival, status: 'CANCELADA' }, { pedido: '123' }), (error) =>
    error.status === 409 && error.code === 'ARRIVAL_NOT_AVAILABLE')
})

test('rejects receipt type errors and corrupted arrival identity before mapping', () => {
  assert.throws(() => mapChegadaToRecebimentoInput(arrival, { pedido: '123', tipo: 'Unknown' }), (error) =>
    error.status === 422 && Boolean(error.details.tipo))
  assert.throws(() => mapChegadaToRecebimentoInput({ ...arrival, numeroNf: '999' }, { pedido: '123' }), (error) =>
    error.status === 409 && error.code === 'ARRIVAL_INVALID_DATA')
})
