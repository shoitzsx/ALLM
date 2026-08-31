import { useMemo, useSyncExternalStore } from 'react'
import {
  DEMO_CURRENT_USER,
  DOCUMENT_TYPE_OPTIONS,
  DIVERGENCE_TYPE_OPTIONS,
  RECEBIMENTO_STATUS,
  RECEIPT_TYPE_OPTIONS,
  STATUS_OPTIONS,
  SUPPLIER_OPTIONS,
  UNIT_OPTIONS,
  cloneData,
  exportRecebimentosCsv,
  filterRecebimentos,
  getDashboardMetrics,
  paginateRecebimentos,
  seedRecebimentos,
  sortRecebimentos,
  validateStatusTransition,
} from './data.js'

export const STORAGE_KEY = 'alm:recebimentos:mvp:v1'
export const suppliers = SUPPLIER_OPTIONS
export const unitCatalog = UNIT_OPTIONS
export const receiptTypes = RECEIPT_TYPE_OPTIONS
export const statusCatalog = STATUS_OPTIONS
export const documentTypes = DOCUMENT_TYPE_OPTIONS
export const divergenceTypes = DIVERGENCE_TYPE_OPTIONS
export const defaultCurrentUser = DEMO_CURRENT_USER
export { DEMO_CURRENT_USER as currentUser }

const listeners = new Set()

function makeDefaultState() {
  return {
    recebimentos: cloneData(seedRecebimentos),
    currentUser: cloneData(DEMO_CURRENT_USER),
    selectedRecebimentoId: null,
    lastUpdated: null,
  }
}

function loadPersistedState() {
  const fallback = makeDefaultState()
  if (typeof window === 'undefined' || !window.localStorage) return fallback

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const recebimentos = Array.isArray(parsed) ? parsed : parsed.recebimentos
    if (!Array.isArray(recebimentos)) return fallback
    return {
      ...fallback,
      ...(Array.isArray(parsed) ? {} : parsed),
      recebimentos,
      currentUser: parsed.currentUser || fallback.currentUser,
    }
  } catch (error) {
    console.warn('Não foi possível carregar os recebimentos salvos.', error)
    return fallback
  }
}

let state = loadPersistedState()

function persistState() {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        recebimentos: state.recebimentos,
        currentUser: state.currentUser,
        lastUpdated: state.lastUpdated,
      }),
    )
  } catch (error) {
    console.warn('Não foi possível salvar os recebimentos neste navegador.', error)
  }
}

function emit() {
  listeners.forEach((listener) => listener())
}

function setState(updater, options = {}) {
  const nextState = typeof updater === 'function' ? updater(state) : updater
  if (!nextState || nextState === state) return state
  state = { ...nextState, lastUpdated: options.keepTimestamp ? nextState.lastUpdated : nowIso() }
  if (options.persist !== false) persistState()
  emit()
  return state
}

export function subscribeToRecebimentos(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getStoreSnapshot() {
  return state
}

export function getCurrentUser() {
  return state.currentUser
}

const serverSnapshot = makeDefaultState()

function getServerSnapshot() {
  return serverSnapshot
}

function nowIso() {
  return new Date().toISOString()
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createId(prefix) {
  const raw = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${raw}`
}

function normalizeActor(user = state.currentUser) {
  return {
    id: user?.id || 'USR-LOCAL',
    nome: user?.nome || user?.name || 'Usuário local',
    name: user?.name || user?.nome || 'Usuário local',
    iniciais:
      user?.iniciais ||
      String(user?.nome || user?.name || 'UL')
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase(),
    perfil: user?.perfil || user?.role || 'Almoxarifado',
    role: user?.role || user?.perfil || 'Almoxarifado',
  }
}

function requireWritePermission(user = state.currentUser) {
  const role = user?.perfil || user?.role || 'Consulta'
  if (role === 'Consulta') throw new Error('O perfil Consulta não pode alterar recebimentos.')
}

function isAdministrator(user = state.currentUser) {
  return (user?.perfil || user?.role) === 'Administrador'
}

function nextProtocol(recebimentos, dateString) {
  const year = String(dateString || localDateString()).slice(0, 4)
  const expression = new RegExp(`^REC-${year}-(\\d+)$`)
  const maxSequence = recebimentos.reduce((max, entry) => {
    const match = String(entry.protocolo || entry.id || '').match(expression)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `REC-${year}-${String(maxSequence + 1).padStart(4, '0')}`
}

function normalizeItem(input = {}, index = 0) {
  const receivedQuantity =
    input.quantidadeRecebida ?? input.quantidade ?? input.receivedQuantity ?? 0
  return {
    id: input.id || createId('IT'),
    numero: String(input.numero ?? input.item ?? (index + 1) * 10),
    codigo: input.codigo ?? input.materialCode ?? '',
    descricao: input.descricao ?? input.description ?? '',
    quantidadeSolicitada:
      Number(input.quantidadeSolicitada ?? input.requestedQuantity ?? receivedQuantity) || 0,
    quantidadeRecebida: Number(receivedQuantity) || 0,
    unidade: input.unidade ?? input.unit ?? 'UN',
  }
}

function auditEntry(user, acao, detalhes, timestamp = nowIso()) {
  return {
    id: createId('AUD'),
    data: timestamp,
    usuario: normalizeActor(user),
    acao,
    detalhes,
  }
}

function statusEntry(user, de, para, observacao = '', timestamp = nowIso()) {
  return {
    id: createId('HST'),
    data: timestamp,
    usuario: normalizeActor(user),
    de,
    para,
    observacao,
  }
}

function getReceiptOrThrow(recebimentos, id) {
  const receipt = recebimentos.find((entry) => entry.id === id || entry.protocolo === id)
  if (!receipt) throw new Error('Recebimento não encontrado.')
  return receipt
}

function mutateReceipt(id, updater) {
  let result
  setState((current) => {
    const index = current.recebimentos.findIndex(
      (entry) => entry.id === id || entry.protocolo === id,
    )
    if (index < 0) throw new Error('Recebimento não encontrado.')
    const currentReceipt = current.recebimentos[index]
    const nextReceipt = updater(currentReceipt)
    if (!nextReceipt || nextReceipt === currentReceipt) {
      result = currentReceipt
      return current
    }
    result = nextReceipt
    const nextReceipts = [...current.recebimentos]
    nextReceipts[index] = nextReceipt
    return { ...current, recebimentos: nextReceipts }
  })
  return result
}

export function getRecebimentoById(id) {
  return state.recebimentos.find((entry) => entry.id === id || entry.protocolo === id) || null
}

export const getReceiptById = getRecebimentoById

export function setCurrentUser(user) {
  const normalized = normalizeActor(user)
  setState((current) => ({ ...current, currentUser: normalized }))
  return normalized
}

export function selectRecebimento(id) {
  setState(
    (current) => ({ ...current, selectedRecebimentoId: id || null }),
    { persist: false },
  )
}

/**
 * Cria um rascunho e preenche data e responsável automaticamente. NF não é
 * exigida nesta etapa e pode ser incluída depois.
 */
export function createRecebimento(input = {}, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const timestamp = nowIso()
  const receivedDate = input.dataRecebimento || input.receivedAt || localDateString()
  let created

  setState((current) => {
    const protocol = input.protocolo || nextProtocol(current.recebimentos, receivedDate)
    const initialStatus = RECEBIMENTO_STATUS.DIGITACAO
    created = {
      id: input.id || protocol,
      protocolo: protocol,
      pedido: String(input.pedido ?? input.purchaseOrder ?? '').trim(),
      numeroNf: String(input.numeroNf ?? input.invoiceNumber ?? '').trim() || null,
      serieNf: String(input.serieNf ?? input.invoiceSeries ?? '').trim() || null,
      dataRecebimento: receivedDate,
      fornecedor: String(input.fornecedor ?? input.supplier ?? '').trim(),
      cnpjFornecedor: String(input.cnpjFornecedor ?? input.supplierTaxId ?? '').trim(),
      tipo: input.tipo ?? input.receiptType ?? 'Estoque',
      responsavel: normalizeActor(user),
      status: initialStatus,
      observacoes: String(input.observacoes ?? input.notes ?? '').trim(),
      criadoEm: timestamp,
      atualizadoEm: timestamp,
      itens: (input.itens || input.items || []).map(normalizeItem),
      anexos: [],
      divergencias: [],
      historicoStatus: [
        statusEntry(user, null, initialStatus, 'Registro criado.', timestamp),
      ],
      historicoAlteracoes: [
        auditEntry(user, 'Recebimento criado', `Protocolo ${protocol}.`, timestamp),
      ],
      arquivado: false,
    }
    return { ...current, recebimentos: [created, ...current.recebimentos] }
  })

  if (input.anexos?.length || input.attachments?.length) {
    addAttachments(created.id, input.anexos || input.attachments, { user })
    created = getRecebimentoById(created.id)
  }
  return created
}

export const createReceipt = createRecebimento

export function updateRecebimento(id, changes = {}, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const timestamp = nowIso()
  const ignoredFields = new Set([
    'id',
    'protocolo',
    'responsavel',
    'status',
    'historicoStatus',
    'historicoAlteracoes',
    'criadoEm',
  ])
  const allowedChanges = Object.fromEntries(
    Object.entries(changes).filter(([key]) => !ignoredFields.has(key)),
  )

  return mutateReceipt(id, (receipt) => {
    if (receipt.status === RECEBIMENTO_STATUS.FINALIZADO && !isAdministrator(user)) {
      throw new Error('Somente um administrador pode editar um recebimento finalizado.')
    }
    const normalizedChanges = { ...allowedChanges }
    if (allowedChanges.items && !allowedChanges.itens) normalizedChanges.itens = allowedChanges.items
    delete normalizedChanges.items
    if (normalizedChanges.itens) normalizedChanges.itens = normalizedChanges.itens.map(normalizeItem)
    if ('numeroNf' in normalizedChanges) {
      normalizedChanges.numeroNf = String(normalizedChanges.numeroNf || '').trim() || null
    }
    const fields = Object.keys(normalizedChanges)
    if (!fields.length) return receipt
    return {
      ...receipt,
      ...normalizedChanges,
      atualizadoEm: timestamp,
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(user, 'Dados alterados', `Campos atualizados: ${fields.join(', ')}.`, timestamp),
      ],
    }
  })
}

export const updateReceipt = updateRecebimento

export function addItem(id, itemData = {}, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const timestamp = nowIso()
  let addedItem
  mutateReceipt(id, (receipt) => {
    if (receipt.status === RECEBIMENTO_STATUS.FINALIZADO && !isAdministrator(user)) {
      throw new Error('Somente um administrador pode editar itens de um recebimento finalizado.')
    }
    addedItem = normalizeItem(itemData, (receipt.itens || []).length)
    return {
      ...receipt,
      itens: [...(receipt.itens || []), addedItem],
      atualizadoEm: timestamp,
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(user, 'Item incluído', addedItem.descricao || addedItem.numero, timestamp),
      ],
    }
  })
  return addedItem
}

export function updateItem(id, itemId, changes = {}, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const timestamp = nowIso()
  let updatedItem
  mutateReceipt(id, (receipt) => {
    if (receipt.status === RECEBIMENTO_STATUS.FINALIZADO && !isAdministrator(user)) {
      throw new Error('Somente um administrador pode editar itens de um recebimento finalizado.')
    }
    const index = (receipt.itens || []).findIndex((entry) => entry.id === itemId)
    if (index < 0) throw new Error('Item não encontrado.')
    updatedItem = normalizeItem({ ...receipt.itens[index], ...changes }, index)
    const itens = [...receipt.itens]
    itens[index] = updatedItem
    return {
      ...receipt,
      itens,
      atualizadoEm: timestamp,
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(user, 'Item alterado', updatedItem.descricao || updatedItem.numero, timestamp),
      ],
    }
  })
  return updatedItem
}

export function removeItem(id, itemId, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const timestamp = nowIso()
  let removedItem
  mutateReceipt(id, (receipt) => {
    if (receipt.status === RECEBIMENTO_STATUS.FINALIZADO && !isAdministrator(user)) {
      throw new Error('Somente um administrador pode remover itens de um recebimento finalizado.')
    }
    removedItem = (receipt.itens || []).find((entry) => entry.id === itemId)
    if (!removedItem) throw new Error('Item não encontrado.')
    if ((receipt.divergencias || []).some((entry) => entry.itemId === itemId)) {
      throw new Error('O item possui divergências vinculadas e não pode ser removido.')
    }
    return {
      ...receipt,
      itens: receipt.itens.filter((entry) => entry.id !== itemId),
      atualizadoEm: timestamp,
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(user, 'Item removido', removedItem.descricao || removedItem.numero, timestamp),
      ],
    }
  })
  return removedItem
}

function normalizeAttachment(input, defaultCategory, user, timestamp) {
  const file = input?.file || input
  const mimeType = input?.mimeType || file?.type || 'application/octet-stream'
  const category =
    input?.categoria ||
    input?.documentType ||
    input?.tipoDocumento ||
    defaultCategory ||
    (mimeType.startsWith('image/') ? 'Foto' : 'Outro')
  return {
    id: input?.id || createId('ANX'),
    nome: input?.nome || input?.name || file?.name || 'Arquivo sem nome',
    categoria: category,
    tipo: category,
    mimeType,
    tamanho: Number(input?.tamanho ?? input?.size ?? file?.size ?? 0),
    dataInclusao: timestamp,
    incluidoPor: normalizeActor(user),
    url: input?.url || null,
    removido: false,
  }
}

export function addAttachments(id, files, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const timestamp = nowIso()
  const inputList = Array.from(files || [])
  if (!inputList.length) return []
  let attachments = []

  mutateReceipt(id, (receipt) => {
    attachments = inputList.map((file) =>
      normalizeAttachment(file, options.category || options.categoria, user, timestamp),
    )
    return {
      ...receipt,
      anexos: [...(receipt.anexos || []), ...attachments],
      atualizadoEm: timestamp,
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(
          user,
          attachments.length === 1 ? 'Arquivo incluído' : 'Arquivos incluídos',
          attachments.map((entry) => entry.nome).join(', '),
          timestamp,
        ),
      ],
    }
  })
  return attachments
}

export function addAttachment(id, file, categoryOrOptions = {}, maybeOptions = {}) {
  const options =
    typeof categoryOrOptions === 'string'
      ? { ...maybeOptions, category: categoryOrOptions }
      : categoryOrOptions
  return addAttachments(id, [file], options)[0]
}

export const addAnexo = addAttachment
export const addAnexos = addAttachments

/** Exclusão lógica: o arquivo continua no histórico de auditoria. */
export function removeAttachment(id, attachmentId, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const timestamp = nowIso()
  let removed
  mutateReceipt(id, (receipt) => {
    if (receipt.status === RECEBIMENTO_STATUS.FINALIZADO && !isAdministrator(user)) {
      throw new Error('Somente um administrador pode remover anexos de um recebimento finalizado.')
    }
    const index = (receipt.anexos || []).findIndex((entry) => entry.id === attachmentId)
    if (index < 0) throw new Error('Arquivo não encontrado.')
    if (receipt.anexos[index].removido) return receipt
    removed = {
      ...receipt.anexos[index],
      removido: true,
      removidoEm: timestamp,
      removidoPor: normalizeActor(user),
      motivoRemocao: options.reason || options.motivo || '',
    }
    const anexos = [...receipt.anexos]
    anexos[index] = removed
    return {
      ...receipt,
      anexos,
      atualizadoEm: timestamp,
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(user, 'Arquivo removido', removed.nome, timestamp),
      ],
    }
  })
  return removed
}

export const removeAnexo = removeAttachment

export function addDivergence(id, input = {}, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const tipo = input.tipo || input.type || 'Outro'
  const descricao = String(input.descricao || input.description || '').trim()
  if (!descricao) throw new Error('Descreva a divergência encontrada.')
  const timestamp = nowIso()
  let created

  mutateReceipt(id, (receipt) => {
    if (receipt.status === RECEBIMENTO_STATUS.FINALIZADO && !isAdministrator(user)) {
      throw new Error('Reabra o recebimento antes de registrar uma divergência.')
    }
    if (input.itemId && !(receipt.itens || []).some((entry) => entry.id === input.itemId)) {
      throw new Error('O item vinculado à divergência não foi encontrado.')
    }
    created = {
      id: input.id || createId('DIV'),
      tipo,
      descricao,
      itemId: input.itemId || null,
      criadaEm: timestamp,
      criadaPor: normalizeActor(user),
      resolvida: false,
      resolvidaEm: null,
      resolvidaPor: null,
      resolucao: '',
    }
    const shouldMoveStatus =
      options.moveStatus !== false && receipt.status === RECEBIMENTO_STATUS.CONFERENCIA
    const nextStatus = shouldMoveStatus ? RECEBIMENTO_STATUS.DIVERGENCIA : receipt.status
    return {
      ...receipt,
      status: nextStatus,
      atualizadoEm: timestamp,
      divergencias: [...(receipt.divergencias || []), created],
      historicoStatus: shouldMoveStatus
        ? [
            ...(receipt.historicoStatus || []),
            statusEntry(
              user,
              receipt.status,
              RECEBIMENTO_STATUS.DIVERGENCIA,
              'Divergência registrada.',
              timestamp,
            ),
          ]
        : receipt.historicoStatus || [],
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(user, 'Divergência registrada', `${tipo}: ${descricao}`, timestamp),
      ],
    }
  })
  return created
}

export const addDivergencia = addDivergence

export function resolveDivergence(id, divergenceId, resolution, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const resolutionText = String(resolution || options.resolucao || '').trim()
  if (!resolutionText) throw new Error('Informe como a divergência foi resolvida.')
  const timestamp = nowIso()
  let resolved

  mutateReceipt(id, (receipt) => {
    const index = (receipt.divergencias || []).findIndex((entry) => entry.id === divergenceId)
    if (index < 0) throw new Error('Divergência não encontrada.')
    if (receipt.divergencias[index].resolvida) return receipt
    resolved = {
      ...receipt.divergencias[index],
      resolvida: true,
      resolvidaEm: timestamp,
      resolvidaPor: normalizeActor(user),
      resolucao: resolutionText,
    }
    const divergencias = [...receipt.divergencias]
    divergencias[index] = resolved
    return {
      ...receipt,
      divergencias,
      atualizadoEm: timestamp,
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(user, 'Divergência resolvida', resolutionText, timestamp),
      ],
    }
  })
  return resolved
}

export const resolveDivergencia = resolveDivergence

export function reopenDivergence(id, divergenceId, reason = '', options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const timestamp = nowIso()
  let reopened
  mutateReceipt(id, (receipt) => {
    const index = (receipt.divergencias || []).findIndex((entry) => entry.id === divergenceId)
    if (index < 0) throw new Error('Divergência não encontrada.')
    reopened = {
      ...receipt.divergencias[index],
      resolvida: false,
      resolvidaEm: null,
      resolvidaPor: null,
      resolucao: '',
    }
    const divergencias = [...receipt.divergencias]
    divergencias[index] = reopened
    return {
      ...receipt,
      divergencias,
      atualizadoEm: timestamp,
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(user, 'Divergência reaberta', reason || reopened.descricao, timestamp),
      ],
    }
  })
  return reopened
}

export function transitionStatus(id, nextStatus, options = {}) {
  const user = options.user || state.currentUser
  requireWritePermission(user)
  const timestamp = nowIso()

  return mutateReceipt(id, (receipt) => {
    const validation = validateStatusTransition(receipt, nextStatus, user)
    if (!validation.allowed && !(options.force && isAdministrator(user))) {
      throw new Error(validation.reason)
    }
    return {
      ...receipt,
      status: nextStatus,
      atualizadoEm: timestamp,
      historicoStatus: [
        ...(receipt.historicoStatus || []),
        statusEntry(
          user,
          receipt.status,
          nextStatus,
          options.note || options.observacao || '',
          timestamp,
        ),
      ],
      historicoAlteracoes: [
        ...(receipt.historicoAlteracoes || []),
        auditEntry(
          user,
          'Status alterado',
          `${receipt.status} → ${nextStatus}.`,
          timestamp,
        ),
      ],
    }
  })
}

export const changeStatus = transitionStatus
export const alterarStatus = transitionStatus

/** Arquivamento reversível; não há exclusão definitiva no MVP. */
export function archiveRecebimento(id, reason = '', options = {}) {
  const user = options.user || state.currentUser
  if (!isAdministrator(user)) throw new Error('Somente um administrador pode arquivar registros.')
  const timestamp = nowIso()
  return mutateReceipt(id, (receipt) => ({
    ...receipt,
    arquivado: true,
    arquivadoEm: timestamp,
    arquivadoPor: normalizeActor(user),
    atualizadoEm: timestamp,
    historicoAlteracoes: [
      ...(receipt.historicoAlteracoes || []),
      auditEntry(user, 'Recebimento arquivado', reason || 'Sem motivo informado.', timestamp),
    ],
  }))
}

export function restoreRecebimento(id, options = {}) {
  const user = options.user || state.currentUser
  if (!isAdministrator(user)) throw new Error('Somente um administrador pode restaurar registros.')
  const timestamp = nowIso()
  return mutateReceipt(id, (receipt) => ({
    ...receipt,
    arquivado: false,
    restauradoEm: timestamp,
    atualizadoEm: timestamp,
    historicoAlteracoes: [
      ...(receipt.historicoAlteracoes || []),
      auditEntry(user, 'Recebimento restaurado', receipt.protocolo, timestamp),
    ],
  }))
}

export function resetDemoData() {
  const fresh = makeDefaultState()
  setState(fresh)
  return fresh.recebimentos
}

export function replaceRecebimentos(recebimentos, options = {}) {
  const user = options.user || state.currentUser
  if (!isAdministrator(user)) throw new Error('Somente um administrador pode importar registros.')
  if (!Array.isArray(recebimentos)) throw new Error('A importação deve ser uma lista de recebimentos.')
  setState((current) => ({ ...current, recebimentos: cloneData(recebimentos) }))
  return state.recebimentos
}

export function queryRecebimentos(options = {}) {
  const includeArchived = Boolean(options.includeArchived)
  const visible = includeArchived
    ? state.recebimentos
    : state.recebimentos.filter((entry) => !entry.arquivado)
  const filtered = filterRecebimentos(visible, options.filters || options)
  const sorted = sortRecebimentos(
    filtered,
    options.sortBy || options.orderBy || 'dataRecebimento',
    options.direction || options.order || 'desc',
  )
  if (!options.page && !options.pageSize) return sorted
  return paginateRecebimentos(sorted, options.page, options.pageSize)
}

export function getDashboard(options = {}) {
  const rows = options.includeArchived
    ? state.recebimentos
    : state.recebimentos.filter((entry) => !entry.arquivado)
  return getDashboardMetrics(rows, options.referenceDate)
}

export function buildCsvExport(filters = {}, options = {}) {
  const rows = queryRecebimentos({ filters, sortBy: 'dataRecebimento', direction: 'desc' })
  return exportRecebimentosCsv(rows, options)
}

export const storeActions = Object.freeze({
  setCurrentUser,
  selectRecebimento,
  createRecebimento,
  createReceipt,
  updateRecebimento,
  updateReceipt,
  addItem,
  updateItem,
  removeItem,
  addAttachment,
  addAttachments,
  removeAttachment,
  addDivergence,
  resolveDivergence,
  reopenDivergence,
  transitionStatus,
  archiveRecebimento,
  restoreRecebimento,
  resetDemoData,
  replaceRecebimentos,
})

/**
 * Hook sem Provider: todos os componentes observam a mesma instância persistida.
 * Se filtros/paginação forem passados, o resultado derivado vem em `view`.
 */
export function useRecebimentosStore(options = {}) {
  const snapshot = useSyncExternalStore(
    subscribeToRecebimentos,
    getStoreSnapshot,
    getServerSnapshot,
  )
  const optionsKey = JSON.stringify(options || {})
  const derived = useMemo(() => {
    const includeArchived = Boolean(options.includeArchived)
    const visible = includeArchived
      ? snapshot.recebimentos
      : snapshot.recebimentos.filter((entry) => !entry.arquivado)
    const filtered = filterRecebimentos(visible, options.filters || options)
    const sorted = sortRecebimentos(
      filtered,
      options.sortBy || options.orderBy || 'dataRecebimento',
      options.direction || options.order || 'desc',
    )
    const view = options.page || options.pageSize
      ? paginateRecebimentos(sorted, options.page, options.pageSize)
      : sorted
    return {
      visible,
      filtered,
      sorted,
      view,
      dashboard: getDashboardMetrics(visible, options.referenceDate),
    }
    // `optionsKey` estabiliza objetos de filtro criados inline pelos componentes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.recebimentos, optionsKey])

  const selectedRecebimento = snapshot.recebimentos.find(
    (entry) => entry.id === snapshot.selectedRecebimentoId,
  ) || null

  return {
    ...snapshot,
    receipts: snapshot.recebimentos,
    currentUser: snapshot.currentUser,
    usuarioAtual: snapshot.currentUser,
    suppliers,
    fornecedores: suppliers,
    unitCatalog,
    unidades: unitCatalog,
    receiptTypes,
    tiposRecebimento: receiptTypes,
    statusCatalog,
    documentTypes,
    divergenceTypes,
    selectedRecebimento,
    filteredRecebimentos: derived.filtered,
    sortedRecebimentos: derived.sorted,
    view: derived.view,
    dashboard: derived.dashboard,
    metrics: derived.dashboard,
    actions: storeActions,
    ...storeActions,
    getRecebimentoById,
    getReceiptById,
    queryRecebimentos,
    buildCsvExport,
  }
}

export const useReceiptStore = useRecebimentosStore
export default useRecebimentosStore

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const parsed = JSON.parse(event.newValue)
      if (!Array.isArray(parsed.recebimentos)) return
      state = {
        ...state,
        ...parsed,
        selectedRecebimentoId: state.selectedRecebimentoId,
      }
      emit()
    } catch {
      // Uma aba pode ter gravado um valor incompleto; a instância atual é mantida.
    }
  })
}
