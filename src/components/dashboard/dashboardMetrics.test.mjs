import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDashboardMetrics, RECEBIMENTO_STATUS, STATUS_OPTIONS } from '../../data.js'
import { buildMonthlySeries, buildStatusChart, buildTopList, getAttentionReceipts, getRecentReceipts, parseReceiptMonth, selectActiveReceipts } from './dashboardMetrics.js'

// D-1 — derivações dos gráficos da Visão geral. Entradas = os mesmos registros que o store já
// entrega para getDashboardMetrics; nada aqui busca dado, inventa período ou altera o original.

const rec = (overrides = {}) => ({ id: overrides.id || Math.random().toString(36).slice(2), status: RECEBIMENTO_STATUS.CONFERENCIA, fornecedor: 'Alfa', tipo: 'Estoque', dataRecebimento: '2026-10-10', itens: [], divergencias: [], anexos: [], ...overrides })

test('parseReceiptMonth: só aceita datas de calendário reais em AAAA-MM-DD (com ou sem hora)', () => {
  assert.equal(parseReceiptMonth('2026-10-15'), '2026-10')
  assert.equal(parseReceiptMonth('2026-01-31T23:59:00.000Z'), '2026-01')
  for (const invalida of [undefined, null, '', '   ', '15/10/2026', '2026-13-01', '2026-00-10', '2026-02-30', '2026-10', 'amanhã', 20261015, '0000-01-01x']) {
    assert.equal(parseReceiptMonth(invalida), null, JSON.stringify(invalida))
  }
})

test('série mensal: conta por mês, preenche com zero os meses sem registro entre o primeiro e o último', () => {
  const rows = [rec({ dataRecebimento: '2026-07-02' }), rec({ dataRecebimento: '2026-07-30' }), rec({ dataRecebimento: '2026-10-01' })]
  const s = buildMonthlySeries(rows)
  assert.deepEqual(s.months.map((m) => [m.key, m.total]), [['2026-07', 2], ['2026-08', 0], ['2026-09', 0], ['2026-10', 1]])
  assert.deepEqual(s.months.map((m) => m.label), ['jul/26', 'ago/26', 'set/26', 'out/26'])
  assert.equal(s.totalNaSerie, 3)
  assert.equal(s.semDataValida, 0)
  assert.equal(s.mesesOmitidos, 0)
})

test('série mensal: atravessa a virada do ano sem pular nem repetir mês', () => {
  const s = buildMonthlySeries([rec({ dataRecebimento: '2025-11-20' }), rec({ dataRecebimento: '2026-02-03' })])
  assert.deepEqual(s.months.map((m) => m.key), ['2025-11', '2025-12', '2026-01', '2026-02'])
})

test('série mensal: datas ausentes ou inválidas ficam FORA da série e são contadas à parte', () => {
  const s = buildMonthlySeries([rec({ dataRecebimento: '' }), rec({ dataRecebimento: '31/12/2026' }), rec({ dataRecebimento: null }), rec({ dataRecebimento: '2026-05-05' })])
  assert.deepEqual(s.months.map((m) => [m.key, m.total]), [['2026-05', 1]])
  assert.equal(s.semDataValida, 3)
  assert.equal(s.totalNaSerie, 1)
})

test('série mensal: no máximo 12 meses (os mais recentes); os registros dos meses anteriores são informados, não somem calados', () => {
  const rows = [rec({ dataRecebimento: '2024-01-10' }), rec({ dataRecebimento: '2024-01-11' }), rec({ dataRecebimento: '2026-10-01' })]
  const s = buildMonthlySeries(rows)
  assert.equal(s.months.length, 12)
  assert.equal(s.months[0].key, '2025-11')
  assert.equal(s.months.at(-1).key, '2026-10')
  assert.equal(s.registrosAntesDoRecorte, 2)
  assert.equal(s.mesesOmitidos, 22)
  assert.equal(s.totalNaSerie, 1)
})

test('série mensal: lista vazia ou sem nenhuma data válida → série vazia (estado vazio honesto)', () => {
  assert.deepEqual(buildMonthlySeries([]).months, [])
  assert.deepEqual(buildMonthlySeries(null).months, [])
  const s = buildMonthlySeries([rec({ dataRecebimento: 'x' })])
  assert.deepEqual(s.months, [])
  assert.equal(s.semDataValida, 1)
})

test('status: usa o catálogo do domínio, proporção pelo total e conta à parte o status fora do catálogo', () => {
  const rows = [rec(), rec(), rec({ status: RECEBIMENTO_STATUS.FINALIZADO }), rec({ status: 'Status antigo' }), rec({ status: undefined })]
  const metrics = getDashboardMetrics(rows, '2026-10-15')
  const chart = buildStatusChart(metrics)
  assert.deepEqual(chart.items.map((i) => i.key), STATUS_OPTIONS.map((o) => o.value))
  assert.equal(chart.items.find((i) => i.key === RECEBIMENTO_STATUS.CONFERENCIA).total, 2)
  assert.equal(chart.items.find((i) => i.key === RECEBIMENTO_STATUS.DIGITACAO).total, 0)
  assert.equal(chart.total, 5)
  assert.equal(chart.foraDoCatalogo, 2)
  assert.equal(chart.items.find((i) => i.key === RECEBIMENTO_STATUS.CONFERENCIA).share, 0.4)
  assert.equal(chart.items.find((i) => i.key === RECEBIMENTO_STATUS.DIGITACAO).share, 0)
})

test('recorte de categorias: Top N com o resto somado em "demais", sem perder nenhum registro', () => {
  const rows = ['A', 'A', 'A', 'B', 'B', 'C', 'D', 'E', 'F', '', null].map((fornecedor) => rec({ fornecedor }))
  const metrics = getDashboardMetrics(rows, '2026-10-15')
  const top = buildTopList(metrics.porFornecedor, 3)
  assert.deepEqual(top.items.map((i) => [i.label, i.total]), [['A', 3], ['B', 2], ['Não informado', 2]])
  assert.equal(top.demais.categorias, 4)
  assert.equal(top.demais.total, 4)
  assert.equal(top.total, 11)
  assert.equal(top.items[0].share, 3 / 11)
})

test('recorte de categorias: com poucas categorias não há "demais"; lista vazia → nada', () => {
  const metrics = getDashboardMetrics([rec({ tipo: 'Estoque' }), rec({ tipo: 'Industrialização' }), rec({ tipo: 'Estoque' })], '2026-10-15')
  const tipos = buildTopList(metrics.porTipo, 8)
  assert.deepEqual(tipos.items.map((i) => [i.label, i.total]), [['Estoque', 2], ['Industrialização', 1]])
  assert.equal(tipos.demais, null)
  assert.deepEqual(buildTopList([], 5), { items: [], demais: null, total: 0 })
  assert.deepEqual(buildTopList(undefined, 5), { items: [], demais: null, total: 0 })
})

test('as derivações não alteram os registros nem as métricas recebidas e são determinísticas', () => {
  const rows = Object.freeze([Object.freeze(rec({ dataRecebimento: '2026-09-01' })), Object.freeze(rec({ dataRecebimento: '2026-10-02', fornecedor: 'Beta' }))])
  const metrics = getDashboardMetrics(rows, '2026-10-15')
  const before = JSON.stringify(metrics)
  const a = [buildMonthlySeries(rows), buildStatusChart(metrics), buildTopList(metrics.porFornecedor, 5)]
  const b = [buildMonthlySeries(rows), buildStatusChart(metrics), buildTopList(metrics.porFornecedor, 5)]
  assert.equal(JSON.stringify(metrics), before)
  assert.deepEqual(a, b)
})

// ---- Ajuste 1: timestamps inválidos — a parte depois do "T" também precisa ser um horário real.

test('parseReceiptMonth: rejeita timestamp com hora, minuto ou segundo impossíveis ou texto no lugar do horário', () => {
  for (const invalido of [
    '2026-10-15T99:99:99', '2026-10-15TRASH', '2026-10-15T', '2026-10-15T24:00:00', '2026-10-15T23:60:00', '2026-10-15T23:59:60',
    '2026-10-15T10', '2026-10-15T10:5', '2026-10-15T10:00:0', '2026-10-15T10:00:00x', '2026-10-15T10:00:00.Z', '2026-10-15T10:00:00.',
    '2026-10-15T10:00:00+25:00', '2026-10-15T10:00:00+03:60', '2026-10-15T10:00:00+3', '2026-10-15T10:00:00ZZ', '2026-10-15T10:00:00 UTC',
    '2026-10-15TT10:00:00', '2026-10-15 10:00:00', '2026-10-15T-1:00:00', '2026-10-15T10:00:00Z extra', '2026-10-15T10:00:00+03:00Z',
  ]) {
    assert.equal(parseReceiptMonth(invalido), null, JSON.stringify(invalido))
  }
})

test('parseReceiptMonth: preserva os formatos que o ALM realmente grava (AAAA-MM-DD e toISOString) e outros ISO 8601 válidos', () => {
  for (const [entrada, mes] of [
    ['2026-10-15', '2026-10'],
    ['2026-10-15T12:00:00.000Z', '2026-10'], // new Date().toISOString() — backend e store
    ['2026-01-31T23:59:59.999Z', '2026-01'],
    ['2026-10-15T00:00:00Z', '2026-10'],
    ['2026-10-15T10:30', '2026-10'],
    ['2026-10-15T10:30:15', '2026-10'],
    ['2026-10-15T10:30:15.5', '2026-10'],
    ['2026-10-15T10:30:15-03:00', '2026-10'],
    ['2026-10-15T10:30:15+0530', '2026-10'],
    ['2026-10-15T10:30:15.123456+05:30', '2026-10'],
    ['  2026-10-15T08:00:00Z  ', '2026-10'],
  ]) {
    assert.equal(parseReceiptMonth(entrada), mes, entrada)
  }
})

test('parseReceiptMonth: timestamp inválido não entra na série — vai para "sem data válida"', () => {
  const s = buildMonthlySeries([rec({ dataRecebimento: '2026-10-15T99:99:99' }), rec({ dataRecebimento: '2026-10-15TRASH' }), rec({ dataRecebimento: '2026-10-15T' }), rec({ dataRecebimento: '2026-10-15T08:00:00.000Z' })])
  assert.deepEqual(s.months.map((m) => [m.key, m.total]), [['2026-10', 1]])
  assert.equal(s.semDataValida, 3)
})

// ---- Ajuste 2: "Recebimentos recentes" e "Requer atenção" usam só os registros ativos.

test('selectActiveReceipts: tira os arquivados e não altera a lista original', () => {
  const lista = Object.freeze([Object.freeze(rec({ id: 'a' })), Object.freeze(rec({ id: 'b', arquivado: true })), Object.freeze(rec({ id: 'c', arquivado: undefined }))])
  assert.deepEqual(selectActiveReceipts(lista).map((r) => r.id), ['a', 'c'])
  assert.equal(lista.length, 3)
  assert.deepEqual(selectActiveReceipts(null), [])
})

test('Requer atenção: arquivado com NF pendente ou divergência aberta NÃO aparece; o ativo equivalente aparece', () => {
  const ativo = rec({ id: 'ativo-pend', numeroNf: '', anexos: [] })
  const arquivadoNf = rec({ id: 'arq-nf', numeroNf: '', anexos: [], arquivado: true })
  const comNf = { numeroNf: 'NF1', anexos: [{ categoria: 'Nota Fiscal', removido: false }] }
  const arquivadoDiv = rec({ id: 'arq-div', ...comNf, divergencias: [{ id: 'D', resolvida: false }], arquivado: true })
  const ativoDiv = rec({ id: 'ativo-div', ...comNf, divergencias: [{ id: 'D', resolvida: false }] })
  const emDia = rec({ id: 'ok', ...comNf })
  const ids = getAttentionReceipts([arquivadoNf, ativo, arquivadoDiv, ativoDiv, emDia]).map((r) => r.id)
  assert.deepEqual(ids, ['ativo-pend', 'ativo-div'])
})

test('Requer atenção: mantém a regra e o limite de antes (NF pendente OU divergência aberta, 5 primeiros na ordem recebida)', () => {
  const muitos = Array.from({ length: 8 }, (_, i) => rec({ id: `p${i}`, numeroNf: '', anexos: [] }))
  assert.deepEqual(getAttentionReceipts(muitos).map((r) => r.id), ['p0', 'p1', 'p2', 'p3', 'p4'])
  assert.deepEqual(getAttentionReceipts(muitos, 2).map((r) => r.id), ['p0', 'p1'])
})

test('Recebimentos recentes: arquivado não aparece, ordena por atualizadoEm (mais novo primeiro), 5 no máximo, sem mutar', () => {
  const lista = Object.freeze([
    Object.freeze(rec({ id: 'velho', atualizadoEm: '2026-01-01T00:00:00.000Z' })),
    Object.freeze(rec({ id: 'arquivado-novissimo', atualizadoEm: '2026-12-31T00:00:00.000Z', arquivado: true })),
    Object.freeze(rec({ id: 'novo', atualizadoEm: '2026-10-10T00:00:00.000Z' })),
    Object.freeze(rec({ id: 'meio', atualizadoEm: '2026-05-05T00:00:00.000Z' })),
  ])
  assert.deepEqual(getRecentReceipts(lista).map((r) => r.id), ['novo', 'meio', 'velho'])
  const sete = Array.from({ length: 7 }, (_, i) => rec({ id: `r${i}`, atualizadoEm: `2026-10-0${i + 1}T00:00:00.000Z` }))
  assert.deepEqual(getRecentReceipts(sete).map((r) => r.id), ['r6', 'r5', 'r4', 'r3', 'r2'])
  assert.deepEqual(getRecentReceipts([rec({ arquivado: true })]), [])
})

test('as duas seções e os KPIs partem do mesmo conjunto: arquivado não altera nenhum deles', () => {
  const ativos = [rec({ id: 'a1', numeroNf: '', anexos: [] }), rec({ id: 'a2' })]
  const comArquivado = [...ativos, rec({ id: 'x', numeroNf: '', anexos: [], arquivado: true, atualizadoEm: '2099-01-01T00:00:00.000Z' })]
  assert.deepEqual(getAttentionReceipts(comArquivado), getAttentionReceipts(ativos))
  assert.deepEqual(getRecentReceipts(comArquivado), getRecentReceipts(ativos))
  assert.equal(getDashboardMetrics(selectActiveReceipts(comArquivado), '2026-10-15').totalRecebimentos, 2)
})
