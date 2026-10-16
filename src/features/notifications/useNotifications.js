import { useContext } from 'react'
import { NotificationsContext } from './NotificationsContext.js'

function useNotificationsContext() {
  const context = useContext(NotificationsContext)
  if (!context) {
    // Falhar alto: sem o Provider na raiz, o aviso simplesmente nunca apareceria.
    throw new Error('Notificações: use este hook dentro de <NotificationsProvider>.')
  }
  return context
}

/**
 * API das notificações para qualquer tela (Portaria, Visualização, Login…).
 * A referência devolvida é estável: pode entrar em dependências de efeitos.
 *
 *   const notify = useNotifications()
 *   notify.success('Chegada registrada', 'CHG-0001')
 *   notify.error('Não foi possível ler a NF-e')
 *
 *   // operação em andamento: fica na tela até ser atualizada ou fechada
 *   const id = notify.progress('Lendo NF-e…')
 *   notify.update(id, { level: 'success', title: 'NF-e lida' })   // ou notify.dismiss(id)
 *
 * Atalhos: success, info, warning, error, progress — (title, message, options).
 * Também há push(input), update(id, patch), dismiss(id), clear() e pushToast(),
 * a assinatura antiga (title, message, type = 'success') que o App já usa.
 *
 * Na tela cabem 5 notificações. As demais esperam numa fila temporária (só na memória)
 * e entram quando abre uma vaga; erro vem primeiro, depois aviso, depois o resto, e nada
 * expira sem ter sido visto. `update` e `dismiss` funcionam também para quem espera. Um botão
 * ao lado da pilha abre a lista de quem espera (temporária, sem histórico).
 *
 * Emitir de novo uma notificação idêntica (mesmo nível, título, mensagem e duração) não cria
 * outra: ela ganha o contador "N ocorrências" e devolve o mesmo id. PROGRESS nunca é agrupada.
 * Com a aba do navegador oculta, nenhuma notificação expira: o tempo que faltava é guardado.
 */
export function useNotifications() {
  return useNotificationsContext().api
}

// Uso interno do módulo (o Viewport precisa assinar a store).
export function useNotificationStore() {
  return useNotificationsContext().store
}
