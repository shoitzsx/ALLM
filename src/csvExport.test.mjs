import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportRecebimentosCsv } from './data.js'
import { buildCsv } from './features/visualizacao/visualizationUtils.js'
import { parseCsv } from './testSupport/csvReference.mjs'

/**
 * H-2 (CWE-1236, CSV Injection): testes dos DOIS exportadores reais do frontend, com o CSV efetivamente
 * gerado e lido por um leitor de referência independente (src/testSupport/csvReference.mjs).
 *   - exportRecebimentosCsv  (src/data.js)  → "Exportar Excel" e "Exportar CSV" da lista de Recebimentos
 *   - buildCsv               (visualizationUtils.js) → "Exportar CSV" da Visualização
 * As entradas são inofensivas: nenhuma executa comando, acessa dado ou usa a rede.
 *
 * Contrato escolhido (ver src/csvSafe.js): se a célula começa — depois de espaços e controles — com = + - @
 * (ou variantes de largura total), ou começa com TAB/CR/LF, ela recebe um TAB na frente e vai entre aspas.
 * Números puros (-5, +5, 1,5) e qualquer texto que não comece assim ficam exatamente como estavam.
 */

const TAB = '\t'

// [entrada, saída esperada na célula depois de lida pelo parser]
const PERIGOSAS = [
  ['=1+1', TAB + '=1+1'],
  ['+1+1', TAB + '+1+1'],
  ['-1+1', TAB + '-1+1'],
  ['@SUM(1,1)', TAB + '@SUM(1,1)'],
  ['=1+1;=2+2', TAB + '=1+1;=2+2'],
  ['=HYPERLINK("http://exemplo.invalid","x")', TAB + '=HYPERLINK("http://exemplo.invalid","x")'],
  [' =1+1', TAB + ' =1+1'],
  ['   +1+1', TAB + '   +1+1'],
  ['\t=1+1', TAB + '\t=1+1'],
  ['\r=1+1', TAB + '\r=1+1'],
  ['\n=1+1', TAB + '\n=1+1'],
  ['\u00a0=1+1', TAB + '\u00a0=1+1'],
  ['\u0001=1+1', TAB + '\u0001=1+1'],
  ['\u200b=1+1', TAB + '\u200b=1+1'],
  ['＝1+1', TAB + '＝1+1'],
  ['＋1+1', TAB + '＋1+1'],
  ['－1+1', TAB + '－1+1'],
  ['＠SUM(1,1)', TAB + '＠SUM(1,1)'],
  ['−1+1', TAB + '−1+1'],
  ['\t', TAB + '\t'],
]

// Texto legítimo: tem de sair idêntico.
const LEGITIMAS = [
  'Parafuso sextavado M8',
  'Ação & café — São José, Ltda.',
  'Distribuidora "Alfa"; Cia',
  '12',
  '-5',
  '+5',
  '1,5',
  '-1,5',
  '15/10/2026',
  'ABC-123',
  '2026-10-15',
  'a=b',
  'x+y',
  'contato@empresa.com',
  '  texto com espaços  ',
  'x";=1+1',
  '"=1+1',
  'linha 1\nlinha 2',
  'linha 1\r\n=2+2',
  'tab\t=aqui',
  '',
]

const CAMPOS = ['pedido', 'numeroNf', 'fornecedor', 'tipo', 'status', 'observacoes', 'protocolo']
// Colunas do CSV de recebimentos (ordem do cabeçalho em data.js)
const COL = { item: 0, quantidade: 1, unidade: 2, descricao: 3, pedido: 4, numeroNf: 5, dataRecebimento: 6, fornecedor: 7, tipo: 8, responsavel: 9, status: 10, observacoes: 11, protocolo: 12 }
const COLUNAS = 13

const congela = (valor) => {
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congela)
    Object.freeze(valor)
  }
  return valor
}

function recebimentoCom(texto, extra = {}) {
  const receb = {
    protocolo: texto,
    pedido: texto,
    numeroNf: texto,
    dataRecebimento: '2026-10-15',
    fornecedor: texto,
    tipo: texto,
    status: texto,
    observacoes: texto,
    responsavel: { id: 'USR-1', nome: texto },
    itens: [
      { numero: 1, codigo: texto, quantidadeRecebida: 10, unidade: texto, descricao: texto },
      { numero: 2, codigo: 'P-2', quantidadeRecebida: '3', unidade: 'UN', descricao: 'Segundo item' },
    ],
    ...extra,
  }
  return receb
}

const celulasDeTexto = (linha) => [COL.unidade, COL.descricao, COL.pedido, COL.numeroNf, COL.fornecedor, COL.tipo, COL.responsavel, COL.status, COL.observacoes, COL.protocolo].map((i) => linha[i])

// ---------------------------------------------------------------- recebimentos (data.js)

for (const [entrada, esperado] of PERIGOSAS) {
  test(`recebimentos: ${JSON.stringify(entrada)} é neutralizada em todos os campos de texto, sem criar células nem linhas`, () => {
    const csv = exportRecebimentosCsv([congela(recebimentoCom(entrada))])
    const linhas = parseCsv(csv, ';')
    assert.equal(linhas.length, 1 + 2, 'cabeçalho + 2 itens')
    assert.ok(linhas.every((l) => l.length === COLUNAS), `todas as linhas com ${COLUNAS} colunas: ${linhas.map((l) => l.length)}`)
    const primeira = linhas[1]
    for (const celula of celulasDeTexto(primeira)) assert.equal(celula, esperado)
  })
}

for (const entrada of LEGITIMAS) {
  test(`recebimentos: texto legítimo ${JSON.stringify(entrada)} sai idêntico`, () => {
    const csv = exportRecebimentosCsv([congela(recebimentoCom(entrada))])
    const linhas = parseCsv(csv, ';')
    assert.equal(linhas.length, 3)
    assert.ok(linhas.every((l) => l.length === COLUNAS))
    for (const celula of celulasDeTexto(linhas[1])) assert.equal(celula, entrada)
  })
}

test('recebimentos: nenhuma célula lida pelo parser começa com = + - @ (nem variantes) — exceto números puros', () => {
  const todas = [...PERIGOSAS.map(([e]) => e), ...LEGITIMAS]
  const csv = exportRecebimentosCsv(todas.map((t, i) => congela(recebimentoCom(t, { protocolo: `REC-${i}` }))))
  const linhas = parseCsv(csv, ';')
  const perigosoNoInicio = /^[=+\-@＝＋－＠−]/
  const numeroPuro = /^[+-]?\d+(?:[.,]\d+)?$/
  for (const linha of linhas) {
    for (const celula of linha) {
      if (numeroPuro.test(celula)) continue
      assert.ok(!perigosoNoInicio.test(celula), `célula começa como fórmula: ${JSON.stringify(celula)}`)
    }
  }
  assert.equal(linhas.length, 1 + todas.length * 2)
})

test('recebimentos: payload com aspas e delimitador não abre célula extra (x";=1+1)', () => {
  const csv = exportRecebimentosCsv([congela(recebimentoCom('x";=1+1'))])
  const linhas = parseCsv(csv, ';')
  assert.ok(linhas.every((l) => l.length === COLUNAS))
  assert.equal(linhas[1][COL.fornecedor], 'x";=1+1')
})

test('recebimentos: delimitador "," também é protegido e mantém as colunas', () => {
  const csv = exportRecebimentosCsv([congela(recebimentoCom('=1+1,=2+2'))], { delimiter: ',' })
  const linhas = parseCsv(csv, ',')
  assert.ok(linhas.every((l) => l.length === COLUNAS))
  assert.equal(linhas[1][COL.fornecedor], TAB + '=1+1,=2+2')
  assert.equal(linhas[1][COL.quantidade], '10')
})

test('recebimentos: números ficam como estavam (inclusive negativo e texto numérico) e datas não mudam', () => {
  const csv = exportRecebimentosCsv([congela(recebimentoCom('ok', { itens: [{ numero: 1, quantidadeRecebida: -5, unidade: 'UN', descricao: 'd' }, { numero: 2, quantidadeRecebida: '-2,5', unidade: 'UN', descricao: 'd' }, { numero: 3, quantidadeRecebida: 7.5, unidade: 'UN', descricao: 'd' }] }))])
  const linhas = parseCsv(csv, ';')
  assert.deepEqual(linhas.slice(1).map((l) => l[COL.quantidade]), ['-5', '-2,5', '7.5'])
  assert.equal(linhas[1][COL.dataRecebimento], '2026-10-15')
  assert.deepEqual(linhas.slice(1).map((l) => l[COL.item]), ['1', '2', '3'])
})

test('recebimentos: cabeçalho, BOM e quebra de linha CRLF seguem o formato anterior', () => {
  const csv = exportRecebimentosCsv([congela(recebimentoCom('ok'))])
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.ok(csv.split('\r\n').length === 3)
  const [cabecalho] = parseCsv(csv, ';')
  assert.deepEqual(cabecalho, ['Item', 'Quantidade', 'Unidade', 'Descrição', 'Pedido', 'Nº NF/documento', 'Data de Recebimento', 'Fornecedor', 'Tipo', 'Responsável', 'Status', 'Observações', 'Protocolo'])
  assert.equal(exportRecebimentosCsv([recebimentoCom('ok')], { withBom: false }).charCodeAt(0), 'I'.charCodeAt(0))
})

test('recebimentos: valores vazios, nulos e ausentes viram células vazias, com as colunas certas', () => {
  const csv = exportRecebimentosCsv([{ protocolo: 'REC-1', pedido: null, numeroNf: undefined, dataRecebimento: '', fornecedor: '', tipo: null, status: 'Em digitação', observacoes: null, itens: [] }])
  const linhas = parseCsv(csv, ';')
  assert.equal(linhas.length, 2)
  assert.equal(linhas[1].length, COLUNAS)
  assert.equal(linhas[1][COL.protocolo], 'REC-1')
  assert.equal(linhas[1][COL.pedido], '')
  assert.equal(linhas[1][COL.observacoes], '')
})

test('recebimentos: UTF-8 e acentos passam intactos pela codificação do arquivo', () => {
  const texto = 'Ação — café, São José ✓ 日本語'
  const csv = exportRecebimentosCsv([congela(recebimentoCom(texto))])
  const bytes = new TextEncoder().encode(csv)
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8')
  const volta = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  assert.equal(parseCsv(volta, ';')[1][COL.fornecedor], texto)
})

test('recebimentos: exportar não altera os dados originais (objetos congelados) e é repetível', () => {
  const originais = congela([recebimentoCom('=1+1'), recebimentoCom('@x')])
  const antes = JSON.stringify(originais)
  const a = exportRecebimentosCsv(originais)
  const b = exportRecebimentosCsv(originais)
  assert.equal(JSON.stringify(originais), antes)
  assert.equal(a, b)
})

test('recebimentos: vários registros com campos multilinha mantêm uma linha por item', () => {
  const lista = [recebimentoCom('A\nB\r\nC'), recebimentoCom('=2+2', { protocolo: 'REC-2' }), recebimentoCom('normal', { protocolo: 'REC-3' })]
  const linhas = parseCsv(exportRecebimentosCsv(congela(lista)), ';')
  assert.equal(linhas.length, 1 + 6)
  assert.ok(linhas.every((l) => l.length === COLUNAS))
  assert.equal(linhas[1][COL.observacoes], 'A\nB\r\nC')
})

// ---------------------------------------------------------------- Visualização (buildCsv)

const colunasVis = [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
  { key: 'c', label: 'C', type: 'date' },
  { key: 'd', label: 'D', type: 'badge', badgeLabels: { X: 'Rótulo X' } },
  { key: 'e', label: 'E', type: 'number' },
]

for (const [entrada, esperado] of PERIGOSAS) {
  test(`visualização: ${JSON.stringify(entrada)} é neutralizada, inclusive em colunas de data e badge`, () => {
    const linhas = parseCsv(buildCsv(colunasVis, congela([{ a: entrada, b: entrada, c: entrada, d: entrada, e: entrada }, { a: 'ok', b: 'ok', c: '2026-10-15', d: 'X', e: 3 }])), ';')
    assert.equal(linhas.length, 3)
    assert.ok(linhas.every((l) => l.length === 5), `5 colunas: ${linhas.map((l) => l.length)}`)
    assert.deepEqual(linhas[1], [esperado, esperado, esperado, esperado, esperado])
    assert.deepEqual(linhas[2], ['ok', 'ok', '15/10/2026', 'Rótulo X', '3'])
  })
}

for (const entrada of LEGITIMAS) {
  test(`visualização: texto legítimo ${JSON.stringify(entrada)} sai idêntico`, () => {
    const linhas = parseCsv(buildCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], congela([{ a: entrada, b: 'fim' }])), ';')
    assert.equal(linhas.length, 2)
    assert.deepEqual(linhas[1], [entrada, 'fim'])
  })
}

test('visualização: rótulos de coluna também são protegidos e o cabeçalho mantém o número de colunas', () => {
  const linhas = parseCsv(buildCsv([{ key: 'a', label: '=1+1' }, { key: 'b', label: 'B;C' }], [{ a: 'x', b: 'y' }]), ';')
  assert.equal(linhas[0].length, 2)
  assert.equal(linhas[0][0], TAB + '=1+1')
  assert.equal(linhas[0][1], 'B;C')
})

test('visualização: números negativos e nulos', () => {
  const linhas = parseCsv(buildCsv([{ key: 'n', label: 'N', type: 'number' }, { key: 'v', label: 'V' }], [{ n: -4, v: null }, { n: 0, v: undefined }]), ';')
  assert.deepEqual(linhas.slice(1), [['-4', ''], ['0', '']])
})

test('visualização: não altera as linhas originais e mantém o formato (; e CRLF)', () => {
  const linhas = congela([{ a: '=1+1', b: 'ok' }])
  const csv = buildCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], linhas)
  assert.equal(linhas[0].a, '=1+1')
  assert.equal(csv.split('\r\n').length, 2)
  assert.ok(csv.startsWith('A;B\r\n'))
})
