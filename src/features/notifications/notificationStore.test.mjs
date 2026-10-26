import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MAX_VISIBLE, createNotificationStore } from './notificationStore.js'
import { createNotificationApi } from './notificationApi.js'
import { LEVEL_META, NOTIFICATION_LEVELS, displayTitle } from './levels.js'

// Agendador falso: o tempo só anda quando o teste manda (`advance`), então
// nenhum teste espera de verdade e nenhum depende da velocidade da máquina.
function createFakeScheduler(start = 1_000) {
  let clock = start
  let lastHandle = 0
  const timers = new Map()
  return {
    now: () => clock,
    setTimer(callback, ms) {
      lastHandle += 1
      timers.set(lastHandle, { at: clock + ms, callback })
      return lastHandle
    },
    clearTimer(handle) {
      timers.delete(handle)
    },
    pending: () => timers.size,
    advance(ms) {
      const target = clock + ms
      for (;;) {
        let next = null
        for (const [handle, timer] of timers) {
          if (timer.at <= target && (!next || timer.at < next.timer.at)) next = { handle, timer }
        }
        if (!next) break
        timers.delete(next.handle)
        clock = Math.max(clock, next.timer.at)
        next.timer.callback()
      }
      clock = target
    },
  }
}

function setup(options) {
  const scheduler = createFakeScheduler()
  const store = createNotificationStore({
    now: scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    ...options,
  })
  return { store, scheduler, api: createNotificationApi(store) }
}

// `getSnapshot()` é o que está na tela; `getQueued()` é o que espera uma vaga.
// `ids` e `queuedIds` olham cada lista; `find` acha a notificação viva em qualquer uma
// (sumir de verdade = não estar em nenhuma), e `everything` lista as duas.
const ids = (store) => store.getSnapshot().map((item) => item.id)
const queuedIds = (store) => store.getQueued().map((item) => item.id)
const everything = (store) => [...store.getSnapshot(), ...store.getQueued()]
const find = (store, id) => everything(store).find((item) => item.id === id)

// ---------------------------------------------------------------- criação

test('os cinco níveis podem ser criados, cada um com o papel ARIA e a duração do seu nível', () => {
  const { store } = setup()
  const created = {}
  for (const level of Object.values(NOTIFICATION_LEVELS)) {
    created[level] = store.push({ level, title: `Título ${level}`, message: `Mensagem ${level}` })
  }

  assert.equal(store.getSnapshot().length, 5)
  assert.equal(new Set(Object.values(created)).size, 5, 'ids únicos')
  for (const [level, id] of Object.entries(created)) {
    const item = find(store, id)
    assert.equal(item.level, level)
    assert.equal(item.title, `Título ${level}`)
    assert.equal(item.message, `Mensagem ${level}`)
    assert.equal(item.duration, LEVEL_META[level].duration)
  }
  assert.equal(LEVEL_META.error.role, 'alert')
  assert.equal(LEVEL_META.success.role, 'status')
})

test('sem nível informado, a notificação nasce SUCCESS', () => {
  const { store, api } = setup()
  const direct = store.push({ title: 'Salvo' })
  const legacy = api.pushToast('Salvo', 'Tudo certo.')
  assert.equal(find(store, direct).level, 'success')
  assert.equal(find(store, legacy).level, 'success')
})

test('os atalhos criam o nível certo, devolvem o id e aceitam opções', () => {
  const { store, api } = setup()
  assert.equal(find(store, api.success('a')).level, 'success')
  assert.equal(find(store, api.info('a')).level, 'info')
  assert.equal(find(store, api.warning('a')).level, 'warning')
  assert.equal(find(store, api.error('a')).level, 'error')
  assert.equal(find(store, api.progress('a')).level, 'progress')

  const custom = api.info('a', 'b', { duration: 1500, id: 'meu-id' })
  assert.equal(custom, 'meu-id')
  assert.equal(find(store, 'meu-id').duration, 1500)
  assert.equal(find(store, 'meu-id').message, 'b')
})

test('atalho com options inválidas (string, número) não lança', () => {
  const { store, api } = setup()
  assert.doesNotThrow(() => api.error('a', 'b', 'texto solto'))
  assert.doesNotThrow(() => api.error('c', 'd', 42))
  assert.equal(store.getSnapshot().length, 2)
})

// ---------------------------------------------------------- encerramento

test('dismiss fecha só a notificação indicada e cancela o timer dela', () => {
  const { store, scheduler } = setup()
  const a = store.push({ title: 'A' })
  const b = store.push({ title: 'B' })
  const c = store.push({ title: 'C' })
  assert.equal(scheduler.pending(), 3)

  assert.equal(store.dismiss(b), true)
  assert.deepEqual(ids(store), [a, c])
  assert.equal(scheduler.pending(), 2)

  assert.equal(store.dismiss(b), false, 'segunda vez: já não existe')
  assert.equal(store.dismiss('nao-existe'), false)
  assert.deepEqual(ids(store), [a, c])
})

// ------------------------------------------------------------- expiração

test('cada nível fecha sozinho na sua duração padrão', () => {
  for (const level of ['success', 'info', 'warning', 'error']) {
    const { store, scheduler } = setup()
    const id = store.push({ level, title: level })
    const duration = LEVEL_META[level].duration

    scheduler.advance(duration - 1)
    assert.ok(find(store, id), `${level} ainda visível 1 ms antes`)
    scheduler.advance(1)
    assert.equal(find(store, id), undefined, `${level} some na duração exata`)
    assert.equal(scheduler.pending(), 0)
  }
})

test('o tempo de exibição é configurável: por notificação, por store e com persistent', () => {
  const porNotificacao = setup()
  const a = porNotificacao.store.push({ title: 'a', duration: 1200 })
  porNotificacao.scheduler.advance(1199)
  assert.ok(find(porNotificacao.store, a))
  porNotificacao.scheduler.advance(1)
  assert.equal(find(porNotificacao.store, a), undefined)

  const porStore = setup({ durations: { success: 1000, error: null } })
  const s = porStore.store.push({ level: 'success', title: 's' })
  const e = porStore.store.push({ level: 'error', title: 'e' })
  porStore.scheduler.advance(1000)
  assert.equal(find(porStore.store, s), undefined, 'success usa o padrão do store')
  porStore.scheduler.advance(10 * 60_000)
  assert.ok(find(porStore.store, e), 'error com null no store não fecha sozinho')

  const fixa = setup()
  const p = fixa.store.push({ level: 'warning', title: 'p', persistent: true })
  fixa.scheduler.advance(60 * 60_000)
  assert.ok(find(fixa.store, p))
  assert.equal(fixa.scheduler.pending(), 0)
})

test('PROGRESS não fecha sozinha, nem se alguém passar duration', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'progress', title: 'Lendo NF-e…', duration: 1000 })
  assert.equal(find(store, id).duration, null)
  assert.equal(scheduler.pending(), 0)
  scheduler.advance(10 * 60_000)
  assert.ok(find(store, id))

  const configurado = setup({ durations: { progress: 500 } })
  const outro = configurado.store.push({ level: 'progress', title: 'x' })
  configurado.scheduler.advance(60_000)
  assert.ok(find(configurado.store, outro), 'nem a configuração do store faz PROGRESS expirar')
})

// --------------------------------------------------------- atualização

test('PROGRESS concluída vira SUCCESS, ganha o título novo e passa a expirar', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'progress', title: 'Lendo NF-e…', message: 'Aguarde.' })

  scheduler.advance(30_000)
  assert.ok(find(store, id), 'segue visível enquanto a operação não termina')

  assert.equal(store.update(id, { level: 'success', title: 'NF-e lida', message: '' }), true)
  const item = find(store, id)
  assert.equal(item.level, 'success')
  assert.equal(item.title, 'NF-e lida')
  assert.equal(item.message, '')
  assert.equal(item.duration, LEVEL_META.success.duration)
  assert.equal(scheduler.pending(), 1)

  scheduler.advance(LEVEL_META.success.duration)
  assert.equal(find(store, id), undefined)
})

test('PROGRESS pode virar ERROR e dura o tempo de um erro', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'progress', title: 'Enviando…' })
  store.update(id, { level: 'error', title: 'Falha no envio' })
  scheduler.advance(LEVEL_META.error.duration - 1)
  assert.ok(find(store, id))
  scheduler.advance(1)
  assert.equal(find(store, id), undefined)
})

test('atualizar o texto de uma PROGRESS mantém o nível e continua sem timer', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'progress', title: 'Enviando' })
  store.update(id, { message: '2 de 5 arquivos' })
  assert.equal(find(store, id).level, 'progress')
  assert.equal(find(store, id).message, '2 de 5 arquivos')
  assert.equal(find(store, id).title, 'Enviando', 'campos ausentes do patch não mudam')
  assert.equal(scheduler.pending(), 0)
})

test('sem título próprio, o título que aparece acompanha o nível', () => {
  const { store } = setup()
  const id = store.push({ level: 'progress' })
  assert.equal(displayTitle(find(store, id)), 'Em andamento')
  store.update(id, { level: 'success' })
  assert.equal(displayTitle(find(store, id)), 'Sucesso')
})

test('update em id que não existe devolve false e não muda nada', () => {
  const { store } = setup()
  store.push({ title: 'A' })
  const before = store.getSnapshot()
  assert.equal(store.update('nao-existe', { title: 'B' }), false)
  assert.equal(store.update(undefined, { title: 'B' }), false)
  assert.equal(store.getSnapshot(), before)
})

test('um id informado pelo chamador atualiza a notificação em vez de duplicar', () => {
  const { store } = setup()
  assert.equal(store.push({ id: 'leitura', level: 'progress', title: 'Lendo' }), 'leitura')
  assert.equal(store.push({ id: 'leitura', level: 'success', title: 'Lida' }), 'leitura')
  assert.equal(store.getSnapshot().length, 1)
  assert.equal(find(store, 'leitura').level, 'success')
  assert.equal(find(store, 'leitura').title, 'Lida')
})

// --------------------------------------------------------- simultâneas

test('várias notificações convivem, com o erro no topo, e expiram cada uma no seu tempo', () => {
  const { store, scheduler } = setup()
  const sucesso = store.push({ level: 'success', title: '1' })
  const erro = store.push({ level: 'error', title: '2' })
  const info = store.push({ level: 'info', title: '3' })
  assert.deepEqual(ids(store), [erro, sucesso, info])

  scheduler.advance(4400)
  assert.deepEqual(ids(store), [erro, info])
  scheduler.advance(600)
  assert.deepEqual(ids(store), [erro])
  scheduler.advance(3000)
  assert.deepEqual(ids(store), [])
  assert.equal(scheduler.pending(), 0)
})

// --------------------------------------- limite de tela, fila e prioridade (C-1)
//
// Regra: na tela cabem `maxVisible` notificações (5 por padrão). O que passa
// disso ESPERA numa fila temporária (só na memória) em vez de ser descartado.
// Erro vem primeiro, depois aviso, depois o resto; em cada grupo, por ordem de
// chegada. Só um aviso mais grave toma o lugar de quem já está na tela.

test('o limite padrão de notificações na tela é 5', () => {
  assert.equal(DEFAULT_MAX_VISIBLE, 5)
  const { store } = setup()
  for (let i = 0; i < 8; i += 1) store.push({ level: 'info', title: String(i) })
  assert.equal(store.getSnapshot().length, 5)
  assert.equal(store.getQueued().length, 3)
})

test('cinco PROGRESS, depois um ERROR, depois um SUCCESS: o ERROR continua na tela e ninguém se perde', () => {
  const { store } = setup()
  const progresso = Array.from({ length: 5 }, (_, i) => store.push({ level: 'progress', title: `Envio ${i + 1}` }))
  const erro = store.push({ level: 'error', title: 'Falha ao salvar' })
  const sucesso = store.push({ level: 'success', title: 'Documento anexado' })

  // O ERROR sobe para o topo e toma a vaga da PROGRESS mais nova; o SUCCESS espera.
  assert.deepEqual(ids(store), [erro, progresso[0], progresso[1], progresso[2], progresso[3]])
  assert.deepEqual(queuedIds(store), [progresso[4], sucesso])
  assert.equal(everything(store).length, 7, 'nada foi descartado')
})

test('vários ERROR seguidos: os cinco primeiros ficam na tela, os outros esperam e nenhum se perde', () => {
  const { store } = setup()
  const erros = Array.from({ length: 8 }, (_, i) => store.push({ level: 'error', title: `Erro ${i + 1}` }))
  assert.deepEqual(ids(store), erros.slice(0, 5))
  assert.deepEqual(queuedIds(store), erros.slice(5))
})

test('cinco ERROR e depois um SUCCESS: o SUCCESS espera e nenhum ERROR sai', () => {
  const { store } = setup()
  const erros = Array.from({ length: 5 }, (_, i) => store.push({ level: 'error', title: `Erro ${i + 1}` }))
  const sucesso = store.push({ level: 'success', title: 'Salvo' })
  assert.deepEqual(ids(store), erros)
  assert.deepEqual(queuedIds(store), [sucesso])
})

test('um ERROR seguido de cinco SUCCESS: o ERROR fica no topo e só o SUCCESS mais novo espera', () => {
  const { store } = setup()
  const erro = store.push({ level: 'error', title: 'Falha' })
  const sucessos = Array.from({ length: 5 }, (_, i) => store.push({ level: 'success', title: `Ok ${i + 1}` }))
  assert.deepEqual(ids(store), [erro, sucessos[0], sucessos[1], sucessos[2], sucessos[3]])
  assert.deepEqual(queuedIds(store), [sucessos[4]])
})

test('um aviso (WARNING) também passa na frente do que não é erro, mas nunca de um erro', () => {
  const { store } = setup({ maxVisible: 2 })
  const sucesso = store.push({ level: 'success', title: 'a' })
  const info = store.push({ level: 'info', title: 'b' })
  const aviso = store.push({ level: 'warning', title: 'Dados incompletos' })
  assert.deepEqual(ids(store), [aviso, sucesso])
  assert.deepEqual(queuedIds(store), [info])

  const erros = setup({ maxVisible: 2 })
  const e1 = erros.store.push({ level: 'error', title: '1' })
  const e2 = erros.store.push({ level: 'error', title: '2' })
  const w = erros.store.push({ level: 'warning', title: 'espera' })
  assert.deepEqual(ids(erros.store), [e1, e2])
  assert.deepEqual(queuedIds(erros.store), [w])
})

test('uma vaga que abre vai para o mais grave que espera, não para o mais antigo', () => {
  const { store } = setup({ maxVisible: 2 })
  const a = store.push({ level: 'error', title: 'a' })
  const b = store.push({ level: 'error', title: 'b' })
  const sucesso = store.push({ level: 'success', title: 'chegou primeiro' })
  const aviso = store.push({ level: 'warning', title: 'chegou depois, mas é mais grave' })
  assert.deepEqual(queuedIds(store), [aviso, sucesso])

  store.dismiss(a)
  assert.deepEqual(ids(store), [b, aviso])
  assert.deepEqual(queuedIds(store), [sucesso])
})

test('erro em espera não expira: o tempo só começa a contar quando ele aparece na tela', () => {
  const { store, scheduler } = setup({ maxVisible: 1 })
  const primeiro = store.push({ level: 'error', title: 'primeiro' })
  const segundo = store.push({ level: 'error', title: 'segundo' })
  assert.deepEqual(queuedIds(store), [segundo])
  assert.equal(scheduler.pending(), 1, 'só quem está na tela tem relógio')

  scheduler.advance(8000)
  assert.equal(everything(store).some((item) => item.id === primeiro), false, 'o primeiro expirou')
  assert.deepEqual(ids(store), [segundo], 'o segundo ocupou a vaga')
  scheduler.advance(7999)
  assert.deepEqual(ids(store), [segundo], 'e ganhou o tempo inteiro, não o que restou da espera')
  scheduler.advance(1)
  assert.deepEqual(everything(store), [])
})

test('quem espera nunca expira sozinho, por mais que a espera dure', () => {
  const { store, scheduler } = setup({ maxVisible: 1 })
  store.push({ level: 'error', title: 'ocupa a vaga', persistent: true })
  const esperando = ['error', 'warning', 'success', 'info'].map((level) => store.push({ level, title: level }))
  assert.equal(scheduler.pending(), 0)

  scheduler.advance(60 * 60_000)
  assert.deepEqual(queuedIds(store), [esperando[0], esperando[1], esperando[2], esperando[3]])
})

test('quem perde a vaga para um erro não é descartado: espera e volta com o tempo inteiro', () => {
  const { store, scheduler } = setup({ maxVisible: 1 })
  const sucesso = store.push({ level: 'success', title: 'Salvo' })
  scheduler.advance(3000)
  const erro = store.push({ level: 'error', title: 'Falha' })
  assert.deepEqual(ids(store), [erro])
  assert.deepEqual(queuedIds(store), [sucesso])
  assert.equal(scheduler.pending(), 1, 'o relógio do SUCCESS foi cancelado enquanto ele espera')

  scheduler.advance(8000)
  assert.deepEqual(ids(store), [sucesso], 'volta quando o erro sai')
  scheduler.advance(4399)
  assert.deepEqual(ids(store), [sucesso], 'com os 4400 ms inteiros, não com os 1400 que sobravam')
  scheduler.advance(1)
  assert.deepEqual(everything(store), [])
})

test('uma PROGRESS que perde a vaga continua viva: pode ser atualizada enquanto espera e volta depois', () => {
  const { store, scheduler } = setup({ maxVisible: 1 })
  const progresso = store.push({ level: 'progress', title: 'Enviando' })
  const erro = store.push({ level: 'error', title: 'Falha em outro fluxo' })
  assert.deepEqual(ids(store), [erro])
  assert.deepEqual(queuedIds(store), [progresso])

  assert.equal(store.update(progresso, { level: 'success', title: 'Enviado' }), true)
  assert.equal(scheduler.pending(), 1, 'só o erro, que está na tela, tem relógio')

  scheduler.advance(8000)
  assert.deepEqual(ids(store), [progresso])
  assert.equal(find(store, progresso).level, 'success')
  assert.equal(find(store, progresso).title, 'Enviado')
  scheduler.advance(4400)
  assert.deepEqual(everything(store), [])
})

test('uma notificação em espera que vira ERROR passa na frente de quem está na tela', () => {
  const { store, scheduler } = setup({ maxVisible: 2 })
  const s1 = store.push({ level: 'success', title: 's1', persistent: true })
  const s2 = store.push({ level: 'success', title: 's2', persistent: true })
  const progresso = store.push({ level: 'progress', title: 'Enviando' })
  assert.deepEqual(queuedIds(store), [progresso])

  store.update(progresso, { level: 'error', title: 'Falhou' })
  assert.deepEqual(ids(store), [progresso, s1])
  assert.deepEqual(queuedIds(store), [s2])
  assert.equal(scheduler.pending(), 1, 'o erro que entrou tem relógio; os persistentes não')
})

test('o cartão em uso (mouse ou foco) não é rebaixado por um erro novo, nem some quando é solto', () => {
  const { store } = setup({ maxVisible: 2 })
  const s1 = store.push({ level: 'success', title: 's1', persistent: true })
  const s2 = store.push({ level: 'success', title: 's2', persistent: true })
  assert.equal(store.pause(s2), true, 'o mouse entrou no cartão mais novo, que seria o primeiro a sair')

  const erro = store.push({ level: 'error', title: 'Falha' })
  assert.deepEqual(ids(store), [erro, s2], 'quem saiu foi o s1, que ninguém estava usando')
  assert.deepEqual(queuedIds(store), [s1])

  assert.equal(store.resume(s2), true)
  assert.deepEqual(ids(store), [erro, s2], 'ao soltar, o s2 não é trocado pelo s1: quem já está na tela fica')
})

test('o erro que esperava porque o cartão estava em uso entra na tela assim que o cartão é solto', () => {
  const { store } = setup({ maxVisible: 1 })
  const sucesso = store.push({ level: 'success', title: 'em uso', persistent: true })
  store.pause(sucesso)
  const erro = store.push({ level: 'error', title: 'Falha' })
  assert.deepEqual(ids(store), [sucesso], 'com o mouse em cima, o erro espera')
  assert.deepEqual(queuedIds(store), [erro])

  store.resume(sucesso)
  assert.deepEqual(ids(store), [erro], 'solto o cartão, o erro toma a vaga')
  assert.deepEqual(queuedIds(store), [sucesso])
})

test('na pilha, erros vêm primeiro, depois avisos, depois o resto; em cada grupo, por ordem de chegada', () => {
  const { store } = setup({ maxVisible: 10 })
  const a = store.push({ level: 'success', title: 'a' })
  const b = store.push({ level: 'warning', title: 'b' })
  const c = store.push({ level: 'error', title: 'c' })
  const d = store.push({ level: 'info', title: 'd' })
  const e = store.push({ level: 'error', title: 'e' })
  const f = store.push({ level: 'warning', title: 'f' })
  const g = store.push({ level: 'progress', title: 'g' })
  assert.deepEqual(ids(store), [c, e, b, f, a, d, g])
})

test('PROGRESS que vira SUCCESS não muda de posição; PROGRESS que vira ERROR sobe para o topo', () => {
  const { store } = setup()
  const p1 = store.push({ level: 'progress', title: '1' })
  const p2 = store.push({ level: 'progress', title: '2' })
  const p3 = store.push({ level: 'progress', title: '3' })

  store.update(p2, { level: 'success', title: 'Enviado' })
  assert.deepEqual(ids(store), [p1, p2, p3])

  store.update(p3, { level: 'error', title: 'Falhou' })
  assert.deepEqual(ids(store), [p3, p1, p2])
})

test('fechar uma notificação em espera pelo id não mexe no que está na tela', () => {
  const { store } = setup({ maxVisible: 1 })
  const naTela = store.push({ title: 'na tela' })
  const esperando = store.push({ title: 'esperando' })
  const antes = store.getSnapshot()

  assert.equal(store.dismiss(esperando), true)
  assert.deepEqual(queuedIds(store), [])
  assert.equal(store.getSnapshot(), antes, 'a lista da tela nem foi recriada')
  assert.deepEqual(ids(store), [naTela])
})

test('clear esvazia a tela e a fila, sem deixar relógio nem pausa para trás', () => {
  const { store, scheduler } = setup({ maxVisible: 2 })
  const primeiro = store.push({ level: 'error', title: 'primeiro' })
  for (let i = 0; i < 4; i += 1) store.push({ level: 'error', title: `erro ${i}` })
  store.pause(primeiro)
  assert.equal(store.getQueued().length, 3)

  assert.equal(store.clear(), true)
  assert.deepEqual(everything(store), [])
  assert.equal(scheduler.pending(), 0)
  assert.equal(store.resume(primeiro), false)
  scheduler.advance(60 * 60_000)
  assert.deepEqual(everything(store), [])
})

test('o snapshot da fila só ganha uma lista nova quando a fila muda, e o da tela só quando a tela muda', () => {
  const { store } = setup({ maxVisible: 1 })
  const a = store.push({ title: 'a' })
  store.push({ title: 'b' })
  const tela1 = store.getSnapshot()
  const fila1 = store.getQueued()

  store.update(a, { title: 'a2' })
  assert.notEqual(store.getSnapshot(), tela1, 'a tela mudou')
  assert.equal(store.getQueued(), fila1, 'a fila continua a mesma referência')

  const tela2 = store.getSnapshot()
  store.push({ title: 'c' })
  assert.equal(store.getSnapshot(), tela2, 'a tela continua a mesma referência')
  assert.notEqual(store.getQueued(), fila1, 'a fila mudou')
})

test('quem assina é avisado também quando só a fila muda', () => {
  const { store } = setup({ maxVisible: 1 })
  store.push({ title: 'na tela', persistent: true })
  let calls = 0
  store.subscribe(() => {
    calls += 1
  })
  store.push({ title: 'vai para a fila' })
  assert.equal(calls, 1)
})

// PRNG de semente fixa: a mesma sequência a cada execução, então o teste nunca é instável.
function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('sequências aleatórias: limite respeitado, relógio só para quem está na tela e nada some sem ter sido visto', () => {
  const LEVELS = ['success', 'info', 'warning', 'error', 'progress']
  const LIMIT = 3
  const severity = (item) => (item.level === 'error' ? 2 : item.level === 'warning' ? 1 : 0)

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const { store, scheduler } = setup({ maxVisible: LIMIT })
    const random = seeded(seed)
    const pick = (list) => list[Math.floor(random() * list.length)]
    const arrival = []
    const held = new Set()
    let where = ''
    let expiring = false // dentro de advance(): é a única hora em que algo pode sair sozinho
    const closing = new Set() // ids (ou '*') que o próprio teste está fechando de propósito
    let previous = new Map() // id → { item, shown } no aviso anterior

    store.subscribe(() => {
      const now = new Map()
      for (const item of store.getSnapshot()) now.set(item.id, { item, shown: true })
      for (const item of store.getQueued()) now.set(item.id, { item, shown: false })
      for (const [id, before] of previous) {
        if (now.has(id) || closing.has(id) || closing.has('*')) continue
        assert.ok(expiring, `semente ${seed}, ${where}: ${id} (${before.item.level}) sumiu sem ninguém pedir`)
        assert.ok(before.shown, `semente ${seed}, ${where}: ${id} (${before.item.level}) expirou sem estar na tela`)
        assert.notEqual(before.item.duration, null, `semente ${seed}, ${where}: ${id} não tinha duração e sumiu`)
        assert.ok(!held.has(id), `semente ${seed}, ${where}: ${id} estava em uso e expirou`)
      }
      previous = now
    })

    for (let step = 0; step < 300; step += 1) {
      const shown = store.getSnapshot()
      const alive = everything(store)
      const roll = random()
      where = `passo ${step}`
      if (roll < 0.35) {
        where += ' (push)'
        arrival.push(store.push({ level: pick(LEVELS), title: `n${step}`, persistent: random() < 0.15 }))
      } else if (roll < 0.5 && alive.length) {
        where += ' (update)'
        store.update(pick(alive).id, { level: pick(LEVELS), title: `u${step}` })
      } else if (roll < 0.6 && alive.length) {
        where += ' (dismiss)'
        const id = pick(alive).id
        closing.add(id)
        store.dismiss(id)
        closing.delete(id)
        held.delete(id)
      } else if (roll < 0.7 && shown.length && held.size < 2) {
        where += ' (pause)'
        const id = pick(shown).id
        if (store.pause(id)) held.add(id)
      } else if (roll < 0.78 && held.size) {
        where += ' (resume)'
        const id = pick([...held])
        store.resume(id)
        held.delete(id)
      } else if (roll < 0.99) {
        where += ' (advance)'
        expiring = true
        scheduler.advance(Math.floor(random() * 9000))
        expiring = false
        const aindaExistem = new Set(everything(store).map((item) => item.id))
        for (const id of [...held]) if (!aindaExistem.has(id)) held.delete(id)
      } else {
        where += ' (clear)'
        closing.add('*')
        store.clear()
        closing.delete('*')
        held.clear()
      }

      const visible = store.getSnapshot()
      const queue = store.getQueued()
      assert.ok(visible.length <= LIMIT, `semente ${seed}, ${where}: ${visible.length} na tela, limite ${LIMIT}`)
      assert.ok(Object.isFrozen(visible) && Object.isFrozen(queue), `semente ${seed}, ${where}: snapshot não congelado`)
      assert.equal(new Set([...visible, ...queue].map((item) => item.id)).size, visible.length + queue.length, `semente ${seed}, ${where}: id repetido`)
      const withClock = visible.filter((item) => item.duration !== null && !held.has(item.id)).length
      assert.equal(scheduler.pending(), withClock, `semente ${seed}, ${where}: relógios pendentes`)
      for (const waiting of queue) {
        for (const onScreen of visible) {
          if (held.has(onScreen.id)) continue
          assert.ok(severity(waiting) <= severity(onScreen), `semente ${seed}, ${where}: ${waiting.level} espera enquanto ${onScreen.level} ocupa a tela`)
        }
      }
      for (let i = 1; i < visible.length; i += 1) {
        const a = visible[i - 1]
        const b = visible[i]
        const ordered = severity(a) > severity(b) || (severity(a) === severity(b) && arrival.indexOf(a.id) < arrival.indexOf(b.id))
        assert.ok(ordered, `semente ${seed}, ${where}: ordem da pilha ${a.level}/${b.level}`)
      }
    }

    // Soltando tudo e deixando o tempo correr, a tela só retém o que não tem prazo.
    for (const id of [...held]) store.resume(id)
    held.clear()
    expiring = true
    for (let i = 0; i < 50; i += 1) scheduler.advance(10_000)
    expiring = false
    const visible = store.getSnapshot()
    assert.ok(visible.every((item) => item.duration === null), `semente ${seed}: sobrou na tela algo com prazo`)
    assert.ok(store.getQueued().length === 0 || visible.length === LIMIT, `semente ${seed}: fila parada com vaga livre`)
  }
})

// ------------------------------------------------- assinatura antiga

test('a assinatura antiga pushToast(title, message, type) segue funcionando', () => {
  const { store, api } = setup()
  const casos = [
    [['Salvo', 'Tudo certo.'], 'success'],
    [['Salvo', 'Tudo certo.', 'success'], 'success'],
    [['Falhou', 'Tente de novo.', 'error'], 'error'],
    [['Falhou', 'Tente de novo.', 'ERROR'], 'error'],
    [['Aviso', 'Revise.', 'warning'], 'warning'],
    [['Dica', 'Veja.', 'info'], 'info'],
    [['Lendo', 'Aguarde.', 'progress'], 'progress'],
  ]
  for (const [args, level] of casos) {
    const id = api.pushToast(...args)
    const item = find(store, id)
    assert.equal(item.level, level, args.join('|'))
    assert.equal(item.title, args[0])
    assert.equal(item.message, args[1])
  }
})

test('pushToast com type inválido vira INFO, nunca um falso sucesso', () => {
  const { store, api } = setup()
  assert.equal(find(store, api.pushToast('a', 'b', 'banana')).level, 'info')
  assert.equal(find(store, api.pushToast('a', 'b', 42)).level, 'info')
})

test('pushToast aceita ser chamado sem mensagem (como o app já faz em alguns lugares)', () => {
  const { store, api } = setup()
  const id = api.pushToast('Somente título')
  assert.equal(find(store, id).message, '')
})

// -------------------------------------------------- valores inválidos

test('nível inválido cai em INFO; nível vazio cai em SUCCESS', () => {
  const { store } = setup()
  for (const level of ['banana', 42, {}, []]) {
    assert.equal(find(store, store.push({ level })).level, 'info', String(level))
  }
  for (const level of [undefined, null, '']) {
    assert.equal(find(store, store.push({ level })).level, 'success', String(level))
  }
})

test('título e mensagem inválidos viram texto vazio, sem lançar', () => {
  const { store } = setup()
  const id = store.push({ title: { a: 1 }, message: ['x'] })
  assert.equal(find(store, id).title, '')
  assert.equal(find(store, id).message, '')

  const numeros = store.push({ title: 42, message: 7.5 })
  assert.equal(find(store, numeros).title, '42')
  assert.equal(find(store, numeros).message, '7.5')

  const aparado = store.push({ title: '  Salvo  ', message: '   ' })
  assert.equal(find(store, aparado).title, 'Salvo')
  assert.equal(find(store, aparado).message, '')
})

test('duration inválida usa o padrão do nível', () => {
  for (const duration of [NaN, -5, 0, '3000', Infinity, null, undefined, {}]) {
    const { store, scheduler } = setup()
    const id = store.push({ level: 'info', duration })
    assert.equal(find(store, id).duration, LEVEL_META.info.duration, String(duration))
    scheduler.advance(LEVEL_META.info.duration)
    assert.equal(find(store, id), undefined)
  }
})

test('entrada que não é objeto é ignorada e devolve null', () => {
  const { store, scheduler } = setup()
  for (const input of [undefined, null, 'texto', 42, true]) {
    assert.equal(store.push(input), null, String(input))
  }
  assert.equal(store.getSnapshot().length, 0)
  assert.equal(scheduler.pending(), 0)
})

test('id inválido é substituído por um id gerado', () => {
  const { store } = setup()
  const a = store.push({ id: '', title: 'a' })
  const b = store.push({ id: {}, title: 'b' })
  const c = store.push({ id: '   ', title: 'c' })
  assert.equal(new Set([a, b, c]).size, 3)
  assert.ok([a, b, c].every((id) => typeof id === 'string' && id.length > 0))
})

test('um id gerado nunca colide com um id escolhido pelo chamador', () => {
  const { store } = setup()
  store.push({ id: 'n-1' })
  const gerado = store.push({ title: 'x' })
  assert.notEqual(gerado, 'n-1')
  assert.equal(store.getSnapshot().length, 2)
})

test('operações com id inválido ou desconhecido devolvem false e não lançam', () => {
  const { store } = setup()
  store.push({ title: 'A' })
  for (const id of [undefined, null, {}, '', 'nao-existe']) {
    assert.equal(store.dismiss(id), false)
    assert.equal(store.update(id, { title: 'x' }), false)
    assert.equal(store.pause(id), false)
    assert.equal(store.resume(id), false)
  }
  assert.equal(store.update(ids(store)[0], null), false)
  assert.equal(store.update(ids(store)[0], 'texto'), false)
})

test('opções inválidas do store caem nos padrões', () => {
  const { store } = setup({ durations: 'x', maxVisible: -1 })
  for (let i = 0; i < DEFAULT_MAX_VISIBLE + 2; i += 1) store.push({ title: String(i) })
  assert.equal(store.getSnapshot().length, DEFAULT_MAX_VISIBLE)
  assert.equal(createNotificationStore('lixo').getSnapshot().length, 0)
  assert.equal(createNotificationStore(null).getSnapshot().length, 0)
})

// -------------------------------------------------------- snapshot

test('o snapshot mantém a referência enquanto nada muda, é novo a cada mudança e é imutável', () => {
  const { store } = setup()
  const vazio = store.getSnapshot()
  assert.equal(store.getSnapshot(), vazio)

  const id = store.push({ title: 'A' })
  const um = store.getSnapshot()
  assert.notEqual(um, vazio)
  assert.equal(store.getSnapshot(), um)

  store.update(id, { title: 'B' })
  assert.notEqual(store.getSnapshot(), um)
  assert.equal(um[0].title, 'A', 'o snapshot antigo não foi alterado')

  assert.ok(Object.isFrozen(store.getSnapshot()[0]))
  assert.throws(() => {
    'use strict'
    store.getSnapshot()[0].title = 'hack'
  }, TypeError)
})

// -------------------------------------- snapshots protegidos contra mutação (C-7)

test('os snapshots da tela e da fila são congelados: nenhum consumidor altera a lista por dentro', () => {
  const { store } = setup({ maxVisible: 1 })
  assert.ok(Object.isFrozen(store.getSnapshot()), 'lista da tela, ainda vazia')
  assert.ok(Object.isFrozen(store.getQueued()), 'lista da fila, ainda vazia')

  store.push({ title: 'na tela' })
  store.push({ title: 'na fila' })
  for (const [nome, lista] of [['tela', store.getSnapshot()], ['fila', store.getQueued()]]) {
    assert.ok(Object.isFrozen(lista), nome)
    assert.throws(() => lista.push({ id: 'intruso', level: 'error' }), TypeError, `${nome}: push`)
    assert.throws(() => lista.pop(), TypeError, `${nome}: pop`)
    assert.throws(() => lista.splice(0, 1), TypeError, `${nome}: splice`)
    assert.throws(() => {
      lista[0] = null
    }, TypeError, `${nome}: atribuição`)
  }
  assert.equal(store.getSnapshot().length, 1)
  assert.equal(store.getQueued().length, 1)
})

test('depois de qualquer operação, o snapshot novo também nasce congelado', () => {
  const { store, scheduler } = setup({ maxVisible: 2 })
  const congelados = (rotulo) => {
    assert.ok(Object.isFrozen(store.getSnapshot()), `${rotulo}: tela`)
    assert.ok(Object.isFrozen(store.getQueued()), `${rotulo}: fila`)
  }
  const a = store.push({ title: 'a' })
  congelados('push')
  store.push({ title: 'b' })
  store.push({ title: 'c' })
  congelados('push que vai para a fila')
  store.update(a, { title: 'a2' })
  congelados('update')
  store.pause(a)
  store.resume(a)
  congelados('pausa e retomada')
  store.dismiss(a)
  congelados('dismiss')
  scheduler.advance(60_000)
  congelados('expiração')
  store.push({ title: 'd' })
  store.clear()
  congelados('clear')
})

// ------------------------------------------------ durações extremas (C-6)

test('duração gigante é limitada ao máximo do setTimeout (2^31 - 1 ms) em vez de estourar', () => {
  const MAX = 2147483647
  const build = (extra) => {
    const scheduler = createFakeScheduler()
    const delays = []
    const store = createNotificationStore({
      now: scheduler.now,
      setTimer: (callback, ms) => {
        delays.push(ms)
        return scheduler.setTimer(callback, ms)
      },
      clearTimer: scheduler.clearTimer,
      ...extra,
    })
    return { store, delays }
  }

  const porNotificacao = build()
  porNotificacao.store.push({ level: 'info', title: 'a', duration: 3e9 })
  porNotificacao.store.push({ level: 'info', title: 'b', duration: Number.MAX_SAFE_INTEGER })
  porNotificacao.store.push({ level: 'info', title: 'c', duration: MAX + 1 })
  porNotificacao.store.push({ level: 'info', title: 'd', duration: MAX })
  assert.deepEqual(porNotificacao.delays, [MAX, MAX, MAX, MAX], 'limitada ao máximo, sem cair no padrão do nível')

  const porStore = build({ durations: { success: 3e9 } })
  porStore.store.push({ level: 'success', title: 'e' })
  assert.deepEqual(porStore.delays, [MAX], 'o padrão configurado no store também é limitado')

  const naAtualizacao = build()
  const id = naAtualizacao.store.push({ level: 'progress', title: 'f' })
  naAtualizacao.store.update(id, { level: 'info', duration: 5e12 })
  assert.deepEqual(naAtualizacao.delays, [MAX], 'e o update também')
})

test('com timers de verdade, uma duração gigante não gera TimeoutOverflowWarning nem expira na hora', async () => {
  const avisos = []
  const aoAvisar = (aviso) => avisos.push(`${aviso.name}: ${aviso.message}`)
  process.on('warning', aoAvisar)
  const store = createNotificationStore()
  try {
    const id = store.push({ level: 'info', title: 'longa', duration: 3e9 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok(find(store, id), 'continua na tela 50 ms depois')
    assert.deepEqual(avisos, [])
    store.dismiss(id)
  } finally {
    process.off('warning', aoAvisar)
    store.clear()
  }
})

test('subscribe avisa a cada mudança, inclusive expiração, e para de avisar após cancelar', () => {
  const { store, scheduler } = setup()
  let calls = 0
  const unsubscribe = store.subscribe(() => {
    calls += 1
  })

  const id = store.push({ title: 'A' })
  assert.equal(calls, 1)
  store.update(id, { title: 'B' })
  assert.equal(calls, 2)
  store.push({ title: 'C' })
  assert.equal(calls, 3)
  scheduler.advance(LEVEL_META.success.duration)
  assert.equal(calls, 5, 'as duas expirações avisaram')

  unsubscribe()
  store.push({ title: 'D' })
  assert.equal(calls, 5)

  assert.equal(typeof store.subscribe('não é função'), 'function')
})

// ------------------------------------------------------ pausa / retomada

test('pause congela a contagem e resume retoma com o tempo que faltava', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'success', title: 'A' })

  scheduler.advance(1000)
  assert.equal(store.pause(id), true)
  assert.equal(scheduler.pending(), 0)
  assert.equal(store.pause(id), false, 'já estava pausada')

  scheduler.advance(60_000)
  assert.ok(find(store, id), 'pausada, não expira')

  assert.equal(store.resume(id), true)
  assert.equal(store.resume(id), false, 'já estava rodando')
  scheduler.advance(LEVEL_META.success.duration - 1000 - 1)
  assert.ok(find(store, id))
  scheduler.advance(1)
  assert.equal(find(store, id), undefined)
})

test('pausa e retomada devolvem true só quando algo mudou, inclusive numa PROGRESS (que não tem timer)', () => {
  const { store } = setup()
  const id = store.push({ level: 'progress', title: 'P' })
  assert.equal(store.resume(id), false, 'ninguém estava segurando')
  assert.equal(store.pause(id), true)
  assert.equal(store.pause(id), false, 'já estava segurada')
  assert.equal(store.resume(id), true)
  assert.equal(store.resume(id), false)
})

// ------------------------------------------- pausa que sobrevive à troca de nível (C-4)

test('PROGRESS segurada (mouse ou foco) que vira SUCCESS continua segura: não some debaixo do usuário', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'progress', title: 'Enviando' })
  store.pause(id)

  store.update(id, { level: 'success', title: 'Enviado' })
  assert.equal(scheduler.pending(), 0, 'o SUCCESS nasce pausado')
  scheduler.advance(60_000)
  assert.ok(find(store, id), 'e continua na tela enquanto o mouse ou o foco estiverem nele')

  assert.equal(store.resume(id), true)
  scheduler.advance(LEVEL_META.success.duration - 1)
  assert.ok(find(store, id), 'ao soltar, o SUCCESS ganha o tempo inteiro')
  scheduler.advance(1)
  assert.equal(find(store, id), undefined)
})

test('PROGRESS que foi solta antes de concluir vira SUCCESS e expira normalmente', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'progress', title: 'Enviando' })
  store.pause(id)
  store.resume(id)

  store.update(id, { level: 'success', title: 'Enviado' })
  assert.equal(scheduler.pending(), 1)
  scheduler.advance(LEVEL_META.success.duration)
  assert.equal(find(store, id), undefined)
})

test('notificação segurada que vira ERROR também fica segura, e solta recebe os 8 s inteiros', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'progress', title: 'Enviando' })
  store.pause(id)
  store.update(id, { level: 'error', title: 'Falhou' })
  scheduler.advance(60_000)
  assert.ok(find(store, id))
  store.resume(id)
  scheduler.advance(LEVEL_META.error.duration - 1)
  assert.ok(find(store, id))
  scheduler.advance(1)
  assert.equal(find(store, id), undefined)
})

test('fechada ou limpa, a notificação esquece a pausa: um id reaproveitado não nasce preso', () => {
  const dismissed = setup()
  dismissed.store.push({ id: 'envio', level: 'progress', title: 'Enviando' })
  dismissed.store.pause('envio')
  dismissed.store.dismiss('envio')
  dismissed.store.push({ id: 'envio', level: 'success', title: 'De novo' })
  assert.equal(dismissed.scheduler.pending(), 1, 'depois de dismiss')

  const cleared = setup()
  cleared.store.push({ id: 'envio', level: 'progress', title: 'Enviando' })
  cleared.store.pause('envio')
  cleared.store.clear()
  cleared.store.push({ id: 'envio', level: 'success', title: 'De novo' })
  assert.equal(cleared.scheduler.pending(), 1, 'depois de clear')

  const expired = setup()
  expired.store.push({ id: 'aviso', level: 'info', title: 'Aviso' })
  expired.store.pause('aviso')
  expired.store.resume('aviso')
  expired.scheduler.advance(LEVEL_META.info.duration)
  expired.store.push({ id: 'aviso', level: 'info', title: 'Outro' })
  assert.equal(expired.scheduler.pending(), 1, 'depois de expirar')
})

test('atualizar uma notificação pausada mantém a pausa e dá o tempo inteiro ao retomar', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'success', title: 'A' })
  scheduler.advance(3000)
  store.pause(id)
  store.update(id, { title: 'B' })
  assert.equal(scheduler.pending(), 0, 'continua pausada')

  store.resume(id)
  scheduler.advance(LEVEL_META.success.duration - 1)
  assert.ok(find(store, id))
  scheduler.advance(1)
  assert.equal(find(store, id), undefined)
})

// ----------------------------------------------------------- limpeza

test('clear cancela todos os timers pendentes e nada dispara depois', () => {
  const { store, scheduler } = setup()
  let calls = 0
  store.push({ level: 'success', title: '1' })
  store.push({ level: 'error', title: '2' })
  store.push({ level: 'info', title: '3' })
  store.push({ level: 'progress', title: '4' })
  assert.equal(scheduler.pending(), 3)
  store.subscribe(() => {
    calls += 1
  })

  assert.equal(store.clear(), true)
  assert.equal(scheduler.pending(), 0)
  assert.equal(store.getSnapshot().length, 0)
  assert.equal(calls, 1)

  scheduler.advance(60 * 60_000)
  assert.equal(calls, 1, 'nenhum timer disparou depois do clear')
  assert.equal(store.clear(), false, 'segundo clear: nada a limpar')
  assert.equal(calls, 1)
})

test('clear também cancela timers pausados', () => {
  const { store, scheduler } = setup()
  const id = store.push({ title: 'A' })
  store.pause(id)
  assert.equal(store.clear(), true)
  assert.equal(store.resume(id), false)
  scheduler.advance(60_000)
  assert.equal(store.getSnapshot().length, 0)
})

test('atualizar substitui o timer antigo em vez de acumular timers', () => {
  const { store, scheduler } = setup()
  const id = store.push({ title: 'A' })
  for (let i = 0; i < 10; i += 1) store.update(id, { title: `A${i}` })
  assert.equal(scheduler.pending(), 1)
  scheduler.advance(LEVEL_META.success.duration)
  assert.equal(store.getSnapshot().length, 0)
  assert.equal(scheduler.pending(), 0)
})

test('depois de expirar ou fechar, não sobra timer para trás', () => {
  const { store, scheduler } = setup()
  store.push({ level: 'success' })
  store.push({ level: 'error' })
  const fechada = store.push({ level: 'info' })
  store.dismiss(fechada)
  scheduler.advance(60_000)
  assert.equal(store.getSnapshot().length, 0)
  assert.equal(scheduler.pending(), 0)
})

// ------------------------------------------------------- timers padrão

test('sem agendador injetado, usa setTimeout/Date.now de verdade (aqui simulados pelo node:test)', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    const store = createNotificationStore()
    const id = store.push({ title: 'A' })
    mock.timers.tick(LEVEL_META.success.duration - 1)
    assert.ok(find(store, id))
    mock.timers.tick(1)
    assert.equal(find(store, id), undefined)

    const fechada = store.push({ title: 'B' })
    store.dismiss(fechada)
    mock.timers.tick(60_000)
    assert.equal(store.getSnapshot().length, 0)
  } finally {
    mock.timers.reset()
  }
})
