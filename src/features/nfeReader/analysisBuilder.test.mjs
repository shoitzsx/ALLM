/**
 * Testes da montagem do objeto de análise a partir de uma chave já resolvida
 * — sem PDF, canvas, câmera ou navegador. Roda com o test runner nativo do
 * Node (`node --test`), igual a chaveNFe.test.mjs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeNfeKey, buildAnalysisFromKey, CONFIDENCE } from './analysisBuilder.js'

const CHAVE_METALFORT = '42260748909580000160550010000082801675042868'
const CHAVE_INVALIDA = CHAVE_METALFORT.slice(0, 43) + '0'

test('analyzeNfeKey aceita uma chave válida e preenche os campos derivados dela', () => {
  const resultado = analyzeNfeKey(CHAVE_METALFORT, 'scanner ao vivo, código de barras')
  assert.equal(resultado.chaveValida, true)
  assert.equal(resultado.origensChave.length, 1)
  assert.equal(resultado.origensChave[0], 'scanner ao vivo, código de barras')
  assert.equal(resultado.fields.numeroNf.value, '8280')
  assert.equal(resultado.fields.numeroNf.confidence, CONFIDENCE.ALTA)
  assert.equal(resultado.referenciaNfe.chaveAcesso.value, CHAVE_METALFORT)
  assert.equal(resultado.referenciaNfe.ufEmitente.value, 'SC')
})

test('analyzeNfeKey nunca inventa pedido, valor total ou data de emissão sem texto', () => {
  const resultado = analyzeNfeKey(CHAVE_METALFORT)
  assert.equal(resultado.fields.pedido.confidence, CONFIDENCE.NAO_ENCONTRADO)
  assert.equal(resultado.fields.pedido.value, '')
  assert.equal(resultado.referenciaNfe.valorTotal.confidence, CONFIDENCE.NAO_ENCONTRADO)
  assert.equal(resultado.referenciaNfe.dataEmissao.confidence, CONFIDENCE.NAO_ENCONTRADO)
})

test('analyzeNfeKey rejeita uma chave com dígito verificador incorreto sem lançar', () => {
  const resultado = analyzeNfeKey(CHAVE_INVALIDA)
  assert.equal(resultado.chaveValida, false)
  assert.equal(resultado.chaveInterpretada, null)
  assert.equal(resultado.fields.numeroNf.confidence, CONFIDENCE.NAO_ENCONTRADO)
  assert.ok(resultado.warnings.length > 0)
})

test('analyzeNfeKey aceita a chave formatada com espaços (normaliza antes de validar)', () => {
  const resultado = analyzeNfeKey('4226 0748 9095 8000 0160 5500 1000 0082 8016 7504 2868')
  assert.equal(resultado.chaveValida, true)
  assert.equal(resultado.fields.serieNf.value, '1')
})

test('buildAnalysisFromKey com chave nula produz o mesmo formato "nada encontrado"', () => {
  const resultado = buildAnalysisFromKey(null, [])
  assert.equal(resultado.chaveValida, false)
  assert.equal(resultado.fields.numeroNf.confidence, CONFIDENCE.NAO_ENCONTRADO)
  // dataRecebimento é a única exceção: sempre vem preenchida com a sugestão de hoje, não derivada da chave.
  assert.equal(resultado.fields.dataRecebimento.value.length, 10)
})

test('buildAnalysisFromKey propaga fontesCruzadas e origens tal como recebidas', () => {
  const resultado = buildAnalysisFromKey(CHAVE_METALFORT, ['texto do PDF', 'código de barras'], {
    fontesCruzadas: true,
  })
  assert.equal(resultado.fontesCruzadas, true)
  assert.deepEqual(resultado.origensChave, ['texto do PDF', 'código de barras'])
})
