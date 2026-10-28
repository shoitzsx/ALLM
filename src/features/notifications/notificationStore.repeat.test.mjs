import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNotificationStore } from './notificationStore.js'
import { createNotificationApi } from './notificationApi.js'

// Agendador falso (o mesmo de notificationStore.test.mjs): o tempo só anda quando o teste manda.
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

const ids = (store) => store.getSnapshot().map((item) => item.id)
const queuedIds = (store) => store.getQueued().map((item) => item.id)
const everything = (store) => [...store.getSnapshot(), ...store.getQueued()]
const find = (store, id) => everything(store).find((item) => item.id === id)

// ---------------------------------------------------------------- repetição (R-9)

test('a mesma notificação repetida vira uma só, com contador, e mantém o id e o nível', () => {
  const { store } = setup()
  const first = store.push({ level: 'error', title: 'Falha de rede', message: 'Tente novamente.' })
  const second = store.push({ level: 'error', title: 'Falha de rede', message: 'Tente novamente.' })
  const third = store.push({ level: 'error', title: 'Falha de rede', message: 'Tente novamente.' })

  assert.equal(second, first, 'devolve o id da que já existe')
  assert.equal(third, first)
  assert.equal(everything(store).length, 1)
  const item = find(store, first)
  assert.equal(item.count, 3)
  assert.equal(item.level, 'error')
  assert.equal(item.message, 'Tente novamente.')
})

test('toda notificação nasce com contador 1', () => {
  const { store } = setup()
  const id = store.push({ level: 'info', title: 'Oi' })
  assert.equal(find(store, id).count, 1)
})

test('erros diferentes NÃO são agrupados só por terem o mesmo título', () => {
  const { store } = setup()
  store.push({ level: 'error', title: 'Não foi possível salvar', message: 'Campo fornecedor vazio.' })
  store.push({ level: 'error', title: 'Não foi possível salvar', message: 'Sem conexão.' })
  store.push({ level: 'error', title: 'Não foi possível salvar', message: 'Campo fornecedor vazio.' })

  assert.equal(everything(store).length, 2, 'duas mensagens distintas continuam distintas')
  assert.deepEqual(everything(store).map((item) => item.count).sort(), [1, 2])
})

test('mesmo texto em níveis diferentes não é agrupado', () => {
  const { store } = setup()
  // persistent nos dois: a duração fica igual (nula) e só o nível distingue as duas
  store.push({ level: 'warning', title: 'Revise', message: 'Dados incompletos.', persistent: true })
  store.push({ level: 'error', title: 'Revise', message: 'Dados incompletos.', persistent: true })
  assert.equal(everything(store).length, 2)
})

test('PROGRESS nunca é agrupada: cada operação em andamento é independente', () => {
  const { store } = setup()
  const a = store.push({ level: 'progress', title: 'Lendo NF-e…' })
  const b = store.push({ level: 'progress', title: 'Lendo NF-e…' })
  assert.notEqual(a, b)
  assert.equal(everything(store).length, 2)
  assert.equal(find(store, a).count, 1)
})

test('quem informa um id explícito continua atualizando a existente, sem contar ocorrência', () => {
  const { store } = setup()
  store.push({ id: 'x', level: 'info', title: 'Igual' })
  store.push({ id: 'x', level: 'info', title: 'Igual' })
  assert.equal(find(store, 'x').count, 1)
  // e um id novo com texto igual ao de outra notificação é outra notificação, não uma repetição
  const other = store.push({ id: 'y', level: 'info', title: 'Igual' })
  assert.equal(other, 'y')
  assert.equal(everything(store).length, 2)
  assert.equal(find(store, 'x').count, 1)
})

test('a duração diferente (persistente x temporária) separa notificações de texto igual', () => {
  const { store } = setup()
  store.push({ level: 'error', title: 'Falha', message: 'Igual', persistent: true })
  store.push({ level: 'error', title: 'Falha', message: 'Igual' })
  assert.equal(everything(store).length, 2)
})

test('cada repetição recomeça a contagem: o tempo conta a partir da última ocorrência', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', message: 'Igual', duration: 1000 })
  scheduler.advance(800)
  store.push({ level: 'error', title: 'Falha', message: 'Igual', duration: 1000 })
  scheduler.advance(800) // 1600 ms desde a primeira, 800 desde a última
  assert.ok(find(store, id), 'ainda está na tela')
  assert.equal(find(store, id).count, 2)
  scheduler.advance(300)
  assert.equal(find(store, id), undefined)
})

test('repetir uma notificação em uso (mouse/foco) mantém a pausa', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'warning', title: 'Atenção', duration: 1000 })
  store.pause(id)
  store.push({ level: 'warning', title: 'Atenção', duration: 1000 })
  scheduler.advance(5000)
  assert.equal(find(store, id).count, 2)
  store.resume(id)
  scheduler.advance(999)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('repetir uma notificação que espera na fila só aumenta o contador dela', () => {
  const { store, scheduler } = setup()
  for (let n = 0; n < 5; n += 1) store.push({ level: 'error', title: `Persistente ${n}`, persistent: true })
  const waiting = store.push({ level: 'error', title: 'Na fila', message: 'x' })
  assert.deepEqual(queuedIds(store), [waiting])
  store.push({ level: 'error', title: 'Na fila', message: 'x' })
  store.push({ level: 'error', title: 'Na fila', message: 'x' })

  assert.deepEqual(queuedIds(store), [waiting], 'continua uma só entrada')
  assert.equal(store.getQueued()[0].count, 3)
  assert.equal(scheduler.pending(), 0, 'quem espera continua sem relógio')
})

test('repetir não troca a ordem de exibição nem tira ninguém da tela', () => {
  const { store } = setup()
  const a = store.push({ level: 'error', title: 'A' })
  const b = store.push({ level: 'error', title: 'B' })
  const c = store.push({ level: 'warning', title: 'C' })
  store.push({ level: 'error', title: 'A' })
  assert.deepEqual(ids(store), [a, b, c])
})

test('a repetição troca a referência do item (o React precisa redesenhar) e congela o novo objeto', () => {
  const { store } = setup()
  store.push({ level: 'info', title: 'Oi' })
  const before = store.getSnapshot()
  store.push({ level: 'info', title: 'Oi' })
  const after = store.getSnapshot()
  assert.notEqual(before, after)
  assert.notEqual(before[0], after[0])
  assert.ok(Object.isFrozen(after[0]))
  assert.ok(Object.isFrozen(after))
})

test('fechar uma notificação agrupada fecha todas as ocorrências; a próxima começa de novo em 1', () => {
  const { store } = setup()
  const id = store.push({ level: 'success', title: 'Salvo' })
  store.push({ level: 'success', title: 'Salvo' })
  store.dismiss(id)
  assert.equal(everything(store).length, 0)
  const again = store.push({ level: 'success', title: 'Salvo' })
  assert.equal(find(store, again).count, 1)
})

test('alterar o texto de uma notificação agrupada zera o contador: já não são ocorrências iguais', () => {
  const { store } = setup()
  const id = store.push({ level: 'error', title: 'Falha', message: 'a' })
  store.push({ level: 'error', title: 'Falha', message: 'a' })
  store.update(id, { message: 'b' })
  assert.equal(find(store, id).count, 1)
  // atualizar só a duração mantém a contagem
  store.push({ level: 'error', title: 'Falha', message: 'b' })
  store.update(id, { duration: 5000 })
  assert.equal(find(store, id).count, 2)
})

test('erros distintos continuam todos acessíveis mesmo com muitas repetições no meio', () => {
  const { store } = setup()
  for (let round = 0; round < 20; round += 1) {
    for (let kind = 0; kind < 8; kind += 1) store.push({ level: 'error', title: `Erro ${kind}`, message: `causa ${kind}` })
  }
  assert.equal(everything(store).length, 8, 'oito erros distintos, nenhum descartado')
  assert.ok(everything(store).every((item) => item.count === 20))
})

test('o atalho pushToast da API antiga também agrupa', () => {
  const { store, api } = setup()
  const a = api.pushToast('Perfil demonstrativo', 'Texto', 'info')
  const b = api.pushToast('Perfil demonstrativo', 'Texto', 'info')
  assert.equal(a, b)
  assert.equal(find(store, a).count, 2)
})

// ---------------------------------------------------------------- aba em segundo plano

test('aba oculta congela os timers e preserva o tempo que faltava', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', duration: 8000 })
  scheduler.advance(3000)
  assert.equal(store.setPageVisible(false), true)
  assert.equal(scheduler.pending(), 0, 'nenhum relógio corre com a aba oculta')
  scheduler.advance(120_000)
  assert.ok(find(store, id), 'não expirou escondida')

  assert.equal(store.setPageVisible(true), true)
  scheduler.advance(4999)
  assert.ok(find(store, id), 'faltavam 5000 ms')
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('setPageVisible só devolve true quando o estado muda, e ocultar duas vezes não desconta o tempo duas vezes', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'info', title: 'Oi', duration: 5000 })
  assert.equal(store.setPageVisible(true), false, 'já estava visível')
  scheduler.advance(1000)
  assert.equal(store.setPageVisible(false), true)
  scheduler.advance(1000)
  assert.equal(store.setPageVisible(false), false)
  assert.equal(store.setPageVisible(true), true)
  scheduler.advance(3999)
  assert.ok(find(store, id), 'faltavam 4000 ms')
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('notificação criada com a aba oculta recebe o tempo inteiro só quando a aba volta', () => {
  const { store, scheduler } = setup()
  store.setPageVisible(false)
  const id = store.push({ level: 'warning', title: 'Chegou escondida', duration: 4000 })
  scheduler.advance(60_000)
  assert.ok(find(store, id))
  assert.equal(scheduler.pending(), 0)
  store.setPageVisible(true)
  scheduler.advance(3999)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('aba oculta e pausa por mouse/foco são independentes: a aba voltar não solta quem está em uso', () => {
  const { store, scheduler } = setup()
  const held = store.push({ level: 'warning', title: 'Em uso', duration: 2000 })
  const free = store.push({ level: 'warning', title: 'Solta', duration: 2000 })
  store.pause(held)
  scheduler.advance(500)
  store.setPageVisible(false)
  store.setPageVisible(true)
  scheduler.advance(1501)
  assert.equal(find(store, free), undefined, 'a solta seguiu o tempo (faltavam 1500)')
  assert.ok(find(store, held), 'a em uso continua parada')
  scheduler.advance(60_000)
  assert.ok(find(store, held))
  store.resume(held)
  scheduler.advance(1999)
  assert.ok(find(store, held), 'faltavam 2000 ms (parou com o tempo inteiro)')
  scheduler.advance(2)
  assert.equal(find(store, held), undefined)
})

test('soltar o mouse com a aba oculta não religa o relógio; ele só corre quando a aba volta', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'X', duration: 3000 })
  store.pause(id)
  store.setPageVisible(false)
  store.resume(id)
  assert.equal(scheduler.pending(), 0)
  scheduler.advance(60_000)
  assert.ok(find(store, id))
  store.setPageVisible(true)
  scheduler.advance(2999)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('prender a notificação com a aba oculta (foco que chega) e a aba voltar mantém a pausa', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'X', duration: 3000 })
  store.setPageVisible(false)
  store.pause(id)
  store.setPageVisible(true)
  scheduler.advance(60_000)
  assert.ok(find(store, id), 'segura pelo foco')
  store.resume(id)
  scheduler.advance(3001)
  assert.equal(find(store, id), undefined)
})

test('PROGRESS não é afetada pela aba oculta e, ao concluir escondida, o SUCCESS recebe o tempo inteiro ao voltar', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'progress', title: 'Lendo…' })
  store.setPageVisible(false)
  scheduler.advance(300_000)
  assert.ok(find(store, id), 'PROGRESS segue viva')
  store.update(id, { level: 'success', title: 'Pronto', duration: 2000 })
  scheduler.advance(300_000)
  assert.ok(find(store, id), 'o SUCCESS ainda não teve tempo de ser visto')
  store.setPageVisible(true)
  scheduler.advance(1999)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('quem sai da fila com a aba oculta entra na tela com o relógio parado', () => {
  const { store, scheduler } = setup()
  const first = []
  for (let n = 0; n < 5; n += 1) first.push(store.push({ level: 'warning', title: `E${n}`, duration: 1000 }))
  const waiting = store.push({ level: 'warning', title: 'Esperava', duration: 1000 })
  assert.deepEqual(queuedIds(store), [waiting])
  scheduler.advance(500)
  store.setPageVisible(false)
  store.dismiss(first[0])
  assert.deepEqual(queuedIds(store), [])
  scheduler.advance(120_000)
  assert.ok(find(store, waiting), 'entrou escondida e não expirou')
  store.setPageVisible(true)
  scheduler.advance(999)
  assert.ok(find(store, waiting), 'tempo inteiro desde que a aba voltou')
  scheduler.advance(2)
  assert.equal(find(store, waiting), undefined)
})

test('repetir uma notificação com a aba oculta recomeça a contagem, parada, até a aba voltar', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', duration: 2000 })
  store.setPageVisible(false)
  store.push({ level: 'error', title: 'Falha', duration: 2000 })
  assert.equal(scheduler.pending(), 0)
  store.setPageVisible(true)
  scheduler.advance(1999)
  assert.equal(find(store, id).count, 2)
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('clear com a aba oculta não deixa timer nem pausa para trás', () => {
  const { store, scheduler } = setup()
  store.push({ level: 'error', title: 'A', duration: 1000 })
  store.setPageVisible(false)
  store.clear()
  store.setPageVisible(true)
  assert.equal(scheduler.pending(), 0)
  const id = store.push({ level: 'info', title: 'Nova', duration: 1000 })
  scheduler.advance(1001)
  assert.equal(find(store, id), undefined)
})

test('várias idas e vindas da aba preservam o tempo restante com exatidão', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'X', duration: 10_000 })
  let elapsed = 0
  for (const slice of [1000, 700, 2300, 400]) {
    scheduler.advance(slice)
    elapsed += slice
    store.setPageVisible(false)
    scheduler.advance(50_000)
    store.setPageVisible(true)
  }
  scheduler.advance(10_000 - elapsed - 1)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

// ---------------------------------------------------------------- tempo mínimo de um erro ao voltar à aba

test('erro com menos de 2 s restantes fica pelo menos 2 s depois que a aba volta', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', duration: 8000 })
  scheduler.advance(7500) // sobram 500 ms
  store.setPageVisible(false)
  scheduler.advance(60_000)
  store.setPageVisible(true)
  scheduler.advance(1999)
  assert.ok(find(store, id), 'ganhou o piso de 2 s')
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('erro com mais de 2 s restantes mantém o tempo restante exato (o piso nunca encurta nem alonga)', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', duration: 8000 })
  scheduler.advance(3000) // sobram 5000 ms
  store.setPageVisible(false)
  store.setPageVisible(true)
  scheduler.advance(4999)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('erro com exatamente 2 s restantes não é alterado', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', duration: 8000 })
  scheduler.advance(6000)
  store.setPageVisible(false)
  store.setPageVisible(true)
  scheduler.advance(1999)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('o piso vale só para ERROR: um aviso com pouco tempo continua com o que sobrava', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'warning', title: 'Atenção', duration: 6000 })
  scheduler.advance(5500)
  store.setPageVisible(false)
  store.setPageVisible(true)
  scheduler.advance(499)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('eventos de visibilidade repetidos não reiniciam o piso: só a volta real conta', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', duration: 8000 })
  scheduler.advance(7800)
  store.setPageVisible(false)
  assert.equal(store.setPageVisible(true), true)
  scheduler.advance(1000)
  assert.equal(store.setPageVisible(true), false, 'evento duplicado é ignorado')
  assert.equal(store.setPageVisible(true), false)
  scheduler.advance(999)
  assert.ok(find(store, id), 'ainda dentro dos 2 s desde a volta')
  scheduler.advance(2)
  assert.equal(find(store, id), undefined, 'os 2 s não foram renovados pelos eventos duplicados')
})

test('ocultar duas vezes seguidas não gera piso nem desconta tempo a mais', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', duration: 3000 })
  scheduler.advance(1000) // sobram 2000
  store.setPageVisible(false)
  store.setPageVisible(false)
  store.setPageVisible(true)
  scheduler.advance(1999)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('erro em uso (mouse/foco) não ganha o piso: o comportamento da pausa continua o mesmo', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', duration: 8000 })
  scheduler.advance(7500) // sobram 500 ms
  store.pause(id)
  store.setPageVisible(false)
  store.setPageVisible(true)
  scheduler.advance(60_000)
  assert.ok(find(store, id), 'segura enquanto estiver em uso')
  store.resume(id)
  scheduler.advance(499)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined, 'ao soltar, corre só os 500 ms que sobravam')
})

test('erro criado com a aba oculta e duração curta também recebe o piso de 2 s ao voltar', () => {
  const { store, scheduler } = setup()
  store.setPageVisible(false)
  const id = store.push({ level: 'error', title: 'Rápido', duration: 800 })
  store.setPageVisible(true)
  scheduler.advance(1999)
  assert.ok(find(store, id))
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('PROGRESS não é afetada pelo piso, e a que vira ERROR escondida recebe o tempo de erro inteiro', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'progress', title: 'Lendo…' })
  store.setPageVisible(false)
  store.setPageVisible(true)
  scheduler.advance(120_000)
  assert.ok(find(store, id), 'PROGRESS segue viva')
  store.setPageVisible(false)
  store.update(id, { level: 'error', title: 'Falhou' })
  store.setPageVisible(true)
  scheduler.advance(7999)
  assert.ok(find(store, id), 'o erro novo tem os 8 s do nível')
  scheduler.advance(2)
  assert.equal(find(store, id), undefined)
})

test('sem nunca ter ficado oculto, nada muda: erro com pouco tempo expira no prazo', () => {
  const { store, scheduler } = setup()
  const id = store.push({ level: 'error', title: 'Falha', duration: 8000 })
  scheduler.advance(7500)
  assert.equal(store.setPageVisible(true), false)
  scheduler.advance(501)
  assert.equal(find(store, id), undefined)
})

// ---------------------------------------------------------------- limite de tela ajustável (telas baixas)

test('setMaxVisible reduz a tela: os menos graves e mais novos vão para a fila, nada é descartado', () => {
  const { store } = setup()
  const w1 = store.push({ level: 'warning', title: 'W1', persistent: true })
  const e1 = store.push({ level: 'error', title: 'E1', persistent: true })
  const s1 = store.push({ level: 'success', title: 'S1', persistent: true })
  const e2 = store.push({ level: 'error', title: 'E2', persistent: true })
  const w2 = store.push({ level: 'warning', title: 'W2', persistent: true })

  assert.equal(store.setMaxVisible(2), true)
  assert.deepEqual(ids(store), [e1, e2], 'ficam os erros')
  assert.deepEqual(queuedIds(store), [w1, w2, s1], 'o resto espera, por gravidade e chegada')
  assert.equal(everything(store).length, 5)
})

test('setMaxVisible maior promove quem esperava, com o tempo inteiro', () => {
  const { store, scheduler } = setup({ maxVisible: 1 })
  store.push({ level: 'info', title: 'A', persistent: true }) // segura a única vaga: B espera
  const b = store.push({ level: 'info', title: 'B', duration: 1000 })
  assert.deepEqual(queuedIds(store), [b])
  scheduler.advance(60_000)
  assert.ok(find(store, b), 'esperando não expira')
  assert.equal(store.setMaxVisible(2), true)
  assert.deepEqual(queuedIds(store), [])
  scheduler.advance(999)
  assert.ok(find(store, b))
  scheduler.advance(2)
  assert.equal(find(store, b), undefined)
})

test('quem volta para a fila perde o relógio (não expira escondido) e PROGRESS continua viva e atualizável', () => {
  const { store, scheduler } = setup()
  const p = store.push({ level: 'progress', title: 'Enviando…' })
  const e = store.push({ level: 'error', title: 'Erro', duration: 1000 })
  const i = store.push({ level: 'info', title: 'Info', duration: 1000 })
  store.setMaxVisible(1)
  assert.deepEqual(ids(store), [e])
  assert.equal(scheduler.pending(), 1, 'só o erro, que está na tela, tem relógio')
  scheduler.advance(120_000)
  assert.equal(find(store, e), undefined, 'o erro expirou na tela')
  assert.ok(find(store, p) && find(store, i), 'quem esperava continua vivo')
  assert.equal(store.update(p, { title: 'Enviando 2…' }), true, 'PROGRESS na fila pode ser atualizada')
})

test('item em uso (mouse/foco) nunca é rebaixado pelo novo limite; ao soltar, o excesso é rebaixado', () => {
  const { store } = setup()
  const a = store.push({ level: 'info', title: 'A', persistent: true })
  const b = store.push({ level: 'info', title: 'B', persistent: true })
  const c = store.push({ level: 'info', title: 'C', persistent: true })
  store.pause(a)
  store.pause(b)
  store.setMaxVisible(1)
  assert.deepEqual(ids(store), [a, b], 'os dois em uso ficam, mesmo acima do limite')
  assert.deepEqual(queuedIds(store), [c])
  store.resume(b)
  assert.deepEqual(ids(store), [a], 'solto, o excedente vai para a fila')
  assert.deepEqual(queuedIds(store), [b, c])
})

test('setMaxVisible ignora valores inválidos e devolve false quando nada muda', () => {
  const { store } = setup()
  store.push({ level: 'info', title: 'A', persistent: true })
  for (const bad of [0, -1, 1.5, NaN, '3', null, undefined, Infinity]) assert.equal(store.setMaxVisible(bad), false, String(bad))
  assert.equal(store.setMaxVisible(5), false, 'já é 5')
  const tela = store.getSnapshot()
  const fila = store.getQueued()
  assert.equal(store.setMaxVisible(2), true)
  assert.equal(store.getSnapshot(), tela, 'a tela não mudou: mesma referência')
  assert.equal(store.getQueued(), fila)
})

test('reduzir o limite avisa quem assina e mantém a prioridade: erro nunca perde a vaga para aviso', () => {
  const { store } = setup()
  let calls = 0
  store.subscribe(() => { calls += 1 })
  for (let n = 0; n < 4; n += 1) store.push({ level: 'warning', title: `W${n}`, persistent: true })
  const err = store.push({ level: 'error', title: 'E', persistent: true })
  const before = calls
  store.setMaxVisible(1)
  assert.ok(calls > before)
  assert.deepEqual(ids(store), [err])
  store.setMaxVisible(5)
  assert.equal(store.getSnapshot()[0].id, err, 'o erro continua na frente')
})
