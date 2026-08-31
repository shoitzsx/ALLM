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
  { value: '3M do Brasil Ltda.', label: '3M do Brasil Ltda.', cnpj: '45.985.371/0001-08' },
  { value: 'ArcelorMittal Brasil S.A.', label: 'ArcelorMittal Brasil S.A.', cnpj: '17.469.701/0001-77' },
  { value: 'Gerdau Aços Longos S.A.', label: 'Gerdau Aços Longos S.A.', cnpj: '07.358.761/0001-69' },
  { value: 'Klabin S.A.', label: 'Klabin S.A.', cnpj: '89.637.490/0001-45' },
  { value: 'Parker Hannifin Indústria Ltda.', label: 'Parker Hannifin Indústria Ltda.', cnpj: '54.543.486/0001-84' },
  { value: 'Saint-Gobain Abrasivos Ltda.', label: 'Saint-Gobain Abrasivos Ltda.', cnpj: '61.064.838/0001-33' },
  { value: 'Siemens Brasil Ltda.', label: 'Siemens Brasil Ltda.', cnpj: '44.013.159/0001-16' },
  { value: 'SKF do Brasil Ltda.', label: 'SKF do Brasil Ltda.', cnpj: '61.077.327/0001-56' },
  { value: 'Votorantim Cimentos S.A.', label: 'Votorantim Cimentos S.A.', cnpj: '01.637.895/0001-32' },
  { value: 'WEG Equipamentos Elétricos S.A.', label: 'WEG Equipamentos Elétricos S.A.', cnpj: '07.175.725/0001-60' },
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
    nome: 'Marcos Oliveira',
    name: 'Marcos Oliveira',
    iniciais: 'MO',
    email: 'marcos.oliveira@alm.local',
    perfil: 'Almoxarifado',
    role: 'Almoxarifado',
  },
  {
    id: 'USR-002',
    nome: 'Ana Souza',
    name: 'Ana Souza',
    iniciais: 'AS',
    email: 'ana.souza@alm.local',
    perfil: 'Suprimentos',
    role: 'Suprimentos',
  },
  {
    id: 'USR-003',
    nome: 'Rafael Costa',
    name: 'Rafael Costa',
    iniciais: 'RC',
    email: 'rafael.costa@alm.local',
    perfil: 'Almoxarifado',
    role: 'Almoxarifado',
  },
  {
    id: 'USR-004',
    nome: 'Carla Mendes',
    name: 'Carla Mendes',
    iniciais: 'CM',
    email: 'carla.mendes@alm.local',
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
export const seedRecebimentos = [
  {
    id: 'REC-2026-0010',
    protocolo: 'REC-2026-0010',
    pedido: '4500873210',
    numeroNf: '248913',
    serieNf: '1',
    dataRecebimento: '2026-08-31',
    fornecedor: 'WEG Equipamentos Elétricos S.A.',
    cnpjFornecedor: '07.175.725/0001-60',
    tipo: 'Estoque',
    responsavel: actor(MARCOS),
    status: RECEBIMENTO_STATUS.FINALIZADO,
    observacoes: 'Entrega conferida no portão 2. Volumes sem avarias.',
    criadoEm: '2026-08-31T08:12:00-03:00',
    atualizadoEm: '2026-08-31T09:06:00-03:00',
    itens: [
      item('IT-0010-01', '10', 'MAT-001284', 'Motor trifásico 5 cv, 4 polos', 2, 2, 'PÇ'),
      item('IT-0010-02', '20', 'MAT-004311', 'Acoplamento elástico AG-112', 4, 4, 'UN'),
    ],
    anexos: [
      attachment('ANX-001001', 'NF_248913.pdf', 'Nota Fiscal', '2026-08-31T08:18:00-03:00', MARCOS, 684200),
      attachment('ANX-001002', 'DACTE_93481.pdf', 'DACTE', '2026-08-31T08:19:00-03:00', MARCOS, 391000),
      attachment('ANX-001003', 'Pedido_4500873210.pdf', 'Pedido', '2026-08-31T08:20:00-03:00', MARCOS, 226500),
      attachment('ANX-001004', 'volumes_recebidos.jpg', 'Foto', '2026-08-31T08:23:00-03:00', MARCOS, 1480000),
    ],
    divergencias: [],
    historicoStatus: [
      statusChange('HST-001001', '2026-08-31T08:12:00-03:00', MARCOS, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-001002', '2026-08-31T08:27:00-03:00', MARCOS, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA),
      statusChange('HST-001003', '2026-08-31T09:06:00-03:00', MARCOS, RECEBIMENTO_STATUS.CONFERENCIA, RECEBIMENTO_STATUS.FINALIZADO, 'Conferência física e documental concluída.'),
    ],
    historicoAlteracoes: [
      change('AUD-001001', '2026-08-31T08:12:00-03:00', MARCOS, 'Recebimento criado', 'Protocolo REC-2026-0010.'),
      change('AUD-001002', '2026-08-31T08:23:00-03:00', MARCOS, 'Arquivos incluídos', 'NF, DACTE, pedido e 1 foto.'),
    ],
  },
  {
    id: 'REC-2026-0009',
    protocolo: 'REC-2026-0009',
    pedido: '4500873188',
    numeroNf: '99314',
    serieNf: '3',
    dataRecebimento: '2026-08-31',
    fornecedor: 'SKF do Brasil Ltda.',
    cnpjFornecedor: '61.077.327/0001-56',
    tipo: 'Débito Direto',
    responsavel: actor(RAFAEL),
    status: RECEBIMENTO_STATUS.CONFERENCIA,
    observacoes: 'Aguardando validação da especificação do rolamento pelo solicitante.',
    criadoEm: '2026-08-31T09:34:00-03:00',
    atualizadoEm: '2026-08-31T10:02:00-03:00',
    itens: [
      item('IT-0009-01', '10', 'MAT-009720', 'Rolamento autocompensador 22218 EK', 6, 6, 'PÇ'),
      item('IT-0009-02', '20', 'MAT-009721', 'Bucha de fixação H 318', 6, 6, 'PÇ'),
    ],
    anexos: [
      attachment('ANX-000901', 'NF_99314.pdf', 'Nota Fiscal', '2026-08-31T09:38:00-03:00', RAFAEL, 583000),
      attachment('ANX-000902', 'etiqueta_rolamento.jpg', 'Foto', '2026-08-31T09:42:00-03:00', RAFAEL, 926000),
    ],
    divergencias: [],
    historicoStatus: [
      statusChange('HST-000901', '2026-08-31T09:34:00-03:00', RAFAEL, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-000902', '2026-08-31T10:02:00-03:00', RAFAEL, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA),
    ],
    historicoAlteracoes: [
      change('AUD-000901', '2026-08-31T09:34:00-03:00', RAFAEL, 'Recebimento criado', 'Protocolo REC-2026-0009.'),
    ],
  },
  {
    id: 'REC-2026-0008',
    protocolo: 'REC-2026-0008',
    pedido: '4500873097',
    numeroNf: null,
    serieNf: null,
    dataRecebimento: '2026-08-31',
    fornecedor: 'ArcelorMittal Brasil S.A.',
    cnpjFornecedor: '17.469.701/0001-77',
    tipo: 'Estoque',
    responsavel: actor(MARCOS),
    status: RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO,
    observacoes: 'Romaneio recebido; XML e DANFE ainda não enviados pelo fornecedor.',
    criadoEm: '2026-08-31T10:18:00-03:00',
    atualizadoEm: '2026-08-31T10:46:00-03:00',
    itens: [
      item('IT-0008-01', '10', 'MAT-015622', 'Chapa de aço carbono 6,35 mm', 1800, 1800, 'KG'),
    ],
    anexos: [
      attachment('ANX-000801', 'Pedido_4500873097.pdf', 'Pedido', '2026-08-31T10:20:00-03:00', MARCOS, 199000),
      attachment('ANX-000802', 'romaneio_entrega.pdf', 'Outro', '2026-08-31T10:22:00-03:00', MARCOS, 332000),
      attachment('ANX-000803', 'carga_chapas.jpg', 'Foto', '2026-08-31T10:25:00-03:00', MARCOS, 2110000),
    ],
    divergencias: [],
    historicoStatus: [
      statusChange('HST-000801', '2026-08-31T10:18:00-03:00', MARCOS, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-000802', '2026-08-31T10:46:00-03:00', MARCOS, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO, 'NF ainda não recebida.'),
    ],
    historicoAlteracoes: [
      change('AUD-000801', '2026-08-31T10:18:00-03:00', MARCOS, 'Recebimento criado', 'Protocolo REC-2026-0008.'),
    ],
  },
  {
    id: 'REC-2026-0007',
    protocolo: 'REC-2026-0007',
    pedido: '4500872964',
    numeroNf: '78122',
    serieNf: '1',
    dataRecebimento: '2026-08-31',
    fornecedor: 'Saint-Gobain Abrasivos Ltda.',
    cnpjFornecedor: '61.064.838/0001-33',
    tipo: 'Estoque',
    responsavel: actor(RAFAEL),
    status: RECEBIMENTO_STATUS.DIVERGENCIA,
    observacoes: 'Carga segregada na área de não conformes até orientação de Suprimentos.',
    criadoEm: '2026-08-31T11:04:00-03:00',
    atualizadoEm: '2026-08-31T11:48:00-03:00',
    itens: [
      item('IT-0007-01', '10', 'MAT-002034', 'Disco de corte 7 pol x 1,6 mm', 200, 180, 'PÇ'),
      item('IT-0007-02', '20', 'MAT-002036', 'Disco de desbaste 7 pol', 100, 100, 'PÇ'),
    ],
    anexos: [
      attachment('ANX-000701', 'NF_78122.pdf', 'Nota Fiscal', '2026-08-31T11:07:00-03:00', RAFAEL, 488000),
      attachment('ANX-000702', 'caixas_avariadas_01.jpg', 'Foto', '2026-08-31T11:15:00-03:00', RAFAEL, 1340000),
      attachment('ANX-000703', 'caixas_avariadas_02.jpg', 'Foto', '2026-08-31T11:16:00-03:00', RAFAEL, 1290000),
    ],
    divergencias: [
      divergence('DIV-000701', 'Quantidade incorreta', 'Faltaram 20 discos de corte no volume lacrado.', '2026-08-31T11:31:00-03:00', RAFAEL, { itemId: 'IT-0007-01' }),
      divergence('DIV-000702', 'Problema de embalagem', 'Duas caixas chegaram amassadas e com fita rompida.', '2026-08-31T11:35:00-03:00', RAFAEL),
    ],
    historicoStatus: [
      statusChange('HST-000701', '2026-08-31T11:04:00-03:00', RAFAEL, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-000702', '2026-08-31T11:22:00-03:00', RAFAEL, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA),
      statusChange('HST-000703', '2026-08-31T11:48:00-03:00', RAFAEL, RECEBIMENTO_STATUS.CONFERENCIA, RECEBIMENTO_STATUS.DIVERGENCIA, 'Diferença física e embalagem avariada.'),
    ],
    historicoAlteracoes: [
      change('AUD-000701', '2026-08-31T11:04:00-03:00', RAFAEL, 'Recebimento criado', 'Protocolo REC-2026-0007.'),
      change('AUD-000702', '2026-08-31T11:35:00-03:00', RAFAEL, 'Divergências registradas', 'Quantidade incorreta e problema de embalagem.'),
    ],
  },
  {
    id: 'REC-2026-0006',
    protocolo: 'REC-2026-0006',
    pedido: '4500872801',
    numeroNf: null,
    serieNf: null,
    dataRecebimento: '2026-08-31',
    fornecedor: 'Klabin S.A.',
    cnpjFornecedor: '89.637.490/0001-45',
    tipo: 'Débito Direto',
    responsavel: actor(MARCOS),
    status: RECEBIMENTO_STATUS.DIGITACAO,
    observacoes: 'Descarga em andamento. Contagem final ainda não realizada.',
    criadoEm: '2026-08-31T13:26:00-03:00',
    atualizadoEm: '2026-08-31T13:31:00-03:00',
    itens: [
      item('IT-0006-01', '10', 'MAT-021401', 'Papelão ondulado dupla face 1,20 m', 24, 18, 'RL'),
    ],
    anexos: [
      attachment('ANX-000601', 'inicio_descarga.jpg', 'Foto', '2026-08-31T13:31:00-03:00', MARCOS, 1780000),
    ],
    divergencias: [],
    historicoStatus: [
      statusChange('HST-000601', '2026-08-31T13:26:00-03:00', MARCOS, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
    ],
    historicoAlteracoes: [
      change('AUD-000601', '2026-08-31T13:26:00-03:00', MARCOS, 'Recebimento criado', 'Protocolo REC-2026-0006.'),
    ],
  },
  {
    id: 'REC-2026-0005',
    protocolo: 'REC-2026-0005',
    pedido: '4500872145',
    numeroNf: '551087',
    serieNf: '2',
    dataRecebimento: '2026-08-28',
    fornecedor: 'Siemens Brasil Ltda.',
    cnpjFornecedor: '44.013.159/0001-16',
    tipo: 'Débito Direto',
    responsavel: actor(RAFAEL),
    status: RECEBIMENTO_STATUS.FINALIZADO,
    observacoes: 'Material entregue diretamente à manutenção após conferência.',
    criadoEm: '2026-08-28T14:08:00-03:00',
    atualizadoEm: '2026-08-28T15:22:00-03:00',
    itens: [
      item('IT-0005-01', '10', 'MAT-033008', 'Módulo de entrada digital SIMATIC', 3, 3, 'UN'),
    ],
    anexos: [
      attachment('ANX-000501', 'NF_551087.pdf', 'Nota Fiscal', '2026-08-28T14:12:00-03:00', RAFAEL, 612000),
      attachment('ANX-000502', 'certificado_conformidade.pdf', 'Certificado', '2026-08-28T14:14:00-03:00', RAFAEL, 845000),
      attachment('ANX-000503', 'etiqueta_modulos.jpg', 'Foto', '2026-08-28T14:18:00-03:00', RAFAEL, 740000),
    ],
    divergencias: [],
    historicoStatus: [
      statusChange('HST-000501', '2026-08-28T14:08:00-03:00', RAFAEL, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-000502', '2026-08-28T14:30:00-03:00', RAFAEL, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA),
      statusChange('HST-000503', '2026-08-28T15:22:00-03:00', RAFAEL, RECEBIMENTO_STATUS.CONFERENCIA, RECEBIMENTO_STATUS.FINALIZADO),
    ],
    historicoAlteracoes: [
      change('AUD-000501', '2026-08-28T14:08:00-03:00', RAFAEL, 'Recebimento criado', 'Protocolo REC-2026-0005.'),
    ],
  },
  {
    id: 'REC-2026-0004',
    protocolo: 'REC-2026-0004',
    pedido: '4500871932',
    numeroNf: '41076',
    serieNf: '1',
    dataRecebimento: '2026-08-27',
    fornecedor: 'Parker Hannifin Indústria Ltda.',
    cnpjFornecedor: '54.543.486/0001-84',
    tipo: 'Estoque',
    responsavel: actor(MARCOS),
    status: RECEBIMENTO_STATUS.DIVERGENCIA,
    observacoes: 'Suprimentos acionou o fornecedor para troca do item 20.',
    criadoEm: '2026-08-27T10:11:00-03:00',
    atualizadoEm: '2026-08-28T09:42:00-03:00',
    itens: [
      item('IT-0004-01', '10', 'MAT-001930', 'Mangueira hidráulica 1/2 pol', 50, 50, 'M'),
      item('IT-0004-02', '20', 'MAT-001944', 'Terminal hidráulico fêmea 1/2 pol', 20, 20, 'PÇ'),
    ],
    anexos: [
      attachment('ANX-000401', 'NF_41076.pdf', 'Nota Fiscal', '2026-08-27T10:15:00-03:00', MARCOS, 420000),
      attachment('ANX-000402', 'terminal_recebido.jpg', 'Foto', '2026-08-27T10:38:00-03:00', MARCOS, 1080000),
    ],
    divergencias: [
      divergence('DIV-000401', 'Material diferente', 'Terminal recebido possui rosca BSP; pedido especifica NPT.', '2026-08-27T10:42:00-03:00', MARCOS, { itemId: 'IT-0004-02' }),
      divergence('DIV-000402', 'Falta de documentação', 'Certificado do lote foi enviado no dia seguinte.', '2026-08-27T10:44:00-03:00', MARCOS, {
        resolvida: true,
        resolvidaEm: '2026-08-28T09:42:00-03:00',
        resolvidaPor: ANA,
        resolucao: 'Certificado recebido por Suprimentos e anexado ao processo.',
      }),
    ],
    historicoStatus: [
      statusChange('HST-000401', '2026-08-27T10:11:00-03:00', MARCOS, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-000402', '2026-08-27T10:25:00-03:00', MARCOS, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA),
      statusChange('HST-000403', '2026-08-27T10:49:00-03:00', MARCOS, RECEBIMENTO_STATUS.CONFERENCIA, RECEBIMENTO_STATUS.DIVERGENCIA),
    ],
    historicoAlteracoes: [
      change('AUD-000401', '2026-08-27T10:11:00-03:00', MARCOS, 'Recebimento criado', 'Protocolo REC-2026-0004.'),
      change('AUD-000402', '2026-08-28T09:42:00-03:00', ANA, 'Divergência resolvida', 'Certificado do lote recebido.'),
    ],
  },
  {
    id: 'REC-2026-0003',
    protocolo: 'REC-2026-0003',
    pedido: '4500871680',
    numeroNf: null,
    serieNf: null,
    dataRecebimento: '2026-08-26',
    fornecedor: '3M do Brasil Ltda.',
    cnpjFornecedor: '45.985.371/0001-08',
    tipo: 'Estoque',
    responsavel: actor(RAFAEL),
    status: RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO,
    observacoes: 'Fornecedor informou indisponibilidade temporária do DANFE.',
    criadoEm: '2026-08-26T16:02:00-03:00',
    atualizadoEm: '2026-08-26T16:28:00-03:00',
    itens: [
      item('IT-0003-01', '10', 'MAT-005106', 'Respirador semifacial reutilizável', 30, 30, 'UN'),
      item('IT-0003-02', '20', 'MAT-005108', 'Filtro químico para vapores orgânicos', 60, 60, 'PÇ'),
    ],
    anexos: [
      attachment('ANX-000301', 'volumes_3m.jpg', 'Foto', '2026-08-26T16:08:00-03:00', RAFAEL, 1550000),
      attachment('ANX-000302', 'Pedido_4500871680.pdf', 'Pedido', '2026-08-26T16:10:00-03:00', RAFAEL, 208000),
    ],
    divergencias: [
      divergence('DIV-000301', 'Falta de documentação', 'Nota Fiscal ainda não disponibilizada pelo fornecedor.', '2026-08-26T16:20:00-03:00', RAFAEL),
    ],
    historicoStatus: [
      statusChange('HST-000301', '2026-08-26T16:02:00-03:00', RAFAEL, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-000302', '2026-08-26T16:28:00-03:00', RAFAEL, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO),
    ],
    historicoAlteracoes: [
      change('AUD-000301', '2026-08-26T16:02:00-03:00', RAFAEL, 'Recebimento criado', 'Protocolo REC-2026-0003.'),
    ],
  },
  {
    id: 'REC-2026-0002',
    protocolo: 'REC-2026-0002',
    pedido: '4500871426',
    numeroNf: '32884',
    serieNf: '1',
    dataRecebimento: '2026-08-25',
    fornecedor: 'Gerdau Aços Longos S.A.',
    cnpjFornecedor: '07.358.761/0001-69',
    tipo: 'Estoque',
    responsavel: actor(MARCOS),
    status: RECEBIMENTO_STATUS.CONFERENCIA,
    observacoes: 'Peso da balança confere com o romaneio; certificado em validação.',
    criadoEm: '2026-08-25T08:44:00-03:00',
    atualizadoEm: '2026-08-25T09:18:00-03:00',
    itens: [
      item('IT-0002-01', '10', 'MAT-019001', 'Barra redonda aço SAE 1045, 2 pol', 2500, 2498.5, 'KG'),
    ],
    anexos: [
      attachment('ANX-000201', 'NF_32884.pdf', 'Nota Fiscal', '2026-08-25T08:48:00-03:00', MARCOS, 501000),
      attachment('ANX-000202', 'romaneio_pesagem.pdf', 'Outro', '2026-08-25T08:50:00-03:00', MARCOS, 280000),
      attachment('ANX-000203', 'feixe_barras.jpg', 'Foto', '2026-08-25T08:54:00-03:00', MARCOS, 1900000),
    ],
    divergencias: [],
    historicoStatus: [
      statusChange('HST-000201', '2026-08-25T08:44:00-03:00', MARCOS, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
      statusChange('HST-000202', '2026-08-25T09:18:00-03:00', MARCOS, RECEBIMENTO_STATUS.DIGITACAO, RECEBIMENTO_STATUS.CONFERENCIA),
    ],
    historicoAlteracoes: [
      change('AUD-000201', '2026-08-25T08:44:00-03:00', MARCOS, 'Recebimento criado', 'Protocolo REC-2026-0002.'),
    ],
  },
  {
    id: 'REC-2026-0001',
    protocolo: 'REC-2026-0001',
    pedido: '4500871003',
    numeroNf: null,
    serieNf: null,
    dataRecebimento: '2026-08-24',
    fornecedor: 'Votorantim Cimentos S.A.',
    cnpjFornecedor: '01.637.895/0001-32',
    tipo: 'Outro',
    responsavel: actor(RAFAEL),
    status: RECEBIMENTO_STATUS.DIGITACAO,
    observacoes: 'Registro recuperado de anotação preliminar da portaria.',
    criadoEm: '2026-08-24T15:40:00-03:00',
    atualizadoEm: '2026-08-24T15:40:00-03:00',
    itens: [
      item('IT-0001-01', '10', 'MAT-027001', 'Argamassa refratária de alta alumina', 40, 40, 'UN'),
    ],
    anexos: [],
    divergencias: [],
    historicoStatus: [
      statusChange('HST-000101', '2026-08-24T15:40:00-03:00', RAFAEL, null, RECEBIMENTO_STATUS.DIGITACAO, 'Registro criado.'),
    ],
    historicoAlteracoes: [
      change('AUD-000101', '2026-08-24T15:40:00-03:00', RAFAEL, 'Recebimento criado', 'Protocolo REC-2026-0001.'),
    ],
  },
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
