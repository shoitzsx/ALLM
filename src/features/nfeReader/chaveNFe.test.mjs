/**
 * Teste da matemática de validação/interpretação da chave de acesso — não
 * depende de PDF, canvas ou navegador. Roda com o test runner nativo do
 * Node (`node --test`, sem dependência nova).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findValidNfeKeys, interpretarChave, validarChaveNFe } from './chaveNFe.js'

// Chave sintética (fictícia), com dígito verificador válido — a mesma dos fixtures de imagem.
const CHAVE_EXEMPLO = '42260112345678000199550010000000011000000014'
const CHAVE_EXEMPLO_FORMATADA = '4226 0112 3456 7800 0199 5500 1000 0000 0110 0000 0014'

test('valida uma chave sintética com dígito verificador correto', () => {
  assert.equal(validarChaveNFe(CHAVE_EXEMPLO), true)
})

test('interpreta uma chave sintética com todos os campos esperados', () => {
  const resultado = interpretarChave(CHAVE_EXEMPLO)
  assert.ok(resultado, 'a chave deveria ser válida e retornar um objeto interpretado')
  assert.equal(resultado.uf, '42')
  assert.equal(resultado.anoMes, '2601')
  assert.equal(resultado.cnpj, '12345678000199')
  assert.equal(resultado.cnpjFormatado, '12.345.678/0001-99')
  assert.equal(resultado.modelo, '55')
  assert.equal(Number(resultado.serie), 1)
  assert.equal(Number(resultado.numeroNf), 1)
})

test('findValidNfeKeys encontra a chave formatada em blocos separados por espaço', () => {
  const encontradas = findValidNfeKeys(CHAVE_EXEMPLO_FORMATADA)
  assert.deepEqual(encontradas, [CHAVE_EXEMPLO])
})

test('findValidNfeKeys também aceita hífens e quebras de linha como separador', () => {
  const comHifen = '4226-0112-3456-7800-0199-5500-1000-0000-0110-0000-0014'
  const comQuebraDeLinha = '4226 0112\n3456 7800\n0199 5500\n1000 0000\n0110 0000\n0014'
  assert.deepEqual(findValidNfeKeys(comHifen), [CHAVE_EXEMPLO])
  assert.deepEqual(findValidNfeKeys(comQuebraDeLinha), [CHAVE_EXEMPLO])
})

test('findValidNfeKeys nunca aceita 44 dígitos sem dígito verificador válido', () => {
  const digitosSemDvValido = '11111111111111111111111111111111111111111111'
  assert.deepEqual(findValidNfeKeys(digitosSemDvValido), [])
})

test('findValidNfeKeys deduplica a mesma chave repetida no texto', () => {
  const textoComRepeticao = `Via 1: ${CHAVE_EXEMPLO} ... Via 2 (canhoto): ${CHAVE_EXEMPLO}`
  assert.deepEqual(findValidNfeKeys(textoComRepeticao), [CHAVE_EXEMPLO])
})

test('interpretarChave rejeita uma chave com dígito verificador incorreto', () => {
  const chaveComDvErrado = CHAVE_EXEMPLO.slice(0, 43) + '0'
  assert.equal(interpretarChave(chaveComDvErrado), null)
})
