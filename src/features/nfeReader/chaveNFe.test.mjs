/**
 * Teste da matemática de validação/interpretação da chave de acesso — não
 * depende de PDF, canvas ou navegador. Roda com o test runner nativo do
 * Node (`node --test`, sem dependência nova).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  encontrouSequenciaDe44Digitos,
  findValidNfeKeys,
  interpretarChave,
  validarCnpjDigitos,
  validarChaveNFe,
  validarDvChaveNFe,
} from './chaveNFe.js'

const CHAVE_METALFORT = '42260748909580000160550010000082801675042868'
const CHAVE_METALFORT_FORMATADA = '4226 0748 9095 8000 0160 5500 1000 0082 8016 7504 2868'
const BASE43_METALFORT = CHAVE_METALFORT.slice(0, 43)

// Chave real reportada como falso positivo: passa no DV, mas cUF=40 (não
// existe), AAMM com mês 49 (impossível), modelo 02 (não é NF-e) e CNPJ com
// dígitos verificadores inválidos. Antes da validação semântica abaixo,
// `validarChaveNFe` aceitava isso como uma chave de NF-e real.
const CHAVE_FALSO_POSITIVO_OCR = '40104994734000518550020000395041864220514400'

/** Mesmo algoritmo de validarDvChaveNFe — usado só para MONTAR fixtures de teste com DV correto, nunca para validar produção. */
function calcularDv(base43) {
  const digs = base43.split('').map(Number)
  let peso = 2
  let soma = 0
  for (let i = digs.length - 1; i >= 0; i--) {
    soma += digs[i] * peso
    peso++
    if (peso > 9) peso = 2
  }
  const resto = soma % 11
  const dv = 11 - resto
  return dv >= 10 ? 0 : dv
}

function montarChaveComDvCorreto(base43) {
  return `${base43}${calcularDv(base43)}`
}

/** Substitui um trecho de `base` a partir de `inicio`, mantendo o resto intacto. */
function substituir(base, inicio, novoTrecho) {
  return base.slice(0, inicio) + novoTrecho + base.slice(inicio + novoTrecho.length)
}

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

// --- Priorização por rótulo "CHAVE DE ACESSO" (extração, não validação) ---

const CHAVE_REAL_DANFE_WGS = '43240104994734000518550020000398041864220514'
const BLOCO_CHAVE_REAL_DANFE_WGS = '4324 0104 9947 3400 0518 5500 2000 0398 0418 6422 0514'

test('findValidNfeKeys reconstrói a chave real logo após o rótulo "CHAVE DE ACESSO" (caso real relatado)', () => {
  const texto = `DANFE\nCHAVE DE ACESSO\n${BLOCO_CHAVE_REAL_DANFE_WGS}\nCNPJ: 04.994.734/0005-18`
  assert.deepEqual(findValidNfeKeys(texto), [CHAVE_REAL_DANFE_WGS])
})

test('findValidNfeKeys sem o rótulo "CHAVE DE ACESSO" continua funcionando (nenhuma regressão)', () => {
  assert.deepEqual(findValidNfeKeys(CHAVE_METALFORT_FORMATADA), [CHAVE_METALFORT])
})

test('findValidNfeKeys prioriza a chave perto do rótulo mesmo havendo outra chave válida distante no texto (números de outras áreas não ganham prioridade)', () => {
  const texto = `Texto de rodapé qualquer, nada a ver. ${CHAVE_METALFORT_FORMATADA} mais texto solto.\n\nCHAVE DE ACESSO\n${BLOCO_CHAVE_REAL_DANFE_WGS}`
  const encontradas = findValidNfeKeys(texto)
  assert.equal(encontradas[0], CHAVE_REAL_DANFE_WGS, 'a chave perto do rótulo vem primeiro')
  assert.ok(encontradas.includes(CHAVE_METALFORT), 'mas a outra chave válida do texto não é descartada, só desempatada depois')
})

test('findValidNfeKeys deduplica a mesma chave repetida no texto', () => {
  const textoComRepeticao = `Via 1: ${CHAVE_METALFORT} ... Via 2 (canhoto): ${CHAVE_METALFORT}`
  assert.deepEqual(findValidNfeKeys(textoComRepeticao), [CHAVE_METALFORT])
})

test('interpretarChave rejeita uma chave com dígito verificador incorreto', () => {
  const chaveComDvErrado = CHAVE_METALFORT.slice(0, 43) + '0'
  assert.equal(interpretarChave(chaveComDvErrado), null)
})

// --- Validação semântica (cUF/AAMM/CNPJ/modelo) — não basta passar no DV ---

test('validarCnpjDigitos aceita um CNPJ real (dígitos verificadores corretos, da própria chave METALFORT)', () => {
  assert.equal(validarCnpjDigitos('48909580000160'), true)
})

test('validarCnpjDigitos rejeita dígitos verificadores incorretos e sequências de 14 dígitos iguais', () => {
  assert.equal(validarCnpjDigitos('94734000518550'), false, 'CNPJ embutido no falso positivo real')
  assert.equal(validarCnpjDigitos('00000000000000'), false, 'repetição não é um CNPJ real, mesmo que passasse no cálculo')
  assert.equal(validarCnpjDigitos('123'), false, 'tamanho errado')
})

test('validarChaveNFe rejeita cUF inexistente (ex.: 40), mesmo com DV correto', () => {
  const chave = montarChaveComDvCorreto(substituir(BASE43_METALFORT, 0, '40'))
  assert.equal(validarDvChaveNFe(chave), true, 'pré-condição: o DV precisa estar correto para o teste provar a checagem semântica')
  assert.equal(validarChaveNFe(chave), false)
})

test('validarChaveNFe rejeita AAMM com mês 49 (impossível), mesmo com DV correto', () => {
  const chave = montarChaveComDvCorreto(substituir(BASE43_METALFORT, 4, '49'))
  assert.equal(validarDvChaveNFe(chave), true)
  assert.equal(validarChaveNFe(chave), false)
})

test('validarChaveNFe aceita meses nas bordas válidas (01 e 12)', () => {
  const chaveJaneiro = montarChaveComDvCorreto(substituir(BASE43_METALFORT, 4, '01'))
  const chaveDezembro = montarChaveComDvCorreto(substituir(BASE43_METALFORT, 4, '12'))
  assert.equal(validarChaveNFe(chaveJaneiro), true)
  assert.equal(validarChaveNFe(chaveDezembro), true)
})

test('validarChaveNFe rejeita modelo diferente de 55 (ex.: 02, 65), mesmo com DV correto', () => {
  const chaveModelo02 = montarChaveComDvCorreto(substituir(BASE43_METALFORT, 20, '02'))
  const chaveModelo65 = montarChaveComDvCorreto(substituir(BASE43_METALFORT, 20, '65'))
  assert.equal(validarChaveNFe(chaveModelo02), false)
  assert.equal(validarChaveNFe(chaveModelo65), false)
})

test('validarChaveNFe rejeita CNPJ embutido com dígitos verificadores inválidos, mesmo com DV da chave correto', () => {
  const chave = montarChaveComDvCorreto(substituir(BASE43_METALFORT, 6, '00000000000001'))
  assert.equal(validarDvChaveNFe(chave), true)
  assert.equal(validarChaveNFe(chave), false)
})

test('a chave real do falso positivo relatado (cUF/AAMM/modelo/CNPJ todos incoerentes) é rejeitada', () => {
  assert.equal(validarDvChaveNFe(CHAVE_FALSO_POSITIVO_OCR), true, 'é um falso positivo exatamente porque passa no DV')
  assert.equal(validarChaveNFe(CHAVE_FALSO_POSITIVO_OCR), false)
  assert.equal(interpretarChave(CHAVE_FALSO_POSITIVO_OCR), null)
})

test('encontrouSequenciaDe44Digitos identifica a sequência do falso positivo mesmo sabendo que ela é inválida', () => {
  assert.equal(encontrouSequenciaDe44Digitos(CHAVE_FALSO_POSITIVO_OCR), true)
  assert.equal(encontrouSequenciaDe44Digitos('nenhum número de 44 dígitos aqui'), false)
  assert.equal(encontrouSequenciaDe44Digitos(''), false)
})
