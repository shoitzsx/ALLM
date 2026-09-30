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
// _rowNumber é interno do repository (nunca sai na resposta pública — ver
// attachmentResponse em app.mjs) — permite atualizar/remover 1 anexo depois
// sem reler a sheet inteira de novo só para redescobrir a linha.
function attachmentFromRow(row) {
  const data = row.data
  return { id: data.id, nome: data.nome, categoria: data.categoria, tipo: data.tipo, mimeType: data.mimeType, tamanho: number(data.tamanho), storageKey: data.storageKey, url: text(data.url), incluidoPor: json(data.incluidoPor), dataInclusao: data.dataInclusao, removido: bool(data.removido), removidoEm: text(data.removidoEm), removidoPor: json(data.removidoPor), motivoRemocao: data.motivoRemocao, _rowNumber: row.rowNumber }
}
function attachmentToRow(attachment, receiptId) {
  return { ...attachment, recebimentoId: receiptId, incluidoPor: JSON.stringify(attachment.incluidoPor || null), removidoPor: JSON.stringify(attachment.removidoPor || null) }
}
function auditToRow(entry, receiptId) {
  return { id: entry.id, recebimentoId: receiptId, data: entry.data, usuario: JSON.stringify(entry.usuario || null), acao: entry.acao, detalhes: entry.detalhes }
}

export function createRecebimentosRepository({ sheets, defaultUsers }) {
  async function listRecebimentos() {
    // As 6 sheets inteiras em 1 request HTTP (batchGet) em vez de 6 —
    // mesmos dados, mesma forma de resultado, só menos cota de leitura gasta.
    const [mainRows, itemRows, divergenceRows, statusRows, auditRows, attachmentRows] = await sheets.readManyRows([
      'Recebimentos', 'Itens', 'Divergencias', 'HistoricoStatus', 'Auditoria', 'Anexos',
    ])
    const grouped = (rows) => rows.reduce((result, row) => {
      const id = row.data.recebimentoId
      if (!result.has(id)) result.set(id, [])
      result.get(id).push(row.data)
      return result
    }, new Map())
    // Anexos precisa da linha inteira (não só row.data) pra preservar
    // rowNumber — ver attachmentFromRow.
    const groupedRows = (rows) => rows.reduce((result, row) => {
      const id = row.data.recebimentoId
      if (!result.has(id)) result.set(id, [])
      result.get(id).push(row)
      return result
    }, new Map())
    const items = grouped(itemRows)
    const divergences = grouped(divergenceRows)
    const histories = grouped(statusRows)
    const audits = grouped(auditRows)
    const attachments = groupedRows(attachmentRows)
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
        if (property === 'historicoAlteracoes') data = auditToRow(entry, receipt.id)
        if (property === 'anexos') data = attachmentToRow(entry, receipt.id)
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

  async function touchRecebimentoRow(receipt) {
    const rows = await sheets.readRows('Recebimentos')
    const current = rows.find((row) => row.data.id === receipt.id)
    if (current) await sheets.updateRow('Recebimentos', current.rowNumber, receiptToRow(receipt))
  }

  // Caminho dedicado para adicionar 1 anexo: toca só Recebimentos (atualizadoEm)
  // + as linhas novas em Anexos e Auditoria num único batch atômico — nunca relê/regrava
  // Itens, Divergencias ou HistoricoStatus (ao contrário de saveRecebimento/
  // replaceChildren, que reescrevem os 5 filhos inteiros a cada chamada).
  // Depende de service.addAttachment já ter colocado o novo anexo e a nova
  // entrada de auditoria como últimos elementos dos respectivos arrays.
  async function addAttachmentRow(receipt) {
    const attachment = receipt.anexos[receipt.anexos.length - 1]
    const auditEntry = receipt.historicoAlteracoes[receipt.historicoAlteracoes.length - 1]
    await touchRecebimentoRow(receipt)
    await sheets.appendAttachmentAndAudit(attachmentToRow(attachment, receipt.id), auditToRow(auditEntry, receipt.id))
    return attachment
  }

  // Caminho dedicado para remover 1 anexo: atualiza a linha existente em
  // Anexos (removido=true, etc.) em vez de apagar+reescrever a sheet
  // inteira. Depende de attachment._rowNumber, presente porque o anexo veio
  // de uma leitura anterior via listRecebimentos/attachmentFromRow — nunca
  // é uma entrada recém-criada na mesma requisição.
  async function removeAttachmentRow(receipt, attachment) {
    const auditEntry = receipt.historicoAlteracoes[receipt.historicoAlteracoes.length - 1]
    await touchRecebimentoRow(receipt)
    await sheets.updateRow('Anexos', attachment._rowNumber, attachmentToRow(attachment, receipt.id))
    await sheets.appendRow('Auditoria', auditToRow(auditEntry, receipt.id))
    return attachment
  }

  async function createRecebimento(receipt) { return saveRecebimento(receipt) }
  async function updateRecebimento(receipt) { return saveRecebimento(receipt) }
  // O PATCH exclusivo de número/série da NF altera apenas a linha principal
  // e acrescenta sua auditoria. Regravar todos os filhos aqui atrasava o
  // upload seguinte e multiplicava as chamadas à API do Sheets.
  async function updateNfFields(receipt) {
    const auditEntry = receipt.historicoAlteracoes[receipt.historicoAlteracoes.length - 1]
    const rows = await sheets.readRows('Recebimentos')
    const current = rows.find((row) => row.data.id === receipt.id)
    if (!current) throw new Error('Recebimento não encontrado para atualização da NF.')
    await sheets.updateReceiptAndAudit(current.rowNumber, receiptToRow(receipt), auditToRow(auditEntry, receipt.id))
    return receipt
  }
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
    updateNfFields,
    addItem: saveRecebimento,
    updateItem: saveRecebimento,
    removeItem: saveRecebimento,
    addDivergence: saveRecebimento,
    resolveDivergence: saveRecebimento,
    reopenDivergence: saveRecebimento,
    transitionStatus: saveRecebimento,
    addAttachment: saveRecebimento,
    removeAttachment: saveRecebimento,
    addAttachmentRow,
    removeAttachmentRow,
    archiveRecebimento,
    restoreRecebimento,
    listUsuarios,
    getUsuario,
    saveUsuario,
  }
}
