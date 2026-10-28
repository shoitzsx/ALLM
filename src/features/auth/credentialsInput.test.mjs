import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MATRICULA_MAX_LENGTH,
  MATRICULA_MIN_LENGTH,
  PIN_LENGTH,
  applyMatriculaInput,
  applyPinInput,
  canSubmitCredentials,
  isMatriculaComplete,
  isPinComplete,
  sanitizeMatriculaInput,
  sanitizePinInput,
} from './credentialsInput.js'

// Regras OFICIAIS (Goran e Kobner): matrícula [0-9A-Z]{3,20} em maiúsculas; PIN do MVP com exatamente 8 dígitos.

// --- matrícula: letras e números, 3 a 20 caracteres, maiúsculas na digitação ---

test('limites oficiais: matrícula de 3 a 20 caracteres, PIN de 8 dígitos', () => {
  assert.equal(MATRICULA_MIN_LENGTH, 3)
  assert.equal(MATRICULA_MAX_LENGTH, 20)
  assert.equal(PIN_LENGTH, 8)
})

test('matrícula válida (3 a 20) passa intacta, com zeros à esquerda e letras em maiúsculas', () => {
  for (const value of ['123', '0012', '000123', '123456', 'A12345', 'ABC', 'AB1', '0'.repeat(20), 'A'.repeat(20), '1234567890ABCDEFGHIJ']) {
    assert.equal(sanitizeMatriculaInput(value), value)
    assert.equal(typeof sanitizeMatriculaInput(value), 'string')
    assert.equal(isMatriculaComplete(sanitizeMatriculaInput(value)), true, value)
  }
})

test('matrícula: o limite mínimo é 3 e o máximo é 20, nos dois lados da fronteira', () => {
  for (const value of ['', '0', '1', 'A', '12', 'AB']) assert.equal(isMatriculaComplete(value), false, JSON.stringify(value))
  for (const value of ['123', 'ABC']) assert.equal(isMatriculaComplete(value), true, value)
  assert.equal(isMatriculaComplete('9'.repeat(20)), true)
  assert.equal(isMatriculaComplete('9'.repeat(21)), false)
  assert.equal(isMatriculaComplete('A'.repeat(21)), false)
})

test('letras minúsculas viram MAIÚSCULAS durante a digitação', () => {
  assert.equal(sanitizeMatriculaInput('a12b'), 'A12B')
  assert.equal(sanitizeMatriculaInput('abc123'), 'ABC123')
  assert.deepEqual(applyMatriculaInput('', 'ab12'), { value: 'AB12', overflow: false })
  assert.deepEqual(applyMatriculaInput('AB1', 'AB1c'), { value: 'AB1C', overflow: false })
})

test('o teste de "completa" é estrito: minúscula, espaço, símbolo ou acento não passam', () => {
  for (const value of ['abc', 'Ab1', ' 123', '12 3', '1.234', 'A-12', 'AÇ1', '１２３']) assert.equal(isMatriculaComplete(value), false, JSON.stringify(value))
})

test('limpar a matrícula tira só o que não é 0-9 ou A-Z; NUNCA corta (o excesso é recusado, não truncado)', () => {
  assert.equal(sanitizeMatriculaInput('9'.repeat(25)), '9'.repeat(25))
  assert.equal(sanitizeMatriculaInput('A'.repeat(40)), 'A'.repeat(40))
  assert.equal(sanitizeMatriculaInput('00123AB'), '00123AB')
  assert.equal(sanitizeMatriculaInput('12-34'), '1234')
  assert.equal(sanitizeMatriculaInput('+0012'), '0012')
  assert.equal(sanitizeMatriculaInput('1e5'), '1E5')
})

test('só ASCII: dígitos e letras de outros alfabetos, acentos e "ß" são descartados', () => {
  assert.equal(sanitizeMatriculaInput('١٢٣٤'), '')
  assert.equal(sanitizeMatriculaInput('１２３４'), '')
  assert.equal(sanitizeMatriculaInput('ßÇãé'), '', '"ß" não pode virar "SS" nem acento virar letra')
  assert.equal(sanitizeMatriculaInput('Ação123'), 'AO123')
  assert.equal(sanitizeMatriculaInput('İ12'), '12')
})

// --- entrada: digitação, colagem e preenchimento automático chegam todos como "novo valor bruto do campo" ---

const accept = (previous, raw) => applyMatriculaInput(previous, raw)

test('mais de 20 caracteres é RECUSADO e o valor que já estava no campo é preservado (sem truncar)', () => {
  const twenty = '1234567890ABCDEFGHIJ'
  // Digitar o 21º caractere.
  assert.deepEqual(accept(twenty, `${twenty}K`), { value: twenty, overflow: true })
  // Colar 21 caracteres num campo vazio: nada entra (não vira os 20 primeiros).
  assert.deepEqual(accept('', `${twenty}K`), { value: '', overflow: true })
  // Colar algo longo num campo com valor válido: o valor anterior fica.
  assert.deepEqual(accept('AB12', 'X'.repeat(40)), { value: 'AB12', overflow: true })
  // O limite conta caracteres VÁLIDOS: separadores e símbolos não o gastam nem o escondem.
  assert.deepEqual(accept('', `${twenty.slice(0, 10)}-${twenty.slice(10)}-K`), { value: '', overflow: true })
  assert.deepEqual(accept('', '1 2 3 4 5 6 7 8 9 0 A B C D E F G H I J K'), { value: '', overflow: true })
})

test('até 20 caracteres é aceito, com os zeros à esquerda', () => {
  assert.deepEqual(accept('', '0012'), { value: '0012', overflow: false })
  assert.deepEqual(accept('', 'a000123'), { value: 'A000123', overflow: false })
  assert.deepEqual(accept('', '1234567890ABCDEFGHIJ'), { value: '1234567890ABCDEFGHIJ', overflow: false })
  assert.deepEqual(accept('1234567890ABCDEFGHI', '1234567890ABCDEFGHIJ'), { value: '1234567890ABCDEFGHIJ', overflow: false })
  assert.deepEqual(accept('', '00 12-34'), { value: '001234', overflow: false })
  assert.deepEqual(accept('', 'Mat 0012 34'), { value: 'MAT001234', overflow: false })
  assert.equal(typeof accept('', '0012').value, 'string')
})

test('apagar nunca recusa: a matrícula de 20 volta a aceitar caractere depois de apagar', () => {
  const twenty = '1234567890ABCDEFGHIJ'
  assert.deepEqual(accept(twenty, twenty.slice(0, -1)), { value: twenty.slice(0, -1), overflow: false })
  assert.deepEqual(accept('1', ''), { value: '', overflow: false })
  assert.deepEqual(accept(twenty.slice(0, -1), `${twenty.slice(0, -1)}Z`), { value: `${twenty.slice(0, -1)}Z`, overflow: false })
})

test('símbolos e espaços saem em silêncio (sem aviso de excesso)', () => {
  assert.deepEqual(accept('12', '12-'), { value: '12', overflow: false })
  assert.deepEqual(accept('', '---'), { value: '', overflow: false })
  assert.deepEqual(accept('', '١٢٣٤'), { value: '', overflow: false })
  assert.deepEqual(accept(null, undefined), { value: '', overflow: false })
})

test('o valor anterior preservado passa pelo mesmo saneamento (maiúsculas, só A-Z e 0-9)', () => {
  assert.equal(accept('ab-12', 'X'.repeat(25)).value, 'AB12')
})

test('colagem e preenchimento assistido: espaços, quebras e separadores saem', () => {
  assert.equal(sanitizeMatriculaInput('  001234\n'), '001234')
  assert.equal(sanitizeMatriculaInput('00 12 34'), '001234')
  assert.equal(sanitizeMatriculaInput('Matrícula: 000123'), 'MATRCULA000123')
  assert.equal(sanitizeMatriculaInput(null), '')
  assert.equal(sanitizeMatriculaInput(undefined), '')
})

test('apagar: o valor digitado, sem o último caractere, continua sendo texto com os zeros', () => {
  assert.equal(sanitizeMatriculaInput('001234'.slice(0, -1)), '00123')
  assert.equal(sanitizeMatriculaInput('0012'.slice(0, -1)), '001')
  assert.equal(sanitizeMatriculaInput('0'.slice(0, -1)), '')
})

test('a matrícula nunca é convertida em número (os zeros à esquerda são significativos)', () => {
  const sources = ['credentialsInput.js', 'LoginPage.jsx', 'ActivatePasskeyPage.jsx'].map((name) => readFileSync(new URL(name, import.meta.url), 'utf8'))
  for (const source of sources) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    assert.doesNotMatch(code, /\bNumber\s*\(|parseInt|parseFloat|Math\.|\bunary\+|=\s*\+\s*matricula|valueAsNumber|type="number"|type='number'/)
  }
  assert.equal(sanitizeMatriculaInput('0012'), '0012')
  assert.notEqual(sanitizeMatriculaInput('0012'), String(Number('0012')))
})

// --- PIN: exatamente 8 dígitos numéricos ---

test('PIN mantém só dígitos 0-9: digitação, colagem e preenchimento assistido', () => {
  assert.equal(sanitizePinInput('1234'), '1234')
  assert.equal(sanitizePinInput('1234 5678'), '12345678')
  assert.equal(sanitizePinInput('1a2b3c'), '123')
  assert.equal(sanitizePinInput('  12-34\n'), '1234')
  assert.equal(sanitizePinInput('abc'), '')
  assert.equal(sanitizePinInput(null), '')
  assert.equal(sanitizePinInput(undefined), '')
})

test('PIN descarta dígitos de outros alfabetos (só 0-9 ASCII)', () => {
  assert.equal(sanitizePinInput('١٢٣'), '')
  assert.equal(sanitizePinInput('１２３'), '')
})

test('PIN completo = exatamente 8 dígitos, com os zeros à esquerda preservados', () => {
  assert.equal(isPinComplete('12345678'), true)
  assert.equal(isPinComplete('00000000'), true)
  assert.equal(isPinComplete('00123456'), true)
  assert.equal(typeof applyPinInput('', '00123456'), 'string')
  assert.equal(applyPinInput('', '00123456'), '00123456')
  for (const value of ['', '1', '1234567', '123456789', '0000000', '1234567a', 'abcdefgh', ' 12345678', '1234 5678']) {
    assert.equal(isPinComplete(value), false, JSON.stringify(value))
  }
})

test('PIN: até 8 dígitos é aceito; o 9º é RECUSADO e o valor anterior fica (sem truncar)', () => {
  assert.equal(applyPinInput('', '1234'), '1234')
  assert.equal(applyPinInput('1234567', '12345678'), '12345678')
  assert.equal(applyPinInput('12345678', '123456789'), '12345678')
  assert.equal(applyPinInput('', '123456789'), '', 'colar 9 dígitos não vira os 8 primeiros')
  assert.equal(applyPinInput('1234', '1'.repeat(64)), '1234')
  assert.equal(applyPinInput('12345678', '1234567'), '1234567', 'apagar nunca é recusado')
  assert.equal(applyPinInput('', '1234 5678'), '12345678')
  assert.equal(applyPinInput('', 'abcd'), '')
  assert.equal(applyPinInput(null, undefined), '')
})

test('pode enviar quando matrícula e PIN têm conteúdo; os tamanhos são checados à parte', () => {
  assert.equal(canSubmitCredentials({ matricula: '0012', pin: '1' }), true)
  assert.equal(canSubmitCredentials({ matricula: 'abc', pin: '12345678' }), true)
  assert.equal(canSubmitCredentials({ matricula: '', pin: '12345678' }), false)
  assert.equal(canSubmitCredentials({ matricula: '   ', pin: '12345678' }), false)
  assert.equal(canSubmitCredentials({ matricula: '---', pin: '12345678' }), false)
  assert.equal(canSubmitCredentials({ matricula: '0012', pin: '' }), false)
  assert.equal(canSubmitCredentials({ matricula: '0012', pin: 'abc' }), false)
  assert.equal(canSubmitCredentials({}), false)
  assert.equal(canSubmitCredentials(), false)
})
