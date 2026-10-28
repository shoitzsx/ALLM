import { LEVEL_META, NOTIFICATION_LEVELS, normalizeLevel } from './levels.js'

/**
 * Store das notificações — lógica pura, sem React e sem DOM, para ser testada
 * com `node --test`. O relógio e os timers são injetáveis (`now`, `setTimer`,
 * `clearTimer`): os testes usam um agendador falso e andam o tempo à mão, sem
 * esperar nada de verdade.
 *
 * Contrato com o React (`useSyncExternalStore`): `getSnapshot()` e `getQueued()`
 * devolvem a MESMA referência até a lista correspondente mudar, e uma lista nova
 * (congelada) quando muda. Nenhum consumidor consegue alterar a store por dentro.
 *
 * Cada notificação das listas é um objeto congelado:
 *   id        — texto único (gerado aqui, ou o informado pelo chamador)
 *   level     — 'success' | 'info' | 'warning' | 'error' | 'progress'
 *   title     — texto informado ('' quando não houve; a tela cai no rótulo do nível)
 *   message   — texto de apoio ('' quando não houve)
 *   duration  — ms até fechar sozinha; null = fica até ser fechada
 *   createdAt — instante da criação, pelo relógio injetado
 *   count     — quantas vezes a MESMA notificação foi emitida (1 = uma só; ver "Repetição")
 *
 * Tela e fila. Na tela cabem `maxVisible` notificações (5 por padrão). O que passa
 * disso NÃO é descartado: espera numa fila temporária, só na memória (nada é salvo),
 * e entra assim que abre uma vaga.
 *   - Gravidade: erro > aviso (WARNING) > o resto (sucesso, informação, em andamento).
 *     Na tela e na fila, o mais grave vem antes; em empate, quem chegou primeiro.
 *     `getSnapshot()` já devolve a pilha nessa ordem: a interface só a desenha, sem
 *     reordenar, então a ordem do DOM é a ordem visual e a do teclado.
 *   - Só uma notificação estritamente mais grave toma a vaga de quem já está na tela,
 *     e nunca a de quem está sendo usado (mouse em cima ou foco dentro — ver `pause`).
 *   - Quem espera não tem relógio: nada expira sem ter sido visto. O tempo de exibição
 *     começa, inteiro, quando a notificação entra na tela — também ao voltar dela.
 *   - Uma PROGRESS que perde a vaga continua viva na fila e pode ser atualizada
 *     (`update`) enquanto espera.
 *
 * Repetição. Emitir de novo uma notificação IDÊNTICA (mesmo nível, título, mensagem e
 * duração) não cria outra: a que existe ganha `count + 1`, mantém o id, o nível e o
 * lugar, e recomeça a contagem de tempo. Erros com mensagens diferentes nunca se
 * juntam, mesmo com o mesmo título. PROGRESS nunca é agrupada (cada operação em
 * andamento é independente) e quem informa um `id` explícito está atualizando, não repetindo.
 *
 * Aba oculta. `setPageVisible(false)` congela todos os relógios guardando o tempo que
 * faltava; `setPageVisible(true)` os retoma de onde pararam. Notificações que chegam
 * com a aba oculta só começam a contar quando ela volta. É independente da pausa por
 * mouse/foco (`pause`): voltar à aba não solta quem está em uso. Um ERROR que volta à vista
 * com menos de 2 s restantes fica 2 s (MIN_RETURN_MS); os demais níveis mantêm o tempo exato.
 */

/** Quantas notificações ficam na tela ao mesmo tempo; as demais esperam na fila. */
export const DEFAULT_MAX_VISIBLE = 5

/** O setTimeout guarda o atraso num inteiro de 32 bits com sinal: acima disso estoura e dispara na hora. */
const MAX_TIMER_MS = 2147483647

/** Um erro que volta à vista depois de a aba ter ficado oculta fica ao menos isso na tela. */
const MIN_RETURN_MS = 2000

const EMPTY = Object.freeze([])

function cleanText(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function cleanId(value) {
  const id = cleanText(value)
  return id === '' ? null : id
}

/**
 * Tempo válido: número finito e maior que zero, no máximo o que o setTimeout aceita.
 * Qualquer outra coisa vira null ("use o padrão").
 */
function cleanDuration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, MAX_TIMER_MS) : null
}

function buildDurations(overrides) {
  const durations = {}
  for (const level of Object.values(NOTIFICATION_LEVELS)) {
    durations[level] = LEVEL_META[level].duration
    if (!overrides || typeof overrides !== 'object') continue
    // `null` explícito = esse nível passa a não fechar sozinho.
    if (overrides[level] === null) durations[level] = null
    else durations[level] = cleanDuration(overrides[level]) ?? durations[level]
  }
  return durations
}

/**
 * Duração efetiva. PROGRESS permanece visível até ser encerrada explicitamente
 * — sem exceção, nem por `duration` do chamador nem por configuração do store.
 * `persistent` faz o mesmo para qualquer nível; senão vale a duração do
 * chamador ou a do nível.
 */
function resolveDuration(level, options, durations) {
  if (level === NOTIFICATION_LEVELS.PROGRESS || options.persistent === true) return null
  return cleanDuration(options.duration) ?? durations[level]
}

const severityOf = (item) => LEVEL_META[item.level].severity

/** Mais grave primeiro. Em empate vale a ordem em que a lista já está (a de chegada): o sort é estável. */
const byPriority = (list) => [...list].sort((a, b) => severityOf(b) - severityOf(a))

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index])

export function createNotificationStore(options) {
  const settings = options && typeof options === 'object' ? options : {}
  const now = typeof settings.now === 'function' ? settings.now : () => Date.now()
  const setTimer = typeof settings.setTimer === 'function' ? settings.setTimer : (callback, ms) => setTimeout(callback, ms)
  const clearTimer = typeof settings.clearTimer === 'function' ? settings.clearTimer : (handle) => clearTimeout(handle)
  const validLimit = (value) => Number.isInteger(value) && value > 0
  // Pode mudar depois (setMaxVisible): telas baixas mostram menos cartões e deixam o resto na fila.
  let limit = validLimit(settings.maxVisible) ? settings.maxVisible : DEFAULT_MAX_VISIBLE
  const durations = buildDurations(settings.durations)
  // true enquanto a aba do navegador está oculta: nenhum relógio corre.
  let suspended = false

  // Todas as notificações vivas (tela + fila), na ordem de chegada.
  let items = []
  // O que o React lê: a pilha da tela (já na ordem de exibição) e a fila (na ordem em que vai entrar).
  let visible = EMPTY
  let queued = EMPTY
  let sequence = 0
  // ids que estão na tela agora.
  const shown = new Set()
  // ids em uso (mouse em cima, foco dentro). Vive aqui, e não no timer, porque uma PROGRESS
  // não tem timer e, ao virar SUCCESS, o novo relógio tem de nascer pausado.
  const held = new Set()
  // id → { handle, remaining, startedAt, paused }. `remaining` é o que falta
  // para fechar; só muda quando o timer é pausado e retomado. Só quem está na tela tem timer.
  // Um timer está parado quando a notificação está em uso (`held`) OU a aba está oculta.
  const timers = new Map()
  const listeners = new Set()

  function emit() {
    for (const listener of [...listeners]) listener()
  }

  function indexOf(id) {
    return items.findIndex((item) => item.id === id)
  }

  function nextId() {
    let id
    do {
      sequence += 1
      id = `n-${sequence}`
    } while (indexOf(id) !== -1)
    return id
  }

  function cancelTimer(id) {
    const timer = timers.get(id)
    if (!timer) return
    if (timer.handle !== null) clearTimer(timer.handle)
    timers.delete(id)
  }

  const isFrozen = (id) => suspended || held.has(id)

  /** Para o relógio guardando o que falta. Idempotente: parar de novo não desconta o tempo outra vez. */
  function freeze(timer) {
    if (timer.paused) return
    clearTimer(timer.handle)
    timer.remaining = Math.max(0, timer.remaining - (now() - timer.startedAt))
    timer.handle = null
    timer.paused = true
  }

  /** Religa o relógio parado, de onde ele parou. */
  function thaw(id, timer) {
    if (!timer.paused) return
    timer.paused = false
    timer.startedAt = now()
    timer.handle = setTimer(() => expire(id), timer.remaining)
  }

  function schedule(id, duration, startPaused) {
    cancelTimer(id)
    if (duration === null) return
    if (startPaused) {
      timers.set(id, { handle: null, remaining: duration, startedAt: 0, paused: true })
      return
    }
    const timer = { handle: null, remaining: duration, startedAt: now(), paused: false }
    timer.handle = setTimer(() => expire(id), duration)
    timers.set(id, timer)
  }

  /**
   * Decide quem está na tela e quem espera, e acerta os relógios: só quem está na
   * tela tem relógio. Idempotente — pode rodar depois de qualquer mudança.
   *
   * O laço termina porque cada volta ou ocupa uma vaga livre (no máximo `limit` vezes)
   * ou troca alguém por uma notificação ESTRITAMENTE mais grave, então a gravidade
   * somada da tela só sobe. Trocar também entre iguais faria dois itens se revezarem
   * para sempre — é por isso que a comparação abaixo é `<=` e não `<`.
   */
  function settle() {
    // Limite reduzido (setMaxVisible): o excesso volta para a fila — o menos grave e mais novo primeiro, e
    // nunca quem está em uso. Se só sobrar quem está em uso, o excesso fica até a pessoa soltar.
    while (shown.size > limit) {
      const demotable = byPriority(items.filter((item) => shown.has(item.id) && !held.has(item.id)))
      const victim = demotable[demotable.length - 1]
      if (!victim) break
      shown.delete(victim.id)
    }
    for (;;) {
      const next = byPriority(items.filter((item) => !shown.has(item.id)))[0]
      if (!next) break
      if (shown.size < limit) {
        shown.add(next.id)
        continue
      }
      // Sem vaga: só um aviso estritamente mais grave toma o lugar de alguém — o menos
      // grave e mais novo —, e nunca o de quem está sendo usado.
      const replaceable = byPriority(items.filter((item) => shown.has(item.id) && !held.has(item.id)))
      const victim = replaceable[replaceable.length - 1]
      if (!victim || severityOf(next) <= severityOf(victim)) break
      shown.delete(victim.id)
      shown.add(next.id)
    }
    for (const item of items) {
      if (!shown.has(item.id)) cancelTimer(item.id)
      else if (!timers.has(item.id)) schedule(item.id, item.duration, isFrozen(item.id))
    }
  }

  /** Refaz as duas listas que o React lê. Só troca a referência de quem de fato mudou; devolve se algo mudou. */
  function publish() {
    const onScreen = byPriority(items.filter((item) => shown.has(item.id)))
    const waiting = byPriority(items.filter((item) => !shown.has(item.id)))
    let changed = false
    if (!sameList(visible, onScreen)) {
      visible = Object.freeze(onScreen)
      changed = true
    }
    if (!sameList(queued, waiting)) {
      queued = Object.freeze(waiting)
      changed = true
    }
    return changed
  }

  /** Depois de qualquer mudança: reorganiza tela e fila, acerta os relógios e avisa quem assina. */
  function commit() {
    settle()
    if (publish()) emit()
  }

  function remove(id) {
    if (indexOf(id) === -1) return false
    cancelTimer(id)
    shown.delete(id)
    held.delete(id)
    items = items.filter((item) => item.id !== id)
    commit()
    return true
  }

  function expire(id) {
    // O timer acabou de disparar: não há o que cancelar, só tirar da lista.
    timers.delete(id)
    remove(id)
  }

  /**
   * Cria uma notificação e devolve o id (ou null se `input` não for um objeto).
   * Campos: level, title, message, duration (ms), persistent (true = não fecha
   * sozinha), id. Se já existe uma notificação com esse `id`, ela é atualizada
   * em vez de duplicada. Valores inválidos nunca lançam: caem no padrão.
   * Sem vaga na tela, a notificação espera na fila (ver o topo do arquivo).
   */
  function push(input) {
    if (!input || typeof input !== 'object') return null
    const requestedId = cleanId(input.id)
    if (requestedId !== null && indexOf(requestedId) !== -1) {
      update(requestedId, input)
      return requestedId
    }
    const level = normalizeLevel(input.level)
    const title = cleanText(input.title)
    const message = cleanText(input.message)
    const duration = resolveDuration(level, input, durations)
    if (requestedId === null && level !== NOTIFICATION_LEVELS.PROGRESS) {
      const repeated = items.find((item) => item.level === level && item.title === title && item.message === message && item.duration === duration)
      if (repeated) {
        // Mesma notificação de novo: conta a ocorrência e recomeça o tempo, sem criar outra nem mudar o lugar.
        items = items.map((item) => (item === repeated ? Object.freeze({ ...repeated, count: repeated.count + 1 }) : item))
        cancelTimer(repeated.id) // o relógio recomeça em `settle()`, parado se estiver em uso ou com a aba oculta
        commit()
        return repeated.id
      }
    }
    const id = requestedId ?? nextId()
    const item = Object.freeze({ id, level, title, message, duration, createdAt: now(), count: 1 })
    items = [...items, item]
    commit()
    return id
  }

  /**
   * Altera uma notificação existente (ex.: PROGRESS → SUCCESS ao concluir), na tela ou na fila.
   * Só mexe nos campos presentes em `patch`. Trocar o nível ou a duração
   * reinicia a contagem; trocar só o texto também reinicia (texto novo merece
   * o tempo inteiro). Se a notificação está em uso (`pause`), o novo relógio
   * nasce pausado. Subir de gravidade (ex.: PROGRESS → ERROR) pode tomar a vaga
   * de quem é menos grave. Devolve false se o id não existe.
   */
  function update(id, patch) {
    const key = cleanId(id)
    const index = key === null ? -1 : indexOf(key)
    if (index === -1 || !patch || typeof patch !== 'object') return false
    const current = items[index]
    const level = patch.level == null || patch.level === '' ? current.level : normalizeLevel(patch.level)
    const retimes = patch.duration !== undefined || patch.persistent !== undefined || level !== current.level
    const title = patch.title === undefined ? current.title : cleanText(patch.title)
    const message = patch.message === undefined ? current.message : cleanText(patch.message)
    const next = Object.freeze({
      ...current,
      level,
      title,
      message,
      duration: retimes ? resolveDuration(level, patch, durations) : current.duration,
      // Texto ou nível novos: já não são ocorrências da mesma notificação.
      count: level === current.level && title === current.title && message === current.message ? current.count : 1,
    })
    items = items.map((item, position) => (position === index ? next : item))
    cancelTimer(key) // o relógio recomeça em `settle()`, se a notificação estiver na tela
    commit()
    return true
  }

  function dismiss(id) {
    const key = cleanId(id)
    return key === null ? false : remove(key)
  }

  function clear() {
    if (items.length === 0 && timers.size === 0) return false
    for (const id of [...timers.keys()]) cancelTimer(id)
    items = []
    shown.clear()
    held.clear()
    commit()
    return true
  }

  /**
   * Marca a notificação como "em uso" (mouse em cima, foco dentro): congela a contagem
   * guardando o tempo que falta e impede que um aviso mais grave a tire da tela. A marca
   * vale mesmo sem timer (PROGRESS) e sobrevive a `update`. Devolve true se passou a segurar.
   */
  function pause(id) {
    const key = cleanId(id)
    if (key === null || !shown.has(key) || held.has(key)) return false
    held.add(key)
    const timer = timers.get(key)
    if (timer) freeze(timer)
    return true
  }

  /** Solta a notificação e retoma a contagem de onde parou. Devolve true se estava segura. */
  function resume(id) {
    const key = cleanId(id)
    if (key === null || !held.delete(key)) return false
    const timer = timers.get(key)
    if (timer && !suspended) thaw(key, timer)
    // Quem estava em uso podia estar segurando a vaga de um aviso mais grave que esperava.
    commit()
    return true
  }

  /**
   * Avisa se a aba do navegador está visível. Oculta: congela todos os relógios (o que
   * faltava fica guardado); visível: retoma os que não estão em uso, e um ERROR com menos de
   * 2 s restantes ganha 2 s (quem tem mais mantém o tempo exato; em uso não ganha piso). Devolve true se o
   * estado mudou. Assim um erro não expira enquanto ninguém está olhando.
   */
  function setPageVisible(visible) {
    const hidden = !visible
    if (hidden === suspended) return false
    suspended = hidden
    for (const [id, timer] of timers) {
      if (hidden) freeze(timer)
      else if (!held.has(id)) {
        // Volta real da aba (um evento repetido nem chega aqui): o erro quase expirando ganha o piso.
        const item = items[indexOf(id)]
        if (item && item.level === NOTIFICATION_LEVELS.ERROR && timer.remaining < MIN_RETURN_MS) timer.remaining = MIN_RETURN_MS
        thaw(id, timer)
      }
    }
    return true
  }

  /**
   * Muda quantas notificações cabem na tela (ex.: menos em celulares baixos). Reduzir manda o excesso
   * para a fila; aumentar promove quem esperava. Nada é descartado. Valores que não são inteiros
   * positivos são ignorados. Devolve true se o limite mudou.
   */
  function setMaxVisible(value) {
    if (!validLimit(value) || value === limit) return false
    limit = value
    commit()
    return true
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /** A pilha da tela, na ordem de exibição: erros, avisos, o resto — cada grupo por ordem de chegada. */
  function getSnapshot() {
    return visible
  }

  /** O que espera uma vaga, na ordem em que vai entrar. Sem relógio: nada aqui expira. */
  function getQueued() {
    return queued
  }

  return Object.freeze({ subscribe, getSnapshot, getQueued, push, update, dismiss, clear, pause, resume, setPageVisible, setMaxVisible })
}
