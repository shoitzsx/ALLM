import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadAuthComponents, withWindow } from './testing/renderForTest.mjs'

// Tela de ativação com o primeiro acesso (troca do PIN temporário): marcação e regras de segredo.
const components = await loadAuthComponents()
const { React, renderToStaticMarkup, ActivatePasskeyPage } = components
const markup = withWindow({}, () => renderToStaticMarkup(React.createElement(ActivatePasskeyPage)))
const tag = (pattern) => {
  const found = markup.match(pattern)
  assert.ok(found, `não encontrado: ${pattern}`)
  return found[0]
}
const source = readFileSync(new URL('./ActivatePasskeyPage.jsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
const code = strip(source)

test('a tela abre no PRIMEIRO ACESSO, com a escolha "Novo dispositivo" ao lado', () => {
  assert.match(markup, /<legend>Qual é a sua situação\?<\/legend>/)
  const first = tag(/<input[^>]*value="first"[^>]*>/)
  const device = tag(/<input[^>]*value="device"[^>]*>/)
  assert.match(first, /type="radio"/)
  assert.match(first, /checked/)
  assert.doesNotMatch(device, /checked/)
  assert.match(markup, /Primeiro acesso<\/strong> — recebi um PIN temporário/)
  assert.match(markup, /Novo dispositivo<\/strong> — já tenho o meu PIN/)
})

test('primeiro acesso: matrícula, PIN temporário, novo PIN, confirmação e código, nessa ordem', () => {
  const labels = [...markup.matchAll(/<label for="(activate-[a-z-]+)">([^<]+)<\/label>/g)].map((m) => [m[1], m[2]])
  assert.deepEqual(labels, [
    ['activate-matricula', 'Matrícula'],
    ['activate-pin', 'PIN temporário'],
    ['activate-new-pin', 'Novo PIN'],
    ['activate-confirm-pin', 'Confirmar novo PIN'],
    ['activate-code', 'Código de ativação'],
  ])
  assert.match(markup, />Trocar o PIN e continuar</)
})

test('PINs e código são campos de senha, vazios no HTML e sem preenchimento automático de senha salva', () => {
  for (const id of ['activate-pin', 'activate-new-pin', 'activate-confirm-pin', 'activate-code']) {
    const input = tag(new RegExp(`<input[^>]*id="${id}"[^>]*>`))
    assert.match(input, /type="password"/, id)
    assert.match(input, /value=""/, id)
    assert.doesNotMatch(input, /autoComplete="current-password"|autocomplete="current-password"/i, id)
    assert.doesNotMatch(input, /maxlength|pattern=|readonly/i, id)
  }
  for (const id of ['activate-pin', 'activate-new-pin', 'activate-confirm-pin']) {
    assert.match(tag(new RegExp(`<input[^>]*id="${id}"[^>]*>`)), /inputMode="numeric"|inputmode="numeric"/i, id)
  }
  assert.match(tag(/<input[^>]*id="activate-new-pin"[^>]*>/), /autoComplete="new-password"|autocomplete="new-password"/i)
  assert.match(tag(/<input[^>]*id="activate-confirm-pin"[^>]*>/), /autoComplete="new-password"|autocomplete="new-password"/i)
})

test('matrícula do primeiro acesso: texto, maiúsculas, mesma orientação do login', () => {
  const input = tag(/<input[^>]*id="activate-matricula"[^>]*>/)
  assert.match(input, /inputMode="text"|inputmode="text"/i)
  assert.match(input, /autoCapitalize="characters"|autocapitalize="characters"/i)
  assert.match(markup, />Até 20 letras ou números</)
  assert.match(markup, />8 dígitos, diferente do temporário</)
})

test('a tela nunca afirma sucesso antes do servidor: "Passkey cadastrada" só existe no ramo "concluído"', () => {
  assert.equal((code.match(/Passkey cadastrada/g) || []).length, 1)
  assert.doesNotMatch(markup, /Passkey cadastrada|PIN foi trocado|Seu novo PIN/)
  const done = code.match(/\{done \? \([\s\S]*?\) : ready \?/)
  assert.ok(done, 'ramo done não encontrado')
  assert.match(done[0], /Passkey cadastrada/)
  assert.match(code, /const done = state\.status === REGISTRATION_STATUS\.DONE/)
})

test('o primeiro acesso envia exatamente os campos do contrato e só ao fluxo (nunca a URL, storage ou console)', () => {
  assert.match(code, /void flow\.beginFirstAccess\(\{ matricula, temporaryPin, newPin: definitivePin, activationCode: trimmedCode \}\)/)
  assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie|console\.|location\.|history\.|navigate\(|URLSearchParams|fetch\(/)
  assert.doesNotMatch(code, /\$\{[^}]*(pin|Pin|code|Code)[^}]*\}/, 'segredos não entram em texto montado')
  assert.doesNotMatch(code, /from '\.\/authApi\.js'|authApi\./, 'a página não chama a API: só o fluxo')
})

test('retomar o cadastro e cancelar: o botão existe só quando o servidor já trocou o PIN', () => {
  assert.match(code, /const resumable = state\.status === REGISTRATION_STATUS\.ERROR && state\.canResume === true && !interrupted/)
  assert.match(code, /void flow\.resume\(\)/)
  assert.match(code, /Continuar o cadastro/)
  assert.doesNotMatch(markup, /Continuar o cadastro/)
})

test('trocar entre "Primeiro acesso" e "Novo dispositivo" cancela o fluxo e limpa todos os segredos', () => {
  const change = code.match(/function changeMode[\s\S]*?\n  \}\n/)[0]
  assert.match(change, /flow\?\.cancel\(\)/)
  assert.match(change, /wipeSecrets\(\)/)
})

test('depois da troca do PIN sem retomada possível, a tela leva ao "Novo dispositivo"', () => {
  assert.match(code, /state\.pinChanged === true && state\.canResume !== true && !interrupted\) setMode\(MODE\.DEVICE\)/)
})

test('a recusa de qualquer dado de acesso usa a mensagem genérica; só PIN diferente/igual ao temporário têm texto próprio', () => {
  assert.match(code, /if \(checked\.problem === FIRST_ACCESS_PROBLEM\.INVALID\) wipeSecrets\(\)/)
  assert.match(code, /else \{ setNewPin\(''\); setConfirmPin\(''\) \}/)
})
