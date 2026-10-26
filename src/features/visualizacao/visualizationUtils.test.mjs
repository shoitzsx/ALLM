import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeText,
  matchesSearch,
  getFilteredRows,
  sortRows,
  paginate,
  clampPage,
  escapeCsvValue,
  buildCsv,
  formatCellForExport,
  localDateIso,
} from './visualizationUtils.js'

const amostra = [
  { id: 1, nome: 'Fornecedor Exemplo', status: 'Ativo', data: '2026-10-01', qtd: 10 },
  { id: 2, nome: 'Distribuidora São José', status: 'Inativo', data: '2026-10-05', qtd: 3 },
  { id: 3, nome: 'Comercial Água Limpa', status: 'Ativo', data: '2026-09-20', qtd: 25 },
]

test('normalizeText remove acentos e caixa', () => {
  assert.equal(normalizeText('São José'), 'sao jose')
  assert.equal(normalizeText('ÁGUA'), 'agua')
  assert.equal(normalizeText(null), '')
})

test('busca encontra por substring, sem diferenciar acento/caixa', () => {
  assert.equal(matchesSearch(amostra[1], ['nome'], 'sao jose'), true)
  assert.equal(matchesSearch(amostra[1], ['nome'], 'SÃO'), true)
  assert.equal(matchesSearch(amostra[0], ['nome'], 'sao jose'), false)
})

test('busca vazia não filtra nada', () => {
  assert.equal(matchesSearch(amostra[0], ['nome'], ''), true)
})

test('getFilteredRows aplica busca e filtro de status juntos', () => {
  const tab = { rows: amostra, searchFields: ['nome'], statusField: 'status' }
  const resultado = getFilteredRows(tab, { search: 'comercial', status: 'Ativo' })
  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].id, 3)
})

test('getFilteredRows aplica filtro de período (inclusive nas duas pontas)', () => {
  const tab = { rows: amostra, searchFields: ['nome'], periodoField: 'data' }
  const resultado = getFilteredRows(tab, { periodoInicio: '2026-09-25', periodoFim: '2026-10-03' })
  assert.deepEqual(resultado.map((r) => r.id), [1])
})

test('sortRows ASC ordena por texto de forma natural (pt-BR)', () => {
  const ordenado = sortRows(amostra, { key: 'nome', direction: 'asc' })
  assert.deepEqual(ordenado.map((r) => r.id), [3, 2, 1])
})

test('sortRows DESC inverte a ordem', () => {
  const ordenado = sortRows(amostra, { key: 'qtd', direction: 'desc', type: 'number' })
  assert.deepEqual(ordenado.map((r) => r.id), [3, 1, 2])
})

test('sortRows sem sort devolve a ordem original', () => {
  assert.deepEqual(sortRows(amostra, null).map((r) => r.id), [1, 2, 3])
})

test('paginate corta a página certa e clampPage nunca excede o total de páginas', () => {
  const linhas = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }))
  assert.equal(paginate(linhas, 1, 10).length, 10)
  assert.equal(paginate(linhas, 3, 10).length, 5)
  assert.equal(clampPage(99, 25, 10), 3)
  assert.equal(clampPage(0, 25, 10), 1)
})

test('reset de página: clampPage volta para 1 quando a lista filtrada fica menor', () => {
  assert.equal(clampPage(5, 3, 10), 1)
})

test('escapeCsvValue só usa aspas quando necessário (delimitador ;, aspas internas, quebra de linha), e dobra aspas internas', () => {
  assert.equal(escapeCsvValue('Simples'), 'Simples')
  assert.equal(escapeCsvValue('Com, vírgula'), 'Com, vírgula')
  assert.equal(escapeCsvValue('Com; ponto e vírgula'), '"Com; ponto e vírgula"')
  assert.equal(escapeCsvValue('Com "aspas" internas'), '"Com ""aspas"" internas"')
  assert.equal(escapeCsvValue('Com\nquebra de linha'), '"Com\nquebra de linha"')
})

test('formatCellForExport formata datetime, boolean e badge para texto legível', () => {
  assert.equal(formatCellForExport({ d: '2026-10-08T14:30:00' }, { key: 'd', type: 'datetime' }), '08/10/2026 14:30')
  assert.equal(formatCellForExport({ b: true }, { key: 'b', type: 'boolean' }), 'Sim')
  assert.equal(formatCellForExport({ b: false }, { key: 'b', type: 'boolean' }), 'Não')
  assert.equal(
    formatCellForExport({ s: 'VINCULADA' }, { key: 's', type: 'badge', badgeLabels: { VINCULADA: 'Vinculada a recebimento' } }),
    'Vinculada a recebimento',
  )
})

test('buildCsv usa ; como delimitador (Excel pt-BR), e só escapa valor que contém o próprio delimitador', () => {
  const columns = [{ key: 'nome', label: 'Nome' }, { key: 'status', label: 'Status' }]
  const csv = buildCsv(columns, [{ nome: 'A; B', status: 'Ativo' }, { nome: 'C, D', status: 'Inativo' }])
  assert.equal(csv, 'Nome;Status\r\n"A; B";Ativo\r\nC, D;Inativo')
})

test('exportação respeita filtros: CSV gerado a partir de getFilteredRows só contém o que passou pelo filtro', () => {
  const tab = { rows: amostra, searchFields: ['nome'], statusField: 'status', columns: [{ key: 'nome', label: 'Nome' }] }
  const filtradas = getFilteredRows(tab, { status: 'Ativo' })
  const csv = buildCsv(tab.columns, filtradas)
  assert.equal(csv, 'Nome\r\nFornecedor Exemplo\r\nComercial Água Limpa')
})

test('localDateIso usa os campos locais (ano/mês/dia) e preenche com zero', () => {
  assert.equal(localDateIso(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(localDateIso(new Date(2026, 9, 23)), '2026-10-23')
})

test('localDateIso não varia pela hora: 23:59 local ainda é o dia local, nunca o dia UTC seguinte', () => {
  assert.equal(localDateIso(new Date(2026, 9, 8, 23, 59)), '2026-10-08')
})

test('localDateIso sem argumento usa a data atual no formato YYYY-MM-DD', () => {
  assert.match(localDateIso(), /^\d{4}-\d{2}-\d{2}$/)
})
