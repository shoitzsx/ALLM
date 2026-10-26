// Regras OFICIAIS confirmadas pelo Goran e pelo Kobner (N-2.2/N-2.3), como contrato de teste:
// quem acessa o quê (só pela lista `permissoes` de /auth/me), Meus dispositivos sem
// `authenticators.manage`, código de ativação como segredo e WebAuthn guiado pelo servidor.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { ROUTES } from '../../layout/navigation.js'
import { AUTH_ROUTES, canAccessPath, homePathFor, requiredPermission } from './routeAccess.js'
import { decideAccess, ACCESS } from './accessDecision.js'
import { SESSION_STATUS, parseSessionUser } from './sessionState.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

// Permissões por perfil, como o backend as devolve em /auth/me (backend/auth/postgresAuth.mjs, capabilityMap).
const PERMISSIONS = {
  ADMINISTRADOR: ['catalogos.read', 'authenticators.manage', 'usuarios.read', 'chegadas.read', 'chegadas.create', 'recebimentos.read', 'recebimentos.create', 'recebimentos.update', 'anexos.read', 'anexos.write', 'dashboard.read'],
  ALMOXARIFADO: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'recebimentos.create', 'recebimentos.update', 'anexos.read', 'anexos.write', 'dashboard.read'],
  PORTARIA: ['catalogos.read', 'chegadas.read', 'chegadas.create'],
  SUPRIMENTOS: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'anexos.read', 'dashboard.read'],
  CONSULTA: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'anexos.read', 'dashboard.read'],
}

function userOf(perfil, permissoes = PERMISSIONS[perfil]) {
  return parseSessionUser({
    id: '3f2b8c1e-5a4d-4e6f-8a7b-1c2d3e4f5a6b',
    matricula: 'A12345',
    nome: 'Fulano de Tal',
    perfil,
    papeis: [perfil],
    permissoes,
  })
}

// --- permissões oficiais de cada tela ---

test('cada tela exige a permissão oficial', () => {
  assert.equal(requiredPermission(ROUTES.dashboard), 'dashboard.read', 'Visão geral')
  assert.equal(requiredPermission(ROUTES.nfeReader), 'recebimentos.create', 'Leitura automática prepara dados e encaminha para Novo recebimento')
  assert.equal(requiredPermission(ROUTES.newReceipt), 'recebimentos.create')
  assert.equal(requiredPermission(ROUTES.receipts), 'recebimentos.read')
  assert.equal(requiredPermission(`${ROUTES.receipts}/REC-1`), 'recebimentos.read')
  assert.equal(requiredPermission(ROUTES.visualizacao), 'recebimentos.read', 'Visualização (decisão oficial)')
  assert.equal(requiredPermission(ROUTES.portaria), 'chegadas.read')
  assert.equal(requiredPermission(ROUTES.portariaRegistrar), 'chegadas.create')
  assert.equal(requiredPermission(AUTH_ROUTES.devices), null, 'Meus dispositivos: basta estar autenticado')
})

test('Leitura automática NÃO usa chegadas.create (a leitura da Portaria é um fluxo futuro)', () => {
  assert.notEqual(requiredPermission(ROUTES.nfeReader), 'chegadas.create')
  const portaria = userOf('PORTARIA')
  assert.equal(canAccessPath(portaria, ROUTES.nfeReader), false, 'a Portaria tem chegadas.create e mesmo assim não abre a leitura de hoje')
})

const ACCESS_TABLE = [
  // perfil,        '/'    /recebimentos /novo  /pendencias /leitura  /portaria /portaria/registrar /dispositivos
  ['ADMINISTRADOR', true, true, true, true, true, true, true, true],
  ['ALMOXARIFADO', true, true, true, true, true, true, false, true],
  ['SUPRIMENTOS', true, true, false, true, false, true, false, true],
  ['CONSULTA', true, true, false, true, false, true, false, true],
  ['PORTARIA', false, false, false, false, false, true, true, true],
]
const PATHS = [ROUTES.dashboard, ROUTES.receipts, ROUTES.newReceipt, ROUTES.pending, ROUTES.nfeReader, ROUTES.portaria, ROUTES.portariaRegistrar, AUTH_ROUTES.devices]

for (const [perfil, ...expected] of ACCESS_TABLE) {
  test(`${perfil}: acesso às telas conforme as permissões oficiais`, () => {
    const user = userOf(perfil)
    PATHS.forEach((path, index) => {
      assert.equal(canAccessPath(user, path), expected[index], `${perfil} → ${path}`)
    })
  })
}

test('Visualização (somente leitura): quem lê recebimentos abre; a Portaria não', () => {
  for (const perfil of ['ADMINISTRADOR', 'ALMOXARIFADO', 'SUPRIMENTOS', 'CONSULTA']) assert.equal(canAccessPath(userOf(perfil), ROUTES.visualizacao), true, perfil)
  assert.equal(canAccessPath(userOf('PORTARIA'), ROUTES.visualizacao), false)
  assert.equal(canAccessPath(userOf('PORTARIA', ['recebimentos.read']), ROUTES.visualizacao), true, 'a permissão manda, não o perfil')
})

test('ADMINISTRADOR, ALMOXARIFADO, SUPRIMENTOS e CONSULTA veem a Visão geral; PORTARIA não', () => {
  for (const perfil of ['ADMINISTRADOR', 'ALMOXARIFADO', 'SUPRIMENTOS', 'CONSULTA']) assert.equal(canAccessPath(userOf(perfil), ROUTES.dashboard), true, perfil)
  assert.equal(canAccessPath(userOf('PORTARIA'), ROUTES.dashboard), false)
})

test('só ADMINISTRADOR e ALMOXARIFADO criam recebimentos (Novo recebimento e Leitura automática)', () => {
  for (const perfil of ['ADMINISTRADOR', 'ALMOXARIFADO']) {
    assert.equal(canAccessPath(userOf(perfil), ROUTES.newReceipt), true, perfil)
    assert.equal(canAccessPath(userOf(perfil), ROUTES.nfeReader), true, perfil)
  }
  for (const perfil of ['SUPRIMENTOS', 'CONSULTA', 'PORTARIA']) {
    assert.equal(canAccessPath(userOf(perfil), ROUTES.newReceipt), false, perfil)
    assert.equal(canAccessPath(userOf(perfil), ROUTES.nfeReader), false, perfil)
  }
})

test('a primeira tela de cada perfil: Visão geral, exceto a Portaria, que vai ao painel do dia', () => {
  for (const perfil of ['ADMINISTRADOR', 'ALMOXARIFADO', 'SUPRIMENTOS', 'CONSULTA']) assert.equal(homePathFor(userOf(perfil)), ROUTES.dashboard, perfil)
  assert.equal(homePathFor(userOf('PORTARIA')), ROUTES.portaria)
})

test('o porteiro das rotas segue as mesmas decisões depois de restaurar a sessão', () => {
  const at = (perfil, path) => decideAccess({ status: SESSION_STATUS.AUTHENTICATED, user: userOf(perfil), route: { path, query: new URLSearchParams() } })
  assert.deepEqual(at('ALMOXARIFADO', ROUTES.nfeReader), { action: ACCESS.APP })
  assert.deepEqual(at('SUPRIMENTOS', ROUTES.nfeReader), { action: ACCESS.REDIRECT, to: ROUTES.dashboard })
  assert.deepEqual(at('CONSULTA', ROUTES.newReceipt), { action: ACCESS.REDIRECT, to: ROUTES.dashboard })
  assert.deepEqual(at('PORTARIA', ROUTES.dashboard), { action: ACCESS.REDIRECT, to: ROUTES.portaria })
  assert.deepEqual(at('PORTARIA', ROUTES.portariaRegistrar), { action: ACCESS.APP })
  assert.deepEqual(at('ALMOXARIFADO', ROUTES.portariaRegistrar), { action: ACCESS.REDIRECT, to: ROUTES.dashboard })
})

// --- só `permissoes` decide; o nome do perfil nunca ---

test('a lista permissoes manda, não o perfil: perfil ADMINISTRADOR sem permissões não abre nada de negócio', () => {
  const user = userOf('ADMINISTRADOR', [])
  for (const path of PATHS.filter((p) => p !== AUTH_ROUTES.devices)) assert.equal(canAccessPath(user, path), false, path)
  assert.equal(canAccessPath(user, AUTH_ROUTES.devices), true)
  assert.equal(homePathFor(user), null)
})

test('a lista permissoes manda, não o perfil: perfil PORTARIA com dashboard.read abre a Visão geral', () => {
  const user = userOf('PORTARIA', ['dashboard.read'])
  assert.equal(canAccessPath(user, ROUTES.dashboard), true)
  assert.equal(canAccessPath(user, ROUTES.portaria), false)
})

test('as telas de dados também não olham o perfil nem o papel no código', () => {
  for (const name of ['routeAccess.js', 'accessDecision.js', 'AccessGate.jsx', 'sessionState.js']) {
    const code = strip(read(name))
    assert.doesNotMatch(code.replace(/LEGACY_PROFILE_LABEL[\s\S]*?\}\)/, ''), /\.perfil\s*(===|!==|==)|perfil\s*===|\.papeis\.(includes|some|find)|role\s*===/, name)
  }
})

// --- ações internas ---

test('"Novo recebimento" só aparece com recebimentos.create (pelas permissões da sessão)', () => {
  const app = strip(read('../../App.jsx'))
  const button = app.match(/function NewReceiptButton[\s\S]*?\n\}/)
  assert.ok(button, 'componente NewReceiptButton não encontrado')
  assert.match(button[0], /useAuth\(\)/)
  assert.match(button[0], /can\('recebimentos\.create'\)/)
  // Fora do componente, ninguém abre a criação por um botão solto.
  const outside = app.replace(button[0], '')
  assert.doesNotMatch(outside, /onClick=\{\(\) => navigate\(ROUTES\.newReceipt\)\}/)
  assert.equal((outside.match(/<NewReceiptButton\b/g) || []).length, 3, 'Visão geral, Recebimentos e Pendências')
})

// --- Meus dispositivos ---

test('Meus dispositivos: dispositivos do próprio usuário, sem authenticators.manage', () => {
  for (const name of ['AuthenticatorsPage.jsx', 'authApi.js', 'registrationFlow.js', 'deviceCopy.js', 'routeAccess.js', 'accessDecision.js', 'AccessGate.jsx', 'UserMenu.jsx']) {
    assert.doesNotMatch(strip(read(name)), /authenticators\.manage/, `${name} não exige a permissão de gestão de terceiros`)
  }
  assert.equal(requiredPermission(AUTH_ROUTES.devices), null)
  // Qualquer perfil com sessão, mesmo o de menos poder, abre a própria lista.
  for (const perfil of Object.keys(PERMISSIONS)) assert.equal(canAccessPath(userOf(perfil), AUTH_ROUTES.devices), true, perfil)
  assert.equal(canAccessPath(null, AUTH_ROUTES.devices), false, 'sem sessão não abre')
})

test('Meus dispositivos: MFA recente e último autenticador vêm do servidor, e a tela os respeita', () => {
  const copy = read('deviceCopy.js')
  assert.match(copy, /recent_mfa_required/)
  assert.match(copy, /conflict:/, 'LAST_AUTHENTICATOR (409) tem texto próprio')
  const page = strip(read('AuthenticatorsPage.jsx'))
  assert.match(page, /canRevoke\(rows, row\)/, 'o botão Remover some quando só há um dispositivo ativo')
  assert.match(page, /RECENT_MFA_REQUIRED/, 'sem MFA recente a tela orienta a entrar de novo')
  assert.match(page, /currentSessionRevoked/, 'remover o dispositivo da sessão encerra a sessão')
})

// --- código de ativação como segredo ---

test('ativação: o código é campo de senha, sai da tela no envio e nunca vai à URL, ao storage ou ao console', () => {
  const page = strip(read('ActivatePasskeyPage.jsx'))
  const input = page.match(/<input[^>]*id="activate-code"[\s\S]*?\/>/)
  assert.ok(input, 'campo do código não encontrado')
  assert.match(input[0], /type="password"/)
  assert.match(input[0], /autoComplete="off"/)
  const submit = page.match(/function handleSubmit[\s\S]*?\n  \}\n/)[0]
  const wipe = page.match(/function wipeSecrets[\s\S]*?\n  \}\n/)[0]
  for (const clear of ["setPin('')", "setNewPin('')", "setConfirmPin('')", "setCode('')"]) assert.ok(wipe.includes(clear), `wipeSecrets limpa ${clear}`)
  assert.ok((submit.match(/wipeSecrets\(\)/g) || []).length >= 3, 'os segredos saem da tela na recusa local e no envio, nos dois modos')
  assert.match(submit, /const temporaryPin = pin\n[\s\S]*?wipeSecrets\(\)\n\s*void flow\.beginFirstAccess/, 'primeiro acesso: limpa os campos ANTES de enviar')
  assert.match(submit, /const submittedPin = pin\n[\s\S]*?wipeSecrets\(\)\n\s*void flow\.begin\(/, 'novo dispositivo: limpa os campos ANTES de enviar')
  assert.doesNotMatch(page, /localStorage|sessionStorage|document\.cookie|console\.|location\.(hash|search|href)|history\.|navigate\(|URLSearchParams/, 'o código não pode parar em URL, storage nem console')
  assert.doesNotMatch(page, /\$\{[^}]*(code|Code)[^}]*\}/, 'o código não entra em texto montado')
  // A recusa local usa a mesma mensagem genérica do servidor, sem citar o código.
  assert.match(page, /firstAccessProblemCopy\(problem\)/)
  // Quando o cadastro falha e a tela volta ao formulário, o fluxo esquece o código que ainda guardava.
  assert.match(page, /REGISTRATION_STATUS\.ERROR && !interrupted && state\.canResume !== true\) flow\?\.cancel\(\)/)
})

test('ativação: matrícula e PIN seguem as mesmas regras oficiais do login', () => {
  const page = strip(read('ActivatePasskeyPage.jsx'))
  assert.match(page, /isMatriculaComplete\(matricula\) \|\| !isPinComplete\(pin\)/)
  assert.match(page, /checkFirstAccessInput\(\{ matricula, temporaryPin: pin, newPin, confirmPin, activationCode: code \}\)/)
  assert.match(page, /applyPinInput\(current, event\.target\.value\)/)
  assert.match(page, /applyMatriculaInput\(matriculaRef\.current, event\.target\.value\)/)
  const matricula = page.match(/<input[^>]*id="activate-matricula"[\s\S]*?\/>/)[0]
  assert.match(matricula, /inputMode="text"/)
  assert.match(matricula, /autoCapitalize="characters"/)
})

test('a mensagem de erro da ativação nunca ecoa o código nem o servidor', () => {
  const copy = strip(read('deviceCopy.js'))
  assert.doesNotMatch(copy, /activationCode|código de ativação:|\$\{[^}]*(code|c[óo]digo)/i)
  assert.doesNotMatch(strip(read('registrationFlow.js')), /console\.|emit\([^)]*activationCode/)
})

// --- WebAuthn guiado pelo servidor ---

test('o frontend usa as opções do backend: nenhum domínio, RP ID ou origem fixos no código', () => {
  const dir = new URL('./', import.meta.url)
  const sources = readdirSync(dir).filter((name) => /\.(js|jsx)$/.test(name) && !/\.test\./.test(name))
  assert.ok(sources.length > 10)
  for (const name of sources) {
    const code = strip(read(name))
    assert.doesNotMatch(code, /localhost|127\.0\.0\.1|https?:\/\/|\.vercel\.app|\.aguia/i, `${name}: domínio fixo`)
    assert.doesNotMatch(code, /rpId\s*[:=]\s*['"`]|rp\s*:\s*\{\s*id\s*:\s*['"`]/, `${name}: RP ID fixo`)
  }
  // O RP ID só chega do JSON do servidor.
  assert.match(strip(read('webauthnBrowser.js')), /json\.rpId/)
})
