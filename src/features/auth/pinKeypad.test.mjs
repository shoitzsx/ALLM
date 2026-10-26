import test from 'node:test'
import assert from 'node:assert/strict'
import { KEYPAD_FIELD, KEYPAD_KEY, KEYPAD_LAYOUT, applyKeypadKey, isDigitKey, isKeypadOverflow, keypadMaxLength, keypadServes } from './pinKeypad.js'

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

// --- o teclado numérico do ALM atende SÓ o PIN (8 dígitos); a matrícula tem letras e usa o teclado do dispositivo ---

test('o teclado atende o PIN e mais nenhum campo', () => {
  assert.equal(keypadServes(KEYPAD_FIELD.PIN), true)
  assert.equal(keypadServes(KEYPAD_FIELD.MATRICULA), false)
  assert.equal(keypadServes(null), false)
  assert.equal(keypadServes('desconhecido'), false)
})

test('o PIN tem exatamente 8 dígitos; campo que o teclado não atende não aceita tecla alguma', () => {
  assert.equal(keypadMaxLength(KEYPAD_FIELD.PIN), 8)
  assert.equal(keypadMaxLength(KEYPAD_FIELD.MATRICULA), 0)
  assert.equal(keypadMaxLength(null), 0)
  assert.equal(keypadMaxLength('desconhecido'), 0)
  assert.equal(applyKeypadKey('', '7', { maxLength: keypadMaxLength(KEYPAD_FIELD.MATRICULA) }), '')
})

test('PIN pelo teclado: o 9º dígito é ignorado e os zeros à esquerda ficam', () => {
  const rules = { maxLength: keypadMaxLength(KEYPAD_FIELD.PIN) }
  const type = (...keys) => keys.reduce((acc, key) => applyKeypadKey(acc, key, rules), '')
  assert.equal(type('0', '0', '1', '2', '3', '4', '5', '6'), '00123456')
  assert.equal(type('1', '2', '3', '4', '5', '6', '7', '8', '9', '9'), '12345678')
  assert.equal(type('1', '2', '3', '4', '5', '6', '7', '8', '9', KEYPAD_KEY.BACKSPACE, '0'), '12345670', 'apagar libera espaço')
  assert.equal(type(KEYPAD_KEY.BACKSPACE), '')
  assert.equal(type('1', KEYPAD_KEY.CONTINUE, '2'), '12', 'continuar não mexe no valor')
})

test('limite do PIN também vale quando o valor de entrada já passa do máximo (colagem anterior)', () => {
  assert.equal(applyKeypadKey('123456789', '8', { maxLength: 8 }), '123456789', 'não acrescenta; o saneamento do campo é quem recusa')
  assert.equal(applyKeypadKey('1234567', '8', { maxLength: 8 }), '12345678')
})

test('excesso no teclado: dígito com o PIN já em 8 é recusado e sinalizado; apagar e continuar nunca', () => {
  const pin = { maxLength: keypadMaxLength(KEYPAD_FIELD.PIN) }
  assert.equal(isKeypadOverflow('12345678', '9', pin), true)
  assert.equal(isKeypadOverflow('00000000', '0', pin), true)
  assert.equal(isKeypadOverflow('1234567', '8', pin), false)
  assert.equal(isKeypadOverflow('12345678', KEYPAD_KEY.BACKSPACE, pin), false, 'apagar nunca é excesso')
  assert.equal(isKeypadOverflow('12345678', KEYPAD_KEY.CONTINUE, pin), false)
  assert.equal(isKeypadOverflow('1'.repeat(80), '1'), false, 'sem limite informado, nada é excesso')
  // E o valor preservado é exatamente o anterior, zeros incluídos.
  assert.equal(applyKeypadKey('00000000', '1', pin), '00000000')
})
