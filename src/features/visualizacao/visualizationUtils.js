/**
 * Lógica pura da Visualização — busca, filtro, ordenação, paginação e CSV.
 * Sem React, sem DOM, sem import de nada fora deste arquivo: pode ser
 * testado com `node --test` isoladamente, mesmo padrão já usado em
 * src/features/nfeReader/analysisBuilder.js e src/features/portaria/scannerBridge.js.
 */

/** Remove acentos e normaliza caixa — usado só para COMPARAÇÃO de busca, nunca para exibição. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Algum dos campos de busca da linha contém o termo (sem acento/caixa)? */
export function matchesSearch(row, searchFields, query) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return true
  return (searchFields || []).some((field) => normalizeText(row[field]).includes(normalizedQuery))
}

function matchesStatus(row, statusField, statusValue) {
  if (!statusField || !statusValue) return true
  return String(row[statusField]) === statusValue
}

function matchesPeriod(row, periodoField, periodoInicio, periodoFim) {
  if (!periodoField) return true
  const raw = row[periodoField]
  if (!raw) return !periodoInicio && !periodoFim
  const value = String(raw).slice(0, 10)
  if (periodoInicio && value < periodoInicio) return false
  if (periodoFim && value > periodoFim) return false
  return true
}

/**
 * Filtra as linhas de uma aba pelos critérios atuais. `tab` é a entrada de
 * `TABS` (mockVisualizationData.js); `filters` é `{ search, status, periodoInicio, periodoFim }`.
 */
export function getFilteredRows(tab, filters = {}) {
  const rows = (tab.rows || []).map((row) => (tab.deriveRow ? tab.deriveRow(row) : row))
  const { search = '', status = '', periodoInicio = '', periodoFim = '' } = filters
  return rows.filter(
    (row) =>
      matchesSearch(row, tab.searchFields, search) &&
      matchesStatus(row, tab.statusField, status) &&
      matchesPeriod(row, tab.periodoField, periodoInicio, periodoFim),
  )
}

function compareValues(a, b, type) {
  const av = a ?? ''
  const bv = b ?? ''
  if (type === 'number' || type === 'filesize') {
    return (Number(av) || 0) - (Number(bv) || 0)
  }
  if (type === 'boolean') {
    return Number(Boolean(av)) - Number(Boolean(bv))
  }
  return String(av).localeCompare(String(bv), 'pt-BR', { numeric: true, sensitivity: 'base' })
}

/** Ordena por uma coluna — `sort` é `{ key, direction, type }` ou `null` (ordem natural/original). */
export function sortRows(rows, sort) {
  if (!sort || !sort.key) return rows
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => compareValues(a[sort.key], b[sort.key], sort.type) * direction)
}

/** Garante que a página atual ainda existe depois de um filtro/aba mudar. */
export function clampPage(page, totalRows, pageSize) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  return Math.min(Math.max(1, page), totalPages)
}

export function paginate(rows, page, pageSize) {
  const safePage = clampPage(page, rows.length, pageSize)
  const start = (safePage - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/**
 * Data LOCAL do dispositivo em YYYY-MM-DD, nunca UTC — usada no nome do CSV
 * exportado. `toISOString()` usa UTC e erraria o dia perto da meia-noite
 * (ex.: 21:30 no Brasil ainda é um dia, mas UTC já pode ter virado o outro).
 */
export function localDateIso(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ---------------------------------------------------------------------------
// CSV — protótipo de frontend só para validar UX.
// Produção: a exportação real será fornecida pelo backend (Goran), garantindo
// autorização, volume e consistência com a fonte de verdade (Supabase/API) —
// isto aqui nunca deve ser considerado a exportação final.
// ---------------------------------------------------------------------------

function csvDate(value, withTime) {
  if (!value) return ''
  const [datePart, timePart = ''] = String(value).split('T')
  const [year, month, day] = datePart.split('-')
  if (!year || !month || !day) return String(value)
  const formattedDate = `${day}/${month}/${year}`
  if (!withTime || !timePart) return formattedDate
  return `${formattedDate} ${timePart.slice(0, 5)}`
}

function csvFileSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Valor de exibição de uma célula, em texto puro — usado pelo CSV (a tabela em tela formata por conta própria). */
export function formatCellForExport(row, column) {
  const raw = row[column.key]
  switch (column.type) {
    case 'date':
      return csvDate(raw, false)
    case 'datetime':
      return csvDate(raw, true)
    case 'boolean':
      return raw ? 'Sim' : 'Não'
    case 'filesize':
      return csvFileSize(raw)
    case 'badge':
      return (column.badgeLabels && column.badgeLabels[raw]) || String(raw ?? '')
    default:
      return raw === null || raw === undefined ? '' : String(raw)
  }
}

// Excel em pt-BR trata "," como separador decimal, então só reconhece CSV
// corretamente (colunas separadas) quando o delimitador de campo é ";".
const CSV_DELIMITER = ';'

/** Escapa um valor para uma célula CSV (RFC 4180): aspas quando há o delimitador, aspas internas ou quebra de linha. */
export function escapeCsvValue(value) {
  const text = String(value ?? '')
  if (text.includes(CSV_DELIMITER) || /["\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** Monta o texto CSV completo (cabeçalho + linhas) a partir das colunas e linhas já filtradas/ordenadas. */
export function buildCsv(columns, rows) {
  const header = columns.map((column) => escapeCsvValue(column.label)).join(CSV_DELIMITER)
  const lines = rows.map((row) => columns.map((column) => escapeCsvValue(formatCellForExport(row, column))).join(CSV_DELIMITER))
  return [header, ...lines].join('\r\n')
}
