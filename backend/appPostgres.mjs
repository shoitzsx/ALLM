import { randomUUID } from 'node:crypto'
import { createPostgresPool } from './config/postgres.mjs'
import { readPostgresEnvironment } from './config/postgresEnv.mjs'
import { createWebAuthnAdapter } from './auth/webauthn.mjs'
import { SESSION_COOKIE_NAME, clearOpaqueCookie } from './auth/webauthnSecurity.mjs'
import { authFailure, createPostgresAuth, requireCapability, withApiTransaction } from './auth/postgresAuth.mjs'
import { normalizeChegadaInput } from './services/chegadasService.mjs'
import { iniciarRecebimentoDaChegada } from './services/iniciarRecebimentoDaChegada.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function send(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers })
  res.end(JSON.stringify(payload))
}

function failure(res, status, code, message) {
  send(res, status, { error: { code, message } })
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw authFailure(413, 'PAYLOAD_TOO_LARGE', 'Requisição muito grande.')
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body')
    return value
  } catch {
    throw authFailure(400, 'INVALID_JSON', 'Corpo JSON inválido.')
  }
}

function requestParts(req) {
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/api/v1/')) return null
  return { url, parts: url.pathname.slice('/api/v1/'.length).split('/').filter(Boolean) }
}

function receiptRow(row) {
  return {
    id: row.id, codigo: row.codigo, codigoLegado: row.codigo_legado,
    pedido: row.pedido_compra, numeroNf: row.numero_nf, serieNf: row.serie_nf,
    nfeChaveAcesso: row.nfe_chave_acesso?.trim() || null,
    fornecedorId: row.fornecedor_id, fornecedor: row.fornecedor_nome_snapshot,
    tipoCodigo: row.tipo_codigo, status: row.status, qualidadeDados: row.qualidade_dados,
    recebidoEm: row.recebido_em, criadoEm: row.criado_em, alteradoEm: row.alterado_em,
    responsavelId: row.responsavel_id, observacoes: row.observacoes,
  }
}

function arrivalRow(row) {
  return {
    id: row.id, codigo: row.codigo, status: row.status,
    nfeChaveAcesso: row.nfe_chave_acesso?.trim() || null,
    numeroNf: row.numero_nf, serieNf: row.serie_nf,
    cnpjEmitente: row.cnpj_emitente?.trim() || null,
    fornecedorId: row.fornecedor_id, fornecedor: row.fornecedor_nome_snapshot,
    metodoLeitura: row.metodo_leitura, confianca: row.confianca,
    recebimentoId: row.recebimento_id, criadoEm: row.criado_em,
  }
}

export async function createPostgresApp({ pool: injectedPool, environment, authAdapter } = {}) {
  const env = environment || readPostgresEnvironment()
  const pool = injectedPool || createPostgresPool()
  const adapter = authAdapter || createWebAuthnAdapter({ rpName: env.rpName,
    rpId: env.rpId, origins: env.origins })
  const auth = createPostgresAuth({ pool, adapter, pepper: env.pepper,
    allowedOrigins: env.origins, pinLength: env.pinLength })
  const ready = await withApiTransaction(pool, null, randomUUID(), async (client) => {
    const { rows: [row] } = await client.query(`SELECT
      current_setting('server_version_num')::int AS version,
      current_user='alm_api' AS role_ok,
      to_regclass('alm.usuarios') IS NOT NULL AS users_ok,
      to_regclass('alm.sessoes') IS NOT NULL AS sessions_ok,
      to_regclass('alm.credenciais_webauthn') IS NOT NULL AS credentials_ok,
      to_regclass('alm.fluxos_auth_parcial') IS NOT NULL AS flows_ok,
      to_regclass('alm.desafios_webauthn') IS NOT NULL AS challenges_ok,
      to_regclass('alm.autorizacoes_webauthn') IS NOT NULL AS authorizations_ok,
      to_regclass('alm.chegadas_portaria') IS NOT NULL AS arrivals_ok,
      to_regclass('alm.recebimentos') IS NOT NULL AS receipts_ok`)
    return row
  })
  if (ready.version < 170000 || ready.version >= 180000
    || Object.entries(ready).some(([key, value]) => key.endsWith('_ok') && value !== true)) {
    throw new Error('PostgreSQL 17 e migrations ALM/N-2 são necessários para iniciar a API.')
  }

  async function handle(req, res) {
    const route = requestParts(req)
    if (!route) return failure(res, 404, 'NOT_FOUND', 'Rota não encontrada.')
    const { parts } = route
    const requestId = randomUUID()
    try {
      if (req.method === 'OPTIONS') {
        const origin = auth.requireOrigin(req)
        res.writeHead(204, { 'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          Vary: 'Origin' })
        return res.end()
      }
      if (STATE_CHANGING.has(req.method)) auth.requireOrigin(req)
      const name = parts.join('/')
      if (name === 'auth/login-challenges' && req.method === 'POST') {
        const result = await auth.loginChallenge(req, await readBody(req), requestId)
        return send(res, 201, { challengeId: result.challengeId, options: result.options },
          { 'Set-Cookie': result.setCookie })
      }
      if (parts[0] === 'auth' && parts[1] === 'login-challenges' && parts[3] === 'complete'
        && parts.length === 4 && req.method === 'POST') {
        const result = await auth.completeLogin(req, parts[2], (await readBody(req)).response, requestId)
        return send(res, 200, { authenticated: true }, { 'Set-Cookie': result.setCookie })
      }
      const current = await auth.session(req, requestId)
      if (name === 'auth/me' && req.method === 'GET') {
        if (!current) throw authFailure(401, 'UNAUTHORIZED', 'Sessão ausente ou expirada.')
        const { sessaoId, tokenHash, credencialId, mfaVerificadoEm, ...user } = current
        return send(res, 200, user)
      }
      if (name === 'auth/logout' && req.method === 'POST') {
        const cookie = await auth.logout(req, current, requestId)
        return send(res, 200, { authenticated: false }, { 'Set-Cookie': cookie })
      }
      if (name === 'auth/authenticators/registration-challenges' && req.method === 'POST') {
        return send(res, 201, await auth.registrationChallenge(req, await readBody(req), current, requestId))
      }
      if (name === 'auth/authenticators' && req.method === 'POST') {
        return send(res, 201, await auth.completeRegistration(req, await readBody(req), current, requestId))
      }
      if (name === 'auth/authenticators' && req.method === 'GET') {
        return send(res, 200, { data: await auth.listAuthenticators(current) })
      }
      if (parts[0] === 'auth' && parts[1] === 'authenticators' && parts.length === 3
        && req.method === 'DELETE') {
        const result = await auth.revokeAuthenticator(req, current, parts[2],
          (await readBody(req)).reason, requestId)
        return send(res, 200, result, result.currentSessionRevoked
          ? { 'Set-Cookie': clearOpaqueCookie(SESSION_COOKIE_NAME) } : {})
      }
      if (!current) throw authFailure(401, 'UNAUTHORIZED', 'Sessão ausente ou expirada.')

      if (name === 'catalogos' && req.method === 'GET') {
        requireCapability(current, 'catalogos.read')
        const data = await withApiTransaction(pool, current.id, requestId, async (client) => {
          const [types, units, suppliers] = await Promise.all([
            client.query('SELECT id,codigo,nome FROM alm.tipos_recebimento WHERE ativo=true ORDER BY ordem,nome'),
            client.query('SELECT codigo,descricao FROM alm.unidades_medida WHERE ativo=true ORDER BY ordem,descricao'),
            client.query('SELECT id,razao_social,nome_fantasia,cnpj FROM alm.fornecedores WHERE ativo=true ORDER BY razao_social LIMIT 200'),
          ])
          return { tiposRecebimento: types.rows, unidades: units.rows, fornecedores: suppliers.rows }
        })
        return send(res, 200, data)
      }
      if (name === 'chegadas' && req.method === 'GET') {
        requireCapability(current, 'chegadas.read')
        const rows = await withApiTransaction(pool, current.id, requestId, async (client) => {
          const result = await client.query(`SELECT id,codigo,status,nfe_chave_acesso,numero_nf,
            serie_nf,cnpj_emitente,fornecedor_id,fornecedor_nome_snapshot,metodo_leitura,
            confianca,recebimento_id,criado_em FROM alm.chegadas_portaria
            WHERE excluido_em IS NULL ORDER BY criado_em DESC LIMIT 100`)
          return result.rows
        })
        return send(res, 200, { data: rows.map(arrivalRow) })
      }
      if (name === 'chegadas' && req.method === 'POST') {
        requireCapability(current, 'chegadas.create')
        const input = normalizeChegadaInput(await readBody(req))
        const row = await withApiTransaction(pool, current.id, requestId, async (client) => {
          const { rows: [created] } = await client.query(`INSERT INTO alm.chegadas_portaria
            (nfe_chave_acesso,numero_nf,serie_nf,cnpj_emitente,fornecedor_nome_snapshot,
             metodo_leitura,confianca,observacoes,criado_por,alterado_por)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
            RETURNING id,codigo,status,nfe_chave_acesso,numero_nf,serie_nf,cnpj_emitente,
              fornecedor_id,fornecedor_nome_snapshot,metodo_leitura,confianca,recebimento_id,criado_em`,
          [input.nfeChaveAcesso, input.numeroNf, input.serieNf, input.cnpjEmitente,
            input.fornecedor, input.metodoLeitura, input.confianca, input.observacoes, current.id])
          return created
        })
        return send(res, 201, arrivalRow(row))
      }
      if (parts[0] === 'chegadas' && parts.length === 2 && req.method === 'GET') {
        requireCapability(current, 'chegadas.read')
        if (!UUID.test(parts[1])) throw authFailure(422, 'VALIDATION_ERROR', 'Identificador inválido.')
        const row = await withApiTransaction(pool, current.id, requestId, async (client) => {
          const { rows: [found] } = await client.query(`SELECT id,codigo,status,nfe_chave_acesso,
            numero_nf,serie_nf,cnpj_emitente,fornecedor_id,fornecedor_nome_snapshot,
            metodo_leitura,confianca,recebimento_id,criado_em FROM alm.chegadas_portaria
            WHERE id=$1 AND excluido_em IS NULL`, [parts[1]])
          return found
        })
        return row ? send(res, 200, arrivalRow(row)) : failure(res, 404, 'ARRIVAL_NOT_FOUND', 'Chegada não encontrada.')
      }
      if (parts[0] === 'chegadas' && parts[2] === 'iniciar-recebimento'
        && parts.length === 3 && req.method === 'POST') {
        requireCapability(current, 'recebimentos.create')
        const result = await iniciarRecebimentoDaChegada({ pool, actor: { id: current.id,
          perfil: current.perfil, ativo: true }, chegadaId: parts[1],
        input: await readBody(req), requestId })
        return send(res, result.reutilizado ? 200 : 201, result)
      }
      if (name === 'recebimentos' && req.method === 'POST') {
        requireCapability(current, 'recebimentos.create')
        const input = await readBody(req)
        if ((input.tipoCodigo && !/^[A-Z_]{2,40}$/.test(input.tipoCodigo))
          || (input.fornecedorId && !UUID.test(input.fornecedorId))
          || (input.nfeChaveAcesso && !/^\d{44}$/.test(input.nfeChaveAcesso))) {
          throw authFailure(422, 'VALIDATION_ERROR', 'Dados do recebimento inválidos.')
        }
        const row = await withApiTransaction(pool, current.id, requestId, async (client) => {
          let typeId = null
          if (input.tipoCodigo) {
            const { rows: [type] } = await client.query(`SELECT id FROM alm.tipos_recebimento
              WHERE codigo=$1 AND ativo=true`, [input.tipoCodigo])
            if (!type) throw authFailure(422, 'RECEIPT_TYPE_NOT_FOUND', 'Tipo de recebimento indisponível.')
            typeId = type.id
          }
          if (input.fornecedorId) {
            const { rows: [supplier] } = await client.query(`SELECT id FROM alm.fornecedores
              WHERE id=$1 AND ativo=true`, [input.fornecedorId])
            if (!supplier) throw authFailure(422, 'SUPPLIER_NOT_FOUND', 'Fornecedor indisponível.')
          }
          const { rows: [created] } = await client.query(`INSERT INTO alm.recebimentos
            (qualidade_dados,pedido_compra,numero_nf,serie_nf,nfe_chave_acesso,
             fornecedor_id,tipo_recebimento_id,status,observacoes,criado_por,alterado_por,
             responsavel_id)
            VALUES('PENDENTE_CONFERENCIA',$1,$2,$3,$4,$5,$6,'EM_DIGITACAO',$7,$8,$8,$8)
            RETURNING id,codigo,codigo_legado,pedido_compra,numero_nf,serie_nf,
              nfe_chave_acesso,fornecedor_id,fornecedor_nome_snapshot,status,
              qualidade_dados,recebido_em,criado_em,alterado_em,responsavel_id,observacoes`,
          [input.pedido || null, input.numeroNf || null, input.serieNf || null,
            input.nfeChaveAcesso || null, input.fornecedorId || null, typeId,
            input.observacoes || null, current.id])
          return { ...created, tipo_codigo: input.tipoCodigo || null }
        })
        return send(res, 201, receiptRow(row))
      }
      if (name === 'recebimentos' && req.method === 'GET') {
        requireCapability(current, 'recebimentos.read')
        const rows = await withApiTransaction(pool, current.id, requestId, async (client) => {
          const { rows: found } = await client.query(`SELECT r.id,r.codigo,r.codigo_legado,
            r.pedido_compra,r.numero_nf,r.serie_nf,r.nfe_chave_acesso,r.fornecedor_id,
            r.fornecedor_nome_snapshot,r.status,r.qualidade_dados,r.recebido_em,
            r.criado_em,r.alterado_em,r.responsavel_id,r.observacoes,t.codigo AS tipo_codigo
            FROM alm.recebimentos r LEFT JOIN alm.tipos_recebimento t ON t.id=r.tipo_recebimento_id
            WHERE r.excluido_em IS NULL ORDER BY r.criado_em DESC LIMIT 100`)
          return found
        })
        return send(res, 200, { data: rows.map(receiptRow) })
      }
      if (parts[0] === 'recebimentos' && parts.length === 2 && req.method === 'GET') {
        requireCapability(current, 'recebimentos.read')
        const row = await withApiTransaction(pool, current.id, requestId, async (client) => {
          const { rows: [found] } = await client.query(`SELECT r.id,r.codigo,r.codigo_legado,
            r.pedido_compra,r.numero_nf,r.serie_nf,r.nfe_chave_acesso,r.fornecedor_id,
            r.fornecedor_nome_snapshot,r.status,r.qualidade_dados,r.recebido_em,
            r.criado_em,r.alterado_em,r.responsavel_id,r.observacoes,t.codigo AS tipo_codigo
            FROM alm.recebimentos r LEFT JOIN alm.tipos_recebimento t ON t.id=r.tipo_recebimento_id
            WHERE (r.id::text=$1 OR r.codigo=$1) AND r.excluido_em IS NULL`, [parts[1]])
          return found
        })
        return row ? send(res, 200, receiptRow(row)) : failure(res, 404, 'RECEIPT_NOT_FOUND', 'Recebimento não encontrado.')
      }
      if (name === 'dashboard' && req.method === 'GET') {
        requireCapability(current, 'dashboard.read')
        const result = await withApiTransaction(pool, current.id, requestId, async (client) => {
          const { rows } = await client.query(`SELECT status,count(*)::integer AS total
            FROM alm.recebimentos WHERE excluido_em IS NULL GROUP BY status`)
          return { total: rows.reduce((sum, row) => sum + row.total, 0),
            status: Object.fromEntries(rows.map((row) => [row.status, row.total])) }
        })
        return send(res, 200, result)
      }
      return failure(res, 404, 'NOT_FOUND', 'Endpoint não encontrado.')
    } catch (error) {
      if (error.status) return failure(res, error.status, error.code, error.message)
      if (['23502', '23503', '23514', '22P02'].includes(error.code)) {
        return failure(res, 422, 'VALIDATION_ERROR', 'Dados não atendem às regras do banco.')
      }
      if (error.code === '23505') return failure(res, 409, 'CONFLICT', 'Registro já existente.')
      console.error('ALM PostgreSQL request failed', { code: error.code || 'UNKNOWN', requestId })
      return failure(res, 503, 'DATABASE_UNAVAILABLE', 'Operação indisponível no momento.')
    }
  }

  return { handle, env, close: () => pool.end(), auth }
}
