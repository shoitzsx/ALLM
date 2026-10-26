import { NOTIFICATION_LEVELS } from './levels.js'

/**
 * A "cara" que as telas veem da store: atalhos por nível e a assinatura
 * antiga de `pushToast`. Fica fora do React para ser testada sem DOM.
 *
 * Os atalhos recebem (title, message, options). `options` aceita `duration`
 * (ms), `persistent` (true = não fecha sozinha) e `id`. Todos devolvem o id da
 * notificação criada — é com ele que se atualiza ou fecha uma PROGRESS:
 *
 *   const id = api.progress('Lendo NF-e…')
 *   api.update(id, { level: 'success', title: 'NF-e lida' })
 */
export function createNotificationApi(store) {
  const atLevel = (level) => (title, message, options) =>
    store.push({ ...(options && typeof options === 'object' ? options : null), level, title, message })

  return Object.freeze({
    push: (input) => store.push(input),
    success: atLevel(NOTIFICATION_LEVELS.SUCCESS),
    info: atLevel(NOTIFICATION_LEVELS.INFO),
    warning: atLevel(NOTIFICATION_LEVELS.WARNING),
    error: atLevel(NOTIFICATION_LEVELS.ERROR),
    progress: atLevel(NOTIFICATION_LEVELS.PROGRESS),
    update: (id, patch) => store.update(id, patch),
    dismiss: (id) => store.dismiss(id),
    clear: () => store.clear(),
    // Assinatura histórica do App: pushToast(title, message, type = 'success').
    // `type` omitido vira SUCCESS; 'error' continua sendo ERROR; e agora também
    // aceita 'info', 'warning' e 'progress'.
    pushToast: (title, message, type) => store.push({ title, message, level: type }),
  })
}
