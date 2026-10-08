import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapAnalysisToArrivalDraft, METODO_LEITURA, CONFIANCA } from './scannerBridge.js'

// Fixtures escritas à mão no formato documentado do scanner
// (src/features/nfeReader/analysisBuilder.js) — este arquivo não importa
// nada de nfeReader de propósito, para o teste da Portaria não depender dos
// internos do scanner mudarem.
function field(value, confidence, origin = '') {
  return { value, confidence, origin }
}

const analiseCompletaViaPdf = {
  chaveValida: true,
  chaveInterpretada: {
    chave: '35260112345678000190550010004382711123456785',
    cnpj: '12345678000190',
    cnpjFormatado: '12.345.678/0001-90',
    numeroNf: '438271',
    serie: '1',
    ufSigla: 'SP',
    anoMesLabel: '2026/01',
  },
  fontesCruzadas: true,
  origensChave: ['texto do PDF', 'código de barras'],
  fields: {
    numeroNf: field('438271', 'alta', 'texto do PDF + código de barras'),
    serieNf: field('1', 'alta', 'texto do PDF + código de barras'),
    cnpjFornecedor: field('12.345.678/0001-90', 'alta', 'texto do PDF + código de barras'),
    fornecedor: field('Fornecedor Exemplo Ltda', 'alta', 'catálogo de fornecedores'),
    pedido: field('', 'nao_encontrado'),
    dataRecebimento: field('2026-10-07', 'nao_encontrado', 'sugestão: data de hoje'),
  },
  referenciaNfe: {
    chaveAcesso: field('35260112345678000190550010004382711123456785', 'alta', 'texto do PDF + código de barras'),
    ufEmitente: field('SP', 'alta', 'texto do PDF + código de barras'),
    anoMesEmissao: field('2026/01', 'alta', 'texto do PDF + código de barras'),
    dataEmissao: field('', 'nao_encontrado'),
    valorTotal: field('', 'nao_encontrado'),
  },
  warnings: [],
}

const analiseSemChave = {
  chaveValida: false,
  chaveInterpretada: null,
  fontesCruzadas: false,
  origensChave: [],
  fields: {
    numeroNf: field('', 'nao_encontrado'),
    serieNf: field('', 'nao_encontrado'),
    cnpjFornecedor: field('', 'nao_encontrado'),
    fornecedor: field('', 'nao_encontrado'),
    pedido: field('', 'nao_encontrado'),
    dataRecebimento: field('2026-10-07', 'nao_encontrado', 'sugestão: data de hoje'),
  },
  referenciaNfe: {
    chaveAcesso: field('', 'nao_encontrado'),
    ufEmitente: field('', 'nao_encontrado'),
    anoMesEmissao: field('', 'nao_encontrado'),
    dataEmissao: field('', 'nao_encontrado'),
    valorTotal: field('', 'nao_encontrado'),
  },
  warnings: ['Nenhum código de barras foi detectado. Enquadre o código inteiro, deixando espaço em branco nas laterais.'],
}

test('análise válida completa (texto do PDF + código de barras, fornecedor no catálogo) produz ALTA e TEXTO_PDF', () => {
  const draft = mapAnalysisToArrivalDraft(analiseCompletaViaPdf)
  assert.equal(draft.nfeChaveAcesso, '35260112345678000190550010004382711123456785')
  assert.equal(draft.numeroNf, '438271')
  assert.equal(draft.serieNf, '1')
  assert.equal(draft.cnpjEmitente, '12.345.678/0001-90')
  assert.equal(draft.fornecedor, 'Fornecedor Exemplo Ltda')
  assert.equal(draft.metodoLeitura, METODO_LEITURA.TEXTO_PDF)
  assert.equal(draft.confianca, CONFIANCA.ALTA)
})

test('fornecedor ausente do catálogo vira string vazia, sem rebaixar a confiança', () => {
  const analise = {
    ...analiseCompletaViaPdf,
    fields: { ...analiseCompletaViaPdf.fields, fornecedor: field('', 'nao_encontrado') },
  }
  const draft = mapAnalysisToArrivalDraft(analise)
  assert.equal(draft.fornecedor, '')
  assert.equal(draft.confianca, CONFIANCA.ALTA, 'fornecedor ausente não é um erro — não deve puxar a confiança para baixo')
})

test('análise sem chave válida produz NAO_ENCONTRADO e todos os campos vazios', () => {
  const draft = mapAnalysisToArrivalDraft(analiseSemChave)
  assert.equal(draft.nfeChaveAcesso, '')
  assert.equal(draft.numeroNf, '')
  assert.equal(draft.serieNf, '')
  assert.equal(draft.cnpjEmitente, '')
  assert.equal(draft.fornecedor, '')
  assert.equal(draft.metodoLeitura, METODO_LEITURA.NAO_IDENTIFICADO)
  assert.equal(draft.confianca, CONFIANCA.NAO_ENCONTRADO)
})

test('o objeto de análise original nunca é modificado', () => {
  const antes = JSON.parse(JSON.stringify(analiseCompletaViaPdf))
  mapAnalysisToArrivalDraft(analiseCompletaViaPdf)
  assert.deepEqual(analiseCompletaViaPdf, antes)
})

test('origem código de barras (sem avisos) resulta em CODIGO_BARRAS e ALTA', () => {
  const analise = {
    ...analiseSemChave,
    chaveValida: true,
    chaveInterpretada: analiseCompletaViaPdf.chaveInterpretada,
    origensChave: ['código de barras'],
    fields: analiseCompletaViaPdf.fields,
    warnings: [],
  }
  const draft = mapAnalysisToArrivalDraft(analise)
  assert.equal(draft.metodoLeitura, METODO_LEITURA.CODIGO_BARRAS)
  assert.equal(draft.confianca, CONFIANCA.ALTA)
})

test('origem "foto do código de barras" (NfePhotoCapture) também resulta em CODIGO_BARRAS e ALTA', () => {
  const analise = {
    ...analiseSemChave,
    chaveValida: true,
    chaveInterpretada: analiseCompletaViaPdf.chaveInterpretada,
    origensChave: ['foto do código de barras'],
    fields: analiseCompletaViaPdf.fields,
    warnings: [],
  }
  const draft = mapAnalysisToArrivalDraft(analise)
  assert.equal(draft.metodoLeitura, METODO_LEITURA.CODIGO_BARRAS)
  assert.equal(draft.confianca, CONFIANCA.ALTA)
})

test('origem OCR resulta em OCR e CONFERIR, mesmo sem avisos adicionais', () => {
  const analise = {
    ...analiseSemChave,
    chaveValida: true,
    chaveInterpretada: analiseCompletaViaPdf.chaveInterpretada,
    origensChave: ['OCR'],
    fields: analiseCompletaViaPdf.fields,
    warnings: [],
  }
  const draft = mapAnalysisToArrivalDraft(analise)
  assert.equal(draft.metodoLeitura, METODO_LEITURA.OCR)
  assert.equal(draft.confianca, CONFIANCA.CONFERIR)
})

test('texto do PDF com aviso de uma etapa anterior falhada também vira CONFERIR, não ALTA', () => {
  const analise = {
    ...analiseSemChave,
    chaveValida: true,
    chaveInterpretada: analiseCompletaViaPdf.chaveInterpretada,
    origensChave: ['texto do PDF'],
    fields: analiseCompletaViaPdf.fields,
    warnings: ['Não foi possível renderizar a primeira página do PDF.'],
  }
  const draft = mapAnalysisToArrivalDraft(analise)
  assert.equal(draft.metodoLeitura, METODO_LEITURA.TEXTO_PDF)
  assert.equal(draft.confianca, CONFIANCA.CONFERIR)
})
