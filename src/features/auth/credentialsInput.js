/**
 * Tratamento do que o usuário digita em matrícula e PIN. Regras OFICIAIS
 * (Goran e Kobner): matrícula `[0-9A-Z]{3,20}` e PIN do MVP com exatamente
 * 8 dígitos. O servidor continua sendo quem decide; aqui só se evita enviar
 * o que nunca será aceito e se mantém a digitação limpa.
 */

/** Matrícula: de 3 a 20 caracteres, letras (maiúsculas) e números. */
export const MATRICULA_MIN_LENGTH = 3
export const MATRICULA_MAX_LENGTH = 20

/** PIN do MVP: exatamente 8 dígitos (o servidor lê `ALM_PIN_LENGTH`, 8 por padrão). */
export const PIN_LENGTH = 8

/**
 * Limpa um texto de matrícula: só letras A-Z e números 0-9 (ASCII) ficam, e as
 * letras viram MAIÚSCULAS na digitação. NÃO corta o tamanho — o excesso é
 * recusado por `applyMatriculaInput`, nunca truncado.
 *
 * É TEXTO: os zeros à esquerda são significativos (`0012` ≠ `12`) e a matrícula
 * nunca passa por número. A limpeza vem ANTES de maiúsculas, para letras de
 * outros alfabetos (como "ß") não virarem letras ASCII.
 */
export function sanitizeMatriculaInput(value) {
  return String(value ?? '').replace(/[^0-9A-Za-z]+/g, '').toUpperCase()
}

/**
 * Entrada do campo (digitação, colagem ou preenchimento automático — todas
 * chegam como "novo valor bruto"). Se o novo valor tem até 20 caracteres, ele
 * vale (já limpo e em maiúsculas). Se tem MAIS de 20, a entrada inteira é
 * recusada: o valor que já estava no campo fica como estava (nada de truncar
 * nos 20 primeiros) e `overflow` avisa a tela para mostrar o aviso de excesso.
 * Símbolos e espaços saem em silêncio, sem aviso. O limite conta os caracteres
 * VÁLIDOS, então separadores não o gastam nem o disfarçam.
 */
export function applyMatriculaInput(previous, raw) {
  const clean = sanitizeMatriculaInput(raw)
  if (clean.length > MATRICULA_MAX_LENGTH) {
    return { value: sanitizeMatriculaInput(previous), overflow: true }
  }
  return { value: clean, overflow: false }
}

/**
 * Tamanho aceito (3 a 20, só 0-9 e A-Z maiúsculas). Estrita: recebe o valor já
 * saneado; minúscula, espaço, símbolo ou mais de 20 caracteres não passam. Se
 * falhar, a tela mostra a mesma mensagem genérica de credenciais inválidas — sem
 * revelar a regra nem se a matrícula existe.
 */
export function isMatriculaComplete(value) {
  return new RegExp(`^[0-9A-Z]{${MATRICULA_MIN_LENGTH},${MATRICULA_MAX_LENGTH}}$`).test(String(value ?? ''))
}

/**
 * PIN é numérico: mantém só os dígitos 0-9 (ASCII), com os zeros à esquerda.
 * Serve para digitação, colagem (`12 34` vira `1234`) e preenchimento
 * assistido. Não corta o tamanho: o excesso é recusado por `applyPinInput`.
 */
export function sanitizePinInput(value) {
  return String(value ?? '').replace(/[^0-9]+/g, '')
}

/**
 * Entrada do campo PIN: até 8 dígitos. Mais que isso é RECUSADO por inteiro (o
 * valor anterior fica), como na matrícula — um PIN colado com dígitos a mais
 * nunca é cortado em silêncio para outro PIN.
 */
export function applyPinInput(previous, raw) {
  const clean = sanitizePinInput(raw)
  return clean.length > PIN_LENGTH ? sanitizePinInput(previous) : clean
}

/** PIN com exatamente 8 dígitos (valor já saneado). */
export function isPinComplete(value) {
  return new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(String(value ?? ''))
}

/** Os dois campos têm conteúdo. O tamanho é checado à parte (isMatriculaComplete, isPinComplete). */
export function canSubmitCredentials({ matricula, pin } = {}) {
  return sanitizeMatriculaInput(matricula).length > 0 && sanitizePinInput(pin).length > 0
}
