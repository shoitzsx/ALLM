import { google } from 'googleapis'

export const SHEET_SCHEMA = {
  Recebimentos: [
    'id', 'protocolo', 'pedido', 'numeroNf', 'serieNf', 'dataRecebimento',
    'fornecedor', 'cnpjFornecedor', 'tipo', 'responsavelId', 'responsavelNome',
    'responsavel', 'status', 'observacoes', 'criadoEm', 'atualizadoEm', 'arquivado',
    'arquivadoEm', 'arquivadoPor', 'restauradoEm',
  ],
  Itens: ['id', 'recebimentoId', 'numero', 'codigo', 'descricao', 'quantidadeSolicitada', 'quantidadeRecebida', 'unidade'],
  Divergencias: ['id', 'recebimentoId', 'tipo', 'descricao', 'itemId', 'criadaEm', 'criadaPor', 'resolvida', 'resolvidaEm', 'resolvidaPor', 'resolucao'],
  HistoricoStatus: ['id', 'recebimentoId', 'data', 'usuario', 'statusAnterior', 'novoStatus', 'observacao'],
  Auditoria: ['id', 'recebimentoId', 'data', 'usuario', 'acao', 'detalhes'],
  Anexos: ['id', 'recebimentoId', 'nome', 'categoria', 'tipo', 'mimeType', 'tamanho', 'storageKey', 'url', 'incluidoPor', 'dataInclusao', 'removido', 'removidoEm', 'removidoPor', 'motivoRemocao'],
  Usuarios: ['id', 'nome', 'name', 'iniciais', 'email', 'perfil', 'role', 'ativo'],
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

// Sem isso, uma chamada à Sheets API pode ficar pendurada por tempo
// indefinido: por padrão o gaxios já tenta de novo automaticamente em 429/5xx
// (retry: 3 tentativas), mas totalTimeout e maxRetryDelay não têm limite
// (Number.MAX_SAFE_INTEGER) — já vimos isso nos próprios erros reais desta
// sessão. Aqui só reduzimos os tetos; 429 continua sendo tentado de novo
// (comportamento padrão do gaxios), só não indefinidamente.
export const REQUEST_OPTIONS = {
  timeout: 20000,
  retry: true,
  retryConfig: {
    retry: 2,
    maxRetryDelay: 4000,
    totalTimeout: 20000,
  },
}

// Compartilhado por readRows/readManyRows — mesma transformação de
// values.get/values.batchGet para o formato {rowNumber, data} usado pelo
// repository, só extraída pra não duplicar a lógica entre os dois.
export function parseSheetValues(values) {
  const [headers = [], ...rows] = values || []
  return rows.flatMap((row, index) => row.some((value) => value !== '') ? [{
    rowNumber: index + 2,
    data: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])),
  }] : [])
}

function rowData(sheetName, data) {
  return { values: SHEET_SCHEMA[sheetName].map((header) => {
    const value = data[header] ?? ''
    const userEnteredValue = typeof value === 'number'
      ? { numberValue: value }
      : typeof value === 'boolean'
        ? { boolValue: value }
        : { stringValue: String(value) }
    return { userEnteredValue }
  }) }
}

export function buildAppendCellsRequest(sheetId, sheetName, data) {
  return {
    appendCells: {
      sheetId,
      rows: [rowData(sheetName, data)],
      fields: 'userEnteredValue',
    },
  }
}

export function buildUpdateCellsRequest(sheetId, rowNumber, sheetName, data) {
  return {
    updateCells: {
      range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: SHEET_SCHEMA[sheetName].length },
      rows: [rowData(sheetName, data)],
      fields: 'userEnteredValue',
    },
  }
}

export function createGoogleSheetsClient(config) {
  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: SCOPES,
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = config.spreadsheetId
  const sheetIds = new Map()

  async function loadSheetIds() {
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' }, REQUEST_OPTIONS)
    for (const { properties } of metadata.data.sheets || []) sheetIds.set(properties.title, properties.sheetId)
    return metadata
  }

  async function ensureSchema() {
    const metadata = await loadSheetIds()
    const existing = new Set((metadata.data.sheets || []).map(({ properties }) => properties.title))
    const missing = Object.keys(SHEET_SCHEMA).filter((name) => !existing.has(name))
    if (missing.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      }, REQUEST_OPTIONS)
      await loadSheetIds()
    }
    for (const [name, headers] of Object.entries(SHEET_SCHEMA)) {
      const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${name}'!1:1` }, REQUEST_OPTIONS)
      if (!(response.data.values || [])[0]?.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${name}'!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [headers] },
        }, REQUEST_OPTIONS)
      }
    }
  }

  async function readRows(sheetName) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A:ZZ` }, REQUEST_OPTIONS)
    return parseSheetValues(response.data.values)
  }

  // Várias sheets inteiras em 1 request HTTP (values.batchGet) em vez de 1
  // request por sheet — mesmos dados que N chamadas a readRows() em
  // sequência/paralelo produziriam, só sem multiplicar a cota de leitura.
  async function readManyRows(sheetNames) {
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: sheetNames.map((name) => `'${name}'!A:ZZ`),
    }, REQUEST_OPTIONS)
    const valueRanges = response.data.valueRanges || []
    return sheetNames.map((_, index) => parseSheetValues(valueRanges[index]?.values))
  }

  function serializeRow(sheetName, data) {
    return SHEET_SCHEMA[sheetName].map((header) => data[header] ?? '')
  }

  async function appendRow(sheetName, data) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [serializeRow(sheetName, data)] },
    }, REQUEST_OPTIONS)
  }

  // As duas linhas são a confirmação do mesmo anexo. batchUpdate estrutural
  // aplica ambas atomicamente, evitando anexo gravado sem auditoria.
  async function appendAttachmentAndAudit(attachment, audit) {
    if (!sheetIds.has('Anexos') || !sheetIds.has('Auditoria')) await loadSheetIds()
    const requests = [
      buildAppendCellsRequest(sheetIds.get('Anexos'), 'Anexos', attachment),
      buildAppendCellsRequest(sheetIds.get('Auditoria'), 'Auditoria', audit),
    ]
    try {
      // Um retry automático após resposta perdida poderia duplicar as linhas.
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, {
        ...REQUEST_OPTIONS,
        retry: false,
        retryConfig: { ...REQUEST_OPTIONS.retryConfig, retry: 0 },
      })
    } catch (exception) {
      // A escrita pode ter sido aplicada antes de a conexão cair. Confirme
      // pelo ID público antes de decidir se o arquivo no Drive deve ser limpo.
      try {
        const [attachments, audits] = await readManyRows(['Anexos', 'Auditoria'])
        const attachmentSaved = attachments.some(({ data }) => data.id === attachment.id && data.recebimentoId === attachment.recebimentoId)
        const auditSaved = audits.some(({ data }) => data.id === audit.id && data.recebimentoId === audit.recebimentoId)
        if (attachmentSaved && auditSaved) return
        const status = Number(exception.response?.status || exception.status || 0)
        if (attachmentSaved || auditSaved || status === 0 || status >= 500) exception.persistenceUnknown = true
      } catch {
        exception.persistenceUnknown = true
      }
      throw exception
    }
  }

  async function updateReceiptAndAudit(rowNumber, receipt, audit) {
    if (!sheetIds.has('Recebimentos') || !sheetIds.has('Auditoria')) await loadSheetIds()
    const requests = [
      buildUpdateCellsRequest(sheetIds.get('Recebimentos'), rowNumber, 'Recebimentos', receipt),
      buildAppendCellsRequest(sheetIds.get('Auditoria'), 'Auditoria', audit),
    ]
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, {
        ...REQUEST_OPTIONS,
        retry: false,
        retryConfig: { ...REQUEST_OPTIONS.retryConfig, retry: 0 },
      })
    } catch (exception) {
      // Se a resposta se perdeu depois do commit, o ID único da auditoria
      // comprova que as duas mudanças atômicas foram aplicadas.
      try {
        const audits = await readRows('Auditoria')
        const savedAudit = audits.some(({ data }) => data.id === audit.id && data.recebimentoId === receipt.id)
        if (savedAudit) return
      } catch {}
      throw exception
    }
  }

  async function updateRow(sheetName, rowNumber, data) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [serializeRow(sheetName, data)] },
    }, REQUEST_OPTIONS)
  }

  async function deleteRows(sheetName, rowNumbers) {
    if (!rowNumbers.length) return
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' }, REQUEST_OPTIONS)
    const sheetId = (metadata.data.sheets || []).find(({ properties }) => properties.title === sheetName)?.properties?.sheetId
    if (sheetId === undefined) throw new Error(`Aba não encontrada: ${sheetName}.`)
    const requests = [...rowNumbers].sort((a, b) => b - a).map((rowNumber) => ({
      deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } },
    }))
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, REQUEST_OPTIONS)
  }

  return { ensureSchema, readRows, readManyRows, appendRow, appendAttachmentAndAudit, updateReceiptAndAudit, updateRow, deleteRows }
}
