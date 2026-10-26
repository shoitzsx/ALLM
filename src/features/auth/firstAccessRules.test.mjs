import test from 'node:test'
import assert from 'node:assert/strict'
import { FIRST_ACCESS_PROBLEM, checkFirstAccessInput, firstAccessErrorCopy, firstAccessProblemCopy } from './firstAccessRules.js'
import { REGISTRATION_REASON } from './registrationFlow.js'

const CODE = 'A'.repeat(43)
const ok = { matricula: 'adm001'.toUpperCase(), temporaryPin: '12345678', newPin: '00123456', confirmPin: '00123456', activationCode: CODE }

test('dados válidos: matrícula 3–20, PIN temporário e novo de 8 dígitos iguais à confirmação, código de 43 caracteres', () => {
  assert.deepEqual(checkFirstAccessInput(ok), { ok: true })
  assert.deepEqual(checkFirstAccessInput({ ...ok, matricula: 'ABC', newPin: '00000001', confirmPin: '00000001' }), { ok: true })
  assert.deepEqual(checkFirstAccessInput({ ...ok, matricula: 'A'.repeat(20) }), { ok: true })
})

test('o código é cortado nas pontas (colagem com espaço) mas o formato continua estrito', () => {
  assert.deepEqual(checkFirstAccessInput({ ...ok, activationCode: `  ${CODE}\n` }), { ok: true })
  for (const bad of ['', 'curto', `${CODE}x`, `${'A'.repeat(42)}!`, `${'A'.repeat(21)} ${'A'.repeat(21)}`]) {
    assert.equal(checkFirstAccessInput({ ...ok, activationCode: bad }).problem, FIRST_ACCESS_PROBLEM.INVALID, JSON.stringify(bad))
  }
})

test('matrícula ou PIN fora do tamanho oficial = problema GENÉRICO (não diz qual campo nem a regra)', () => {
  const cases = [
    { matricula: 'AB' },
    { matricula: 'A'.repeat(21) },
    { matricula: 'ab1' },
    { matricula: '' },
    { temporaryPin: '1234567' },
    { temporaryPin: '123456789' },
    { temporaryPin: '1234567a' },
    { temporaryPin: '' },
    { newPin: '1234567', confirmPin: '1234567' },
    { newPin: '123456789', confirmPin: '123456789' },
    { newPin: '', confirmPin: '' },
  ]
  for (const patch of cases) {
    const result = checkFirstAccessInput({ ...ok, ...patch })
    assert.deepEqual(result, { ok: false, problem: FIRST_ACCESS_PROBLEM.INVALID }, JSON.stringify(patch))
  }
})

test('novo PIN diferente da confirmação: problema próprio (é só sobre o que o usuário digitou)', () => {
  assert.deepEqual(checkFirstAccessInput({ ...ok, confirmPin: '00123457' }), { ok: false, problem: FIRST_ACCESS_PROBLEM.MISMATCH })
  assert.deepEqual(checkFirstAccessInput({ ...ok, confirmPin: '' }), { ok: false, problem: FIRST_ACCESS_PROBLEM.MISMATCH })
  assert.deepEqual(checkFirstAccessInput({ ...ok, confirmPin: '0012345' }), { ok: false, problem: FIRST_ACCESS_PROBLEM.MISMATCH })
})

test('novo PIN igual ao temporário é recusado aqui (o servidor também recusa)', () => {
  assert.deepEqual(checkFirstAccessInput({ ...ok, newPin: '12345678', confirmPin: '12345678' }), { ok: false, problem: FIRST_ACCESS_PROBLEM.SAME_AS_TEMPORARY })
})

test('ordem das checagens: formato (genérico) antes de divergência antes de "igual ao temporário"', () => {
  assert.equal(checkFirstAccessInput({ ...ok, temporaryPin: '123', confirmPin: '1' }).problem, FIRST_ACCESS_PROBLEM.INVALID)
  assert.equal(checkFirstAccessInput({ ...ok, newPin: '12345678', confirmPin: '12345679' }).problem, FIRST_ACCESS_PROBLEM.MISMATCH)
})

test('PIN é texto: zeros à esquerda contam e nada vira número', () => {
  assert.deepEqual(checkFirstAccessInput({ ...ok, temporaryPin: '00000001', newPin: '00000002', confirmPin: '00000002' }), { ok: true })
  assert.equal(checkFirstAccessInput({ ...ok, newPin: '00000002', confirmPin: '2' }).problem, FIRST_ACCESS_PROBLEM.MISMATCH)
})

test('dados que não são texto não passam', () => {
  assert.equal(checkFirstAccessInput({ ...ok, newPin: 123456, confirmPin: 123456 }).problem, FIRST_ACCESS_PROBLEM.INVALID)
  assert.equal(checkFirstAccessInput({}).problem, FIRST_ACCESS_PROBLEM.INVALID)
  assert.equal(checkFirstAccessInput().problem, FIRST_ACCESS_PROBLEM.INVALID)
})

test('textos dos problemas locais: o genérico é o mesmo das credenciais inválidas; os outros falam só dos PINs digitados', () => {
  const invalid = firstAccessProblemCopy(FIRST_ACCESS_PROBLEM.INVALID)
  assert.equal(invalid.title, 'Matrícula, PIN ou código inválidos.')
  assert.equal(invalid.tone, 'error')
  assert.match(firstAccessProblemCopy(FIRST_ACCESS_PROBLEM.MISMATCH).title, /iguais/)
  assert.match(firstAccessProblemCopy(FIRST_ACCESS_PROBLEM.SAME_AS_TEMPORARY).title, /diferente do temporário/)
  for (const key of Object.values(FIRST_ACCESS_PROBLEM)) {
    const copy = firstAccessProblemCopy(key)
    assert.doesNotMatch(`${copy.title} ${copy.description}`, /existe|cadastrad[oa]|usu[aá]rio|bloquead|expirou|código (usado|expirado)/i, key)
  }
  assert.deepEqual(firstAccessProblemCopy('desconhecido'), invalid)
})

test('erro do cadastro de primeiro acesso: sem PIN trocado é o texto de sempre', () => {
  for (const reason of Object.values(REGISTRATION_REASON)) {
    const plain = firstAccessErrorCopy({ reason })
    assert.doesNotMatch(plain.description, /PIN já foi trocado/, reason)
  }
})

test('erro depois da troca do PIN: avisa que o PIN já valeu e diz o que fazer (retomar ou "Novo dispositivo")', () => {
  const resumable = firstAccessErrorCopy({ reason: REGISTRATION_REASON.NETWORK, pinChanged: true, canResume: true })
  assert.match(resumable.description, /PIN já foi trocado/)
  assert.match(resumable.description, /não é preciso trocá-lo de novo/)
  const terminal = firstAccessErrorCopy({ reason: REGISTRATION_REASON.INVALID_CREDENTIALS, pinChanged: true })
  assert.match(terminal.description, /PIN já foi trocado/)
  assert.match(terminal.description, /Novo dispositivo/)
  assert.match(terminal.description, /NOVO PIN|novo PIN/)
  assert.equal(terminal.tone, 'error')
})

test('nenhum texto repete segredos nem promete que o código "continua válido"', () => {
  for (const reason of Object.values(REGISTRATION_REASON)) {
    for (const canResume of [true, false]) {
      const copy = firstAccessErrorCopy({ reason, pinChanged: true, canResume })
      assert.doesNotMatch(`${copy.title} ${copy.description}`, /\d{6,}|continua válido|ainda é válido/, reason)
    }
  }
})
