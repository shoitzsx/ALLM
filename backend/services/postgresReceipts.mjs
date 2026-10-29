import { authFailure } from '../auth/postgresAuth.mjs'

const STATUS = Object.freeze({
  EM_DIGITACAO: 'Em digitação',
  AGUARDANDO_DOCUMENTACAO: 'Aguardando documentação',
  EM_CONFERENCIA: 'Em conferência',
  DIVERGENCIA_IDENTIFICADA: 'Divergência identificada',
  CONFERIDO_FINALIZADO: 'Conferido/Finalizado',
})
const TYPE = Object.freeze({
  Estoque: 'ESTOQUE', 'Débito Direto': 'DEBITO_DIRETO',
  Industrialização: 'INDUSTRIALIZACAO', Comodato: 'COMODATO', Outro: 'OUTRO',
})
const DOCUMENT = Object.freeze({
  'Nota Fiscal': 'NOTA_FISCAL', DACTE: 'DACTE', Pedido: 'PEDIDO_COMPRA',
  Foto: 'FOTO_PRODUTO', Certificado: 'CERTIFICADO', Outro: 'OUTRO',
})
const DIVERGENCE = Object.freeze({
  'Quantidade incorreta': 'QUANTIDADE_INCORRETA',
  'Material avariado': 'MATERIAL_AVARIADO',
  'Material diferente': 'MATERIAL_DIFERENTE',
  'Falta de documentação': 'FALTA_DOCUMENTACAO',
  'Problema de embalagem': 'PROBLEMA_EMBALAGEM', Outro: 'OUTRO',
})
const TRANSITIONS = Object.freeze({
  EM_DIGITACAO: ['AGUARDANDO_DOCUMENTACAO', 'EM_CONFERENCIA'],
  AGUARDANDO_DOCUMENTACAO: ['EM_DIGITACAO', 'EM_CONFERENCIA'],
  EM_CONFERENCIA: ['EM_DIGITACAO', 'AGUARDANDO_DOCUMENTACAO', 'DIVERGENCIA_IDENTIFICADA', 'CONFERIDO_FINALIZADO'],
  DIVERGENCIA_IDENTIFICADA: ['EM_CONFERENCIA', 'CONFERIDO_FINALIZADO'],
  CONFERIDO_FINALIZADO: ['EM_CONFERENCIA'],
})
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const documentCode = (value) => DOCUMENT[value] || (Object.values(DOCUMENT).includes(value) ? value : null)
export const documentLabel = (value) => Object.keys(DOCUMENT).find((key) => DOCUMENT[key] === value) || value
export const statusCode = (value) => STATUS[value] ? value : Object.keys(STATUS).find((key) => STATUS[key] === value)
export const typeCode = (value) => TYPE[value] || (Object.values(TYPE).includes(value) ? value : null)
const typeLabel = (value) => Object.keys(TYPE).find((key) => TYPE[key] === value) || value
const divergenceCode = (value) => DIVERGENCE[value] || (Object.values(DIVERGENCE).includes(value) ? value : null)
const divergenceLabel = (value) => Object.keys(DIVERGENCE).find((key) => DIVERGENCE[key] === value) || value
const clean = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const invalid = (message) => authFailure(422, 'VALIDATION_ERROR', message)
const conflict = (message) => authFailure(409, 'CONFLICT', message)
const dateOnly = (value) => value ? new Date(value).toISOString().slice(0, 10) : null

export function itemResponse(row) {
  return { id: row.id, numero: String(row.numero_item), codigo: row.codigo_produto || '',
    descricao: row.descricao, quantidadeSolicitada: row.quantidade_solicitada == null ? null : Number(row.quantidade_solicitada),
    quantidadeRecebida: Number(row.quantidade_recebida), unidade: row.unidade_codigo === 'PC' ? 'PÇ' : row.unidade_codigo,
    observacoes: row.observacoes || '' }
}

export function divergenceResponse(row) {
  return { id: row.id, tipo: divergenceLabel(row.tipo_divergencia_codigo),
    descricao: row.descricao, itemId: row.item_id, status: row.status,
    criadaEm: row.criado_em, criadaPor: row.criada_por_nome ? { id: row.criado_por, nome: row.criada_por_nome } : null,
    resolvida: row.status === 'RESOLVIDA', resolvidaEm: row.resolvida_em,
    resolvidaPor: row.resolvida_por_nome ? { id: row.resolvida_por, nome: row.resolvida_por_nome } : null,
    resolucao: row.resolucao || '' }
}

export function attachmentResponse(row) {
  return { id: row.id, nome: row.nome_original, categoria: documentLabel(row.tipo_arquivo_codigo),
    tipo: documentLabel(row.tipo_arquivo_codigo), mimeType: row.mime_type_detectado,
    tamanho: Number(row.tamanho_bytes), dataInclusao: row.criado_em,
    incluidoPor: row.incluido_por_nome ? { id: row.criado_por, nome: row.incluido_por_nome } : null,
    url: `/api/v1/recebimentos/${row.recebimento_id}/anexos/${row.id}/download`,
    removido: Boolean(row.excluido_em), statusUpload: row.status_upload }
}

export function receiptResponse(row) {
  return {
    id: row.id, codigo: row.codigo, protocolo: row.codigo, codigoLegado: row.codigo_legado,
    pedido: row.pedido_compra || '', numeroNf: row.numero_nf || null, serieNf: row.serie_nf || null,
    nfeChaveAcesso: row.nfe_chave_acesso?.trim() || null,
    fornecedorId: row.fornecedor_id, fornecedor: row.fornecedor_nome_snapshot || '',
    cnpjFornecedor: row.fornecedor_cnpj_snapshot?.trim() || '',
    tipoCodigo: row.tipo_codigo, tipo: typeLabel(row.tipo_codigo),
    status: STATUS[row.status] || row.status, statusCodigo: row.status,
    qualidadeDados: row.qualidade_dados, dataRecebimento: dateOnly(row.recebido_em || row.criado_em),
    recebidoEm: row.recebido_em, criadoEm: row.criado_em, atualizadoEm: row.alterado_em,
    alteradoEm: row.alterado_em, responsavelId: row.responsavel_id,
    responsavel: row.responsavel_nome ? { id: row.responsavel_id, nome: row.responsavel_nome } : null,
    observacoes: row.observacoes || '', arquivado: Boolean(row.excluido_em),
    itens: row.itens || [], anexos: row.anexos || [], divergencias: row.divergencias || [],
    historicoStatus: row.historicoStatus || [], historicoAlteracoes: row.historicoAlteracoes || [],
  }
}

const RECEIPT_SELECT = `SELECT r.*, t.codigo AS tipo_codigo, u.nome AS responsavel_nome
  FROM alm.recebimentos r
  LEFT JOIN alm.tipos_recebimento t ON t.id=r.tipo_recebimento_id
  LEFT JOIN alm.usuarios u ON u.id=r.responsavel_id`

export async function findReceipt(client, id, { lock = false, includeArchived = false, full = true } = {}) {
  const { rows: [row] } = await client.query(`${RECEIPT_SELECT}
    WHERE (r.id::text=$1 OR r.codigo=$1) ${includeArchived ? '' : 'AND r.excluido_em IS NULL'}
    ${lock ? 'FOR UPDATE OF r' : ''}`, [id])
  if (!row) throw authFailure(404, 'RECEIPT_NOT_FOUND', 'Recebimento não encontrado.')
  if (!full) return row
  return (await attachChildren(client, [row]))[0]
}

export async function listReceipts(client, params) {
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1))
  const pageSize = Math.max(1, Math.min(100, Number(params.get('pageSize')) || 50))
  const includeArchived = params.get('includeArchived') === 'true'
  const q = clean(params.get('q') || '', 200)
  const status = statusCode(params.get('status'))
  const conditions = [includeArchived ? 'true' : 'r.excluido_em IS NULL']
  const values = []
  if (q) { values.push(`%${q}%`); conditions.push(`(r.codigo ILIKE $${values.length} OR r.pedido_compra ILIKE $${values.length} OR r.numero_nf ILIKE $${values.length} OR r.fornecedor_nome_snapshot ILIKE $${values.length})`) }
  if (status) { values.push(status); conditions.push(`r.status=$${values.length}`) }
  const where = conditions.join(' AND ')
  const { rows: [count] } = await client.query(`SELECT count(*)::int AS total FROM alm.recebimentos r WHERE ${where}`, values)
  const { rows } = await client.query(`${RECEIPT_SELECT} WHERE ${where}
    ORDER BY r.criado_em DESC,r.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
  [...values, pageSize, (page - 1) * pageSize])
  const data = (await attachChildren(client, rows)).map(receiptResponse)
  return { data, pagination: { page, pageSize, total: count.total,
    totalPages: Math.max(1, Math.ceil(count.total / pageSize)) } }
}

async function attachChildren(client, rows) {
  if (!rows.length) return rows
  const ids = rows.map((row) => row.id)
  const items = await client.query(`SELECT * FROM alm.recebimento_itens WHERE recebimento_id=ANY($1::uuid[])
      AND excluido_em IS NULL ORDER BY numero_item`, [ids])
  const divergences = await client.query(`SELECT d.*, c.nome AS criada_por_nome, u.nome AS resolvida_por_nome
      FROM alm.divergencias d LEFT JOIN alm.usuarios c ON c.id=d.criado_por
      LEFT JOIN alm.usuarios u ON u.id=d.resolvida_por
      WHERE d.recebimento_id=ANY($1::uuid[]) AND d.excluido_em IS NULL ORDER BY d.criado_em`, [ids])
  const attachments = await client.query(`SELECT a.*, u.nome AS incluido_por_nome FROM alm.arquivos a
      LEFT JOIN alm.usuarios u ON u.id=a.criado_por
      WHERE a.recebimento_id=ANY($1::uuid[]) AND a.excluido_em IS NULL
      AND a.status_upload='DISPONIVEL' ORDER BY a.criado_em`, [ids])
  const statusHistory = await client.query(`SELECT h.*, u.nome AS usuario_nome FROM alm.recebimento_status_historico h
      LEFT JOIN alm.usuarios u ON u.id=h.alterado_por
      WHERE h.recebimento_id=ANY($1::uuid[]) ORDER BY h.alterado_em`, [ids])
  const auditHistory = await client.query(`SELECT h.id,h.recebimento_id,h.criado_em,h.usuario_id,h.acao,h.entidade,h.detalhes,
      u.nome AS usuario_nome FROM alm.historico_alteracoes h
      LEFT JOIN alm.usuarios u ON u.id=h.usuario_id
      WHERE h.recebimento_id=ANY($1::uuid[]) ORDER BY h.criado_em`, [ids])
  const grouped = (entries, transform) => {
    const map = new Map()
    for (const entry of entries) {
      const bucket = map.get(entry.recebimento_id) || []
      bucket.push(transform(entry))
      map.set(entry.recebimento_id, bucket)
    }
    return map
  }
  const itemMap = grouped(items.rows, itemResponse)
  const divergenceMap = grouped(divergences.rows, divergenceResponse)
  const attachmentMap = grouped(attachments.rows, attachmentResponse)
  const historyMap = grouped(statusHistory.rows, (entry) => ({ id: entry.id, data: entry.alterado_em,
    de: STATUS[entry.status_anterior] || null, para: STATUS[entry.status_novo],
    observacao: entry.observacao || '', usuario: entry.usuario_nome ? { id: entry.alterado_por, nome: entry.usuario_nome } : null }))
  const auditMap = grouped(auditHistory.rows, (entry) => ({ id: entry.id, data: entry.criado_em,
    acao: `${entry.entidade}: ${entry.acao}`, detalhes: entry.detalhes || '',
    usuario: entry.usuario_nome ? { id: entry.usuario_id, nome: entry.usuario_nome } : null }))
  return rows.map((row) => ({ ...row, itens: itemMap.get(row.id) || [],
    divergencias: divergenceMap.get(row.id) || [], anexos: attachmentMap.get(row.id) || [],
    historicoStatus: historyMap.get(row.id) || [], historicoAlteracoes: auditMap.get(row.id) || [] }))
}

async function lookupType(client, value) {
  const code = typeCode(value)
  if (!code) throw invalid('Tipo de recebimento inválido.')
  const { rows: [row] } = await client.query('SELECT id FROM alm.tipos_recebimento WHERE codigo=$1 AND ativo=true', [code])
  if (!row) throw invalid('Tipo de recebimento indisponível.')
  return row.id
}

async function lookupSupplier(client, name, cnpj, suppliedId, actorId) {
  if (suppliedId) {
    if (!UUID.test(suppliedId)) throw invalid('Fornecedor inválido.')
    const { rows: [row] } = await client.query('SELECT id FROM alm.fornecedores WHERE id=$1 AND ativo=true', [suppliedId])
    if (!row) throw invalid('Fornecedor indisponível.')
    return row.id
  }
  const cleanName = clean(name, 300)
  const cleanCnpj = clean(cnpj, 30).replace(/\D/g, '')
  if (!cleanName) return null
  if (cleanCnpj && !/^\d{14}$/.test(cleanCnpj)) throw invalid('CNPJ do fornecedor inválido.')
  const { rows: [existing] } = await client.query(`SELECT id FROM alm.fornecedores
    WHERE ativo=true AND (${cleanCnpj ? 'cnpj=$1' : 'lower(razao_social)=lower($1)'}) LIMIT 1`,
  [cleanCnpj || cleanName])
  if (existing) return existing.id
  const { rows: [created] } = await client.query(`INSERT INTO alm.fornecedores
    (cnpj,razao_social,criado_por,alterado_por) VALUES($1,$2,$3,$3) RETURNING id`,
  [cleanCnpj || null, cleanName, actorId])
  return created.id
}

export async function createReceipt(client, input, actorId) {
  if (input.itens != null && !Array.isArray(input.itens)) throw invalid('Itens devem ser uma lista.')
  const pedido = clean(input.pedido, 200) || null
  const numeroNf = clean(input.numeroNf, 100) || null
  const serieNf = clean(input.serieNf, 50) || null
  const key = clean(input.nfeChaveAcesso, 44) || null
  if (key && !/^\d{44}$/.test(key)) throw invalid('Chave NF-e inválida.')
  const typeId = await lookupType(client, input.tipoCodigo || input.tipo || 'Estoque')
  const supplierId = await lookupSupplier(client, input.fornecedor, input.cnpjFornecedor, input.fornecedorId, actorId)
  const receivedAt = input.dataRecebimento ? new Date(`${input.dataRecebimento}T12:00:00.000Z`) : new Date()
  if (Number.isNaN(receivedAt.getTime())) throw invalid('Data de recebimento inválida.')
  const { rows: [created] } = await client.query(`INSERT INTO alm.recebimentos
    (qualidade_dados,pedido_compra,numero_nf,serie_nf,nfe_chave_acesso,fornecedor_id,
     tipo_recebimento_id,status,observacoes,criado_por,alterado_por,responsavel_id,recebido_em)
    VALUES('PENDENTE_CONFERENCIA',$1,$2,$3,$4,$5,$6,'EM_DIGITACAO',$7,$8,$8,$8,$9)
    RETURNING id`, [pedido, numeroNf, serieNf, key, supplierId, typeId,
    clean(input.observacoes, 4000) || null, actorId, receivedAt])
  for (const item of input.itens || []) await createItem(client, created.id, item, actorId)
  return receiptResponse(await findReceipt(client, created.id))
}

export async function updateReceipt(client, id, input, actorId) {
  const row = await findReceipt(client, id, { lock: true, full: false })
  if (row.status === 'CONFERIDO_FINALIZADO') throw conflict('Reabra o recebimento antes de editar.')
  const allowed = ['pedido', 'numeroNf', 'serieNf', 'nfeChaveAcesso', 'observacoes',
    'dataRecebimento', 'tipo', 'tipoCodigo', 'fornecedor', 'cnpjFornecedor', 'fornecedorId']
  const changed = Object.keys(input).filter((key) => allowed.includes(key))
  if (!changed.length) throw invalid('Nenhum campo editável informado.')
  const values = []
  const sets = []
  const put = (column, value) => { values.push(value); sets.push(`${column}=$${values.length}`) }
  if ('pedido' in input) put('pedido_compra', clean(input.pedido, 200) || null)
  if ('numeroNf' in input) put('numero_nf', clean(input.numeroNf, 100) || null)
  if ('serieNf' in input) put('serie_nf', clean(input.serieNf, 50) || null)
  if ('nfeChaveAcesso' in input) {
    const key = clean(input.nfeChaveAcesso, 44) || null
    if (key && !/^\d{44}$/.test(key)) throw invalid('Chave NF-e inválida.')
    put('nfe_chave_acesso', key)
  }
  if ('observacoes' in input) put('observacoes', clean(input.observacoes, 4000) || null)
  if ('dataRecebimento' in input) {
    const date = new Date(`${input.dataRecebimento}T12:00:00.000Z`)
    if (Number.isNaN(date.getTime())) throw invalid('Data de recebimento inválida.')
    put('recebido_em', date)
  }
  if ('tipo' in input || 'tipoCodigo' in input) put('tipo_recebimento_id', await lookupType(client, input.tipoCodigo || input.tipo))
  if ('fornecedor' in input || 'cnpjFornecedor' in input || 'fornecedorId' in input) {
    put('fornecedor_id', await lookupSupplier(client, input.fornecedor || row.fornecedor_nome_snapshot,
      input.cnpjFornecedor || row.fornecedor_cnpj_snapshot, input.fornecedorId, actorId))
  }
  values.push(actorId, row.id)
  await client.query(`UPDATE alm.recebimentos SET ${sets.join(',')}, alterado_por=$${values.length - 1}
    WHERE id=$${values.length}`, values)
  return receiptResponse(await findReceipt(client, row.id))
}

function normalizeItem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Dados do item inválidos.')
  const numero = Number(input.numero)
  const quantidadeRecebida = Number(input.quantidadeRecebida ?? input.quantidade)
  const quantidadeSolicitada = input.quantidadeSolicitada == null || input.quantidadeSolicitada === ''
    ? null : Number(input.quantidadeSolicitada)
  const unidade = clean(input.unidade, 12).toUpperCase() === 'PÇ' ? 'PC' : clean(input.unidade || 'UN', 12).toUpperCase()
  if (!Number.isInteger(numero) || numero < 1 || !clean(input.descricao, 2000)
    || !Number.isFinite(quantidadeRecebida) || quantidadeRecebida <= 0
    || (quantidadeSolicitada != null && (!Number.isFinite(quantidadeSolicitada) || quantidadeSolicitada < 0))
    || !/^[A-Z0-9._/-]{1,12}$/.test(unidade)) throw invalid('Dados do item inválidos.')
  return { numero, codigo: clean(input.codigo, 200) || null,
    descricao: clean(input.descricao, 2000), quantidadeRecebida, quantidadeSolicitada,
    unidade, observacoes: clean(input.observacoes, 2000) || null }
}

export async function createItem(client, receiptId, input, actorId) {
  const receipt = await findReceipt(client, receiptId, { lock: true, full: false })
  if (receipt.status === 'CONFERIDO_FINALIZADO') throw conflict('Reabra o recebimento antes de incluir itens.')
  const item = normalizeItem(input)
  const { rows: [row] } = await client.query(`INSERT INTO alm.recebimento_itens
    (recebimento_id,numero_item,codigo_produto,descricao,quantidade_solicitada,
     quantidade_recebida,unidade_codigo,observacoes,criado_por,alterado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
  [receipt.id, item.numero, item.codigo, item.descricao, item.quantidadeSolicitada,
    item.quantidadeRecebida, item.unidade, item.observacoes, actorId])
  return itemResponse(row)
}

export async function updateItem(client, receiptId, itemId, input, actorId) {
  const receipt = await findReceipt(client, receiptId, { lock: true, full: false })
  if (receipt.status === 'CONFERIDO_FINALIZADO') throw conflict('Reabra o recebimento antes de editar itens.')
  const { rows: [old] } = await client.query(`SELECT * FROM alm.recebimento_itens
    WHERE id=$1 AND recebimento_id=$2 AND excluido_em IS NULL FOR UPDATE`, [itemId, receipt.id])
  if (!old) throw authFailure(404, 'ITEM_NOT_FOUND', 'Item não encontrado.')
  const item = normalizeItem({ numero: old.numero_item, codigo: old.codigo_produto,
    descricao: old.descricao, quantidadeSolicitada: old.quantidade_solicitada,
    quantidadeRecebida: old.quantidade_recebida, unidade: old.unidade_codigo,
    observacoes: old.observacoes, ...input })
  const { rows: [row] } = await client.query(`UPDATE alm.recebimento_itens SET
    numero_item=$3,codigo_produto=$4,descricao=$5,quantidade_solicitada=$6,
    quantidade_recebida=$7,unidade_codigo=$8,observacoes=$9,alterado_por=$10
    WHERE id=$1 AND recebimento_id=$2 RETURNING *`,
  [itemId, receipt.id, item.numero, item.codigo, item.descricao,
    item.quantidadeSolicitada, item.quantidadeRecebida, item.unidade, item.observacoes, actorId])
  return itemResponse(row)
}

export async function removeItem(client, receiptId, itemId, actorId) {
  const receipt = await findReceipt(client, receiptId, { lock: true, full: false })
  if (receipt.status === 'CONFERIDO_FINALIZADO') throw conflict('Reabra o recebimento antes de remover itens.')
  const { rows: [linked] } = await client.query(`SELECT id FROM alm.divergencias
    WHERE item_id=$1 AND recebimento_id=$2 AND excluido_em IS NULL LIMIT 1`, [itemId, receipt.id])
  if (linked) throw conflict('O item possui divergência vinculada.')
  const { rows: [file] } = await client.query(`SELECT id FROM alm.arquivos
    WHERE item_id=$1 AND recebimento_id=$2 AND excluido_em IS NULL LIMIT 1`, [itemId, receipt.id])
  if (file) throw conflict('O item possui anexo vinculado.')
  const { rows: [row] } = await client.query(`UPDATE alm.recebimento_itens SET
    excluido_em=clock_timestamp(),excluido_por=$3,motivo_exclusao='Removido pelo operador',alterado_por=$3
    WHERE id=$1 AND recebimento_id=$2 AND excluido_em IS NULL RETURNING *`, [itemId, receipt.id, actorId])
  if (!row) throw authFailure(404, 'ITEM_NOT_FOUND', 'Item não encontrado.')
  return itemResponse(row)
}

export async function createDivergence(client, receiptId, input, actorId) {
  const receipt = await findReceipt(client, receiptId, { lock: true, full: false })
  if (receipt.status === 'CONFERIDO_FINALIZADO') throw conflict('Reabra o recebimento antes de registrar divergências.')
  const tipo = divergenceCode(input.tipo)
  const descricao = clean(input.descricao, 4000)
  if (!tipo || !descricao || (input.itemId && !UUID.test(input.itemId))) throw invalid('Dados da divergência inválidos.')
  if (input.itemId) {
    const { rows: [item] } = await client.query(`SELECT id FROM alm.recebimento_itens
      WHERE id=$1 AND recebimento_id=$2 AND excluido_em IS NULL`, [input.itemId, receipt.id])
    if (!item) throw invalid('Item da divergência não encontrado.')
  }
  const { rows: [row] } = await client.query(`INSERT INTO alm.divergencias
    (recebimento_id,item_id,tipo_divergencia_codigo,severidade,descricao,criado_por,alterado_por)
    VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
  [receipt.id, input.itemId || null, tipo, input.severidade || 'MEDIA', descricao, actorId])
  if (receipt.status === 'EM_CONFERENCIA') {
    await client.query(`SELECT set_config('app.status_observacao','Divergência registrada.',true)`)
    await client.query(`UPDATE alm.recebimentos SET status='DIVERGENCIA_IDENTIFICADA',alterado_por=$2
      WHERE id=$1`, [receipt.id, actorId])
  }
  return divergenceResponse(row)
}

export async function changeDivergence(client, receiptId, divergenceId, action, input, actorId) {
  const receipt = await findReceipt(client, receiptId, { lock: true, full: false })
  if (receipt.status === 'CONFERIDO_FINALIZADO') throw conflict('Reabra o recebimento antes de alterar divergências.')
  const { rows: [old] } = await client.query(`SELECT * FROM alm.divergencias
    WHERE id=$1 AND recebimento_id=$2 AND excluido_em IS NULL FOR UPDATE`, [divergenceId, receipt.id])
  if (!old) throw authFailure(404, 'DIVERGENCE_NOT_FOUND', 'Divergência não encontrada.')
  if (action === 'resolver') {
    const resolution = clean(input.resolucao, 4000)
    if (!resolution) throw invalid('Informe a resolução da divergência.')
    if (old.status === 'RESOLVIDA') return divergenceResponse(old)
    const { rows: [row] } = await client.query(`UPDATE alm.divergencias SET
      status='RESOLVIDA',resolucao=$3,resolvida_em=clock_timestamp(),resolvida_por=$4,
      alterado_por=$4 WHERE id=$1 AND recebimento_id=$2 RETURNING *`,
    [divergenceId, receipt.id, resolution, actorId])
    return divergenceResponse(row)
  }
  if (old.status !== 'RESOLVIDA') return divergenceResponse(old)
  const { rows: [row] } = await client.query(`UPDATE alm.divergencias SET
    status='ABERTA',resolucao=NULL,resolvida_em=NULL,resolvida_por=NULL,
    alterado_por=$3 WHERE id=$1 AND recebimento_id=$2 RETURNING *`, [divergenceId, receipt.id, actorId])
  return divergenceResponse(row)
}

export async function transitionReceipt(client, id, input, actorId, perfil) {
  const row = await findReceipt(client, id, { lock: true, full: false })
  const next = statusCode(input.status)
  if (!next) throw invalid('Status inválido.')
  if (row.status === next) throw conflict('O recebimento já está neste status.')
  if (!TRANSITIONS[row.status]?.includes(next) && !(perfil === 'ADMINISTRADOR' && input.force === true)) {
    throw conflict('Transição de status não permitida.')
  }
  if (row.status === 'CONFERIDO_FINALIZADO' && next !== 'EM_CONFERENCIA') {
    throw conflict('Recebimento finalizado deve ser reaberto para conferência.')
  }
  if (next === 'DIVERGENCIA_IDENTIFICADA') {
    const { rows: [open] } = await client.query(`SELECT id FROM alm.divergencias
      WHERE recebimento_id=$1 AND status IN ('ABERTA','EM_TRATAMENTO') AND excluido_em IS NULL LIMIT 1`, [row.id])
    if (!open) throw conflict('Registre uma divergência aberta antes de alterar o status.')
  }
  await client.query(`SELECT set_config('app.status_observacao',$1,true)`, [clean(input.observacao, 2000)])
  await client.query(`UPDATE alm.recebimentos SET status=$2::varchar,
    qualidade_dados=$3::varchar,alterado_por=$4::uuid,
    conferido_em=CASE WHEN $2::text='CONFERIDO_FINALIZADO' THEN clock_timestamp() ELSE conferido_em END,
    conferido_por=CASE WHEN $2::text='CONFERIDO_FINALIZADO' THEN $4::uuid ELSE conferido_por END
    WHERE id=$1`, [row.id, next, next === 'CONFERIDO_FINALIZADO' ? 'CONFERIDO' : 'PENDENTE_CONFERENCIA', actorId])
  return receiptResponse(await findReceipt(client, row.id))
}

export async function archiveReceipt(client, id, reason, actorId) {
  const row = await findReceipt(client, id, { lock: true, full: false })
  if (row.status === 'CONFERIDO_FINALIZADO') throw conflict('Reabra o recebimento antes de arquivar.')
  const cleanReason = clean(reason, 2000)
  if (!cleanReason) throw invalid('Informe o motivo do arquivamento.')
  await client.query(`UPDATE alm.recebimentos SET excluido_em=clock_timestamp(),
    excluido_por=$2,motivo_exclusao=$3,alterado_por=$2 WHERE id=$1`,
  [row.id, actorId, cleanReason])
  return receiptResponse(await findReceipt(client, row.id, { includeArchived: true }))
}

export async function restoreReceipt(client, id, actorId) {
  const row = await findReceipt(client, id, { lock: true, full: false, includeArchived: true })
  if (!row.excluido_em) throw conflict('Recebimento não está arquivado.')
  await client.query(`UPDATE alm.recebimentos SET excluido_em=NULL,excluido_por=NULL,
    motivo_exclusao=NULL,alterado_por=$2 WHERE id=$1`, [row.id, actorId])
  return receiptResponse(await findReceipt(client, row.id))
}
