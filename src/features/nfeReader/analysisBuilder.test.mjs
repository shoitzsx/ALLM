/**
 * Testes da montagem do objeto de análise a partir de uma chave já resolvida
 * — sem PDF, canvas, câmera ou navegador. Roda com o test runner nativo do
 * Node (`node --test`), igual a chaveNFe.test.mjs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeNfeKey, buildAnalysisFromKey, buildReliableReceiptPrefill, CONFIDENCE } from './analysisBuilder.js'

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

// --- buildReliableReceiptPrefill — o que pode ser levado para "Novo recebimento" ---

test('buildReliableReceiptPrefill leva só os campos derivados matematicamente da chave (confiança alta)', () => {
  const resultado = analyzeNfeKey(CHAVE_METALFORT, 'foto do código de barras')
  const prefill = buildReliableReceiptPrefill(resultado, {})
  assert.deepEqual(Object.keys(prefill).sort(), ['cnpjFornecedor', 'numeroNf', 'serieNf'])
  assert.equal(prefill.numeroNf, '8280')
  assert.equal(prefill.serieNf, '1')
})

test('buildReliableReceiptPrefill NUNCA leva pedido, mesmo que a análise tenha encontrado um valor por heurística de texto', () => {
  const resultado = buildAnalysisFromKey(CHAVE_METALFORT, ['texto do PDF'], { text: 'Pedido de compra nº 4500873245' })
  assert.equal(resultado.fields.pedido.confidence, CONFIDENCE.BAIXA)
  assert.ok(resultado.fields.pedido.value, 'pré-condição: a heurística encontrou algo')
  const prefill = buildReliableReceiptPrefill(resultado, {})
  assert.equal('pedido' in prefill, false)
})

test('buildReliableReceiptPrefill inclui fornecedor só quando vem do catálogo real (confiança alta) — nunca um valor de exemplo', () => {
  const semCatalogo = analyzeNfeKey(CHAVE_METALFORT)
  assert.equal(semCatalogo.fields.fornecedor.confidence, CONFIDENCE.NAO_ENCONTRADO)
  assert.equal('fornecedor' in buildReliableReceiptPrefill(semCatalogo, {}), false)

  // Simula o catálogo local já ter um fornecedor real, confirmado manualmente antes pelo usuário
  // para este CNPJ (supplierCatalog.js) — buildAnalysisFromKey já testa isso via getSupplierByCnpj;
  // aqui simulamos o resultado que ela produziria.
  const comCatalogo = buildAnalysisFromKey(CHAVE_METALFORT, ['código de barras'])
  comCatalogo.fields.fornecedor = { value: 'Fornecedor Real Ltda', confidence: CONFIDENCE.ALTA, origin: 'catálogo de fornecedores' }
  const prefill = buildReliableReceiptPrefill(comCatalogo, {})
  assert.equal(prefill.fornecedor, 'Fornecedor Real Ltda')
})

test('buildReliableReceiptPrefill usa o valor atual da tela (correção manual do usuário), não o valor extraído original', () => {
  const resultado = analyzeNfeKey(CHAVE_METALFORT)
  const prefill = buildReliableReceiptPrefill(resultado, { numeroNf: '9999-corrigido' })
  assert.equal(prefill.numeroNf, '9999-corrigido')
})

test('buildReliableReceiptPrefill com chave inválida não leva nada (tudo "não encontrado")', () => {
  const resultado = analyzeNfeKey(CHAVE_INVALIDA)
  const prefill = buildReliableReceiptPrefill(resultado, {})
  assert.deepEqual(prefill, {})
})
