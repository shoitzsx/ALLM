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

// Chave sintética (fictícia): DV da chave e dígitos verificadores do CNPJ
// embutido corretos, para passar na validação completa (DV + cUF/AAMM/CNPJ/
// modelo). O CNPJ é uma sequência de exemplo, não o de um emitente real.
const CHAVE_EXEMPLO = '42260112345678000195550010000000011000000017'
const CHAVE_EXEMPLO_FORMATADA = '4226 0112 3456 7800 0195 5500 1000 0000 0110 0000 0017'
const BASE43_EXEMPLO = CHAVE_EXEMPLO.slice(0, 43)

// Sequência sintética no formato do falso positivo relatado: passa no DV, mas
// cUF=40 (não existe), AAMM com mês 49 (impossível), modelo 02 (não é NF-e) e
// CNPJ com dígitos verificadores inválidos. Antes da validação semântica
// abaixo, `validarChaveNFe` aceitava isso como uma chave de NF-e real.
const CHAVE_FALSO_POSITIVO_OCR = '40104922333000181550020000000000030000000039'

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

test('valida uma chave sintética com dígito verificador correto', () => {
  assert.equal(validarChaveNFe(CHAVE_EXEMPLO), true)
})

test('interpreta uma chave sintética com todos os campos esperados', () => {
  const resultado = interpretarChave(CHAVE_EXEMPLO)
  assert.ok(resultado, 'a chave deveria ser válida e retornar um objeto interpretado')
  assert.equal(resultado.uf, '42')
  assert.equal(resultado.anoMes, '2601')
  assert.equal(resultado.cnpj, '12345678000195')
  assert.equal(resultado.cnpjFormatado, '12.345.678/0001-95')
  assert.equal(resultado.modelo, '55')
  assert.equal(Number(resultado.serie), 1)
  assert.equal(Number(resultado.numeroNf), 1)
})

test('findValidNfeKeys encontra a chave formatada em blocos separados por espaço', () => {
  const encontradas = findValidNfeKeys(CHAVE_EXEMPLO_FORMATADA)
  assert.deepEqual(encontradas, [CHAVE_EXEMPLO])
})

test('findValidNfeKeys também aceita hífens e quebras de linha como separador', () => {
  const comHifen = '4226-0112-3456-7800-0195-5500-1000-0000-0110-0000-0017'
  const comQuebraDeLinha = '4226 0112\n3456 7800\n0195 5500\n1000 0000\n0110 0000\n0017'
  assert.deepEqual(findValidNfeKeys(comHifen), [CHAVE_EXEMPLO])
  assert.deepEqual(findValidNfeKeys(comQuebraDeLinha), [CHAVE_EXEMPLO])
})

test('findValidNfeKeys nunca aceita 44 dígitos sem dígito verificador válido', () => {
  const digitosSemDvValido = '11111111111111111111111111111111111111111111'
  assert.deepEqual(findValidNfeKeys(digitosSemDvValido), [])
})

// --- Priorização por rótulo "CHAVE DE ACESSO" (extração, não validação) ---

// Segunda chave sintética, no lugar da chave de um DANFE real usada antes neste teste.
const CHAVE_DANFE_EXEMPLO = '43240111222333000181550020000000021000000021'
const BLOCO_CHAVE_DANFE_EXEMPLO = '4324 0111 2223 3300 0181 5500 2000 0000 0210 0000 0021'

test('findValidNfeKeys reconstrói a chave logo após o rótulo "CHAVE DE ACESSO" (formato do caso real relatado)', () => {
  const texto = `DANFE\nCHAVE DE ACESSO\n${BLOCO_CHAVE_DANFE_EXEMPLO}\nCNPJ: 11.222.333/0001-81`
  assert.deepEqual(findValidNfeKeys(texto), [CHAVE_DANFE_EXEMPLO])
})

test('findValidNfeKeys sem o rótulo "CHAVE DE ACESSO" continua funcionando (nenhuma regressão)', () => {
  assert.deepEqual(findValidNfeKeys(CHAVE_EXEMPLO_FORMATADA), [CHAVE_EXEMPLO])
})

test('findValidNfeKeys prioriza a chave perto do rótulo mesmo havendo outra chave válida distante no texto (números de outras áreas não ganham prioridade)', () => {
  const texto = `Texto de rodapé qualquer, nada a ver. ${CHAVE_EXEMPLO_FORMATADA} mais texto solto.\n\nCHAVE DE ACESSO\n${BLOCO_CHAVE_DANFE_EXEMPLO}`
  const encontradas = findValidNfeKeys(texto)
  assert.equal(encontradas[0], CHAVE_DANFE_EXEMPLO, 'a chave perto do rótulo vem primeiro')
  assert.ok(encontradas.includes(CHAVE_EXEMPLO), 'mas a outra chave válida do texto não é descartada, só desempatada depois')
})

test('findValidNfeKeys deduplica a mesma chave repetida no texto', () => {
  const textoComRepeticao = `Via 1: ${CHAVE_EXEMPLO} ... Via 2 (canhoto): ${CHAVE_EXEMPLO}`
  assert.deepEqual(findValidNfeKeys(textoComRepeticao), [CHAVE_EXEMPLO])
})

test('interpretarChave rejeita uma chave com dígito verificador incorreto', () => {
  const chaveComDvErrado = CHAVE_EXEMPLO.slice(0, 43) + '0'
  assert.equal(interpretarChave(chaveComDvErrado), null)
})

// --- Validação semântica (cUF/AAMM/CNPJ/modelo) — não basta passar no DV ---

test('validarCnpjDigitos aceita um CNPJ com dígitos verificadores corretos (o da chave sintética)', () => {
  assert.equal(validarCnpjDigitos('12345678000195'), true)
})

test('validarCnpjDigitos rejeita dígitos verificadores incorretos e sequências de 14 dígitos iguais', () => {
  assert.equal(validarCnpjDigitos('22333000181550'), false, 'CNPJ embutido no falso positivo')
  assert.equal(validarCnpjDigitos('00000000000000'), false, 'repetição não é um CNPJ real, mesmo que passasse no cálculo')
  assert.equal(validarCnpjDigitos('123'), false, 'tamanho errado')
})

test('validarChaveNFe rejeita cUF inexistente (ex.: 40), mesmo com DV correto', () => {
  const chave = montarChaveComDvCorreto(substituir(BASE43_EXEMPLO, 0, '40'))
  assert.equal(validarDvChaveNFe(chave), true, 'pré-condição: o DV precisa estar correto para o teste provar a checagem semântica')
  assert.equal(validarChaveNFe(chave), false)
})

test('validarChaveNFe rejeita AAMM com mês 49 (impossível), mesmo com DV correto', () => {
  const chave = montarChaveComDvCorreto(substituir(BASE43_EXEMPLO, 4, '49'))
  assert.equal(validarDvChaveNFe(chave), true)
  assert.equal(validarChaveNFe(chave), false)
})

test('validarChaveNFe aceita meses nas bordas válidas (01 e 12)', () => {
  const chaveJaneiro = montarChaveComDvCorreto(substituir(BASE43_EXEMPLO, 4, '01'))
  const chaveDezembro = montarChaveComDvCorreto(substituir(BASE43_EXEMPLO, 4, '12'))
  assert.equal(validarChaveNFe(chaveJaneiro), true)
  assert.equal(validarChaveNFe(chaveDezembro), true)
})

test('validarChaveNFe rejeita modelo diferente de 55 (ex.: 02, 65), mesmo com DV correto', () => {
  const chaveModelo02 = montarChaveComDvCorreto(substituir(BASE43_EXEMPLO, 20, '02'))
  const chaveModelo65 = montarChaveComDvCorreto(substituir(BASE43_EXEMPLO, 20, '65'))
  assert.equal(validarChaveNFe(chaveModelo02), false)
  assert.equal(validarChaveNFe(chaveModelo65), false)
})

test('validarChaveNFe rejeita CNPJ embutido com dígitos verificadores inválidos, mesmo com DV da chave correto', () => {
  const chave = montarChaveComDvCorreto(substituir(BASE43_EXEMPLO, 6, '00000000000001'))
  assert.equal(validarDvChaveNFe(chave), true)
  assert.equal(validarChaveNFe(chave), false)
})

test('a sequência no formato do falso positivo relatado (cUF/AAMM/modelo/CNPJ todos incoerentes) é rejeitada', () => {
  assert.equal(validarDvChaveNFe(CHAVE_FALSO_POSITIVO_OCR), true, 'é um falso positivo exatamente porque passa no DV')
  assert.equal(validarChaveNFe(CHAVE_FALSO_POSITIVO_OCR), false)
  assert.equal(interpretarChave(CHAVE_FALSO_POSITIVO_OCR), null)
})

test('encontrouSequenciaDe44Digitos identifica a sequência do falso positivo mesmo sabendo que ela é inválida', () => {
  assert.equal(encontrouSequenciaDe44Digitos(CHAVE_FALSO_POSITIVO_OCR), true)
  assert.equal(encontrouSequenciaDe44Digitos('nenhum número de 44 dígitos aqui'), false)
  assert.equal(encontrouSequenciaDe44Digitos(''), false)
})
