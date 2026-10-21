import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RETURN_TO, buildLoginRoute, readReturnTo, sanitizeReturnTo } from './returnTo.js'

test('aceita caminhos internos do roteador, com ou sem query', () => {
  for (const ok of ['/', '/recebimentos', '/recebimentos/REC-2026-000901', '/portaria/registrar', '/visualizacao?aba=recebimentos', '/recebimentos?q=Metal%C3%BArgica']) {
    assert.equal(sanitizeReturnTo(ok), ok)
  }
  assert.equal(sanitizeReturnTo('#/recebimentos'), '/recebimentos', 'aceita o prefixo # do roteador por hash')
})

test('rejeita endereço externo e esquemas perigosos', () => {
  const bad = [
    'https://evil.example/', 'http://evil.example', '//evil.example', '///evil.example', 'evil.example', 'recebimentos',
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd',
    '/javascript:alert(1)', '//javascript:alert(1)', '/https://evil.example', 'mailto:a@b.c',
  ]
  for (const value of bad) assert.equal(sanitizeReturnTo(value), DEFAULT_RETURN_TO, value)
})

test('rejeita barra invertida, caractere de controle e espaço', () => {
  for (const value of ['/\\evil.example', '\\\\evil.example', '/\\/evil', '/a\nb', '/a\rb', '/a\tb', '/a b', '/\u0000', '/\u007f', ' /recebimentos', '/recebimentos ']) {
    assert.equal(sanitizeReturnTo(value), DEFAULT_RETURN_TO, JSON.stringify(value))
  }
})

test('a codificação não esconde um destino externo', () => {
  for (const value of ['/%2Fevil.example', '/%5Cevil.example', '/%2F%2Fevil.example', '/%0Aevil', '/%250Aevil', '/%252Fevil.example', '/%09evil', '/%00', '/%E0%A4%A']) {
    assert.equal(sanitizeReturnTo(value), DEFAULT_RETURN_TO, value)
  }
})

test('não aceita fragmento nem valor gigante nem tipo errado', () => {
  assert.equal(sanitizeReturnTo('/recebimentos#x'), DEFAULT_RETURN_TO)
  assert.equal(sanitizeReturnTo(`/${'a'.repeat(400)}`), DEFAULT_RETURN_TO)
  for (const value of [undefined, null, 42, {}, [], true, '', '#']) assert.equal(sanitizeReturnTo(value), DEFAULT_RETURN_TO)
})

test('nunca devolve para a própria tela de login (evita laço)', () => {
  for (const value of ['/login', '/login/', '/login?state=invalid', '#/login', '/login/x']) {
    assert.equal(sanitizeReturnTo(value), DEFAULT_RETURN_TO, value)
  }
  assert.equal(sanitizeReturnTo('/loginx'), '/loginx', 'só o caminho exato /login é bloqueado')
})

test('descarta destino com parâmetro sensível (PIN, matrícula, token...)', () => {
  for (const value of ['/recebimentos?pin=1234', '/recebimentos?matricula=00123', '/x?senha=1', '/x?a=1&token=abc', '/x?PIN=1', '/x?password=1', '/x?code=9', '/x?challenge=zz']) {
    assert.equal(sanitizeReturnTo(value), DEFAULT_RETURN_TO, value)
  }
  assert.equal(sanitizeReturnTo('/recebimentos?status=aberto'), '/recebimentos?status=aberto')
})

test('fallback e restrição de rotas conhecidas são configuráveis', () => {
  assert.equal(sanitizeReturnTo('https://x', { fallback: '/inicio' }), '/inicio')
  const known = (path) => path === '/recebimentos' || path.startsWith('/recebimentos/')
  assert.equal(sanitizeReturnTo('/recebimentos/1', { isKnownPath: known }), '/recebimentos/1')
  assert.equal(sanitizeReturnTo('/rota-inventada', { isKnownPath: known }), DEFAULT_RETURN_TO)
})

test('readReturnTo lê do URLSearchParams e sanitiza', () => {
  assert.equal(readReturnTo(new URLSearchParams('returnTo=%2Frecebimentos')), '/recebimentos')
  assert.equal(readReturnTo(new URLSearchParams('returnTo=https%3A%2F%2Fevil.example')), DEFAULT_RETURN_TO)
  assert.equal(readReturnTo(new URLSearchParams('')), DEFAULT_RETURN_TO)
  assert.equal(readReturnTo(undefined), DEFAULT_RETURN_TO)
})

test('buildLoginRoute só carrega destino seguro e omite o padrão', () => {
  assert.equal(buildLoginRoute('/recebimentos/REC-1'), '/login?returnTo=%2Frecebimentos%2FREC-1')
  assert.equal(buildLoginRoute('https://evil.example'), '/login')
  assert.equal(buildLoginRoute('/'), '/login')
  assert.equal(buildLoginRoute(undefined), '/login')
  assert.equal(buildLoginRoute('/x?pin=1234'), '/login')
})
