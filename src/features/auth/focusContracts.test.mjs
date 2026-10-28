import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Contratos de foco da tela de acesso que o Node consegue guardar sem DOM. O
 * comportamento de verdade (foco síncrono no clique, blur sem destino, anel de
 * foco desenhado) só um navegador prova — esses testes impedem a regressão
 * silenciosa do código-fonte entre uma verificação de navegador e outra.
 */
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

function functionBody(code, name) {
  const start = code.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `função ${name} não encontrada`)
  const open = code.indexOf('{', code.indexOf(')', start))
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(open, i + 1)
    }
  }
  throw new Error(`corpo de ${name} não fechou`)
}

const loginCode = stripComments(read('LoginPage.jsx'))

test('alternar o teclado foca o PIN dentro do clique (sem rAF, timer ou promessa)', () => {
  const body = functionBody(loginCode, 'toggleNativeKeyboard')
  assert.doesNotMatch(body, /requestAnimationFrame|setTimeout|setInterval|queueMicrotask|Promise|await|\.then\(/)
  assert.match(body, /flushSync\(/, 'o inputMode novo precisa estar no DOM antes do foco')
  assert.match(body, /\.focus\(\)/)
})

test('alternar o teclado nunca deixa o foco para um timer: a página inteira não agenda foco', () => {
  assert.doesNotMatch(loginCode, /requestAnimationFrame/)
})

test('perder o foco sem destino (relatedTarget nulo) não fecha o teclado do ALM', () => {
  const body = functionBody(loginCode, 'handleZoneBlur')
  assert.match(body, /relatedTarget/)
  // Só fecha quando há um destino E ele está fora da zona.
  assert.match(body, /if\s*\(\s*next\s*&&\s*!/, 'precisa exigir destino não nulo antes de fechar')
})

test('o fechamento por toque fora da zona é por clique (rolar a página não fecha) e é desfeito ao desmontar', () => {
  assert.match(loginCode, /addEventListener\(\s*'click'/)
  assert.doesNotMatch(loginCode, /addEventListener\(\s*'(pointerdown|touchstart|mousedown)'/)
  assert.match(loginCode, /removeEventListener\(\s*'click'/)
})

test('"fora da zona" usa o caminho do evento: o ícone trocado pelo clique não conta como fora', () => {
  assert.match(loginCode, /event\.composedPath\(\)\.includes\(zoneRef\.current\)/)
  assert.doesNotMatch(loginCode, /zoneRef\.current\?*\.contains\(event\.target\)/)
})

test('o teclado do ALM não abre nem fecha por eventos de toque do próprio teclado', () => {
  const keypad = stripComments(read('PinKeypad.jsx'))
  assert.match(keypad, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/, 'mantém o foco no PIN durante o toque')
  assert.doesNotMatch(keypad, /onBlur|onFocus|onTouch|onPointer/, 'o teclado não decide abrir/fechar sozinho')
})

test('o título da passkey não perde o anel de foco de navegação por teclado', () => {
  const css = read('auth.css')
  // Nenhuma regra remove o outline do h1 em :focus sem proteger :focus-visible.
  for (const match of css.matchAll(/([^{}]*h1[^{}]*)\{([^}]*)\}/g)) {
    const [, selector, declarations] = match
    if (!/outline\s*:\s*none/.test(declarations)) continue
    assert.match(selector, /:focus:not\(:focus-visible\)/, `regra remove o anel do título: ${selector.trim()}`)
  }
  const visible = css.match(/\.auth-card-header h1:focus-visible\s*\{([^}]*)\}/)
  assert.ok(visible, 'falta a regra :focus-visible do título')
  assert.match(visible[1], /outline\s*:\s*3px solid/)
  assert.doesNotMatch(visible[1], /outline\s*:\s*none/)
})

test('matrícula: excesso é recusado pela regra única do campo, sem truncar nem maxLength (o teclado do ALM não digita matrícula)', () => {
  assert.match(loginCode, /applyMatriculaInput\(matriculaValueRef\.current, event\.target\.value\)/)
  assert.doesNotMatch(functionBody(loginCode, 'handleKeypadKey'), /matricula/i, 'o teclado numérico só digita o PIN')
  // Nenhum corte automático da matrícula na tela, nem limite nativo que truncaria a colagem.
  assert.doesNotMatch(loginCode, /setMatricula\(sanitizeMatriculaInput/)
  const input = loginCode.match(/<input[^>]*id="login-matricula"[\s\S]*?\/>/)[0]
  assert.doesNotMatch(input, /maxLength|minLength|pattern=/)
  const credentials = stripComments(read('credentialsInput.js'))
  assert.doesNotMatch(functionBody(credentials, 'sanitizeMatriculaInput'), /slice|substring|substr/)
  assert.doesNotMatch(functionBody(credentials, 'applyMatriculaInput'), /slice|substring|substr/)
})

test('o aviso de excesso vem da constante, é alerta e não toca no PIN', () => {
  assert.match(loginCode, /\{MATRICULA_OVERFLOW_MESSAGE\}/)
  assert.doesNotMatch(loginCode, /ultrapassar/, 'o texto fica só em authErrors.js')
  assert.match(loginCode, /id="login-matricula-limit"[^>]*role="alert"/)
  assert.match(functionBody(loginCode, 'handlePinChange'), /^\{[\s\S]*applyPinInput\(current, event\.target\.value\)[\s\S]*\}$/)
  assert.doesNotMatch(functionBody(loginCode, 'handlePinChange'), /Overflow|applyMatriculaInput/)
})

test('clique ou toque fora da zona dos campos também limpa o aviso de excesso da matrícula', () => {
  const body = functionBody(loginCode, 'closeOnOutsideClick')
  assert.match(body, /composedPath\(\)\.includes\(zoneRef\.current\)/, 'só conta como "fora" quem não está no caminho do clique dentro da zona')
  assert.match(body, /setMatriculaOverflow\(0\)/, 'fora da zona, o aviso sai junto com o teclado')
  // O ouvinte precisa existir também quando só o aviso está na tela (sem campo ativo).
  assert.match(loginCode, /if \(!fieldActive && !overflowShown\) return undefined/)
  assert.match(loginCode, /\[fieldActive, overflowShown\]/)
})

test('o aviso continua sem sair por interação DENTRO da zona (campos, teclado, alternância, Entrar)', () => {
  const body = functionBody(loginCode, 'closeOnOutsideClick')
  // A limpeza é condicionada ao clique fora: o mesmo `if` que fecha o teclado.
  assert.match(body, /if \(!event\.composedPath\(\)\.includes\(zoneRef\.current\)\) \{[\s\S]*setMatriculaOverflow\(0\)[\s\S]*\}/)
})
