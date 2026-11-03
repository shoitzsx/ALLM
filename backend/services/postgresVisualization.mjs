import { authFailure } from '../auth/postgresAuth.mjs'
import { csvField } from '../../src/csvSafe.js'

const TABS = Object.freeze({
  chegadas: {
    permission: 'chegadas.read', status: '__statusChegada', date: 'chegadaEm',
    columns: [['codigo', 'Código'], ['numeroNf', 'NF'], ['serieNf', 'Série'],
      ['nfeChaveAcesso', 'Chave NF-e'], ['cnpjEmitente', 'CNPJ emitente'],
      ['fornecedor', 'Fornecedor'], ['transportadora', 'Transportadora'],
      ['chegadaEm', 'Chegada'], ['saidaEm', 'Saída'], ['metodoLeitura', 'Método de leitura'],
      ['confianca', 'Confiança'], ['__statusChegada', 'Status'],
      ['registradoPor', 'Registrado por'], ['criadoEm', 'Criado em'],
      ['recebimentoVinculado', 'Recebimento vinculado']],
    sql: `SELECT c.id,c.codigo,c.numero_nf AS "numeroNf",c.serie_nf AS "serieNf",
      btrim(c.nfe_chave_acesso) AS "nfeChaveAcesso",btrim(c.cnpj_emitente) AS "cnpjEmitente",
      c.fornecedor_nome_snapshot AS fornecedor,''::text AS transportadora,
      c.criado_em AS "chegadaEm",NULL::timestamptz AS "saidaEm",
      c.metodo_leitura AS "metodoLeitura",
      CASE c.confianca WHEN 'ALTA' THEN 'Alta' WHEN 'MEDIA' THEN 'Conferir'
        WHEN 'BAIXA' THEN 'Baixa' ELSE 'Conferir' END AS confianca,
      CASE WHEN c.status='VINCULADA' THEN 'VINCULADA' ELSE 'AGUARDANDO' END AS "__statusChegada",
      u.nome AS "registradoPor",c.criado_em AS "criadoEm",r.codigo AS "recebimentoVinculado"
      FROM alm.chegadas_portaria c LEFT JOIN alm.usuarios u ON u.id=c.criado_por
      LEFT JOIN alm.recebimentos r ON r.id=c.recebimento_id WHERE c.excluido_em IS NULL`,
  },
  recebimentos: {
    permission: 'recebimentos.read', status: 'status', date: 'dataRecebimento',
    columns: [['protocolo', 'Protocolo'], ['pedido', 'Pedido'], ['numeroNf', 'NF'],
      ['serieNf', 'Série'], ['dataRecebimento', 'Data recebimento'],
      ['fornecedor', 'Fornecedor'], ['cnpjFornecedor', 'CNPJ'], ['tipo', 'Tipo'],
      ['responsavelNome', 'Responsável'], ['status', 'Status'],
      ['observacoes', 'Observações'], ['criadoEm', 'Criado em'],
      ['atualizadoEm', 'Atualizado em'], ['arquivado', 'Arquivado'],
      ['chegadaVinculada', 'Chegada vinculada'], ['nfeChaveAcesso', 'Chave NF-e']],
    sql: `SELECT r.id,r.codigo AS protocolo,r.pedido_compra AS pedido,
      r.numero_nf AS "numeroNf",r.serie_nf AS "serieNf",
      r.recebido_em::date AS "dataRecebimento",r.fornecedor_nome_snapshot AS fornecedor,
      btrim(r.fornecedor_cnpj_snapshot) AS "cnpjFornecedor",t.nome AS tipo,
      u.nome AS "responsavelNome",
      CASE r.status WHEN 'EM_DIGITACAO' THEN 'Em digitação'
        WHEN 'AGUARDANDO_DOCUMENTACAO' THEN 'Aguardando documentação'
        WHEN 'EM_CONFERENCIA' THEN 'Em conferência'
        WHEN 'DIVERGENCIA_IDENTIFICADA' THEN 'Divergência identificada'
        WHEN 'CONFERIDO_FINALIZADO' THEN 'Conferido/Finalizado' END AS status,
      r.observacoes,r.criado_em AS "criadoEm",r.alterado_em AS "atualizadoEm",
      (r.excluido_em IS NOT NULL) AS arquivado,c.codigo AS "chegadaVinculada",
      btrim(r.nfe_chave_acesso) AS "nfeChaveAcesso"
      FROM alm.recebimentos r LEFT JOIN alm.tipos_recebimento t ON t.id=r.tipo_recebimento_id
      LEFT JOIN alm.usuarios u ON u.id=r.responsavel_id
      LEFT JOIN alm.chegadas_portaria c ON c.recebimento_id=r.id AND c.excluido_em IS NULL`,
  },
  itens: {
    permission: 'recebimentos.read',
    columns: [['recebimentoProtocolo', 'Recebimento'], ['numero', 'Número'],
      ['codigo', 'Código'], ['descricao', 'Descrição'],
      ['quantidadeSolicitada', 'Qtd. solicitada'],
      ['quantidadeRecebida', 'Qtd. recebida'], ['unidade', 'Unidade']],
    sql: `SELECT i.id,r.codigo AS "recebimentoProtocolo",i.numero_item AS numero,
      i.codigo_produto AS codigo,i.descricao,i.quantidade_solicitada AS "quantidadeSolicitada",
      i.quantidade_recebida AS "quantidadeRecebida",i.unidade_codigo AS unidade
      FROM alm.recebimento_itens i JOIN alm.recebimentos r ON r.id=i.recebimento_id
      WHERE i.excluido_em IS NULL AND r.excluido_em IS NULL`,
  },
  divergencias: {
    permission: 'recebimentos.read', status: 'resolvida', date: 'criadaEm',
    columns: [['recebimentoProtocolo', 'Recebimento'], ['tipo', 'Tipo'],
      ['descricao', 'Descrição'], ['item', 'Item'], ['criadaEm', 'Criada em'],
      ['criadaPor', 'Criada por'], ['resolvida', 'Resolvida'],
      ['resolvidaEm', 'Resolvida em'], ['resolvidaPor', 'Resolvida por'],
      ['resolucao', 'Resolução']],
    sql: `SELECT d.id,r.codigo AS "recebimentoProtocolo",t.nome AS tipo,
      d.descricao,i.descricao AS item,d.criado_em AS "criadaEm",
      cu.nome AS "criadaPor",(d.status='RESOLVIDA') AS resolvida,
      d.resolvida_em AS "resolvidaEm",ru.nome AS "resolvidaPor",d.resolucao
      FROM alm.divergencias d JOIN alm.recebimentos r ON r.id=d.recebimento_id
      LEFT JOIN alm.recebimento_itens i ON i.id=d.item_id
      JOIN alm.tipos_divergencia t ON t.codigo=d.tipo_divergencia_codigo
      LEFT JOIN alm.usuarios cu ON cu.id=d.criado_por
      LEFT JOIN alm.usuarios ru ON ru.id=d.resolvida_por
      WHERE d.excluido_em IS NULL AND r.excluido_em IS NULL`,
  },
  historico: {
    permission: 'recebimentos.read', date: 'data',
    columns: [['recebimentoProtocolo', 'Recebimento'], ['data', 'Data'],
      ['usuario', 'Usuário'], ['statusAnterior', 'Status anterior'],
      ['novoStatus', 'Novo status'], ['observacao', 'Observação']],
    sql: `SELECT h.id,r.codigo AS "recebimentoProtocolo",h.alterado_em AS data,
      u.nome AS usuario,h.status_anterior AS "statusAnterior",
      h.status_novo AS "novoStatus",h.observacao
      FROM alm.recebimento_status_historico h
      JOIN alm.recebimentos r ON r.id=h.recebimento_id
      LEFT JOIN alm.usuarios u ON u.id=h.alterado_por`,
  },
  auditoria: {
    permission: 'usuarios.read', date: 'data',
    columns: [['data', 'Data'], ['entidade', 'Entidade'], ['registro', 'Registro'],
      ['usuario', 'Usuário'], ['acao', 'Ação'], ['resumo', 'Resumo'],
      ['requestId', 'Request ID']],
    sql: `SELECT h.id,h.criado_em AS data,h.entidade,h.entidade_id AS registro,
      u.nome AS usuario,h.acao,h.detalhes AS resumo,h.request_id AS "requestId"
      FROM alm.historico_alteracoes h LEFT JOIN alm.usuarios u ON u.id=h.usuario_id`,
  },
  anexos: {
    permission: 'anexos.read', status: 'situacao', date: 'incluidoEm',
    columns: [['recebimentoProtocolo', 'Recebimento'], ['nome', 'Nome'],
      ['categoria', 'Categoria'], ['mimeType', 'MIME'], ['tamanho', 'Tamanho'],
      ['incluidoPor', 'Incluído por'], ['incluidoEm', 'Incluído em'],
      ['situacao', 'Situação'], ['removidoEm', 'Removido em'], ['motivo', 'Motivo']],
    sql: `SELECT a.id,r.codigo AS "recebimentoProtocolo",a.nome_original AS nome,
      t.nome AS categoria,a.mime_type_detectado AS "mimeType",a.tamanho_bytes AS tamanho,
      u.nome AS "incluidoPor",a.criado_em AS "incluidoEm",
      CASE WHEN a.excluido_em IS NOT NULL THEN 'Removido'
        WHEN a.status_upload='DISPONIVEL' THEN 'Ativo' ELSE 'Quarentena' END AS situacao,
      a.excluido_em AS "removidoEm",a.motivo_exclusao AS motivo
      FROM alm.arquivos a JOIN alm.recebimentos r ON r.id=a.recebimento_id
      JOIN alm.tipos_arquivo t ON t.codigo=a.tipo_arquivo_codigo
      LEFT JOIN alm.usuarios u ON u.id=a.criado_por`,
  },
  usuarios: {
    permission: 'usuarios.read', status: 'ativo',
    columns: [['matricula', 'Matrícula'], ['nome', 'Nome'], ['perfil', 'Perfil'],
      ['ativo', 'Ativo'], ['criadoEm', 'Criado em'], ['atualizadoEm', 'Atualizado em']],
    sql: `SELECT id,matricula,nome,perfil,ativo,criado_em AS "criadoEm",
      alterado_em AS "atualizadoEm" FROM alm.usuarios`,
  },
})

export function visualizationTab(name) {
  const tab = TABS[name]
  if (!tab) throw authFailure(404, 'TAB_NOT_FOUND', 'Aba não encontrada.')
  return tab
}

function queryParts(tab, params) {
  const values = []
  const where = []
  const search = String(params.get('search') || '').trim().slice(0, 200)
  if (search) {
    values.push(`%${search}%`)
    where.push(`to_jsonb(v)::text ILIKE $${values.length}`)
  }
  const status = String(params.get('status') || '').trim()
  if (status && tab.status) {
    values.push(status)
    where.push(`v."${tab.status}"::text=$${values.length}`)
  }
  for (const [param, operator] of [['periodoInicio', '>='], ['periodoFim', '<=']]) {
    const date = params.get(param)
    if (!date || !tab.date) continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw authFailure(422, 'VALIDATION_ERROR', 'Período inválido.')
    }
    values.push(date)
    where.push(`v."${tab.date}"::date ${operator} $${values.length}::date`)
  }
  const sortKey = params.get('sortKey')
  const allowed = new Set(tab.columns.map(([key]) => key))
  const sort = allowed.has(sortKey) ? sortKey : tab.date || tab.columns[0][0]
  const dir = params.get('sortDirection') === 'asc' ? 'ASC' : 'DESC'
  return { values, where: where.length ? `WHERE ${where.join(' AND ')}` : '',
    order: `ORDER BY v."${sort}" ${dir} NULLS LAST` }
}

export async function listVisualization(client, name, params) {
  const tab = visualizationTab(name)
  const query = queryParts(tab, params)
  const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1))
  const pageSize = Math.max(1, Math.min(100, Number(params.get('pageSize')) || 25))
  const source = `(${tab.sql}) v`
  const { rows: [count] } = await client.query(`SELECT count(*)::int AS total FROM ${source} ${query.where}`, query.values)
  const { rows } = await client.query(`SELECT * FROM ${source} ${query.where} ${query.order}
    LIMIT $${query.values.length + 1} OFFSET $${query.values.length + 2}`,
  [...query.values, pageSize, (page - 1) * pageSize])
  return { data: rows, pagination: { page, pageSize, total: count.total,
    totalPages: Math.max(1, Math.ceil(count.total / pageSize)) } }
}

export async function exportVisualization(client, name, params) {
  const tab = visualizationTab(name)
  const query = queryParts(tab, params)
  const source = `(${tab.sql}) v`
  const header = tab.columns.map(([, label]) => csvField(label, ';')).join(';')
  const lines = [header]
  for (let offset = 0; ; offset += 500) {
    const { rows } = await client.query(`SELECT * FROM ${source} ${query.where} ${query.order}
      LIMIT 500 OFFSET $${query.values.length + 1}`, [...query.values, offset])
    for (const row of rows) {
      lines.push(tab.columns.map(([key]) => csvField(row[key] == null ? '' : String(row[key]), ';')).join(';'))
    }
    if (rows.length < 500) break
    if (offset >= 100000) throw authFailure(413, 'EXPORT_TOO_LARGE', 'Reduza os filtros para exportar até 100 mil linhas.')
  }
  return '\uFEFF' + lines.join('\r\n')
}
