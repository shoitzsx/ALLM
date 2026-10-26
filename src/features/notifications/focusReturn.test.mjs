import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rememberFocusOrigin, shouldRestoreFocus } from './focusReturn.js'

// Elementos de mentira: o módulo só lê `isConnected` e compara referências.
const element = (name, isConnected = true) => ({ name, isConnected })

// ------------------------------------------- de onde o foco veio (C-5)

test('o foco que chega de um elemento da página passa a ser a origem lembrada', () => {
  const botao = element('Anexar arquivo')
  assert.equal(rememberFocusOrigin({ previous: null, from: botao, insideHost: false }), botao)
  const antigo = element('origem antiga')
  assert.equal(rememberFocusOrigin({ previous: antigo, from: botao, insideHost: false }), botao, 'a mais recente vence')
})

test('o foco que passa de uma notificação para outra mantém a origem que já estava lembrada', () => {
  const origem = element('Anexar arquivo')
  const outraNotificacao = element('Fechar notificação')
  assert.equal(rememberFocusOrigin({ previous: origem, from: outraNotificacao, insideHost: true }), origem)
})

test('foco vindo do nada (clique em texto, barra do navegador, outra janela) apaga a origem velha', () => {
  const velha = element('origem de uma sessão de teclado anterior')
  assert.equal(rememberFocusOrigin({ previous: velha, from: null, insideHost: false }), null)
  assert.equal(rememberFocusOrigin({ previous: velha, from: undefined, insideHost: false }), null)
})

// ----------------------------------- quando devolver o foco ao fechar (C-5)

test('fechar pelo teclado devolve o foco à origem, desde que o foco estivesse mesmo na notificação', () => {
  const origem = element('Anexar arquivo')
  assert.equal(shouldRestoreFocus({ viaKeyboard: true, focusInsideToast: true, target: origem }), true)
})

test('fechar com o mouse ou o toque nunca mexe no foco, para a página não rolar sozinha', () => {
  const origem = element('Anexar arquivo')
  assert.equal(shouldRestoreFocus({ viaKeyboard: false, focusInsideToast: true, target: origem }), false)
})

test('não devolve o foco se ele não estava na notificação, se não há origem ou se a origem saiu da página', () => {
  const origem = element('Anexar arquivo')
  assert.equal(shouldRestoreFocus({ viaKeyboard: true, focusInsideToast: false, target: origem }), false)
  assert.equal(shouldRestoreFocus({ viaKeyboard: true, focusInsideToast: true, target: null }), false)
  assert.equal(shouldRestoreFocus({ viaKeyboard: true, focusInsideToast: true, target: element('removido', false) }), false)
})
