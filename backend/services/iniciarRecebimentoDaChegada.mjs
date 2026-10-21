import { randomUUID } from 'node:crypto'
import { mapChegadaToRecebimentoInput, planInicioRecebimento } from './chegadasService.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TYPE_CODES = Object.freeze({
  Estoque: 'ESTOQUE',
  'Débito Direto': 'DEBITO_DIRETO',
  Industrialização: 'INDUSTRIALIZACAO',
  Comodato: 'COMODATO',
  Outro: 'OUTRO',
})

function failure(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

function assertActor(actor) {
  if (!actor || !UUID.test(actor.id || '') || actor.ativo !== true) {
    throw failure(401, 'UNAUTHORIZED', 'Sessão ausente ou inválida.')
  }
  if (!['ADMINISTRADOR', 'ALMOXARIFADO'].includes(actor.perfil)) {
    throw failure(403, 'FORBIDDEN', 'Perfil sem permissão para iniciar recebimentos.')
  }
}

function arrivalFromRow(row) {
  return {
    id: row.id,
    status: row.status,
    recebimentoId: row.recebimento_id,
    excluidoEm: row.excluido_em,
    nfeChaveAcesso: row.nfe_chave_acesso?.trim() || null,
    numeroNf: row.numero_nf,
    serieNf: row.serie_nf,
    cnpjEmitente: row.cnpj_emitente?.trim() || null,
    fornecedor: row.fornecedor_nome_snapshot || null,
  }
}

function assertMatchingRetry(input, receipt, arrival) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw failure(422, 'VALIDATION_ERROR', 'Dados do recebimento inválidos.')
  }
  const allowed = new Set(['pedido', 'tipo', 'fornecedor'])
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw failure(422, 'VALIDATION_ERROR', 'O retry contém campos não aceitos.')
  }
  const pedido = typeof input.pedido === 'string' ? input.pedido.trim() : input.pedido
  const tipo = typeof input.tipo === 'string' ? input.tipo.trim() : input.tipo
  const fornecedor = typeof input.fornecedor === 'string' ? input.fornecedor.trim() : input.fornecedor
  const expectedSupplier = arrival.fornecedor_nome_snapshot || receipt.fornecedor_nome_snapshot || receipt.razao_social
  const mismatch = ('pedido' in input && pedido !== receipt.pedido_compra)
    || ('tipo' in input && TYPE_CODES[tipo] !== receipt.tipo_codigo)
    || ('fornecedor' in input && fornecedor !== expectedSupplier
      && (arrival.fornecedor_nome_snapshot || fornecedor !== receipt.nome_fantasia))
  if (mismatch) throw failure(409, 'ARRIVAL_RETRY_CONFLICT', 'A chegada já está vinculada com dados diferentes.')
}

function translateDatabaseError(error) {
  if (error.status) return error
  if (error.code === '23505') return failure(409, 'ARRIVAL_CONFLICT', 'A chegada já possui um vínculo conflitante.')
  if (error.code === '23503' || error.code === '23514' || error.code === '23502') {
    return failure(422, 'VALIDATION_ERROR', 'Os dados não atendem às regras do banco.')
  }
  if (error.code === '42501') return failure(503, 'DATABASE_PERMISSION_ERROR', 'A operação não está disponível para a conexão configurada.')
  if (error.code === 'P0001') {
    const message = error.message || ''
    if (message.startsWith('CHG inexistente:')) return failure(404, 'ARRIVAL_NOT_FOUND', 'Chegada não encontrada.')
    if (message.includes('Usuario autenticado inexistente ou inativo')) return failure(401, 'UNAUTHORIZED', 'Sessão ausente ou inválida.')
    return failure(409, 'ARRIVAL_NOT_AVAILABLE', 'A chegada não pode iniciar um recebimento.')
  }
  return failure(503, 'DATABASE_UNAVAILABLE', 'Não foi possível concluir a operação no banco.')
}

// O pool deve conectar como alm_runtime_api. A identidade humana é obtida de
// uma sessão verificada pelo servidor antes de chamar esta função.
export async function iniciarRecebimentoDaChegada({ pool, actor, chegadaId, input, requestId = randomUUID() }) {
  assertActor(actor)
  if (!UUID.test(chegadaId || '') || !UUID.test(requestId || '')) {
    throw failure(422, 'VALIDATION_ERROR', 'Identificador inválido.')
  }
  const client = await pool.connect()
  let inTransaction = false
  let discardConnection = false
  try {
    await client.query('BEGIN')
    inTransaction = true
    await client.query('SET LOCAL ROLE alm_api')
    await client.query("SELECT set_config('app.usuario_id', $1, true), set_config('app.request_id', $2, true), set_config('app.ator_sistema', '', true)", [actor.id, requestId])

    const arrivalResult = await client.query(`
      SELECT id, status, recebimento_id, excluido_em, nfe_chave_acesso,
             numero_nf, serie_nf, cnpj_emitente, fornecedor_id, fornecedor_nome_snapshot
        FROM alm.chegadas_portaria WHERE id = $1::uuid FOR UPDATE
    `, [chegadaId])
    const arrivalRow = arrivalResult.rows[0]
    const plan = planInicioRecebimento(arrivalRow && arrivalFromRow(arrivalRow), input)

    let typeId
    let supplierId
    if (plan.kind === 'create') {
      const mapped = mapChegadaToRecebimentoInput(arrivalFromRow(arrivalRow), input)
      const typeResult = await client.query(
        'SELECT id FROM alm.tipos_recebimento WHERE codigo = $1 AND ativo = true',
        [TYPE_CODES[mapped.tipo]],
      )
      typeId = typeResult.rows[0]?.id
      if (!typeId) throw failure(422, 'RECEIPT_TYPE_NOT_FOUND', 'Tipo de recebimento indisponível no catálogo.')

      const supplierResult = await client.query(`
        SELECT id, razao_social, nome_fantasia FROM alm.fornecedores
         WHERE ativo = true AND id = $1::uuid AND (cnpj IS NULL OR cnpj = $2)
      `, [arrivalRow.fornecedor_id, mapped.cnpjFornecedor])
      let supplier = supplierResult.rows[0]
      supplierId = supplier?.id
      if (!supplierId) {
        const byCnpj = await client.query(
          'SELECT id, razao_social, nome_fantasia FROM alm.fornecedores WHERE ativo = true AND cnpj = $1',
          [mapped.cnpjFornecedor],
        )
        supplier = byCnpj.rows[0]
        supplierId = supplier?.id
      }
      if (!supplierId) throw failure(422, 'SUPPLIER_NOT_FOUND', 'Cadastre o fornecedor no catálogo antes de iniciar o recebimento.')
      if (!arrivalRow.fornecedor_nome_snapshot
        && ![supplier.razao_social, supplier.nome_fantasia].includes(mapped.fornecedor)) {
        throw failure(422, 'SUPPLIER_MISMATCH', 'O nome informado não corresponde ao fornecedor cadastrado.')
      }
    }

    const link = (await client.query(
      'SELECT recebimento_id, codigo, reutilizado FROM alm.criar_recebimento_da_chegada($1::uuid)',
      [chegadaId],
    )).rows[0]
    if (!link) throw failure(503, 'DATABASE_UNAVAILABLE', 'O banco não retornou o vínculo da chegada.')
    if (plan.kind === 'existing' && (!link.reutilizado || link.recebimento_id !== plan.recebimentoId)) {
      throw failure(409, 'ARRIVAL_INVALID_DATA', 'O vínculo da chegada está inconsistente.')
    }

    if (!link.reutilizado) {
      if (plan.kind !== 'create') throw failure(409, 'ARRIVAL_INVALID_DATA', 'O vínculo da chegada mudou durante a operação.')
      const updated = await client.query(`
        UPDATE alm.recebimentos
           SET pedido_compra = $1, tipo_recebimento_id = $2,
               fornecedor_id = $3::uuid, alterado_por = $4::uuid
         WHERE id = $5::uuid AND status = 'EM_DIGITACAO' AND excluido_em IS NULL
           AND (fornecedor_id IS NULL OR fornecedor_id = $3::uuid)
         RETURNING id
      `, [plan.receiptInput.pedido, typeId, supplierId, actor.id, link.recebimento_id])
      if (updated.rowCount !== 1) {
        throw failure(409, 'ARRIVAL_INVALID_DATA', 'Não foi possível completar o recebimento vinculado.')
      }
    }

    const receipt = (await client.query(`
      SELECT r.id, r.codigo, r.pedido_compra, t.codigo AS tipo_codigo,
             r.fornecedor_nome_snapshot, f.razao_social, f.nome_fantasia
        FROM alm.recebimentos r
        LEFT JOIN alm.tipos_recebimento t ON t.id = r.tipo_recebimento_id
        LEFT JOIN alm.fornecedores f ON f.id = r.fornecedor_id
       WHERE r.id = $1::uuid AND r.excluido_em IS NULL
    `, [link.recebimento_id])).rows[0]
    if (!receipt) throw failure(409, 'ARRIVAL_INVALID_DATA', 'Recebimento vinculado indisponível.')
    if (link.reutilizado) assertMatchingRetry(input ?? {}, receipt, arrivalRow)

    await client.query('COMMIT')
    inTransaction = false
    return { recebimentoId: receipt.id, codigo: receipt.codigo, reutilizado: link.reutilizado }
  } catch (error) {
    if (inTransaction) {
      try { await client.query('ROLLBACK') } catch { discardConnection = true }
    }
    throw translateDatabaseError(error)
  } finally {
    client.release(discardConnection)
  }
}
