import { MATRICULA_MAX_LENGTH, sanitizePinInput } from './credentialsInput.js'

/**
 * Modelo do teclado numérico do ALM: o que cada tecla faz com o valor do
 * campo ativo (matrícula ou PIN). Puro, sem DOM. O valor que passa por aqui
 * nunca é registrado, armazenado nem enviado — quem chama mantém o valor só
 * no estado do componente.
 */
export const KEYPAD_KEY = Object.freeze({
  BACKSPACE: 'backspace',
  CONTINUE: 'continue',
})

/** Ordem de leitura, em linhas de três: 1-9, depois apagar, 0 e continuar. */
export const KEYPAD_LAYOUT = Object.freeze([
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  KEYPAD_KEY.BACKSPACE, '0', KEYPAD_KEY.CONTINUE,
])

export function isDigitKey(key) {
  return typeof key === 'string' && key.length === 1 && key >= '0' && key <= '9'
}

/** Campos que o MESMO teclado do ALM atende, um de cada vez (o que tem o foco). */
export const KEYPAD_FIELD = Object.freeze({
  MATRICULA: 'matricula',
  PIN: 'pin',
})

/** Matrícula tem no máximo 6 dígitos; o PIN segue sem limite (política pendente). */
export function keypadMaxLength(field) {
  return field === KEYPAD_FIELD.MATRICULA ? MATRICULA_MAX_LENGTH : Infinity
}

/**
 * Tecla que seria recusada por excesso: dígito com o campo já no limite.
 * Apagar, continuar e campo sem limite (PIN) nunca são excesso.
 */
export function isKeypadOverflow(value, key, { maxLength = Infinity } = {}) {
  return isDigitKey(key) && sanitizePinInput(value).length >= maxLength
}

/**
 * Aplica uma tecla ao valor do campo ativo. Dígito acrescenta no fim (e é
 * ignorado se já houver `maxLength` dígitos); apagar remove o último;
 * "continuar" e qualquer tecla desconhecida não mexem no valor (a ação de
 * continuar é da tela). Sem `maxLength`, não há limite de comprimento.
 */
export function applyKeypadKey(value, key, { maxLength = Infinity } = {}) {
  const current = sanitizePinInput(value)
  if (isDigitKey(key)) return current.length >= maxLength ? current : current + key
  if (key === KEYPAD_KEY.BACKSPACE) return current.slice(0, -1)
  return current
}
