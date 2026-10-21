import test from 'node:test'
import assert from 'node:assert/strict'
import { KEYPAD_FIELD, KEYPAD_KEY, KEYPAD_LAYOUT, applyKeypadKey, isDigitKey, isKeypadOverflow, keypadMaxLength } from './pinKeypad.js'

const press = (pin, ...keys) => keys.reduce((acc, key) => applyKeypadKey(acc, key), pin)

test('o teclado tem 0 a 9, apagar e continuar, cada um uma vez', () => {
  assert.equal(KEYPAD_LAYOUT.length, 12)
  assert.equal(new Set(KEYPAD_LAYOUT).size, 12)
  for (const digit of '0123456789') assert.ok(KEYPAD_LAYOUT.includes(digit), digit)
  assert.ok(KEYPAD_LAYOUT.includes(KEYPAD_KEY.BACKSPACE))
  assert.ok(KEYPAD_LAYOUT.includes(KEYPAD_KEY.CONTINUE))
})

test('ordem de leitura: 1-9 em três linhas, depois apagar, 0 e continuar', () => {
  assert.deepEqual([...KEYPAD_LAYOUT], ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'backspace', '0', 'continue'])
})

test('digitação acrescenta no fim e mantém zeros à esquerda', () => {
  assert.equal(press('', '0', '0', '1', '2', '3'), '00123')
  assert.equal(press('12', '3', '4'), '1234')
})

test('apagar remove o último dígito e é seguro em PIN vazio', () => {
  assert.equal(press('1234', KEYPAD_KEY.BACKSPACE), '123')
  assert.equal(press('1', KEYPAD_KEY.BACKSPACE), '')
  assert.equal(press('', KEYPAD_KEY.BACKSPACE), '')
  assert.equal(press('1234', KEYPAD_KEY.BACKSPACE, KEYPAD_KEY.BACKSPACE, '9'), '129')
})

test('continuar e teclas desconhecidas não mexem no PIN', () => {
  assert.equal(press('123', KEYPAD_KEY.CONTINUE), '123')
  for (const key of ['a', '', '12', undefined, null, 5, '-', ' ']) assert.equal(applyKeypadKey('123', key), '123')
})

test('o PIN de entrada é sempre saneado (só dígitos) antes de aplicar a tecla', () => {
  assert.equal(applyKeypadKey('12 3a', '4'), '1234')
  assert.equal(applyKeypadKey(null, '7'), '7')
})

test('não há limite de comprimento no teclado', () => {
  let pin = ''
  for (let i = 0; i < 100; i += 1) pin = applyKeypadKey(pin, '7')
  assert.equal(pin.length, 100)
})

test('isDigitKey só aceita um caractere de 0 a 9', () => {
  for (const d of '0123456789') assert.equal(isDigitKey(d), true)
  for (const x of ['a', '10', '', ' ', '١', null, undefined, 3]) assert.equal(isDigitKey(x), false)
})

// --- um só teclado para dois campos: matrícula (até 6 dígitos) e PIN (sem limite definido) ---

test('cada campo tem a sua regra: matrícula limita a 6 dígitos, PIN continua sem limite', () => {
  assert.equal(keypadMaxLength(KEYPAD_FIELD.MATRICULA), 6)
  assert.equal(keypadMaxLength(KEYPAD_FIELD.PIN), Infinity)
  assert.equal(keypadMaxLength(null), Infinity)
  assert.equal(keypadMaxLength('desconhecido'), Infinity)
})

test('matrícula pelo teclado: o 7º dígito é ignorado e os zeros à esquerda ficam', () => {
  const rules = { maxLength: keypadMaxLength(KEYPAD_FIELD.MATRICULA) }
  const type = (...keys) => keys.reduce((acc, key) => applyKeypadKey(acc, key, rules), '')
  assert.equal(type('0', '0', '1', '2'), '0012')
  assert.equal(type('0', '0', '0', '1', '2', '3'), '000123')
  assert.equal(type('1', '2', '3', '4', '5', '6', '7', '8'), '123456')
  assert.equal(type('1', '2', '3', '4', '5', '6', '7', KEYPAD_KEY.BACKSPACE, '9'), '123459', 'apagar libera espaço')
  assert.equal(type(KEYPAD_KEY.BACKSPACE), '')
  assert.equal(type('1', KEYPAD_KEY.CONTINUE, '2'), '12', 'continuar não mexe no valor')
})

test('PIN pelo teclado: sem limite, como antes', () => {
  const rules = { maxLength: keypadMaxLength(KEYPAD_FIELD.PIN) }
  let pin = ''
  for (let i = 0; i < 40; i += 1) pin = applyKeypadKey(pin, '7', rules)
  assert.equal(pin.length, 40)
})

test('limite de matrícula também vale quando o valor de entrada já passa do máximo (colagem anterior)', () => {
  assert.equal(applyKeypadKey('1234567', '8', { maxLength: 6 }), '1234567', 'não acrescenta; o saneamento do campo é quem corta')
  assert.equal(applyKeypadKey('12345', '8', { maxLength: 6 }), '123458')
})

test('alternar entre matrícula e PIN: cada tecla vai SÓ para o campo ativo', () => {
  const values = { matricula: '', pin: '' }
  const press = (field, key) => {
    const next = { ...values }
    next[field] = applyKeypadKey(values[field], key, { maxLength: keypadMaxLength(field) })
    Object.assign(values, next)
  }
  for (const key of ['0', '0', '4', '2']) press(KEYPAD_FIELD.MATRICULA, key)
  assert.deepEqual(values, { matricula: '0042', pin: '' })
  for (const key of ['9', '8', '7']) press(KEYPAD_FIELD.PIN, key)
  assert.deepEqual(values, { matricula: '0042', pin: '987' })
  press(KEYPAD_FIELD.MATRICULA, KEYPAD_KEY.BACKSPACE)
  assert.deepEqual(values, { matricula: '004', pin: '987' })
  press(KEYPAD_FIELD.PIN, '1')
  press(KEYPAD_FIELD.MATRICULA, '5')
  assert.deepEqual(values, { matricula: '0045', pin: '9871' })
})

test('excesso no teclado: dígito com a matrícula já em 6 é recusado e sinalizado; PIN nunca', () => {
  const matricula = { maxLength: keypadMaxLength(KEYPAD_FIELD.MATRICULA) }
  const pin = { maxLength: keypadMaxLength(KEYPAD_FIELD.PIN) }
  assert.equal(isKeypadOverflow('123456', '7', matricula), true)
  assert.equal(isKeypadOverflow('000000', '0', matricula), true)
  assert.equal(isKeypadOverflow('12345', '6', matricula), false)
  assert.equal(isKeypadOverflow('123456', KEYPAD_KEY.BACKSPACE, matricula), false, 'apagar nunca é excesso')
  assert.equal(isKeypadOverflow('123456', KEYPAD_KEY.CONTINUE, matricula), false)
  assert.equal(isKeypadOverflow('1'.repeat(80), '1', pin), false, 'a política do PIN não mudou')
  // E o valor preservado é exatamente o anterior, zeros incluídos.
  assert.equal(applyKeypadKey('000000', '1', matricula), '000000')
})
