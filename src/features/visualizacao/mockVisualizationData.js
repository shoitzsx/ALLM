/**
 * Dados 100% fictícios para a primeira versão da Visualização — não vêm de
 * backend, Supabase ou Google Sheets. Servem só para validar a UX de uma
 * tela de consulta somente-leitura antes de existir uma API real por trás.
 *
 * Gerados de forma determinística (sem Math.random na renderização) para
 * que "Atualizar" continue mostrando exatamente os mesmos dados — ver
 * README da tarefa: "nesta versão mock, manter os mesmos dados".
 */

const FORNECEDORES = [
  'Metalúrgica Exemplo Ltda',
  'Distribuidora Simulada S.A.',
  'Comercial Fictícia EIRELI',
  'Insumos Teste Ltda',
  'Ferragens Modelo S.A.',
  'Papelaria Exemplo ME',
  'Equipamentos Simulados Ltda',
  'Química Fictícia Indústria',
]

const TRANSPORTADORAS = [
  'Transporte Rápido Ltda',
  'Logística Exemplo S.A.',
  'Expresso Fictício ME',
  'Rodoviário Teste Transportes',
]

const PESSOAS = ['Ana Souza', 'Carlos Pereira', 'Beatriz Lima', 'Diego Santos', 'Fernanda Costa', 'Rafael Oliveira', 'Juliana Alves', 'Marcos Teixeira']

const PERFIS = ['Administrador', 'Almoxarifado', 'Suprimentos', 'Consulta']

const METODOS_LEITURA = ['Texto do PDF', 'Código de barras', 'OCR', 'Digitação manual']

const CONFIANCAS = ['Alta', 'Conferir', 'Baixa']

const TIPOS_RECEBIMENTO = ['Estoque', 'Débito Direto']

const UNIDADES = ['PÇ', 'UN', 'KG', 'M', 'CX']

const DESCRICOES_ITEM = ['Parafuso sextavado M10', 'Chapa de aço 2mm', 'Cabo elétrico 2,5mm', 'Luva de proteção', 'Tinta industrial 20L', 'Correia transportadora', 'Rolamento 6204', 'Filtro de ar industrial']

const TIPOS_DIVERGENCIA = ['Quantidade incorreta', 'Material avariado', 'Material diferente do solicitado', 'Falta de documentação', 'Problema de embalagem']

const CATEGORIAS_ANEXO = ['Nota Fiscal', 'DACTE', 'Pedido', 'Fotos', 'Certificados', 'Outros documentos']

const MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

const SITUACOES_ANEXO = ['Ativo', 'Removido', 'Quarentena', 'Purgado']

const ACOES_AUDITORIA = ['Recebimento criado', 'Item incluído', 'Status alterado', 'Anexo incluído', 'Anexo removido', 'Divergência registrada', 'Divergência resolvida']

const ENTIDADES_AUDITORIA = ['Recebimento', 'Chegada', 'Anexo', 'Usuário']

function pick(list, index) {
  return list[index % list.length]
}

function pad(value, length) {
  return String(value).padStart(length, '0')
}

function isoDate(dayOffset) {
  const base = new Date('2026-10-08T12:00:00')
  base.setDate(base.getDate() - dayOffset)
  return base.toISOString().slice(0, 10)
}

function isoDateTime(dayOffset, hour, minute) {
  return `${isoDate(dayOffset)}T${pad(hour, 2)}:${pad(minute, 2)}:00`
}

function fakeUuid(prefix, index) {
  return `${prefix}-0000-0000-0000-${pad(index, 12)}`
}

function cnpj(seed) {
  const n = String(10000000000000 + seed * 37).slice(0, 14)
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12, 14)}`
}

function chaveNfeFicticia(seed) {
  return `352610${pad(seed, 2)}00000000${pad(seed, 6)}550010${pad(seed, 9)}1`.padEnd(44, '0').slice(0, 44)
}

// ---------------------------------------------------------------------------
// RECEBIMENTOS (gerado primeiro — as demais abas referenciam o protocolo)
// ---------------------------------------------------------------------------
const RECEBIMENTO_STATUS_LABELS = ['Em digitação', 'Aguardando documentação', 'Em conferência', 'Divergência identificada', 'Conferido/Finalizado']

const RECEBIMENTOS_COUNT = 20
export const mockRecebimentos = Array.from({ length: RECEBIMENTOS_COUNT }, (_, i) => {
  const index = i + 1
  const protocolo = `REC-2026-${pad(index, 4)}`
  const temChegada = index <= 9
  return {
    id: fakeUuid('REC', index),
    protocolo,
    pedido: `45008${pad(70000 + index, 5)}`,
    numeroNf: index % 6 === 0 ? '' : String(400000 + index * 37),
    serieNf: index % 6 === 0 ? '' : '1',
    dataRecebimento: isoDate(index),
    fornecedor: pick(FORNECEDORES, index),
    cnpjFornecedor: cnpj(index),
    tipo: pick(TIPOS_RECEBIMENTO, index),
    responsavelNome: pick(PESSOAS, index),
    status: pick(RECEBIMENTO_STATUS_LABELS, index),
    observacoes: index % 4 === 0 ? 'Entrega no portão 2, volumes lacrados.' : '',
    criadoEm: isoDateTime(index, 8 + (index % 8), (index * 7) % 60),
    atualizadoEm: isoDateTime(Math.max(index - 1, 0), 9 + (index % 7), (index * 11) % 60),
    arquivado: index % 9 === 0,
    chegadaVinculada: temChegada ? `CHG-2026-${pad(index, 4)}` : '',
    nfeChaveAcesso: index % 6 === 0 ? '' : chaveNfeFicticia(index),
  }
})

// ---------------------------------------------------------------------------
// CHEGADAS (Portaria)
// ---------------------------------------------------------------------------
const CHEGADAS_COUNT = 16
export const mockChegadas = Array.from({ length: CHEGADAS_COUNT }, (_, i) => {
  const index = i + 1
  const vinculada = index <= 9
  return {
    id: fakeUuid('CHG', index),
    codigo: `CHG-2026-${pad(index, 4)}`,
    numeroNf: String(400000 + index * 37),
    serieNf: '1',
    nfeChaveAcesso: chaveNfeFicticia(index),
    cnpjEmitente: cnpj(index),
    fornecedor: index % 7 === 0 ? '' : pick(FORNECEDORES, index),
    transportadora: pick(TRANSPORTADORAS, index),
    chegadaEm: isoDateTime(index, 7 + (index % 5), (index * 13) % 60),
    saidaEm: index % 3 === 0 ? '' : isoDateTime(index, 8 + (index % 5), (index * 17) % 60),
    metodoLeitura: pick(METODOS_LEITURA, index),
    confianca: pick(CONFIANCAS, index),
    registradoPor: pick(PESSOAS, index + 2),
    criadoEm: isoDateTime(index, 7 + (index % 5), (index * 13) % 60),
    recebimentoVinculado: vinculada ? `REC-2026-${pad(index, 4)}` : '',
  }
})

// ---------------------------------------------------------------------------
// ITENS
// ---------------------------------------------------------------------------
const ITENS_COUNT = 32
export const mockItens = Array.from({ length: ITENS_COUNT }, (_, i) => {
  const index = i + 1
  const recebimentoIndex = ((index - 1) % RECEBIMENTOS_COUNT) + 1
  const solicitada = 10 + (index % 15) * 3
  const recebida = index % 5 === 0 ? solicitada - 2 : solicitada
  return {
    id: fakeUuid('ITM', index),
    recebimentoProtocolo: `REC-2026-${pad(recebimentoIndex, 4)}`,
    numero: String((index % 8) * 10 + 10),
    codigo: `COD-${pad(1000 + index, 4)}`,
    descricao: pick(DESCRICOES_ITEM, index),
    quantidadeSolicitada: solicitada,
    quantidadeRecebida: recebida,
    unidade: pick(UNIDADES, index),
  }
})

// ---------------------------------------------------------------------------
// DIVERGÊNCIAS
// ---------------------------------------------------------------------------
const DIVERGENCIAS_COUNT = 11
export const mockDivergencias = Array.from({ length: DIVERGENCIAS_COUNT }, (_, i) => {
  const index = i + 1
  const recebimentoIndex = ((index - 1) % RECEBIMENTOS_COUNT) + 1
  const resolvida = index % 2 === 0
  return {
    id: fakeUuid('DIV', index),
    recebimentoProtocolo: `REC-2026-${pad(recebimentoIndex, 4)}`,
    tipo: pick(TIPOS_DIVERGENCIA, index),
    descricao: 'Quantidade recebida divergente da nota fiscal — ver detalhes no recebimento.',
    item: pick(DESCRICOES_ITEM, index),
    criadaEm: isoDateTime(index + 2, 10, (index * 19) % 60),
    criadaPor: pick(PESSOAS, index),
    resolvida,
    resolvidaEm: resolvida ? isoDateTime(index, 14, (index * 23) % 60) : '',
    resolvidaPor: resolvida ? pick(PESSOAS, index + 3) : '',
    resolucao: resolvida ? 'Fornecedor notificado; crédito combinado para a próxima entrega.' : '',
  }
})

// ---------------------------------------------------------------------------
// HISTÓRICO (status)
// ---------------------------------------------------------------------------
const HISTORICO_COUNT = 20
export const mockHistorico = Array.from({ length: HISTORICO_COUNT }, (_, i) => {
  const index = i + 1
  const recebimentoIndex = ((index - 1) % RECEBIMENTOS_COUNT) + 1
  const de = index % 5 === 0 ? null : pick(RECEBIMENTO_STATUS_LABELS, index - 1)
  return {
    id: fakeUuid('HST', index),
    recebimentoProtocolo: `REC-2026-${pad(recebimentoIndex, 4)}`,
    data: isoDateTime(index, 9 + (index % 6), (index * 9) % 60),
    usuario: pick(PESSOAS, index),
    statusAnterior: de || '',
    novoStatus: pick(RECEBIMENTO_STATUS_LABELS, index),
    observacao: index % 4 === 0 ? 'Registro criado.' : '',
  }
})

// ---------------------------------------------------------------------------
// AUDITORIA
// ---------------------------------------------------------------------------
const AUDITORIA_COUNT = 24
export const mockAuditoria = Array.from({ length: AUDITORIA_COUNT }, (_, i) => {
  const index = i + 1
  const recebimentoIndex = ((index - 1) % RECEBIMENTOS_COUNT) + 1
  return {
    id: fakeUuid('AUD', index),
    data: isoDateTime(index, 7 + (index % 10), (index * 31) % 60),
    entidade: pick(ENTIDADES_AUDITORIA, index),
    registro: `REC-2026-${pad(recebimentoIndex, 4)}`,
    usuario: pick(PESSOAS, index),
    acao: pick(ACOES_AUDITORIA, index),
    resumo: `${pick(ACOES_AUDITORIA, index)} no protocolo REC-2026-${pad(recebimentoIndex, 4)}.`,
    requestId: fakeUuid('REQ', index),
  }
})

// ---------------------------------------------------------------------------
// ANEXOS
// ---------------------------------------------------------------------------
const ANEXOS_COUNT = 15
export const mockAnexos = Array.from({ length: ANEXOS_COUNT }, (_, i) => {
  const index = i + 1
  const recebimentoIndex = ((index - 1) % RECEBIMENTOS_COUNT) + 1
  const situacao = pick(SITUACOES_ANEXO, index)
  const removido = situacao === 'Removido' || situacao === 'Purgado'
  return {
    id: fakeUuid('ANX', index),
    recebimentoProtocolo: `REC-2026-${pad(recebimentoIndex, 4)}`,
    nome: `${pick(CATEGORIAS_ANEXO, index).toLowerCase().replace(/\s+/g, '-')}-${pad(index, 3)}.${index % 3 === 0 ? 'jpg' : 'pdf'}`,
    categoria: pick(CATEGORIAS_ANEXO, index),
    mimeType: pick(MIME_TYPES, index),
    tamanho: 120_000 + index * 53_000,
    incluidoPor: pick(PESSOAS, index),
    incluidoEm: isoDateTime(index, 11, (index * 21) % 60),
    situacao,
    removidoEm: removido ? isoDateTime(Math.max(index - 2, 0), 16, (index * 27) % 60) : '',
    motivo: removido ? 'Arquivo duplicado, substituído por versão mais legível.' : '',
  }
})

// ---------------------------------------------------------------------------
// USUÁRIOS — nunca incluir PIN, hash, token de sessão ou qualquer segredo.
// ---------------------------------------------------------------------------
const USUARIOS_COUNT = 8
export const mockUsuarios = Array.from({ length: USUARIOS_COUNT }, (_, i) => {
  const index = i + 1
  return {
    id: fakeUuid('USR', index),
    matricula: pad(10000 + index, 6),
    nome: pick(PESSOAS, index),
    perfil: pick(PERFIS, index),
    ativo: index !== USUARIOS_COUNT,
    criadoEm: isoDateTime(index * 6, 9, 0),
    atualizadoEm: isoDateTime(index, 9, 0),
  }
})

// ---------------------------------------------------------------------------
// Configuração das abas — dirige o grid genérico (colunas, busca, filtros).
// `badgeTones` mapeia valor → tom visual (success/warning/danger/neutral);
// são só representações desta tela, não enums de banco.
// ---------------------------------------------------------------------------
const STATUS_TONES_RECEBIMENTO = {
  'Em digitação': 'neutral',
  'Aguardando documentação': 'warning',
  'Em conferência': 'info',
  'Divergência identificada': 'danger',
  'Conferido/Finalizado': 'success',
}

const CONFIANCA_TONES = { Alta: 'success', Conferir: 'warning', Baixa: 'danger' }
const SITUACAO_ANEXO_TONES = { Ativo: 'success', Removido: 'neutral', Quarentena: 'warning', Purgado: 'danger' }

export const TABS = [
  {
    id: 'chegadas',
    label: 'Chegadas',
    rows: mockChegadas,
    primaryKeyField: 'codigo',
    idField: 'id',
    searchFields: ['codigo', 'numeroNf', 'fornecedor', 'transportadora', 'registradoPor', 'nfeChaveAcesso'],
    periodoField: 'chegadaEm',
    statusField: '__statusChegada',
    statusOptions: [
      { value: 'AGUARDANDO', label: 'Aguardando conferência', tone: 'warning' },
      { value: 'VINCULADA', label: 'Vinculada a recebimento', tone: 'success' },
    ],
    deriveRow: (row) => ({ ...row, __statusChegada: row.recebimentoVinculado ? 'VINCULADA' : 'AGUARDANDO' }),
    columns: [
      { key: 'codigo', label: 'Código', type: 'mono' },
      { key: 'numeroNf', label: 'NF' },
      { key: 'serieNf', label: 'Série' },
      { key: 'nfeChaveAcesso', label: 'Chave NF-e', type: 'mono', truncate: 18 },
      { key: 'cnpjEmitente', label: 'CNPJ emitente', type: 'mono' },
      { key: 'fornecedor', label: 'Fornecedor', truncate: 28 },
      { key: 'transportadora', label: 'Transportadora', truncate: 24 },
      { key: 'chegadaEm', label: 'Chegada', type: 'datetime' },
      { key: 'saidaEm', label: 'Saída', type: 'datetime' },
      { key: 'metodoLeitura', label: 'Método de leitura' },
      { key: 'confianca', label: 'Confiança', type: 'badge', badgeTones: CONFIANCA_TONES },
      { key: '__statusChegada', label: 'Status', type: 'badge', badgeTones: { AGUARDANDO: 'warning', VINCULADA: 'success' }, badgeLabels: { AGUARDANDO: 'Aguardando conferência', VINCULADA: 'Vinculada a recebimento' } },
      { key: 'registradoPor', label: 'Registrado por' },
      { key: 'criadoEm', label: 'Criado em', type: 'datetime' },
      { key: 'recebimentoVinculado', label: 'Recebimento vinculado', type: 'mono' },
    ],
  },
  {
    id: 'recebimentos',
    label: 'Recebimentos',
    rows: mockRecebimentos,
    primaryKeyField: 'protocolo',
    idField: 'id',
    searchFields: ['protocolo', 'pedido', 'numeroNf', 'fornecedor', 'responsavelNome'],
    periodoField: 'dataRecebimento',
    statusField: 'status',
    statusOptions: Object.keys(STATUS_TONES_RECEBIMENTO).map((value) => ({ value, label: value, tone: STATUS_TONES_RECEBIMENTO[value] })),
    columns: [
      { key: 'protocolo', label: 'Protocolo', type: 'mono' },
      { key: 'pedido', label: 'Pedido' },
      { key: 'numeroNf', label: 'NF' },
      { key: 'serieNf', label: 'Série' },
      { key: 'dataRecebimento', label: 'Data recebimento', type: 'date' },
      { key: 'fornecedor', label: 'Fornecedor', truncate: 28 },
      { key: 'cnpjFornecedor', label: 'CNPJ', type: 'mono' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'responsavelNome', label: 'Responsável' },
      { key: 'status', label: 'Status', type: 'badge', badgeTones: STATUS_TONES_RECEBIMENTO },
      { key: 'observacoes', label: 'Observações', truncate: 32 },
      { key: 'criadoEm', label: 'Criado em', type: 'datetime' },
      { key: 'atualizadoEm', label: 'Atualizado em', type: 'datetime' },
      { key: 'arquivado', label: 'Arquivado', type: 'boolean' },
      { key: 'chegadaVinculada', label: 'Chegada vinculada', type: 'mono' },
      { key: 'nfeChaveAcesso', label: 'Chave NF-e', type: 'mono', truncate: 18 },
    ],
  },
  {
    id: 'itens',
    label: 'Itens',
    rows: mockItens,
    primaryKeyField: 'codigo',
    idField: 'id',
    searchFields: ['recebimentoProtocolo', 'codigo', 'descricao'],
    columns: [
      { key: 'recebimentoProtocolo', label: 'Recebimento', type: 'mono' },
      { key: 'numero', label: 'Número', align: 'right' },
      { key: 'codigo', label: 'Código', type: 'mono' },
      { key: 'descricao', label: 'Descrição', truncate: 32 },
      { key: 'quantidadeSolicitada', label: 'Qtd. solicitada', type: 'number' },
      { key: 'quantidadeRecebida', label: 'Qtd. recebida', type: 'number' },
      { key: 'unidade', label: 'Unidade' },
    ],
  },
  {
    id: 'divergencias',
    label: 'Divergências',
    rows: mockDivergencias,
    primaryKeyField: 'id',
    idField: 'id',
    searchFields: ['recebimentoProtocolo', 'tipo', 'descricao', 'criadaPor'],
    periodoField: 'criadaEm',
    statusField: 'resolvida',
    statusOptions: [
      { value: 'true', label: 'Resolvida', tone: 'success' },
      { value: 'false', label: 'Em aberto', tone: 'danger' },
    ],
    columns: [
      { key: 'recebimentoProtocolo', label: 'Recebimento', type: 'mono' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'descricao', label: 'Descrição', truncate: 36 },
      { key: 'item', label: 'Item', truncate: 24 },
      { key: 'criadaEm', label: 'Criada em', type: 'datetime' },
      { key: 'criadaPor', label: 'Criada por' },
      { key: 'resolvida', label: 'Resolvida', type: 'boolean' },
      { key: 'resolvidaEm', label: 'Resolvida em', type: 'datetime' },
      { key: 'resolvidaPor', label: 'Resolvida por' },
      { key: 'resolucao', label: 'Resolução', truncate: 32 },
    ],
  },
  {
    id: 'historico',
    label: 'Histórico',
    rows: mockHistorico,
    primaryKeyField: 'id',
    idField: 'id',
    searchFields: ['recebimentoProtocolo', 'usuario', 'statusAnterior', 'novoStatus'],
    periodoField: 'data',
    columns: [
      { key: 'recebimentoProtocolo', label: 'Recebimento', type: 'mono' },
      { key: 'data', label: 'Data', type: 'datetime' },
      { key: 'usuario', label: 'Usuário' },
      { key: 'statusAnterior', label: 'Status anterior' },
      { key: 'novoStatus', label: 'Novo status' },
      { key: 'observacao', label: 'Observação', truncate: 28 },
    ],
  },
  {
    id: 'auditoria',
    label: 'Auditoria',
    rows: mockAuditoria,
    primaryKeyField: 'requestId',
    idField: 'id',
    searchFields: ['registro', 'usuario', 'acao', 'resumo'],
    periodoField: 'data',
    columns: [
      { key: 'data', label: 'Data', type: 'datetime' },
      { key: 'entidade', label: 'Entidade' },
      { key: 'registro', label: 'Registro', type: 'mono' },
      { key: 'usuario', label: 'Usuário' },
      { key: 'acao', label: 'Ação' },
      { key: 'resumo', label: 'Resumo', truncate: 36 },
      { key: 'requestId', label: 'Request ID', type: 'mono', truncate: 16 },
    ],
  },
  {
    id: 'anexos',
    label: 'Anexos',
    rows: mockAnexos,
    primaryKeyField: 'nome',
    idField: 'id',
    searchFields: ['recebimentoProtocolo', 'nome', 'categoria', 'incluidoPor'],
    periodoField: 'incluidoEm',
    statusField: 'situacao',
    statusOptions: Object.keys(SITUACAO_ANEXO_TONES).map((value) => ({ value, label: value, tone: SITUACAO_ANEXO_TONES[value] })),
    columns: [
      { key: 'recebimentoProtocolo', label: 'Recebimento', type: 'mono' },
      { key: 'nome', label: 'Nome', truncate: 28 },
      { key: 'categoria', label: 'Categoria' },
      { key: 'mimeType', label: 'MIME', type: 'mono' },
      { key: 'tamanho', label: 'Tamanho', type: 'filesize' },
      { key: 'incluidoPor', label: 'Incluído por' },
      { key: 'incluidoEm', label: 'Incluído em', type: 'datetime' },
      { key: 'situacao', label: 'Situação', type: 'badge', badgeTones: SITUACAO_ANEXO_TONES },
      { key: 'removidoEm', label: 'Removido em', type: 'datetime' },
      { key: 'motivo', label: 'Motivo', truncate: 28 },
    ],
  },
  {
    id: 'usuarios',
    label: 'Usuários',
    rows: mockUsuarios,
    primaryKeyField: 'matricula',
    idField: 'id',
    searchFields: ['matricula', 'nome', 'perfil'],
    statusField: 'ativo',
    statusOptions: [
      { value: 'true', label: 'Ativo', tone: 'success' },
      { value: 'false', label: 'Inativo', tone: 'neutral' },
    ],
    columns: [
      { key: 'matricula', label: 'Matrícula', type: 'mono' },
      { key: 'nome', label: 'Nome' },
      { key: 'perfil', label: 'Perfil' },
      { key: 'ativo', label: 'Ativo', type: 'boolean' },
      { key: 'criadoEm', label: 'Criado em', type: 'datetime' },
      { key: 'atualizadoEm', label: 'Atualizado em', type: 'datetime' },
    ],
  },
]
