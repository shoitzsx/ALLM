const childSheets = {
  itens: 'Itens',
  divergencias: 'Divergencias',
  historicoStatus: 'HistoricoStatus',
  historicoAlteracoes: 'Auditoria',
  anexos: 'Anexos',
}

const json = (value, fallback = null) => {
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}
const bool = (value) => value === true || String(value).toLowerCase() === 'true'
const number = (value) => Number(value || 0)
const text = (value) => value === '' ? null : value

function receiptFromRow(row) {
  const data = row.data
  return {
    id: data.id,
    protocolo: data.protocolo,
    pedido: data.pedido,
    numeroNf: text(data.numeroNf),
    serieNf: text(data.serieNf),
    dataRecebimento: data.dataRecebimento,
    fornecedor: data.fornecedor,
    cnpjFornecedor: data.cnpjFornecedor,
    tipo: data.tipo,
    responsavel: json(data.responsavel, { id: data.responsavelId, nome: data.responsavelNome, name: data.responsavelNome }),
    status: data.status,
    observacoes: data.observacoes,
    criadoEm: data.criadoEm,
    atualizadoEm: data.atualizadoEm,
    arquivado: bool(data.arquivado),
    arquivadoEm: text(data.arquivadoEm),
    arquivadoPor: json(data.arquivadoPor),
    restauradoEm: text(data.restauradoEm),
  }
}

function receiptToRow(receipt) {
  return {
    id: receipt.id,
    protocolo: receipt.protocolo,
    pedido: receipt.pedido,
    numeroNf: receipt.numeroNf,
    serieNf: receipt.serieNf,
    dataRecebimento: receipt.dataRecebimento,
    fornecedor: receipt.fornecedor,
    cnpjFornecedor: receipt.cnpjFornecedor,
    tipo: receipt.tipo,
    responsavelId: receipt.responsavel?.id,
    responsavelNome: receipt.responsavel?.nome || receipt.responsavel?.name,
    responsavel: JSON.stringify(receipt.responsavel || {}),
    status: receipt.status,
    observacoes: receipt.observacoes,
    criadoEm: receipt.criadoEm,
    atualizadoEm: receipt.atualizadoEm,
    arquivado: Boolean(receipt.arquivado),
    arquivadoEm: receipt.arquivadoEm,
    arquivadoPor: JSON.stringify(receipt.arquivadoPor || null),
    restauradoEm: receipt.restauradoEm,
  }
}

function itemFromRow(data) {
  return { id: data.id, numero: data.numero, codigo: data.codigo, descricao: data.descricao, quantidadeSolicitada: number(data.quantidadeSolicitada), quantidadeRecebida: number(data.quantidadeRecebida), unidade: data.unidade }
}
function divergenceFromRow(data) {
  return { id: data.id, tipo: data.tipo, descricao: data.descricao, itemId: text(data.itemId), criadaEm: data.criadaEm, criadaPor: json(data.criadaPor), resolvida: bool(data.resolvida), resolvidaEm: text(data.resolvidaEm), resolvidaPor: json(data.resolvidaPor), resolucao: data.resolucao }
}
function historyFromRow(data) {
  return { id: data.id, data: data.data, usuario: json(data.usuario), de: text(data.statusAnterior), para: data.novoStatus, observacao: data.observacao }
}
function auditFromRow(data) {
  return { id: data.id, data: data.data, usuario: json(data.usuario), acao: data.acao, detalhes: data.detalhes }
}
function attachmentFromRow(data) {
  return { id: data.id, nome: data.nome, categoria: data.categoria, tipo: data.tipo, mimeType: data.mimeType, tamanho: number(data.tamanho), storageKey: data.storageKey, url: text(data.url), incluidoPor: json(data.incluidoPor), dataInclusao: data.dataInclusao, removido: bool(data.removido), removidoEm: text(data.removidoEm), removidoPor: json(data.removidoPor), motivoRemocao: data.motivoRemocao }
}

export function createRecebimentosRepository({ sheets, defaultUsers }) {
  async function listRecebimentos() {
    const [mainRows, itemRows, divergenceRows, statusRows, auditRows, attachmentRows] = await Promise.all([
      sheets.readRows('Recebimentos'), sheets.readRows('Itens'), sheets.readRows('Divergencias'),
      sheets.readRows('HistoricoStatus'), sheets.readRows('Auditoria'), sheets.readRows('Anexos'),
    ])
    const grouped = (rows) => rows.reduce((result, row) => {
      const id = row.data.recebimentoId
      if (!result.has(id)) result.set(id, [])
      result.get(id).push(row.data)
      return result
    }, new Map())
    const items = grouped(itemRows)
    const divergences = grouped(divergenceRows)
    const histories = grouped(statusRows)
    const audits = grouped(auditRows)
    const attachments = grouped(attachmentRows)
    return mainRows.map((row) => ({
      ...receiptFromRow(row),
      itens: (items.get(row.data.id) || []).map(itemFromRow),
      divergencias: (divergences.get(row.data.id) || []).map(divergenceFromRow),
      historicoStatus: (histories.get(row.data.id) || []).map(historyFromRow),
      historicoAlteracoes: (audits.get(row.data.id) || []).map(auditFromRow),
      anexos: (attachments.get(row.data.id) || []).map(attachmentFromRow),
    }))
  }

  async function getRecebimento(id) {
    return (await listRecebimentos()).find((entry) => entry.id === id || entry.protocolo === id) || null
  }

  async function replaceChildren(receipt) {
    for (const [property, sheetName] of Object.entries(childSheets)) {
      const existing = await sheets.readRows(sheetName)
      await sheets.deleteRows(sheetName, existing.filter((row) => row.data.recebimentoId === receipt.id).map((row) => row.rowNumber))
      const entries = receipt[property] || []
      for (const entry of entries) {
        let data
        if (property === 'itens') data = { ...entry, recebimentoId: receipt.id }
        if (property === 'divergencias') data = { ...entry, recebimentoId: receipt.id, criadaPor: JSON.stringify(entry.criadaPor || null), resolvidaPor: JSON.stringify(entry.resolvidaPor || null) }
        if (property === 'historicoStatus') data = { id: entry.id, recebimentoId: receipt.id, data: entry.data, usuario: JSON.stringify(entry.usuario || null), statusAnterior: entry.de, novoStatus: entry.para, observacao: entry.observacao }
        if (property === 'historicoAlteracoes') data = { id: entry.id, recebimentoId: receipt.id, data: entry.data, usuario: JSON.stringify(entry.usuario || null), acao: entry.acao, detalhes: entry.detalhes }
        if (property === 'anexos') data = { ...entry, recebimentoId: receipt.id, incluidoPor: JSON.stringify(entry.incluidoPor || null), removidoPor: JSON.stringify(entry.removidoPor || null) }
        await sheets.appendRow(sheetName, data)
      }
    }
  }

  async function saveRecebimento(receipt) {
    const rows = await sheets.readRows('Recebimentos')
    const current = rows.find((row) => row.data.id === receipt.id)
    if (current) await sheets.updateRow('Recebimentos', current.rowNumber, receiptToRow(receipt))
    else await sheets.appendRow('Recebimentos', receiptToRow(receipt))
    await replaceChildren(receipt)
    return receipt
  }

  async function createRecebimento(receipt) { return saveRecebimento(receipt) }
  async function updateRecebimento(receipt) { return saveRecebimento(receipt) }
  async function archiveRecebimento(receipt) { return saveRecebimento(receipt) }
  async function restoreRecebimento(receipt) { return saveRecebimento(receipt) }

  async function listUsuarios() {
    const rows = await sheets.readRows('Usuarios')
    return rows.map(({ data }) => ({ ...data, ativo: bool(data.ativo) }))
  }
  async function ensureUsuarios() {
    const users = await listUsuarios()
    if (users.length) return users
    for (const user of defaultUsers) await sheets.appendRow('Usuarios', user)
    return defaultUsers
  }
  async function getUsuario(id) { return (await listUsuarios()).find((user) => user.id === id) || null }
  async function saveUsuario(user) {
    const rows = await sheets.readRows('Usuarios')
    const existing = rows.find((row) => row.data.id === user.id)
    if (existing) await sheets.updateRow('Usuarios', existing.rowNumber, user)
    else await sheets.appendRow('Usuarios', user)
    return user
  }

  async function initialize() { await sheets.ensureSchema(); await ensureUsuarios() }
  // As mutações de entidades filhas reescrevem somente as linhas daquele
  // recebimento, localizadas sempre pelo `id` — nunca pelo número da linha.
  return {
    initialize,
    listRecebimentos,
    getRecebimento,
    createRecebimento,
    updateRecebimento,
    addItem: saveRecebimento,
    updateItem: saveRecebimento,
    removeItem: saveRecebimento,
    addDivergence: saveRecebimento,
    resolveDivergence: saveRecebimento,
    reopenDivergence: saveRecebimento,
    transitionStatus: saveRecebimento,
    addAttachment: saveRecebimento,
    removeAttachment: saveRecebimento,
    archiveRecebimento,
    restoreRecebimento,
    listUsuarios,
    getUsuario,
    saveUsuario,
  }
}
