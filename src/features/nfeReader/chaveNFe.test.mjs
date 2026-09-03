/**
 * Teste da matemática de validação/interpretação da chave de acesso — não
 * depende de PDF, canvas ou navegador. Roda com o test runner nativo do
 * Node (`node --test`, sem dependência nova).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findValidNfeKeys, interpretarChave, validarChaveNFe } from './chaveNFe.js'

const CHAVE_METALFORT = '42260748909580000160550010000082801675042868'
const CHAVE_METALFORT_FORMATADA = '4226 0748 9095 8000 0160 5500 1000 0082 8016 7504 2868'

test('valida a chave real da METALFORT (dígito verificador correto)', () => {
  assert.equal(validarChaveNFe(CHAVE_METALFORT), true)
})

test('interpreta a chave real da METALFORT com todos os campos esperados', () => {
  const resultado = interpretarChave(CHAVE_METALFORT)
  assert.ok(resultado, 'a chave deveria ser válida e retornar um objeto interpretado')
  assert.equal(resultado.uf, '42')
  assert.equal(resultado.anoMes, '2607')
  assert.equal(resultado.cnpj, '48909580000160')
  assert.equal(resultado.cnpjFormatado, '48.909.580/0001-60')
  assert.equal(resultado.modelo, '55')
  assert.equal(Number(resultado.serie), 1)
  assert.equal(Number(resultado.numeroNf), 8280)
})

test('findValidNfeKeys encontra a chave formatada em blocos separados por espaço', () => {
  const encontradas = findValidNfeKeys(CHAVE_METALFORT_FORMATADA)
  assert.deepEqual(encontradas, [CHAVE_METALFORT])
})

test('findValidNfeKeys também aceita hífens e quebras de linha como separador', () => {
  const comHifen = '4226-0748-9095-8000-0160-5500-1000-0082-8016-7504-2868'
  const comQuebraDeLinha = '4226 0748\n9095 8000\n0160 5500\n1000 0082\n8016 7504\n2868'
  assert.deepEqual(findValidNfeKeys(comHifen), [CHAVE_METALFORT])
  assert.deepEqual(findValidNfeKeys(comQuebraDeLinha), [CHAVE_METALFORT])
})

test('findValidNfeKeys nunca aceita 44 dígitos sem dígito verificador válido', () => {
  const digitosSemDvValido = '11111111111111111111111111111111111111111111'
  assert.deepEqual(findValidNfeKeys(digitosSemDvValido), [])
})

test('findValidNfeKeys deduplica a mesma chave repetida no texto', () => {
  const textoComRepeticao = `Via 1: ${CHAVE_METALFORT} ... Via 2 (canhoto): ${CHAVE_METALFORT}`
  assert.deepEqual(findValidNfeKeys(textoComRepeticao), [CHAVE_METALFORT])
})

test('interpretarChave rejeita uma chave com dígito verificador incorreto', () => {
  const chaveComDvErrado = CHAVE_METALFORT.slice(0, 43) + '0'
  assert.equal(interpretarChave(chaveComDvErrado), null)
})
