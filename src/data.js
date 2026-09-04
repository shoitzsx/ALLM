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

export const SUPPLIER_OPTIONS = Object.freeze([
  { value: 'Aço Forte Distribuidora Ltda', label: 'Aço Forte Distribuidora Ltda' },
  { value: 'Ferramentas Industriais SA', label: 'Ferramentas Industriais SA' },
  { value: 'EPI Total Equipamentos', label: 'EPI Total Equipamentos' },
  { value: 'Elétrica Nordeste Cabos', label: 'Elétrica Nordeste Cabos' },
  { value: 'Rolamentos & Cia', label: 'Rolamentos & Cia' },
  { value: 'Tintas Proteção Industrial', label: 'Tintas Proteção Industrial' },
  { value: 'Hidráulica Sul Componentes', label: 'Hidráulica Sul Componentes' },
  { value: 'Embalagens Industriais Brasil', label: 'Embalagens Industriais Brasil' },
])

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
    id: 'USR-001',
    nome: 'Marcos Teixeira',
    name: 'Marcos Teixeira',
    iniciais: 'MT',
    email: 'marcos.teixeira@alm.local',
    perfil: 'Administrador',
    role: 'Administrador',
  },
  {
    id: 'USR-002',
    nome: 'Ana Ferreira',
    name: 'Ana Ferreira',
    iniciais: 'AF',
    email: 'ana.ferreira@alm.local',
    perfil: 'Almoxarifado',
    role: 'Almoxarifado',
  },
  {
    id: 'USR-003',
    nome: 'Rafael Souza',
    name: 'Rafael Souza',
    iniciais: 'RS',
    email: 'rafael.souza@alm.local',
    perfil: 'Suprimentos',
    role: 'Suprimentos',
  },
  {
    id: 'USR-004',
    nome: 'Carla Mendes',
    name: 'Carla Mendes',
    iniciais: 'CM',
    email: 'carla.mendes@alm.local',
    perfil: 'Consulta',
    role: 'Consulta',
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

function receipt(config) {
  const { responsavel, ...rest } = config
  return {
    numeroNf: null,
    serieNf: null,
    observacoes: '',
    anexos: [],
    divergencias: [],
    historicoStatus: [],
    historicoAlteracoes: [],
    arquivado: false,
    ...rest,
    responsavel: actor(responsavel),
  }
}

/**
 * Massa rica e determinística para o protótipo. Cobre os cinco estados, com
 * exemplos de NF pendente, anexos, divergência aberta e divergência resolvida.
 */
export const seedRecebimentos = [
  receipt({
    id: 'REC-2026-0001',
    protocolo: 'REC-2026-0001',
    pedido: 'PC-88231',
    numeroNf: '45210',
    serieNf: '1',
    dataRecebimento: '2026-07-06',
    fornecedor: 'Aço Forte Distribuidora Ltda',
    cnpjFornecedor: '12.345.678/0001-90',
    tipo: 'Estoque',
    responsavel: ANA,
    status: RECEBIMENTO_STATUS.FINALIZADO,
    observacoes: 'Material conferido sem ressalvas.',
    criadoEm: '2026-07-06T08:40:00-03:00',
    atualizadoEm: '2026-07-06T11:15:00-03:00',
    itens: [
      item('IT-0001-1', '10', 'PAR-3050', 'Parafuso sextavado M10x40 zincado', 500, 500, 'PÇ'),
      item('IT-0001-2', '20', 'ARR-1020', 'Arruela lisa M10', 1000, 1000, 'PÇ'),
    ],
    anexos: [
      attachment('ANX-0001-1', 'NF-45210.pdf', 'Nota Fiscal', '2026-07-06T08:45:00-03:00', ANA, 248000),
      attachment('ANX-0001-2', 'foto-descarga-01.jpg', 'Foto', '2026-07-06T08:50:00-03:00', ANA, 1520000),
    ],
    historicoStatus: [
      statusChange('HST-0001-1', '2026-07-06T08:40:00-03:00', ANA, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0001-2', '2026-07-06T09:10:00-03:00', ANA, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA, 'Itens e NF conferidos.'),
      statusChange('HST-0001-3', '2026-07-06T11:15:00-03:00', ANA, RECEBIMENTO_STATUS.CONFERENCIA, RECEBIMENTO_STATUS.FINALIZADO, 'Conferência concluída sem divergências.'),
    ],
    historicoAlteracoes: [
      change('AUD-0001-1', '2026-07-06T08:40:00-03:00', ANA, 'Recebimento criado', 'Protocolo REC-2026-0001.'),
      change('AUD-0001-2', '2026-07-06T08:45:00-03:00', ANA, 'Arquivo incluído', 'NF-45210.pdf'),
      change('AUD-0001-3', '2026-07-06T11:15:00-03:00', ANA, 'Status alterado', 'Em conferência → Conferido/Finalizado.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0002',
    protocolo: 'REC-2026-0002',
    pedido: 'PC-88250',
    numeroNf: '12044',
    serieNf: '2',
    dataRecebimento: '2026-07-18',
    fornecedor: 'Ferramentas Industriais SA',
    cnpjFornecedor: '23.456.789/0001-01',
    tipo: 'Débito Direto',
    responsavel: MARCOS,
    status: RECEBIMENTO_STATUS.FINALIZADO,
    observacoes: 'Ferramentaria conferida e liberada para uso imediato.',
    criadoEm: '2026-07-18T10:05:00-03:00',
    atualizadoEm: '2026-07-18T13:40:00-03:00',
    itens: [
      item('IT-0002-1', '10', 'FER-1002', 'Furadeira de impacto 750W', 5, 5, 'UN'),
      item('IT-0002-2', '20', 'BRC-1010', 'Broca aço rápido 10mm', 50, 50, 'PÇ'),
    ],
    anexos: [
      attachment('ANX-0002-1', 'NF-12044.pdf', 'Nota Fiscal', '2026-07-18T10:10:00-03:00', MARCOS, 198000),
    ],
    historicoStatus: [
      statusChange('HST-0002-1', '2026-07-18T10:05:00-03:00', MARCOS, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0002-2', '2026-07-18T11:00:00-03:00', MARCOS, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA, 'Aguardando conferência técnica.'),
      statusChange('HST-0002-3', '2026-07-18T13:40:00-03:00', MARCOS, RECEBIMENTO_STATUS.CONFERENCIA, RECEBIMENTO_STATUS.FINALIZADO, 'Conferido e liberado.'),
    ],
    historicoAlteracoes: [
      change('AUD-0002-1', '2026-07-18T10:05:00-03:00', MARCOS, 'Recebimento criado', 'Protocolo REC-2026-0002.'),
      change('AUD-0002-2', '2026-07-18T13:40:00-03:00', MARCOS, 'Status alterado', 'Em conferência → Conferido/Finalizado.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0003',
    protocolo: 'REC-2026-0003',
    pedido: 'PC-88310',
    numeroNf: '8891',
    serieNf: '1',
    dataRecebimento: '2026-08-02',
    fornecedor: 'EPI Total Equipamentos',
    cnpjFornecedor: '34.567.890/0001-12',
    tipo: 'Estoque',
    responsavel: ANA,
    status: RECEBIMENTO_STATUS.FINALIZADO,
    observacoes: 'Divergência de quantidade tratada com o fornecedor antes da finalização.',
    criadoEm: '2026-08-02T09:00:00-03:00',
    atualizadoEm: '2026-08-06T15:20:00-03:00',
    itens: [
      item('IT-0003-1', '10', 'LUV-2001', 'Luva de raspa cano longo', 200, 180, 'PAR'),
      item('IT-0003-2', '20', 'CAP-2100', 'Capacete de segurança classe B', 100, 100, 'UN'),
    ],
    anexos: [
      attachment('ANX-0003-1', 'NF-8891.pdf', 'Nota Fiscal', '2026-08-02T09:05:00-03:00', ANA, 176000),
    ],
    divergencias: [
      divergence('DIV-0003-1', 'Quantidade incorreta', 'Recebidas 180 de 200 luvas solicitadas; fornecedor notificado.', '2026-08-02T09:30:00-03:00', ANA, {
        itemId: 'IT-0003-1',
        resolvida: true,
        resolvidaEm: '2026-08-06T15:15:00-03:00',
        resolvidaPor: ANA,
        resolucao: 'Fornecedor enviou complemento de 20 unidades em nova remessa; divergência encerrada.',
      }),
    ],
    historicoStatus: [
      statusChange('HST-0003-1', '2026-08-02T09:00:00-03:00', ANA, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0003-2', '2026-08-02T09:30:00-03:00', ANA, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.DIVERGENCIA, 'Divergência de quantidade registrada.'),
      statusChange('HST-0003-3', '2026-08-06T15:20:00-03:00', ANA, RECEBIMENTO_STATUS.DIVERGENCIA, RECEBIMENTO_STATUS.FINALIZADO, 'Divergência resolvida, recebimento finalizado.'),
    ],
    historicoAlteracoes: [
      change('AUD-0003-1', '2026-08-02T09:00:00-03:00', ANA, 'Recebimento criado', 'Protocolo REC-2026-0003.'),
      change('AUD-0003-2', '2026-08-02T09:30:00-03:00', ANA, 'Divergência registrada', 'Quantidade incorreta: recebidas 180 de 200 luvas.'),
      change('AUD-0003-3', '2026-08-06T15:15:00-03:00', ANA, 'Divergência resolvida', 'Fornecedor enviou complemento de 20 unidades.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0004',
    protocolo: 'REC-2026-0004',
    pedido: 'PC-88402',
    dataRecebimento: '2026-09-04',
    fornecedor: 'Aço Forte Distribuidora Ltda',
    cnpjFornecedor: '12.345.678/0001-90',
    tipo: 'Estoque',
    responsavel: RAFAEL,
    status: RECEBIMENTO_STATUS.DIGITACAO,
    observacoes: 'Aguardando conferência de peso e romaneio antes de seguir.',
    criadoEm: '2026-09-04T08:10:00-03:00',
    atualizadoEm: '2026-09-04T08:10:00-03:00',
    itens: [
      item('IT-0004-1', '10', 'CHP-4020', 'Chapa de aço carbono 2mm 1,20x3,00m', 30, 30, 'UN'),
    ],
    historicoStatus: [
      statusChange('HST-0004-1', '2026-09-04T08:10:00-03:00', RAFAEL, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
    ],
    historicoAlteracoes: [
      change('AUD-0004-1', '2026-09-04T08:10:00-03:00', RAFAEL, 'Recebimento criado', 'Protocolo REC-2026-0004.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0005',
    protocolo: 'REC-2026-0005',
    pedido: 'PC-88415',
    dataRecebimento: '2026-09-03',
    fornecedor: 'Elétrica Nordeste Cabos',
    cnpjFornecedor: '45.678.901/0001-23',
    tipo: 'Estoque',
    responsavel: ANA,
    status: RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO,
    observacoes: 'Material chegou antes da nota fiscal; fornecedor prometeu envio em 48h.',
    criadoEm: '2026-09-03T14:00:00-03:00',
    atualizadoEm: '2026-09-03T14:20:00-03:00',
    itens: [
      item('IT-0005-1', '10', 'CAB-5010', 'Cabo flexível 2,5mm² (rolo 100m)', 10, 10, 'RL'),
      item('IT-0005-2', '20', 'DIS-5200', 'Disjuntor bipolar 32A', 40, 40, 'UN'),
    ],
    anexos: [
      attachment('ANX-0005-1', 'foto-material-01.jpg', 'Foto', '2026-09-03T14:10:00-03:00', ANA, 1340000),
    ],
    historicoStatus: [
      statusChange('HST-0005-1', '2026-09-03T14:00:00-03:00', ANA, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0005-2', '2026-09-03T14:20:00-03:00', ANA, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO, 'NF ainda não enviada pelo fornecedor.'),
    ],
    historicoAlteracoes: [
      change('AUD-0005-1', '2026-09-03T14:00:00-03:00', ANA, 'Recebimento criado', 'Protocolo REC-2026-0005.'),
      change('AUD-0005-2', '2026-09-03T14:20:00-03:00', ANA, 'Status alterado', 'Em digitação → Aguardando documentação.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0006',
    protocolo: 'REC-2026-0006',
    pedido: 'PC-88420',
    numeroNf: '34210',
    serieNf: '1',
    dataRecebimento: '2026-09-04',
    fornecedor: 'Rolamentos & Cia',
    cnpjFornecedor: '56.789.012/0001-34',
    tipo: 'Industrialização',
    responsavel: MARCOS,
    status: RECEBIMENTO_STATUS.CONFERENCIA,
    observacoes: 'Em conferência técnica com a manutenção.',
    criadoEm: '2026-09-04T09:30:00-03:00',
    atualizadoEm: '2026-09-04T10:00:00-03:00',
    itens: [
      item('IT-0006-1', '10', 'ROL-6205', 'Rolamento rígido de esferas 6205', 60, 60, 'UN'),
      item('IT-0006-2', '20', 'COR-6300', 'Correia dentada industrial', 15, 15, 'UN'),
    ],
    anexos: [
      attachment('ANX-0006-1', 'NF-34210.pdf', 'Nota Fiscal', '2026-09-04T09:35:00-03:00', MARCOS, 152000),
      attachment('ANX-0006-2', 'foto-recebimento-06.jpg', 'Foto', '2026-09-04T09:40:00-03:00', MARCOS, 1180000),
    ],
    historicoStatus: [
      statusChange('HST-0006-1', '2026-09-04T09:30:00-03:00', MARCOS, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0006-2', '2026-09-04T10:00:00-03:00', MARCOS, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA, 'Encaminhado para conferência técnica.'),
    ],
    historicoAlteracoes: [
      change('AUD-0006-1', '2026-09-04T09:30:00-03:00', MARCOS, 'Recebimento criado', 'Protocolo REC-2026-0006.'),
      change('AUD-0006-2', '2026-09-04T09:35:00-03:00', MARCOS, 'Arquivo incluído', 'NF-34210.pdf'),
    ],
  }),
  receipt({
    id: 'REC-2026-0007',
    protocolo: 'REC-2026-0007',
    pedido: 'PC-88399',
    numeroNf: '55892',
    serieNf: '3',
    dataRecebimento: '2026-08-28',
    fornecedor: 'Tintas Proteção Industrial',
    cnpjFornecedor: '67.890.123/0001-45',
    tipo: 'Estoque',
    responsavel: ANA,
    status: RECEBIMENTO_STATUS.DIVERGENCIA,
    observacoes: 'Parte do lote de solvente chegou avariada.',
    criadoEm: '2026-08-28T11:00:00-03:00',
    atualizadoEm: '2026-08-28T11:45:00-03:00',
    itens: [
      item('IT-0007-1', '10', 'TIN-7010', 'Tinta epóxi cinza 18L', 20, 20, 'UN'),
      item('IT-0007-2', '20', 'SOL-7020', 'Solvente industrial 5L', 10, 8, 'UN'),
    ],
    anexos: [
      attachment('ANX-0007-1', 'NF-55892.pdf', 'Nota Fiscal', '2026-08-28T11:05:00-03:00', ANA, 210000),
      attachment('ANX-0007-2', 'foto-avaria-solvente.jpg', 'Foto', '2026-08-28T11:30:00-03:00', ANA, 1670000),
    ],
    divergencias: [
      divergence('DIV-0007-1', 'Material avariado', '2 latas de solvente chegaram amassadas e vazando parcialmente.', '2026-08-28T11:45:00-03:00', ANA, {
        itemId: 'IT-0007-2',
      }),
    ],
    historicoStatus: [
      statusChange('HST-0007-1', '2026-08-28T11:00:00-03:00', ANA, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0007-2', '2026-08-28T11:20:00-03:00', ANA, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA, 'Iniciada conferência do lote.'),
      statusChange('HST-0007-3', '2026-08-28T11:45:00-03:00', ANA, RECEBIMENTO_STATUS.CONFERENCIA, RECEBIMENTO_STATUS.DIVERGENCIA, 'Avaria identificada em parte do lote de solvente.'),
    ],
    historicoAlteracoes: [
      change('AUD-0007-1', '2026-08-28T11:00:00-03:00', ANA, 'Recebimento criado', 'Protocolo REC-2026-0007.'),
      change('AUD-0007-2', '2026-08-28T11:45:00-03:00', ANA, 'Divergência registrada', 'Material avariado: 2 latas de solvente amassadas.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0008',
    protocolo: 'REC-2026-0008',
    pedido: 'PC-88405',
    dataRecebimento: '2026-08-30',
    fornecedor: 'Ferramentas Industriais SA',
    cnpjFornecedor: '23.456.789/0001-01',
    tipo: 'Comodato',
    responsavel: RAFAEL,
    status: RECEBIMENTO_STATUS.DIVERGENCIA,
    observacoes: 'Equipamento em comodato sem contrato assinado anexado.',
    criadoEm: '2026-08-30T13:15:00-03:00',
    atualizadoEm: '2026-08-30T16:00:00-03:00',
    itens: [
      item('IT-0008-1', '10', 'EMP-8001', 'Empilhadeira manual paleteira 2500kg', 1, 1, 'UN'),
    ],
    divergencias: [
      divergence('DIV-0008-1', 'Falta de documentação', 'Contrato de comodato assinado não foi anexado pelo fornecedor.', '2026-08-30T16:00:00-03:00', RAFAEL, {}),
    ],
    historicoStatus: [
      statusChange('HST-0008-1', '2026-08-30T13:15:00-03:00', RAFAEL, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0008-2', '2026-08-30T13:30:00-03:00', RAFAEL, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO, 'Aguardando contrato de comodato.'),
      statusChange('HST-0008-3', '2026-08-30T16:00:00-03:00', RAFAEL, RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO, RECEBIMENTO_STATUS.DIVERGENCIA, 'Prazo vencido sem envio do contrato.'),
    ],
    historicoAlteracoes: [
      change('AUD-0008-1', '2026-08-30T13:15:00-03:00', RAFAEL, 'Recebimento criado', 'Protocolo REC-2026-0008.'),
      change('AUD-0008-2', '2026-08-30T16:00:00-03:00', RAFAEL, 'Divergência registrada', 'Falta de documentação: contrato de comodato pendente.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0009',
    protocolo: 'REC-2026-0009',
    pedido: 'PC-88180',
    numeroNf: '7765',
    serieNf: '1',
    dataRecebimento: '2026-06-15',
    fornecedor: 'EPI Total Equipamentos',
    cnpjFornecedor: '34.567.890/0001-12',
    tipo: 'Estoque',
    responsavel: MARCOS,
    status: RECEBIMENTO_STATUS.FINALIZADO,
    observacoes: 'Reposição trimestral de EPIs conferida e liberada.',
    criadoEm: '2026-06-15T09:00:00-03:00',
    atualizadoEm: '2026-06-15T12:30:00-03:00',
    itens: [
      item('IT-0009-1', '10', 'OCU-9001', 'Óculos de proteção antiembaçante', 150, 150, 'UN'),
      item('IT-0009-2', '20', 'PRO-9002', 'Protetor auricular tipo plug', 300, 300, 'PAR'),
    ],
    anexos: [
      attachment('ANX-0009-1', 'NF-7765.pdf', 'Nota Fiscal', '2026-06-15T09:05:00-03:00', MARCOS, 165000),
    ],
    historicoStatus: [
      statusChange('HST-0009-1', '2026-06-15T09:00:00-03:00', MARCOS, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0009-2', '2026-06-15T12:30:00-03:00', MARCOS, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.FINALIZADO, 'Conferido e liberado para estoque.'),
    ],
    historicoAlteracoes: [
      change('AUD-0009-1', '2026-06-15T09:00:00-03:00', MARCOS, 'Recebimento criado', 'Protocolo REC-2026-0009.'),
      change('AUD-0009-2', '2026-06-15T12:30:00-03:00', MARCOS, 'Status alterado', 'Em digitação → Conferido/Finalizado.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0010',
    protocolo: 'REC-2026-0010',
    pedido: 'PC-88430',
    dataRecebimento: '2026-09-04',
    fornecedor: 'Rolamentos & Cia',
    cnpjFornecedor: '56.789.012/0001-34',
    tipo: 'Estoque',
    responsavel: ANA,
    status: RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO,
    observacoes: 'NF eletrônica ainda não disponibilizada pelo fornecedor.',
    criadoEm: '2026-09-04T11:00:00-03:00',
    atualizadoEm: '2026-09-04T11:20:00-03:00',
    itens: [
      item('IT-0010-1', '10', 'ROL-6400', 'Rolamento autocompensador de rolos', 25, 25, 'UN'),
    ],
    historicoStatus: [
      statusChange('HST-0010-1', '2026-09-04T11:00:00-03:00', ANA, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0010-2', '2026-09-04T11:20:00-03:00', ANA, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO, 'NF ainda não recebida.'),
    ],
    historicoAlteracoes: [
      change('AUD-0010-1', '2026-09-04T11:00:00-03:00', ANA, 'Recebimento criado', 'Protocolo REC-2026-0010.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0011',
    protocolo: 'REC-2026-0011',
    pedido: 'PC-88440',
    numeroNf: '99021',
    serieNf: '1',
    dataRecebimento: '2026-08-20',
    fornecedor: 'Aço Forte Distribuidora Ltda',
    cnpjFornecedor: '12.345.678/0001-90',
    tipo: 'Outro',
    responsavel: RAFAEL,
    status: RECEBIMENTO_STATUS.CONFERENCIA,
    observacoes: 'Aguardando liberação da engenharia para uso em obra interna.',
    criadoEm: '2026-08-20T10:30:00-03:00',
    atualizadoEm: '2026-08-20T11:10:00-03:00',
    itens: [
      item('IT-0011-1', '10', 'VER-1150', 'Vergalhão CA-50 10mm 12m', 200, 200, 'UN'),
    ],
    anexos: [
      attachment('ANX-0011-1', 'NF-99021.pdf', 'Nota Fiscal', '2026-08-20T10:35:00-03:00', RAFAEL, 132000),
    ],
    historicoStatus: [
      statusChange('HST-0011-1', '2026-08-20T10:30:00-03:00', RAFAEL, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-0011-2', '2026-08-20T11:10:00-03:00', RAFAEL, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA, 'Encaminhado para conferência da engenharia.'),
    ],
    historicoAlteracoes: [
      change('AUD-0011-1', '2026-08-20T10:30:00-03:00', RAFAEL, 'Recebimento criado', 'Protocolo REC-2026-0011.'),
    ],
  }),
  receipt({
    id: 'REC-2026-0012',
    protocolo: 'REC-2026-0012',
    pedido: 'PC-88450',
    dataRecebimento: '2026-09-02',
    fornecedor: 'Elétrica Nordeste Cabos',
    cnpjFornecedor: '45.678.901/0001-23',
    tipo: 'Estoque',
    responsavel: MARCOS,
    status: RECEBIMENTO_STATUS.DIGITACAO,
    observacoes: '',
    criadoEm: '2026-09-02T15:45:00-03:00',
    atualizadoEm: '2026-09-02T15:45:00-03:00',
    itens: [
      item('IT-0012-1', '10', 'LED-1200', 'Lâmpada LED tubular 18W', 100, 100, 'UN'),
    ],
    historicoStatus: [
      statusChange('HST-0012-1', '2026-09-02T15:45:00-03:00', MARCOS, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
    ],
    historicoAlteracoes: [
      change('AUD-0012-1', '2026-09-02T15:45:00-03:00', MARCOS, 'Recebimento criado', 'Protocolo REC-2026-0012.'),
    ],
  }),
]

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
