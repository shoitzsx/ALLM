// Notificações do ALM — cinco níveis (SUCCESS, INFO, WARNING, ERROR, PROGRESS).
// O Provider fica na raiz do App; qualquer tela usa o hook:
//
//   import { useNotifications } from '../notifications/index.js'
//   const notify = useNotifications()
//   notify.warning('Dados incompletos', 'Confira o CNPJ antes de confirmar.')
//
// Detalhes de uso em useNotifications.js; regras de cada nível em levels.js.
export { NotificationsProvider } from './NotificationsProvider.jsx'
export { useNotifications } from './useNotifications.js'
export { NOTIFICATION_LEVELS } from './levels.js'
