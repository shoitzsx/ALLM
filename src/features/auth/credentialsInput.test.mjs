import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MATRICULA_MAX_LENGTH,
  applyMatriculaInput,
  canSubmitCredentials,
  isMatriculaComplete,
  sanitizeMatriculaInput,
  sanitizePinInput,
} from './credentialsInput.js'

// --- matrícula: só números de 0 a 9, 4 a 6 dígitos (o mínimo é validação interna) ---

test('matrícula válida de 4 a 6 dígitos passa intacta, com os zeros à esquerda', () => {
  for (const value of ['0012', '000123', '1234', '123456', '000000', '0000']) {
    assert.equal(sanitizeMatriculaInput(value), value)
    assert.equal(typeof sanitizeMatriculaInput(value), 'string')
    assert.equal(isMatriculaComplete(sanitizeMatriculaInput(value)), true, value)
  }
})

test('matrícula curta (123) é mantida como digitada, mas não está completa', () => {
  assert.equal(sanitizeMatriculaInput('123'), '123')
  assert.equal(isMatriculaComplete('123'), false)
  for (const value of ['', '0', '12', '012']) assert.equal(isMatriculaComplete(value), false, JSON.stringify(value))
})

test('limpar a matrícula tira só o que não é 0-9; NUNCA corta (o excesso é recusado, não truncado)', () => {
  assert.equal(MATRICULA_MAX_LENGTH, 6)
  assert.equal(sanitizeMatriculaInput('1234567'), '1234567')
  assert.equal(sanitizeMatriculaInput('9'.repeat(10)), '9'.repeat(10))
  // A checagem de "completa" é estrita: mais de 6 dígitos nunca passa.
  assert.equal(isMatriculaComplete('1234567'), false)
  assert.equal(isMatriculaComplete('0000000'), false)
})

// --- entrada: digitação, colagem e preenchimento automático chegam todos como "novo valor bruto do campo" ---

const accept = (previous, raw) => applyMatriculaInput(previous, raw)

test('mais de 6 dígitos é RECUSADO e o valor que já estava no campo é preservado (sem truncar)', () => {
  // Digitar o 7º dígito.
  assert.deepEqual(accept('123456', '1234567'), { value: '123456', overflow: true })
  assert.deepEqual(accept('000000', '0000001'), { value: '000000', overflow: true })
  // Colar 7 dígitos num campo vazio: nada entra (não vira "123456").
  assert.deepEqual(accept('', '1234567'), { value: '', overflow: true })
  // Colar algo longo num campo com valor válido: o valor anterior fica.
  assert.deepEqual(accept('12', '12345678'), { value: '12', overflow: true })
  assert.deepEqual(accept('0042', '9'.repeat(40)), { value: '0042', overflow: true })
  // O limite conta DÍGITOS: separadores e letras não o gastam nem o escondem.
  assert.deepEqual(accept('', '000-123 456'), { value: '', overflow: true })
  assert.deepEqual(accept('', 'Mat 12345678'), { value: '', overflow: true })
})

test('até 6 dígitos é aceito, com os zeros à esquerda', () => {
  assert.deepEqual(accept('', '0012'), { value: '0012', overflow: false })
  assert.deepEqual(accept('', '000123'), { value: '000123', overflow: false })
  assert.deepEqual(accept('', '123456'), { value: '123456', overflow: false })
  assert.deepEqual(accept('12345', '123456'), { value: '123456', overflow: false })
  assert.deepEqual(accept('', '00 12-34'), { value: '001234', overflow: false })
  assert.deepEqual(accept('', 'Mat 0012 34'), { value: '001234', overflow: false })
  assert.equal(typeof accept('', '0012').value, 'string')
})

test('apagar nunca recusa: a matrícula de 6 dígitos volta a aceitar dígito depois de apagar', () => {
  assert.deepEqual(accept('123456', '12345'), { value: '12345', overflow: false })
  assert.deepEqual(accept('1', ''), { value: '', overflow: false })
  assert.deepEqual(accept('12345', '123459'), { value: '123459', overflow: false })
})

test('letras e símbolos são descartados em silêncio (sem aviso de excesso)', () => {
  assert.deepEqual(accept('12', '12a'), { value: '12', overflow: false })
  assert.deepEqual(accept('', 'abc'), { value: '', overflow: false })
  assert.deepEqual(accept('', 'A12B'), { value: '12', overflow: false })
  assert.deepEqual(accept('', '١٢٣٤'), { value: '', overflow: false })
  assert.deepEqual(accept(null, undefined), { value: '', overflow: false })
})

test('o valor anterior preservado passa pelo mesmo saneamento (só dígitos)', () => {
  assert.equal(accept('ab12', '1234567').value, '12')
})

test('matrícula descarta letras e símbolos: só 0-9 ASCII', () => {
  assert.equal(sanitizeMatriculaInput('abc'), '')
  assert.equal(sanitizeMatriculaInput('A12B'), '12')
  assert.equal(sanitizeMatriculaInput('00123AB'), '00123')
  assert.equal(sanitizeMatriculaInput('12-34'), '1234')
  assert.equal(sanitizeMatriculaInput('1e5'), '15')
  assert.equal(sanitizeMatriculaInput('+0012'), '0012')
  assert.equal(sanitizeMatriculaInput('١٢٣٤'), '')
  assert.equal(sanitizeMatriculaInput('１２３４'), '')
  assert.equal(isMatriculaComplete('12ab'), false)
  assert.equal(isMatriculaComplete(' 1234'), false)
  assert.equal(isMatriculaComplete('1.234'), false)
})

test('colagem e preenchimento assistido: espaços, quebras e separadores saem', () => {
  assert.equal(sanitizeMatriculaInput('  001234\n'), '001234')
  assert.equal(sanitizeMatriculaInput('00 12 34'), '001234')
  assert.equal(sanitizeMatriculaInput('Matrícula: 000123'), '000123')
  assert.equal(sanitizeMatriculaInput(null), '')
  assert.equal(sanitizeMatriculaInput(undefined), '')
})

test('apagar: o valor digitado, sem o último dígito, continua sendo texto com os zeros', () => {
  assert.equal(sanitizeMatriculaInput('001234'.slice(0, -1)), '00123')
  assert.equal(sanitizeMatriculaInput('0012'.slice(0, -1)), '001')
  assert.equal(sanitizeMatriculaInput('0'.slice(0, -1)), '')
})

test('a matrícula nunca é convertida em número (os zeros à esquerda são significativos)', () => {
  const sources = ['credentialsInput.js', 'LoginPage.jsx'].map((name) => readFileSync(new URL(name, import.meta.url), 'utf8'))
  for (const source of sources) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    assert.doesNotMatch(code, /\bNumber\s*\(|parseInt|parseFloat|Math\.|\bunary\+|=\s*\+\s*matricula|valueAsNumber|type="number"|type='number'/)
  }
  assert.equal(sanitizeMatriculaInput('0012'), '0012')
  assert.notEqual(sanitizeMatriculaInput('0012'), String(Number('0012')))
})

// --- PIN: a política continua pendente, nada mudou ---

test('PIN mantém só dígitos: digitação, colagem e preenchimento assistido', () => {
  assert.equal(sanitizePinInput('1234'), '1234')
  assert.equal(sanitizePinInput('12 34'), '1234')
  assert.equal(sanitizePinInput('1a2b3c'), '123')
  assert.equal(sanitizePinInput('  12-34\n'), '1234')
  assert.equal(sanitizePinInput('abc'), '')
  assert.equal(sanitizePinInput(null), '')
  assert.equal(sanitizePinInput(undefined), '')
})

test('PIN preserva zeros à esquerda e continua sem limite de comprimento', () => {
  assert.equal(sanitizePinInput('000123'), '000123')
  assert.equal(sanitizePinInput('0'), '0')
  assert.equal(sanitizePinInput('1'), '1')
  assert.equal(sanitizePinInput('1'.repeat(64)), '1'.repeat(64))
  assert.equal(sanitizePinInput('9'.repeat(200)).length, 200)
})

test('PIN descarta dígitos de outros alfabetos (só 0-9 ASCII)', () => {
  assert.equal(sanitizePinInput('١٢٣'), '')
  assert.equal(sanitizePinInput('１２３'), '')
})

test('pode enviar quando matrícula e PIN têm conteúdo; o tamanho da matrícula é checado à parte', () => {
  assert.equal(canSubmitCredentials({ matricula: '0012', pin: '1' }), true)
  assert.equal(canSubmitCredentials({ matricula: '123', pin: '0' }), true)
  assert.equal(canSubmitCredentials({ matricula: '', pin: '1234' }), false)
  assert.equal(canSubmitCredentials({ matricula: '   ', pin: '1234' }), false)
  assert.equal(canSubmitCredentials({ matricula: 'abc', pin: '1234' }), false)
  assert.equal(canSubmitCredentials({ matricula: '0012', pin: '' }), false)
  assert.equal(canSubmitCredentials({ matricula: '0012', pin: 'abc' }), false)
  assert.equal(canSubmitCredentials({}), false)
  assert.equal(canSubmitCredentials(), false)
})
