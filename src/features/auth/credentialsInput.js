/**
 * Tratamento do que o usuário digita em matrícula e PIN. Só as regras já
 * decididas; o resto (tamanho definitivo do PIN) depende de aprovação e é
 * decidido no servidor.
 */

/** Matrícula: de 4 a 6 dígitos. O mínimo é só validação interna — a tela não o mostra. */
export const MATRICULA_MIN_LENGTH = 4
export const MATRICULA_MAX_LENGTH = 6

/**
 * Limpa um texto de matrícula: só dígitos de 0 a 9 (ASCII) ficam. NÃO corta o
 * tamanho — excesso é recusado por `applyMatriculaInput`, nunca truncado.
 *
 * É TEXTO: os zeros à esquerda são significativos (`0012` ≠ `12`). Nunca passa
 * por número, nem aqui nem em quem chama.
 */
export function sanitizeMatriculaInput(value) {
  return String(value ?? '').replace(/\D+/g, '')
}

/**
 * Entrada do campo (digitação, colagem ou preenchimento automático — todas
 * chegam como "novo valor bruto"). Se o novo valor tem até 6 dígitos, ele
 * vale (já limpo). Se tem MAIS de 6, a entrada inteira é recusada: o valor que
 * já estava no campo fica como estava (nada de truncar para os 6 primeiros) e
 * `overflow` avisa a tela para mostrar o aviso de excesso. Letras e símbolos
 * saem em silêncio, sem aviso. O limite conta DÍGITOS, então separadores não o
 * gastam nem o disfarçam.
 */
export function applyMatriculaInput(previous, raw) {
  const digits = sanitizeMatriculaInput(raw)
  if (digits.length > MATRICULA_MAX_LENGTH) {
    return { value: sanitizeMatriculaInput(previous), overflow: true }
  }
  return { value: digits, overflow: false }
}

/**
 * Tamanho aceito (4 a 6 dígitos). Estrita: recebe o valor já saneado, e um
 * valor com letra, espaço ou mais de 6 dígitos não passa. Se falhar, a tela
 * mostra a mesma mensagem genérica de credenciais inválidas — sem revelar a regra.
 */
export function isMatriculaComplete(value) {
  return new RegExp(`^[0-9]{${MATRICULA_MIN_LENGTH},${MATRICULA_MAX_LENGTH}}$`).test(String(value ?? ''))
}

/**
 * PIN é numérico: mantém só os dígitos. Serve para digitação, colagem
 * (`12 34` vira `1234`) e preenchimento assistido. NÃO impõe comprimento
 * mínimo nem máximo: a política do PIN segue pendente.
 */
export function sanitizePinInput(value) {
  return String(value ?? '').replace(/\D+/g, '')
}

/** Os dois campos têm conteúdo. Não valida o tamanho da matrícula (ver isMatriculaComplete). */
export function canSubmitCredentials({ matricula, pin } = {}) {
  return sanitizeMatriculaInput(matricula).length > 0 && sanitizePinInput(pin).length > 0
}
