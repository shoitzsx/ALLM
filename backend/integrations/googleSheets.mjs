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
  return rows.filter((row) => row.some((value) => value !== '')).map((row, index) => ({
    rowNumber: index + 2,
    data: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])),
  }))
}

export function createGoogleSheetsClient(config) {
  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: SCOPES,
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = config.spreadsheetId

  async function ensureSchema() {
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' }, REQUEST_OPTIONS)
    const existing = new Set((metadata.data.sheets || []).map(({ properties }) => properties.title))
    const missing = Object.keys(SHEET_SCHEMA).filter((name) => !existing.has(name))
    if (missing.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      }, REQUEST_OPTIONS)
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

  return { ensureSchema, readRows, readManyRows, appendRow, updateRow, deleteRows }
}
