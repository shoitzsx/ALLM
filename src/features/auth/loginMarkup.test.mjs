import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTH_STATUS, UNSUPPORTED_REASON, createInitialState } from './authStates.js'
import { TOUCH_KEYPAD_QUERY as Q } from './inputModality.js'
import { loadAuthComponents, withWindow } from './testing/renderForTest.mjs'

const components = await loadAuthComponents()
const { React, renderToStaticMarkup, LoginPage, PinKeypad, PasskeyStep } = components
const html = (element) => renderToStaticMarkup(element)
const loginHtml = (windowOptions) => withWindow(windowOptions, () => html(React.createElement(LoginPage)))

/** Atributos de uma tag (a primeira que casa com o padrão). */
function tag(markup, pattern) {
  const match = markup.match(pattern)
  assert.ok(match, `tag não encontrada: ${pattern}`)
  return match[0]
}

const touchOnly = (query) => ({ matches: query === Q.primaryPointerCoarse || query === Q.primaryHoverNone })
const desktop = (query) => ({ matches: query === Q.anyPointerFine })

test('formulário não pode enviar matrícula/PIN na URL: método POST, sem action', () => {
  const form = tag(loginHtml(), /<form\b[^>]*>/)
  assert.match(form, /method="post"/i)
  assert.doesNotMatch(form, /\baction=/i)
  assert.doesNotMatch(form, /method="get"/i)
})

test('matrícula: texto (zeros à esquerda), rótulo, teclado de texto com maiúsculas, sem regra de mínimo na tela', () => {
  const markup = loginHtml()
  assert.match(markup, /<label for="login-matricula">Matrícula<\/label>/)
  const input = tag(markup, /<input[^>]*id="login-matricula"[^>]*>/)
  assert.match(input, /type="text"/, 'type=number perderia os zeros à esquerda')
  assert.match(input, /inputMode="text"|inputmode="text"/i, 'letras e números: teclado de texto, não numérico')
  assert.match(input, /autoComplete="username"|autocomplete="username"/i)
  assert.match(input, /autoCapitalize="characters"|autocapitalize="characters"/i, 'o teclado do aparelho já sugere maiúsculas')
  assert.doesNotMatch(input, /minlength|maxlength|pattern=/i)
  assert.doesNotMatch(input, /min=|max=/i)
  assert.match(input, /required/)
  assert.match(input, /spellcheck="false"/i)
})

test('matrícula: a única orientação visível é "Até 20 letras ou números" e o mínimo não aparece em lugar nenhum', () => {
  const markup = loginHtml()
  assert.match(markup, />Até 20 letras ou números</)
  const input = tag(markup, /<input[^>]*id="login-matricula"[^>]*>/)
  const hintId = markup.match(/<[a-z]+[^>]*id="(login-matricula-hint)"[^>]*>/)?.[1]
  assert.equal(hintId, 'login-matricula-hint')
  assert.match(input, /aria-describedby="[^"]*login-matricula-hint/)
  assert.doesNotMatch(markup, /m[ií]nim|pelo menos|ao menos|3 (d[ií]gitos|n[uú]meros|caracteres)|tr[eê]s|entre 3|3 a 20|Até 6|4 a 6/i)
})

test('estado inicial: sem aviso de excesso; só a orientação "Até 20 letras ou números"', () => {
  const markup = loginHtml()
  assert.doesNotMatch(markup, /ultrapassar|login-matricula-limit/)
  assert.match(markup, /<span id="login-matricula-hint"/)
})

test('a mesma regra vale em qualquer dispositivo: matrícula com teclado de texto, PIN com teclado numérico', () => {
  for (const options of [undefined, { matchMedia: desktop }]) {
    const markup = loginHtml(options)
    assert.match(tag(markup, /<input[^>]*id="login-matricula"[^>]*>/), /inputMode="text"|inputmode="text"/i)
    assert.match(tag(markup, /<input[^>]*id="login-pin"[^>]*>/), /inputMode="numeric"|inputmode="numeric"/i)
  }
})

test('celular/tablet só de toque: o PIN usa o teclado do ALM; a matrícula (com letras) continua no teclado do aparelho', () => {
  const markup = loginHtml({ matchMedia: touchOnly })
  const matricula = tag(markup, /<input[^>]*id="login-matricula"[^>]*>/)
  assert.match(matricula, /inputMode="text"|inputmode="text"/i, 'o teclado numérico do ALM não digita letras')
  assert.doesNotMatch(matricula, /inputMode="none"|inputmode="none"/i)
  const pin = tag(markup, /<input[^>]*id="login-pin"[^>]*>/)
  assert.match(pin, /inputMode="none"|inputmode="none"/i)
  for (const [id, input] of [['login-matricula', matricula], ['login-pin', pin]]) {
    assert.doesNotMatch(input, /readonly|disabled/i, `${id}: colagem e preenchimento assistido precisam continuar valendo`)
    assert.doesNotMatch(input, /maxlength|pattern=/i, id)
  }
  // A alternância "Usar o teclado do dispositivo" é única e vale só para o PIN.
  assert.equal((markup.match(/auth-keyboard-toggle/g) || []).length, 1)
  assert.doesNotMatch(markup, /class="auth-keypad"/, 'o teclado só aparece quando um campo recebe foco')
})

test('matrícula e PIN pertencem à mesma zona do teclado e declaram qual campo o teclado atende', () => {
  const markup = loginHtml({ matchMedia: touchOnly })
  const zone = markup.match(/<div class="auth-entry-zone"[^>]*>([\s\S]*?)<button[^>]*auth-submit/)
  assert.ok(zone, 'zona do teclado não encontrada')
  assert.match(zone[1], /id="login-matricula"/)
  assert.match(zone[1], /id="login-pin"/)
  assert.match(tag(markup, /<input[^>]*id="login-matricula"[^>]*>/), /data-keypad-target="matricula"/)
  assert.match(tag(markup, /<input[^>]*id="login-pin"[^>]*>/), /data-keypad-target="pin"/)
})

test('PIN: rótulo, mascarado, numérico, com preenchimento assistido (o tamanho de 8 é regra em código, não atributo)', () => {
  const markup = loginHtml()
  assert.match(markup, /<label for="login-pin">PIN<\/label>/)
  const input = tag(markup, /<input[^>]*id="login-pin"[^>]*>/)
  assert.match(input, /type="password"/)
  assert.match(input, /inputMode="numeric"|inputmode="numeric"/i)
  assert.match(input, /autoComplete="current-password"|autocomplete="current-password"/i)
  assert.doesNotMatch(input, /maxlength|minlength|pattern=/i)
  assert.doesNotMatch(input, /readonly/i, 'readonly quebraria colagem e preenchimento assistido')
  assert.doesNotMatch(input, /value="[^"]/i, 'o PIN nunca é renderizado no HTML')
  assert.match(input, /value=""/, 'campo controlado e vazio no primeiro desenho')
})

test('mostrar/ocultar PIN continua disponível, com nome acessível e estado', () => {
  const button = tag(loginHtml(), /<button[^>]*class="auth-pin-toggle"[^>]*>/)
  assert.match(button, /aria-label="Mostrar PIN"/)
  assert.match(button, /aria-pressed="false"/)
  assert.match(button, /type="button"/)
})

test('o envio tem botão do tipo submit e o formulário avisa quando está ocupado (aria-busy)', () => {
  const markup = loginHtml()
  assert.match(tag(markup, /<form\b[^>]*>/), /aria-busy="false"/)
  assert.match(tag(markup, /<button[^>]*auth-submit[^>]*>/), /type="submit"/)
})

test('a tela informa que a passkey será exigida depois do PIN', () => {
  assert.match(loginHtml(), /passkey/i)
})

test('computador (mouse): teclado do ALM ausente, PIN numérico e sem alternância de teclado', () => {
  const markup = loginHtml({ matchMedia: desktop })
  assert.doesNotMatch(markup, /auth-keypad|Teclado numérico do ALM|auth-keyboard-toggle/)
  assert.match(tag(markup, /<input[^>]*id="login-pin"[^>]*>/), /inputMode="numeric"|inputmode="numeric"/i)
})

test('sem matchMedia o padrão é o teclado do dispositivo', () => {
  const markup = loginHtml()
  assert.doesNotMatch(markup, /auth-keyboard-toggle/)
  assert.match(tag(markup, /<input[^>]*id="login-pin"[^>]*>/), /inputMode="numeric"|inputmode="numeric"/i)
})

test('celular/tablet só de toque: alternativa acessível para o teclado do aparelho', () => {
  const markup = loginHtml({ matchMedia: touchOnly })
  const toggle = tag(markup, /<button[^>]*auth-keyboard-toggle[^>]*>/)
  assert.match(toggle, /aria-pressed="false"/)
  assert.match(markup, /Usar o teclado do dispositivo/)
  // O teclado só aparece quando o campo do PIN recebe foco (comportamento verificado em navegador).
  assert.doesNotMatch(markup, /class="auth-keypad"/)
})

test('tablet com trackpad/mouse conectado mantém o teclado do dispositivo', () => {
  const withMouse = (query) => ({ matches: query === Q.primaryPointerCoarse || query === Q.primaryHoverNone || query === Q.anyPointerFine })
  const markup = loginHtml({ matchMedia: withMouse })
  assert.doesNotMatch(markup, /auth-keyboard-toggle/)
  assert.match(tag(markup, /<input[^>]*id="login-pin"[^>]*>/), /inputMode="numeric"|inputmode="numeric"/i)
})

test('teclado do ALM: grupo nomeado, 12 botões do tipo button, nomes acessíveis', () => {
  const markup = html(React.createElement(PinKeypad, { onKey() {}, digitCount: 0 }))
  const group = tag(markup, /<div[^>]*class="auth-keypad"[^>]*>/)
  assert.match(group, /role="group"/)
  assert.match(group, /aria-label="Teclado numérico do ALM"/)
  const buttons = markup.match(/<button\b[^>]*>/g)
  assert.equal(buttons.length, 12)
  for (const button of buttons) assert.match(button, /type="button"/, 'nenhuma tecla pode enviar o formulário')
  for (const digit of '0123456789') assert.match(markup, new RegExp(`data-key="${digit}"[^>]*>${digit}</button>`))
  assert.match(markup, /aria-label="Apagar último dígito"/)
  assert.match(markup, /<span>Continuar<\/span>/)
})

test('teclado do ALM: leitor de tela ouve só a QUANTIDADE de dígitos, nunca quais', () => {
  const text = (digitCount) => html(React.createElement(PinKeypad, { onKey() {}, digitCount })).match(/role="status"[^>]*>([^<]*)</)[1]
  assert.equal(text(0), 'Nenhum dígito informado.')
  assert.equal(text(1), '1 dígito informado.')
  assert.equal(text(6), '6 dígitos informados.')
  const markup = html(React.createElement(PinKeypad, { onKey() {}, digitCount: 4 }))
  assert.match(markup, /aria-live="polite"/)
})

test('teclado do ALM mostra e anuncia em qual campo está digitando (matrícula ou PIN)', () => {
  for (const [fieldLabel, count, spoken] of [
    ['Matrícula', 3, 'Matrícula: 3 dígitos informados.'],
    ['Matrícula', 0, 'Matrícula: nenhum dígito informado.'],
    ['PIN', 1, 'PIN: 1 dígito informado.'],
  ]) {
    const markup = html(React.createElement(PinKeypad, { onKey() {}, digitCount: count, fieldLabel }))
    assert.equal(markup.match(/role="status"[^>]*>([^<]*)</)[1], spoken)
    const caption = tag(markup, /<p[^>]*class="auth-keypad-target"[^>]*>/)
    assert.match(caption, /aria-hidden="true"/, 'o status já anuncia o campo; a legenda visual não duplica')
    assert.match(markup, new RegExp(`Digitando em <strong>${fieldLabel}</strong>`))
  }
  // O texto anunciado continua sendo só a quantidade, nunca os dígitos.
  const status = html(React.createElement(PinKeypad, { onKey() {}, digitCount: 4, fieldLabel: 'PIN' })).match(/role="status"[^>]*>([^<]*)</)[1]
  assert.equal(status, 'PIN: 4 dígitos informados.')
})

test('legenda do teclado mostra o que foi digitado (só visual): matrícula em dígitos, PIN só em pontos', () => {
  const caption = (props) => html(React.createElement(PinKeypad, { onKey() {}, ...props })).match(/<p[^>]*auth-keypad-target[^>]*>[\s\S]*?<\/p>/)[0]
  assert.match(caption({ digitCount: 4, fieldLabel: 'Matrícula', valuePreview: '0042' }), /<span class="auth-keypad-value">0042<\/span>/)
  assert.match(caption({ digitCount: 0, fieldLabel: 'Matrícula', valuePreview: '' }), /Digitando em <strong>Matrícula<\/strong>/)
  assert.doesNotMatch(caption({ digitCount: 0, fieldLabel: 'Matrícula', valuePreview: '' }), /auth-keypad-value/)
  assert.match(caption({ digitCount: 3, fieldLabel: 'PIN', valuePreview: '•••' }), /<span class="auth-keypad-value">•••<\/span>/)
  // A legenda é visual: o leitor de tela continua ouvindo só a contagem pela região de status.
  assert.match(caption({ digitCount: 4, fieldLabel: 'Matrícula', valuePreview: '0042' }), /aria-hidden="true"/)
})

test('teclado do ALM desativado enquanto a tela está ocupada', () => {
  const markup = html(React.createElement(PinKeypad, { onKey() {}, digitCount: 0, disabled: true }))
  const buttons = markup.match(/<button\b[^>]*>/g)
  assert.ok(buttons.every((button) => /disabled/.test(button)))
})

const SECOND_FACTOR_STATES = [
  [AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR, null, { role: 'status', retry: false, back: 'Cancelar' }],
  [AUTH_STATUS.CONFIRMACAO_INTERROMPIDA, null, { role: 'status', retry: true, back: 'Voltar' }],
  [AUTH_STATUS.PASSKEY_NAO_CADASTRADA, null, { role: 'status', retry: false, back: 'Voltar' }],
  [AUTH_STATUS.DISPOSITIVO_INCOMPATIVEL, UNSUPPORTED_REASON.SEM_WEBAUTHN, { role: 'alert', retry: false, back: 'Voltar' }],
  [AUTH_STATUS.DISPOSITIVO_INCOMPATIVEL, UNSUPPORTED_REASON.CONTEXTO_INSEGURO, { role: 'alert', retry: false, back: 'Voltar' }],
  [AUTH_STATUS.ERRO_CONEXAO, null, { role: 'alert', retry: true, back: 'Voltar' }],
  [AUTH_STATUS.ERRO_SEGUNDO_FATOR, null, { role: 'alert', retry: true, back: 'Voltar' }],
]

for (const [status, reason, expected] of SECOND_FACTOR_STATES) {
  test(`passo da passkey: ${status}${reason ? ` (${reason})` : ''}`, () => {
    const state = createInitialState(status, reason ? { reason } : {})
    const markup = html(React.createElement(PasskeyStep, { state, onRetry() {}, onBack() {} }))
    assert.match(markup, /<h1[^>]*tabindex="-1"[^>]*>/i, 'o título recebe foco ao mudar de passo')
    assert.match(markup, new RegExp(`role="${expected.role}"`), 'papel ARIA do aviso')
    assert.equal(/Tentar novamente/.test(markup), expected.retry)
    assert.match(markup, new RegExp(`>${expected.back}</button>`))
    const labels = [...markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim())
    for (const label of labels) {
      assert.doesNotMatch(label, /cadastrar|registrar|criar|recuperar|redefinir|esqueci|ignorar|pular|entrar assim mesmo/i, `botão indevido: ${label}`)
    }
    assert.doesNotMatch(markup, /auth-preview-badge/, 'sem selo fora da pré-visualização')
  })
}

test('passo da passkey: aguardando é ocupado (aria-busy) e informa que o segundo fator é obrigatório', () => {
  const state = createInitialState(AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR)
  const markup = html(React.createElement(PasskeyStep, { state, onRetry() {}, onBack() {} }))
  assert.match(markup, /aria-busy="true"/)
  assert.match(markup, /obrigat[óo]rio/i)
})

test('passo da passkey: a pré-visualização é identificada como demonstrativa e sem acesso', () => {
  const state = createInitialState(AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR)
  const markup = html(React.createElement(PasskeyStep, { state, preview: true, onRetry() {}, onBack() {} }))
  assert.match(markup, /Pré-visualização demonstrativa: não concede acesso\./)
})

test('passo da passkey sem texto (estado de formulário) não renderiza nada', () => {
  const state = createInitialState(AUTH_STATUS.CREDENCIAIS)
  assert.equal(html(React.createElement(PasskeyStep, { state, onRetry() {}, onBack() {} })), '')
})

// --- passkey real: o botão que abre o dispositivo é um toque do usuário (exigência do Safari) ---

test('passo da passkey com fluxo real: botão "Usar a passkey" aparece só no passo aguardando', () => {
  const waiting = createInitialState(AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR)
  const markup = html(React.createElement(PasskeyStep, { state: waiting, onStart() {}, onRetry() {}, onBack() {} }))
  const start = tag(markup, /<button[^>]*auth-passkey-start[^>]*>/)
  assert.match(start, /type="button"/)
  assert.doesNotMatch(start, /disabled/)
  assert.match(markup, />Usar a passkey</)
  assert.match(markup, />Cancelar</)
  for (const status of [AUTH_STATUS.CONFIRMACAO_INTERROMPIDA, AUTH_STATUS.ERRO_CONEXAO, AUTH_STATUS.ERRO_SEGUNDO_FATOR, AUTH_STATUS.PASSKEY_NAO_CADASTRADA]) {
    const other = html(React.createElement(PasskeyStep, { state: createInitialState(status), onStart() {}, onRetry() {}, onBack() {} }))
    assert.doesNotMatch(other, /auth-passkey-start/, status)
  }
})

test('passo da passkey: enquanto o dispositivo responde, o botão fica desativado e o passo ocupado', () => {
  const waiting = createInitialState(AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR)
  const markup = html(React.createElement(PasskeyStep, { state: waiting, onStart() {}, busy: true, onRetry() {}, onBack() {} }))
  assert.match(tag(markup, /<button[^>]*auth-passkey-start[^>]*>/), /disabled/)
  assert.match(markup, /aria-busy="true"/)
  assert.match(markup, /Aguardando o dispositivo/)
  const idle = html(React.createElement(PasskeyStep, { state: waiting, onStart() {}, busy: false, onRetry() {}, onBack() {} }))
  assert.match(idle, /aria-busy="false"/)
})

test('passo da passkey sem fluxo real (pré-visualização/testes): nenhum botão que dispare passkey', () => {
  const waiting = createInitialState(AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR)
  const markup = html(React.createElement(PasskeyStep, { state: waiting, preview: true, onRetry() {}, onBack() {} }))
  assert.doesNotMatch(markup, /auth-passkey-start/)
})
