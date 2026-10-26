/**
 * Derivações puras para os gráficos da Visão geral (D-1).
 *
 * Partem do que o store já entrega — os registros ativos carregados da API e o
 * resultado de getDashboardMetrics (src/data.js) — sem buscar dado, sem
 * inventar período e sem alterar o que recebem. As regras de contagem (status,
 * fornecedor, tipo, "Não informado") continuam sendo as do domínio; aqui só se
 * calcula proporção, recorte e série temporal.
 */
import { STATUS_OPTIONS, hasOpenDivergences, isNfPending } from '../../data.js'

const MONTH_LABELS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
// Data AAAA-MM-DD, opcionalmente seguida de T + horário ISO 8601: HH:MM[:SS[.frações]] e, se houver, Z ou ±HH:MM / ±HHMM.
// É o que o ALM grava (AAAA-MM-DD do formulário e new Date().toISOString() do backend/store); nada além disso é aceito.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))?$)/

/** "AAAA-MM" de uma data de calendário real em AAAA-MM-DD (com ou sem hora); null caso contrário. */
export function parseReceiptMonth(value) {
  if (typeof value !== 'string') return null
  const match = ISO_DATE.exec(value.trim())
  if (!match) return null
  const [year, month, day] = match.slice(1, 4).map(Number)
  const [hour, minute, second, offsetHour, offsetMinute] = match.slice(4).map((part) => (part === undefined ? 0 : Number(part)))
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${match[1]}-${match[2]}`
}

const monthIndex = (key) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1
const monthKey = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`

/**
 * Recebimentos por mês de `dataRecebimento`, do primeiro ao último mês com
 * registro (meses vazios no meio = 0, que é a contagem real), limitado aos
 * `maxMonths` mais recentes. Datas ausentes/inválidas não entram na série e
 * são devolvidas em `semDataValida`; o que fica antes do recorte, em
 * `registrosAntesDoRecorte`.
 */
export function buildMonthlySeries(recebimentos, { maxMonths = 12 } = {}) {
  const counts = new Map()
  let semDataValida = 0
  for (const entry of recebimentos || []) {
    const key = parseReceiptMonth(entry?.dataRecebimento)
    if (!key) semDataValida += 1
    else counts.set(key, (counts.get(key) || 0) + 1)
  }
  if (!counts.size) return { months: [], totalNaSerie: 0, semDataValida, mesesOmitidos: 0, registrosAntesDoRecorte: 0 }

  const indexes = [...counts.keys()].map(monthIndex)
  const last = Math.max(...indexes)
  const first = Math.max(Math.min(...indexes), last - maxMonths + 1)
  const months = []
  for (let index = first; index <= last; index += 1) {
    const key = monthKey(index)
    months.push({ key, label: `${MONTH_LABELS[index % 12]}/${key.slice(2, 4)}`, total: counts.get(key) || 0 })
  }
  const registrosAntesDoRecorte = [...counts.entries()].filter(([key]) => monthIndex(key) < first).reduce((sum, [, total]) => sum + total, 0)
  return {
    months,
    totalNaSerie: months.reduce((sum, month) => sum + month.total, 0),
    semDataValida,
    mesesOmitidos: first - Math.min(...indexes),
    registrosAntesDoRecorte,
  }
}

const SHORT_LABEL = new Map(STATUS_OPTIONS.map((option) => [option.value, option.shortLabel]))

/**
 * Barras de status a partir de metrics.porStatus (catálogo do domínio, na
 * ordem do fluxo). `foraDoCatalogo` = registros cujo status não está no
 * catálogo — getDashboardMetrics não os conta em nenhuma barra.
 */
export function buildStatusChart(metrics) {
  const total = metrics?.totalRecebimentos || 0
  const items = (metrics?.porStatus || []).map((entry) => ({
    key: entry.status,
    label: SHORT_LABEL.get(entry.status) || entry.label,
    total: entry.total,
    share: total ? entry.total / total : 0,
  }))
  const noCatalogo = items.reduce((sum, item) => sum + item.total, 0)
  return { items, total, foraDoCatalogo: Math.max(0, total - noCatalogo) }
}

/** As `limit` maiores categorias (já ordenadas pelo domínio) + o resto somado em `demais`. */
export function buildTopList(entries, limit) {
  const list = entries || []
  const total = list.reduce((sum, entry) => sum + entry.total, 0)
  const toItem = (entry) => ({ key: entry.label, label: entry.label, total: entry.total, share: total ? entry.total / total : 0 })
  const rest = list.slice(limit)
  return {
    items: list.slice(0, limit).map(toItem),
    demais: rest.length ? { categorias: rest.length, total: rest.reduce((sum, entry) => sum + entry.total, 0) } : null,
    total,
  }
}

/**
 * Registros ativos (não arquivados): a base única da Visão geral. É a mesma regra do store
 * ("visible" em useRecebimentosStore) que alimenta getDashboardMetrics, então KPIs, gráficos,
 * "Recebimentos recentes" e "Requer atenção" somam sobre o mesmo conjunto.
 */
export function selectActiveReceipts(recebimentos) {
  return (recebimentos || []).filter((entry) => !entry.arquivado)
}

/** "Requer atenção": NF pendente ou divergência aberta (regras do domínio), na ordem recebida. */
export function getAttentionReceipts(activeReceipts, limit = 5) {
  return selectActiveReceipts(activeReceipts)
    .filter((entry) => isNfPending(entry) || hasOpenDivergences(entry))
    .slice(0, limit)
}

/** "Recebimentos recentes": os últimos atualizados, sem alterar a lista recebida. */
export function getRecentReceipts(activeReceipts, limit = 5) {
  return [...selectActiveReceipts(activeReceipts)]
    .sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)))
    .slice(0, limit)
}
