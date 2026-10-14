import { RECEIPT_TYPE_OPTIONS } from '../../src/data.js'
import { interpretarChave } from '../../src/features/nfeReader/chaveNFe.js'

function validationError(message, details) {
  const error = new Error(message)
  error.code = 'VALIDATION_ERROR'
  error.status = 422
  error.details = details
  throw error
}

function conflict(code, message) {
  const error = new Error(message)
  error.code = code
  error.status = 409
  throw error
}

function text(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function numericText(value) {
  return value.replace(/^0+(?=\d)/, '')
}

function sameNumber(left, right) {
  return /^\d+$/.test(left) && /^\d+$/.test(right) && numericText(left) === numericText(right)
}

function validCnpj(value) {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false
  const digits = [...value].map(Number)
  const digit = (weights) => {
    const remainder = weights.reduce((sum, weight, index) => sum + weight * digits[index], 0) % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  return digit([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === digits[12]
    && digit([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === digits[13]
}

function parseNfeKey(value) {
  if (!/^[\d\s.-]+$/.test(value)) return null
  const parsed = interpretarChave(value)
  const month = Number(parsed?.anoMes.slice(2, 4))
  if (!parsed || !parsed.ufSigla || month < 1 || month > 12 || parsed.modelo !== '55' || !validCnpj(parsed.cnpj)) return null
  return parsed
}

// Only operational fields are returned. Identity, linkage, timestamps and actor
// belong to the database transaction and the authenticated backend context.
export function normalizeChegadaInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    validationError('Dados da chegada inválidos.', { body: 'Envie um objeto JSON.' })
  }

  const errors = {}
  const rawKey = text(input.nfeChaveAcesso)
  const key = rawKey ? parseNfeKey(rawKey) : null
  if (rawKey && !key) errors.nfeChaveAcesso = 'Informe uma chave NF-e válida de 44 dígitos.'

  const rawCnpj = text(input.cnpjEmitente)
  const cnpj = rawCnpj.replace(/[.\-/\s]/g, '')
  if (rawCnpj && (!/^[\d.\-/\s]+$/.test(rawCnpj) || !validCnpj(cnpj))) {
    errors.cnpjEmitente = 'CNPJ do emitente inválido.'
  }

  const numeroNf = text(input.numeroNf)
  const serieNf = text(input.serieNf)
  if (key && numeroNf && !sameNumber(numeroNf, key.numeroNf)) {
    errors.numeroNf = 'Número da NF difere da chave de acesso.'
  }
  if (key && serieNf && !sameNumber(serieNf, key.serie)) {
    errors.serieNf = 'Série da NF difere da chave de acesso.'
  }
  if (key && cnpj && cnpj !== key.cnpj) {
    errors.cnpjEmitente = 'CNPJ do emitente difere da chave de acesso.'
  }
  if (!rawKey && !numeroNf) errors.numeroNf = 'Informe a chave NF-e ou o número da NF.'
  if (!rawKey && !cnpj) errors.cnpjEmitente = 'Informe o CNPJ do emitente quando não houver chave NF-e.'

  const metodoLeitura = text(input.metodoLeitura)
  if (!metodoLeitura) errors.metodoLeitura = 'Método de leitura é obrigatório.'
  if (Object.keys(errors).length) validationError('Dados da chegada inválidos.', errors)

  return {
    nfeChaveAcesso: key?.chave ?? null,
    numeroNf: key?.numeroNf ?? numeroNf,
    serieNf: key?.serie ?? (serieNf || null),
    cnpjEmitente: key?.cnpj ?? cnpj,
    fornecedor: text(input.fornecedor) || null,
    metodoLeitura,
    confianca: text(input.confianca) || null,
    observacoes: text(input.observacoes) || null,
  }
}

// This is only the receipt input. The eventual repository operation must create
// the REC and link the CHG atomically, with the actor set by the backend.
export function mapChegadaToRecebimentoInput(chegada, input) {
  if (!chegada) {
    const error = new Error('Chegada não encontrada.')
    error.code = 'ARRIVAL_NOT_FOUND'
    error.status = 404
    throw error
  }
  if (chegada.excluidoEm) conflict('ARRIVAL_DELETED', 'Chegada excluída logicamente.')
  if (chegada.recebimentoId || chegada.status === 'VINCULADA') {
    conflict('ARRIVAL_ALREADY_LINKED', 'Chegada já vinculada a um recebimento.')
  }
  if (chegada.status !== 'REGISTRADA') conflict('ARRIVAL_NOT_AVAILABLE', 'Chegada não disponível para iniciar recebimento.')
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    validationError('Dados do recebimento inválidos.', { body: 'Envie um objeto JSON.' })
  }

  const errors = {}
  const allowed = new Set(['pedido', 'tipo', 'fornecedor'])
  const unexpected = Object.keys(input).filter((field) => !allowed.has(field))
  if (unexpected.length) errors.body = `Campos não aceitos: ${unexpected.join(', ')}.`

  const pedido = text(input.pedido)
  if (!pedido) errors.pedido = 'Pedido é obrigatório.'
  const tipo = text(input.tipo) || 'Estoque'
  if (!RECEIPT_TYPE_OPTIONS.some((option) => option.value === tipo)) errors.tipo = 'Tipo de recebimento inválido.'

  const fornecedorChegada = text(chegada.fornecedor || chegada.fornecedorNomeSnapshot)
  const fornecedorBody = text(input.fornecedor)
  if (fornecedorChegada && fornecedorBody && fornecedorChegada !== fornecedorBody) {
    errors.fornecedor = 'A correção do fornecedor exige uma operação específica.'
  }
  const fornecedor = fornecedorChegada || fornecedorBody
  if (!fornecedor) errors.fornecedor = 'Fornecedor é obrigatório para iniciar o recebimento.'
  if (Object.keys(errors).length) validationError('Dados do recebimento inválidos.', errors)

  const key = text(chegada.nfeChaveAcesso)
  const parsed = key ? parseNfeKey(key) : null
  if (key && !parsed) conflict('ARRIVAL_INVALID_DATA', 'A chave NF-e da chegada é inválida.')
  const numeroNf = text(chegada.numeroNf)
  const serieNf = text(chegada.serieNf)
  const cnpjEmitente = text(chegada.cnpjEmitente).replace(/\D/g, '')
  if ((parsed && ((numeroNf && !sameNumber(numeroNf, parsed.numeroNf))
    || (serieNf && !sameNumber(serieNf, parsed.serie))
    || (cnpjEmitente && cnpjEmitente !== parsed.cnpj)))
    || (!parsed && (!numeroNf || !validCnpj(cnpjEmitente)))) {
    conflict('ARRIVAL_INVALID_DATA', 'Os dados de identificação da chegada são inconsistentes.')
  }
  return {
    pedido,
    tipo,
    fornecedor,
    numeroNf: numeroNf || parsed?.numeroNf || null,
    serieNf: serieNf || parsed?.serie || null,
    cnpjFornecedor: cnpjEmitente || parsed?.cnpj || null,
    nfeChaveAcesso: key || null,
  }
}

// This is a domain decision only. The database transaction remains the source
// of truth for concurrent calls and must return the linked REC on a retry.
export function planInicioRecebimento(chegada, input) {
  if (!chegada) {
    const error = new Error('Chegada não encontrada.')
    error.code = 'ARRIVAL_NOT_FOUND'
    error.status = 404
    throw error
  }
  if (chegada.excluidoEm) conflict('ARRIVAL_DELETED', 'Chegada excluída logicamente.')
  const linked = chegada.status === 'VINCULADA'
  const receiptId = text(chegada.recebimentoId)
  if (linked !== Boolean(receiptId)) {
    conflict('ARRIVAL_INVALID_DATA', 'O vínculo da chegada está inconsistente.')
  }
  if (linked) return { kind: 'existing', recebimentoId: receiptId }
  return { kind: 'create', receiptInput: mapChegadaToRecebimentoInput(chegada, input) }
}
