import { isMatriculaComplete, isPinComplete } from './credentialsInput.js'
import { registrationErrorCopy } from './deviceCopy.js'

/**
 * Regras de TELA do primeiro acesso (troca do PIN temporário). Puro: não fala com o
 * servidor nem decide acesso. Só evita enviar o que o backend com certeza recusaria
 * (POST /auth/initial-pin: matrícula `[0-9A-Z]{3,20}`, os dois PINs com exatamente 8
 * dígitos, novo PIN diferente do temporário, código de 32 bytes em Base64URL) e confere
 * a confirmação do novo PIN, que só existe na tela.
 *
 * O servidor continua sendo quem valida de verdade. Para não revelar nada, qualquer
 * problema de formato dos dados de acesso (matrícula, PIN temporário, código, tamanho do
 * novo PIN) usa a MESMA mensagem genérica das credenciais inválidas. "PINs diferentes" e
 * "igual ao temporário" falam só do que o próprio usuário acabou de digitar.
 */
// O código de ativação do servidor é um token de 32 bytes em Base64URL (43 caracteres).
export const ACTIVATION_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const FIRST_ACCESS_PROBLEM = Object.freeze({
  INVALID: 'invalid',
  MISMATCH: 'mismatch',
  SAME_AS_TEMPORARY: 'same_as_temporary',
})

const text = (value) => typeof value === 'string'

/** @returns {{ ok: true } | { ok: false, problem: string }} */
export function checkFirstAccessInput({ matricula, temporaryPin, newPin, confirmPin, activationCode } = {}) {
  const shapeOk = text(matricula) && text(temporaryPin) && text(newPin) && text(activationCode)
    && isMatriculaComplete(matricula)
    && isPinComplete(temporaryPin)
    && isPinComplete(newPin)
    && ACTIVATION_CODE_PATTERN.test(activationCode.trim())
  if (!shapeOk) return { ok: false, problem: FIRST_ACCESS_PROBLEM.INVALID }
  if (!text(confirmPin) || confirmPin !== newPin) return { ok: false, problem: FIRST_ACCESS_PROBLEM.MISMATCH }
  if (newPin === temporaryPin) return { ok: false, problem: FIRST_ACCESS_PROBLEM.SAME_AS_TEMPORARY }
  return { ok: true }
}

const PROBLEM_COPY = Object.freeze({
  [FIRST_ACCESS_PROBLEM.INVALID]: Object.freeze({
    tone: 'error',
    title: 'Matrícula, PIN ou código inválidos.',
    description: 'Confira os dados e tente novamente. Se continuar, procure um responsável pelo ALM.',
  }),
  [FIRST_ACCESS_PROBLEM.MISMATCH]: Object.freeze({
    tone: 'warning',
    title: 'Os dois campos do novo PIN precisam ser iguais.',
    description: 'Digite o novo PIN de 8 dígitos de novo, igual nos dois campos.',
  }),
  [FIRST_ACCESS_PROBLEM.SAME_AS_TEMPORARY]: Object.freeze({
    tone: 'warning',
    title: 'O novo PIN precisa ser diferente do temporário.',
    description: 'Escolha outro PIN de 8 dígitos para o seu acesso.',
  }),
})

export function firstAccessProblemCopy(problem) {
  return PROBLEM_COPY[problem] || PROBLEM_COPY[FIRST_ACCESS_PROBLEM.INVALID]
}

/**
 * Texto do erro do cadastro no primeiro acesso. Depois de o PIN ter sido trocado (o servidor
 * confirmou), avisa isso — o usuário não deve tentar a troca de novo — e diz o caminho:
 * retomar nesta tela ou, se a retomada já não é possível, entrar por "Novo dispositivo" com
 * o NOVO PIN e o mesmo código de ativação. Sem prometer que o código ainda vale: quem decide
 * é o servidor.
 */
export function firstAccessErrorCopy({ reason, unsupported, pinChanged = false, canResume = false } = {}) {
  const base = registrationErrorCopy(reason, unsupported)
  if (!pinChanged) return base
  const next = canResume
    ? 'Seu PIN já foi trocado; não é preciso trocá-lo de novo. Continue o cadastro abaixo.'
    : 'Seu PIN já foi trocado. Para continuar, escolha “Novo dispositivo” e entre com o NOVO PIN e o mesmo código de ativação, se ele ainda valer.'
  return { tone: base.tone, title: base.title, description: `${base.description} ${next}` }
}
