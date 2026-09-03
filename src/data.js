/**
 * Dados de demonstração e funções puras do domínio de recebimentos.
 *
 * O registro principal representa o processo de recebimento. Os materiais ficam
 * em `itens`, enquanto documentos, divergências e auditoria permanecem ligados
 * ao mesmo protocolo.
 */

export const RECEBIMENTO_STATUS = Object.freeze({
  DIGITACAO: 'Em digitação',
  AGUARDANDO_DOCUMENTACAO: 'Aguardando documentação',
  CONFERENCIA: 'Em conferência',
  DIVERGENCIA: 'Divergência identificada',
  FINALIZADO: 'Conferido/Finalizado',
})

export const STATUS = RECEBIMENTO_STATUS

export const STATUS_OPTIONS = Object.freeze([
  {
    value: RECEBIMENTO_STATUS.DIGITACAO,
    label: RECEBIMENTO_STATUS.DIGITACAO,
    shortLabel: 'Em digitação',
    tone: 'neutral',
    description: 'Registro iniciado e ainda editável pelo Almoxarifado.',
  },
  {
    value: RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO,
    label: RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO,
    shortLabel: 'Aguardando docs.',
    tone: 'warning',
    description: 'Material recebido, mas há documentação obrigatória pendente.',
  },
  {
    value: RECEBIMENTO_STATUS.CONFERENCIA,
    label: RECEBIMENTO_STATUS.CONFERENCIA,
    shortLabel: 'Em conferência',
    tone: 'info',
    description: 'Itens e documentos estão sendo conferidos.',
  },
  {
    value: RECEBIMENTO_STATUS.DIVERGENCIA,
    label: RECEBIMENTO_STATUS.DIVERGENCIA,
    shortLabel: 'Com divergência',
    tone: 'danger',
    description: 'Existe ao menos uma ocorrência que precisa de tratamento.',
  },
  {
    value: RECEBIMENTO_STATUS.FINALIZADO,
    label: RECEBIMENTO_STATUS.FINALIZADO,
    shortLabel: 'Finalizado',
    tone: 'success',
    description: 'Conferência concluída e documentação obrigatória presente.',
  },
])

export const UNIT_OPTIONS = Object.freeze([
  { value: 'PÇ', label: 'Peça (PÇ)' },
  { value: 'UN', label: 'Unidade (UN)' },
  { value: 'KG', label: 'Quilograma (KG)' },
  { value: 'M', label: 'Metro (M)' },
  { value: 'L', label: 'Litro (L)' },
  { value: 'CX', label: 'Caixa (CX)' },
  { value: 'JG', label: 'Jogo (JG)' },
  { value: 'RL', label: 'Rolo (RL)' },
])

export const RECEIPT_TYPE_OPTIONS = Object.freeze([
  { value: 'Estoque', label: 'Estoque' },
  { value: 'Débito Direto', label: 'Débito Direto' },
  { value: 'Industrialização', label: 'Industrialização' },
  { value: 'Comodato', label: 'Comodato' },
  { value: 'Outro', label: 'Outro' },
])

export const SUPPLIER_OPTIONS = Object.freeze([])

export const DOCUMENT_TYPE_OPTIONS = Object.freeze([
  { value: 'Nota Fiscal', label: 'Nota Fiscal', requiredForClosing: true },
  { value: 'DACTE', label: 'DACTE', requiredForClosing: false },
  { value: 'Pedido', label: 'Pedido de Compra', requiredForClosing: false },
  { value: 'Foto', label: 'Fotos do material', requiredForClosing: false },
  { value: 'Certificado', label: 'Certificados', requiredForClosing: false },
  { value: 'Outro', label: 'Outros documentos', requiredForClosing: false },
])

export const DIVERGENCE_TYPE_OPTIONS = Object.freeze([
  { value: 'Quantidade incorreta', label: 'Quantidade incorreta' },
  { value: 'Material avariado', label: 'Material avariado' },
  { value: 'Material diferente', label: 'Material diferente do solicitado' },
  { value: 'Falta de documentação', label: 'Falta de documentação' },
  { value: 'Problema de embalagem', label: 'Problema de embalagem' },
  { value: 'Outro', label: 'Outro' },
])

export const USER_ROLE_OPTIONS = Object.freeze([
  { value: 'Administrador', label: 'Administrador' },
  { value: 'Almoxarifado', label: 'Almoxarifado' },
  { value: 'Suprimentos', label: 'Suprimentos' },
  { value: 'Consulta', label: 'Consulta' },
])

export const DEMO_USERS = Object.freeze([
  {
    id: 'USR-LOCAL',
    nome: 'Usuário MVP',
    name: 'Usuário MVP',
    iniciais: 'UM',
    email: 'usuario@alm.local',
    perfil: 'Administrador',
    role: 'Administrador',
  },
])

export const DEMO_CURRENT_USER = DEMO_USERS[0]
export const currentUser = DEMO_CURRENT_USER

export const STATUS_TRANSITIONS = Object.freeze({
  [RECEBIMENTO_STATUS.DIGITACAO]: [
    RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO,
    RECEBIMENTO_STATUS.CONFERENCIA,
  ],
  [RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO]: [
    RECEBIMENTO_STATUS.DIGITACAO,
    RECEBIMENTO_STATUS.CONFERENCIA,
  ],
  [RECEBIMENTO_STATUS.CONFERENCIA]: [
    RECEBIMENTO_STATUS.DIGITACAO,
    RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO,
    RECEBIMENTO_STATUS.DIVERGENCIA,
    RECEBIMENTO_STATUS.FINALIZADO,
  ],
  [RECEBIMENTO_STATUS.DIVERGENCIA]: [
    RECEBIMENTO_STATUS.CONFERENCIA,
    RECEBIMENTO_STATUS.FINALIZADO,
  ],
  [RECEBIMENTO_STATUS.FINALIZADO]: [],
})

const ALL_STATUS = STATUS_OPTIONS.map((option) => option.value)

export const ROLE_STATUS_PERMISSIONS = Object.freeze({
  Administrador: ALL_STATUS,
  Almoxarifado: ALL_STATUS,
  Suprimentos: [RECEBIMENTO_STATUS.CONFERENCIA, RECEBIMENTO_STATUS.DIVERGENCIA],
  Consulta: [],
})

export const catalogos = Object.freeze({
  status: STATUS_OPTIONS,
  unidades: UNIT_OPTIONS,
  tiposRecebimento: RECEIPT_TYPE_OPTIONS,
  fornecedores: SUPPLIER_OPTIONS,
  tiposDocumento: DOCUMENT_TYPE_OPTIONS,
  tiposDivergencia: DIVERGENCE_TYPE_OPTIONS,
  perfis: USER_ROLE_OPTIONS,
})

function actor(user) {
  return {
    id: user.id,
    nome: user.nome || user.name,
    iniciais: user.iniciais,
    perfil: user.perfil || user.role,
  }
}

function item(id, numero, codigo, descricao, solicitada, recebida, unidade) {
  return {
    id,
    numero,
    codigo,
    descricao,
    quantidadeSolicitada: solicitada,
    quantidadeRecebida: recebida,
    unidade,
  }
}

function attachment(id, nome, categoria, dataInclusao, usuario, tamanho = 0) {
  return {
    id,
    nome,
    categoria,
    tipo: categoria,
    mimeType: categoria === 'Foto' ? 'image/jpeg' : 'application/pdf',
    tamanho,
    dataInclusao,
    incluidoPor: actor(usuario),
    url: null,
  }
}

function change(id, data, usuario, acao, detalhes) {
  return { id, data, usuario: actor(usuario), acao, detalhes }
}

function statusChange(id, data, usuario, de, para, observacao = '') {
  return { id, data, usuario: actor(usuario), de, para, observacao }
}

function divergence(
  id,
  tipo,
  descricao,
  data,
  usuario,
  options = {},
) {
  return {
    id,
    tipo,
    descricao,
    itemId: options.itemId || null,
    criadaEm: data,
    criadaPor: actor(usuario),
    resolvida: Boolean(options.resolvida),
    resolvidaEm: options.resolvidaEm || null,
    resolvidaPor: options.resolvidaPor ? actor(options.resolvidaPor) : null,
    resolucao: options.resolucao || '',
  }
}

const [MARCOS, ANA, RAFAEL, CARLA] = DEMO_USERS

/**
 * Massa rica e determinística para o protótipo. Há dois registros em cada um
 * dos cinco estados e exemplos de recebimento parcial, NF pendente, anexos e
 * divergências abertas/resolvidas.
 */
export const seedRecebimentos = []

export const recebimentosIniciais = seedRecebimentos
export const statusOptions = STATUS_OPTIONS
export const unidades = UNIT_OPTIONS
export const unitCatalog = UNIT_OPTIONS
export const tiposRecebimento = RECEIPT_TYPE_OPTIONS
export const receiptTypes = RECEIPT_TYPE_OPTIONS
export const fornecedores = SUPPLIER_OPTIONS
export const suppliers = SUPPLIER_OPTIONS
export const supplierOptions = SUPPLIER_OPTIONS
export const tiposDocumento = DOCUMENT_TYPE_OPTIONS
export const tiposDivergencia = DIVERGENCE_TYPE_OPTIONS

export function cloneData(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

export function getResponsibleName(recebimento) {
  const responsible = recebimento?.responsavel
  if (typeof responsible === 'string') return responsible
  return responsible?.nome || responsible?.name || ''
}

export function isNfPending(recebimento) {
  if (!String(recebimento?.numeroNf || '').trim()) return true
  return !(recebimento?.anexos || []).some(
    (anexo) => !anexo.removido && (anexo.categoria || anexo.tipo) === 'Nota Fiscal',
  )
}

export function hasOpenDivergences(recebimento) {
  return (recebimento?.divergencias || []).some((entry) => !entry.resolvida)
}

export function getReceiptItemCount(recebimento) {
  return (recebimento?.itens || []).length
}

export function getReceiptTotalQuantity(recebimento) {
  return (recebimento?.itens || []).reduce(
    (total, current) => total + (Number(current.quantidadeRecebida) || 0),
    0,
  )
}

export function validateStatusTransition(recebimento, nextStatus, user = DEMO_CURRENT_USER) {
  if (!recebimento) return { allowed: false, reason: 'Recebimento não encontrado.' }
  if (!ALL_STATUS.includes(nextStatus)) return { allowed: false, reason: 'Status inválido.' }
  if (recebimento.status === nextStatus) {
    return { allowed: false, reason: 'O recebimento já está neste status.' }
  }

  const role = user?.perfil || user?.role || 'Consulta'
  if (role === 'Consulta') {
    return { allowed: false, reason: 'O perfil Consulta não pode alterar status.' }
  }

  if (role !== 'Administrador') {
    const allowedTargets = STATUS_TRANSITIONS[recebimento.status] || []
    if (!allowedTargets.includes(nextStatus)) {
      return { allowed: false, reason: 'Essa mudança não faz parte do fluxo permitido.' }
    }

    if (!(ROLE_STATUS_PERMISSIONS[role] || []).includes(nextStatus)) {
      return { allowed: false, reason: `O perfil ${role} não pode mover para este status.` }
    }
  }

  if (nextStatus === RECEBIMENTO_STATUS.DIVERGENCIA && !hasOpenDivergences(recebimento)) {
    return { allowed: false, reason: 'Registre uma divergência aberta antes de mudar o status.' }
  }

  if (nextStatus === RECEBIMENTO_STATUS.FINALIZADO) {
    if (isNfPending(recebimento)) {
      return { allowed: false, reason: 'A NF e seu arquivo são obrigatórios para finalizar.' }
    }
    if (!(recebimento.itens || []).length) {
      return { allowed: false, reason: 'Inclua ao menos um item para finalizar.' }
    }
    if (hasOpenDivergences(recebimento)) {
      return { allowed: false, reason: 'Resolva todas as divergências antes de finalizar.' }
    }
  }

  return { allowed: true, reason: '' }
}

export function canTransitionStatus(recebimento, nextStatus, user = DEMO_CURRENT_USER) {
  return validateStatusTransition(recebimento, nextStatus, user).allowed
}

export function getAllowedNextStatuses(recebimento, user = DEMO_CURRENT_USER) {
  return STATUS_OPTIONS.filter((option) => canTransitionStatus(recebimento, option.value, user))
}

function matchesSearch(recebimento, search) {
  if (!search) return true
  const terms = normalizeText(search).split(/\s+/).filter(Boolean)
  const itemText = (recebimento.itens || [])
    .map((entry) => `${entry.numero} ${entry.codigo} ${entry.descricao} ${entry.unidade}`)
    .join(' ')
  const divergenceText = (recebimento.divergencias || [])
    .map((entry) => `${entry.tipo} ${entry.descricao}`)
    .join(' ')
  const haystack = normalizeText(
    [
      recebimento.protocolo,
      recebimento.pedido,
      recebimento.numeroNf,
      recebimento.fornecedor,
      recebimento.cnpjFornecedor,
      recebimento.tipo,
      recebimento.status,
      getResponsibleName(recebimento),
      recebimento.observacoes,
      itemText,
      divergenceText,
    ].join(' '),
  )
  return terms.every((term) => haystack.includes(term))
}

function matchesText(value, expected) {
  if (!expected) return true
  return normalizeText(value).includes(normalizeText(expected))
}

function normalizeBooleanFilter(value) {
  if (value === true || value === 'true' || value === 'sim' || value === 'pendente') return true
  if (value === false || value === 'false' || value === 'nao' || value === 'não' || value === 'completa') return false
  return null
}

/**
 * Filtra sem alterar o array original. Aceita os nomes de filtro usados nas
 * telas (`search`, `periodoInicio`, etc.) e alguns aliases usuais.
 */
export function filterRecebimentos(recebimentos, filters = {}) {
  const search = filters.search ?? filters.query ?? filters.pesquisa ?? ''
  const startDate = filters.periodoInicio ?? filters.dateFrom ?? filters.dataInicio ?? ''
  const endDate = filters.periodoFim ?? filters.dateTo ?? filters.dataFim ?? ''
  const statusFilter = filters.status
  const statuses = Array.isArray(statusFilter)
    ? statusFilter.filter(Boolean)
    : statusFilter
      ? [statusFilter]
      : []
  const nfPending = normalizeBooleanFilter(filters.nfPendente)
  const divergenceFilter = normalizeBooleanFilter(filters.comDivergencia ?? filters.divergencia)

  return (recebimentos || []).filter((recebimento) => {
    if (!matchesSearch(recebimento, search)) return false
    if (startDate && recebimento.dataRecebimento < startDate) return false
    if (endDate && recebimento.dataRecebimento > endDate) return false
    if (statuses.length && !statuses.includes(recebimento.status)) return false
    if (!matchesText(recebimento.pedido, filters.pedido)) return false
    if (!matchesText(recebimento.fornecedor, filters.fornecedor)) return false
    if (!matchesText(recebimento.tipo, filters.tipo)) return false
    if (!matchesText(getResponsibleName(recebimento), filters.responsavel)) return false

    if (filters.item) {
      const expectedItem = normalizeText(filters.item)
      const hasItem = (recebimento.itens || []).some((entry) =>
        normalizeText(`${entry.numero} ${entry.codigo} ${entry.descricao}`).includes(expectedItem),
      )
      if (!hasItem) return false
    }

    if (nfPending !== null && isNfPending(recebimento) !== nfPending) return false
    if (divergenceFilter !== null && hasOpenDivergences(recebimento) !== divergenceFilter) return false
    return true
  })
}

const SORT_VALUE_GETTERS = {
  protocolo: (entry) => entry.protocolo,
  pedido: (entry) => entry.pedido,
  numeroNf: (entry) => entry.numeroNf,
  dataRecebimento: (entry) => entry.dataRecebimento,
  fornecedor: (entry) => entry.fornecedor,
  tipo: (entry) => entry.tipo,
  responsavel: (entry) => getResponsibleName(entry),
  status: (entry) => entry.status,
  quantidade: (entry) => getReceiptTotalQuantity(entry),
}

export function sortRecebimentos(recebimentos, sortBy = 'dataRecebimento', direction = 'desc') {
  const getter = SORT_VALUE_GETTERS[sortBy] || SORT_VALUE_GETTERS.dataRecebimento
  const multiplier = direction === 'asc' ? 1 : -1
  return [...(recebimentos || [])].sort((left, right) => {
    const a = getter(left) ?? ''
    const b = getter(right) ?? ''
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * multiplier
    return String(a).localeCompare(String(b), 'pt-BR', { numeric: true }) * multiplier
  })
}

export function paginateRecebimentos(recebimentos, page = 1, pageSize = 10) {
  const safeSize = Math.max(1, Number(pageSize) || 10)
  const totalItems = (recebimentos || []).length
  const totalPages = Math.max(1, Math.ceil(totalItems / safeSize))
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages)
  const start = (safePage - 1) * safeSize
  return {
    items: (recebimentos || []).slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    totalItems,
    totalPages,
  }
}

export function flattenRecebimentos(recebimentos) {
  return (recebimentos || []).flatMap((recebimento) => {
    const base = {
      protocolo: recebimento.protocolo,
      pedido: recebimento.pedido,
      numeroNf: recebimento.numeroNf || '',
      dataRecebimento: recebimento.dataRecebimento,
      fornecedor: recebimento.fornecedor,
      tipo: recebimento.tipo,
      responsavel: getResponsibleName(recebimento),
      status: recebimento.status,
      observacoes: recebimento.observacoes || '',
    }
    if (!(recebimento.itens || []).length) {
      return [{ ...base, item: '', codigo: '', quantidade: '', unidade: '', descricao: '' }]
    }
    return recebimento.itens.map((entry) => ({
      ...base,
      item: entry.numero,
      codigo: entry.codigo || '',
      quantidade: entry.quantidadeRecebida,
      unidade: entry.unidade,
      descricao: entry.descricao,
    }))
  })
}

function getReferenceDateString(referenceDate) {
  if (typeof referenceDate === 'string') return referenceDate.slice(0, 10)
  const date = referenceDate instanceof Date ? referenceDate : new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function countBy(recebimentos, getter, keyName) {
  const counts = new Map()
  recebimentos.forEach((entry) => {
    const key = getter(entry) || 'Não informado'
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  return [...counts.entries()]
    .map(([key, total]) => ({ [keyName]: key, label: key, total }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'))
}

export function getDashboardMetrics(recebimentos, referenceDate = new Date()) {
  const rows = recebimentos || []
  const today = getReferenceDateString(referenceDate)
  const todayRows = rows.filter((entry) => entry.dataRecebimento === today)
  const porStatus = STATUS_OPTIONS.map((option) => ({
    status: option.value,
    label: option.label,
    tone: option.tone,
    total: rows.filter((entry) => entry.status === option.value).length,
  }))
  const monthCounts = new Map()
  rows.forEach((entry) => {
    const month = String(entry.dataRecebimento || '').slice(0, 7)
    if (month) monthCounts.set(month, (monthCounts.get(month) || 0) + 1)
  })
  const evolucaoMensal = [...monthCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, total]) => ({ mes, total }))

  const divergenciasAbertas = rows.reduce(
    (total, entry) => total + (entry.divergencias || []).filter((itemEntry) => !itemEntry.resolvida).length,
    0,
  )
  const documentacaoPendente = rows.filter(isNfPending).length
  const pedidosComDivergencia = rows.filter(hasOpenDivergences).length

  return {
    totalRecebimentos: rows.length,
    recebimentosHoje: todayRows.length,
    materiaisHoje: todayRows.reduce((total, entry) => total + getReceiptItemCount(entry), 0),
    quantidadeRecebidaHoje: todayRows.reduce((total, entry) => total + getReceiptTotalQuantity(entry), 0),
    pedidosComDivergencia,
    divergenciasAbertas,
    documentacaoPendente,
    finalizados: rows.filter((entry) => entry.status === RECEBIMENTO_STATUS.FINALIZADO).length,
    porStatus,
    porFornecedor: countBy(rows, (entry) => entry.fornecedor, 'fornecedor'),
    porTipo: countBy(rows, (entry) => entry.tipo, 'tipo'),
    evolucaoMensal,
  }
}

export const calculateMetrics = getDashboardMetrics

function csvCell(value, delimiter) {
  const text = value == null ? '' : String(value)
  if (text.includes(delimiter) || /["\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** Retorna CSV com uma linha por item, compatível com o legado em Excel. */
export function exportRecebimentosCsv(recebimentos, options = {}) {
  const delimiter = options.delimiter || ';'
  const headers = [
    ['item', 'Item'],
    ['quantidade', 'Quantidade'],
    ['unidade', 'Unidade'],
    ['descricao', 'Descrição'],
    ['pedido', 'Pedido'],
    ['numeroNf', 'Nº NF/documento'],
    ['dataRecebimento', 'Data de Recebimento'],
    ['fornecedor', 'Fornecedor'],
    ['tipo', 'Tipo'],
    ['responsavel', 'Responsável'],
    ['status', 'Status'],
    ['observacoes', 'Observações'],
    ['protocolo', 'Protocolo'],
  ]
  const rows = flattenRecebimentos(recebimentos)
  const lines = [
    headers.map(([, title]) => csvCell(title, delimiter)).join(delimiter),
    ...rows.map((row) =>
      headers.map(([key]) => csvCell(row[key], delimiter)).join(delimiter),
    ),
  ]
  return `${options.withBom === false ? '' : '\uFEFF'}${lines.join('\r\n')}`
}

export const exportToCsv = exportRecebimentosCsv
