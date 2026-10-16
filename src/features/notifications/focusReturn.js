/**
 * Regras de foco das notificações, sem React e sem DOM: recebem "elementos" só para
 * compará-los e ler `isConnected`, então rodam em `node --test`.
 */

/**
 * De onde o foco veio quando entrou numa notificação — para devolvê-lo ali ao fechar pelo teclado.
 * - veio de um elemento da página → ele passa a ser a origem lembrada;
 * - veio de outra notificação → a origem lembrada continua a mesma (o usuário só andou dentro da pilha);
 * - veio do nada (clique em texto, barra do navegador, outra janela) → não há origem: apaga a velha.
 *   Sem isso, uma sessão de teclado antiga puxaria o foco — e rolaria a página — para um elemento
 *   que o usuário já deixou para trás.
 */
export function rememberFocusOrigin({ previous, from, insideHost }) {
  if (!from) return null
  if (insideHost) return previous ?? null
  return from
}

/**
 * Devolver o foco só faz sentido para quem fechou pelo teclado e estava com o foco dentro da
 * notificação. Mouse e toque nunca mexem no foco: devolvê-lo rolaria a página até um elemento
 * que ficou lá atrás.
 */
export function shouldRestoreFocus({ viaKeyboard, focusInsideToast, target }) {
  return Boolean(viaKeyboard && focusInsideToast && target && target.isConnected)
}
