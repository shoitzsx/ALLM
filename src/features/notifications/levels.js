/**
 * Níveis das notificações do ALM e tudo que depende só do nível: duração
 * padrão, papel ARIA e rótulo lido por leitor de tela.
 *
 * Os valores são strings minúsculas de propósito: são os mesmos `type` que
 * `pushToast(title, message, type)` sempre aceitou ('success', 'error'), então
 * toda chamada antiga continua válida sem mudar uma linha.
 */
export const NOTIFICATION_LEVELS = Object.freeze({
  SUCCESS: 'success',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  PROGRESS: 'progress',
})

/** Nível de quem não informa nenhum — o mesmo `type = 'success'` histórico de pushToast. */
export const DEFAULT_LEVEL = NOTIFICATION_LEVELS.SUCCESS

/**
 * Nível de quem informa algo que não é um nível. INFO, e não SUCCESS: um valor
 * desconhecido nunca deve aparecer como sucesso na tela ("nada de falso sucesso").
 */
export const FALLBACK_LEVEL = NOTIFICATION_LEVELS.INFO

/**
 * duration — ms até fechar sozinha; `null` = fica até alguém fechar.
 * role     — ERROR interrompe o leitor de tela (alert); os demais esperam a vez (status).
 * label    — lido por leitor de tela antes do título, porque cor e ícone sozinhos
 *            não dizem o nível a quem não enxerga a tela.
 * severity — quem tem prioridade quando não cabe tudo na tela: erro (2) vem antes
 *            de aviso (1), que vem antes do resto (0: sucesso, informação, em andamento).
 */
export const LEVEL_META = Object.freeze({
  [NOTIFICATION_LEVELS.SUCCESS]: Object.freeze({ duration: 4400, role: 'status', label: 'Sucesso', severity: 0 }),
  [NOTIFICATION_LEVELS.INFO]: Object.freeze({ duration: 5000, role: 'status', label: 'Informação', severity: 0 }),
  [NOTIFICATION_LEVELS.WARNING]: Object.freeze({ duration: 6500, role: 'status', label: 'Atenção', severity: 1 }),
  [NOTIFICATION_LEVELS.ERROR]: Object.freeze({ duration: 8000, role: 'alert', label: 'Erro', severity: 2 }),
  [NOTIFICATION_LEVELS.PROGRESS]: Object.freeze({ duration: null, role: 'status', label: 'Em andamento', severity: 0 }),
})

// Os níveis válidos como conjunto. Nada de Object.hasOwn aqui: o build do Vite mira
// Safari 14 / Chrome 87 / Firefox 78 e não preenche APIs que esses navegadores não têm
// (Object.hasOwn só chegou no Safari 15.4 / Chrome 93 / Firefox 92).
const VALID_LEVELS = new Set(Object.values(NOTIFICATION_LEVELS))

/**
 * Converte o que o chamador passou em um nível válido.
 * - vazio (undefined, null, '') → SUCCESS, como o `type = 'success'` de sempre;
 * - 'ERROR', ' error ' etc. → aceita caixa e espaços;
 * - qualquer outra coisa → INFO (nunca SUCCESS).
 */
export function normalizeLevel(value) {
  if (!value) return DEFAULT_LEVEL
  if (typeof value !== 'string') return FALLBACK_LEVEL
  const level = value.trim().toLowerCase()
  if (level === '') return DEFAULT_LEVEL
  return VALID_LEVELS.has(level) ? level : FALLBACK_LEVEL
}

/**
 * Título que aparece na tela. Fica separado do `title` guardado para que uma
 * notificação sem título acompanhe o nível quando ele muda (ex.: PROGRESS
 * concluída vira SUCCESS e passa de "Em andamento" para "Sucesso").
 */
export function displayTitle(item) {
  return item.title || LEVEL_META[item.level].label
}
