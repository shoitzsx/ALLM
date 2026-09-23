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

export function createGoogleSheetsClient(config) {
  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: SCOPES,
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = config.spreadsheetId

  async function ensureSchema() {
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })
    const existing = new Set((metadata.data.sheets || []).map(({ properties }) => properties.title))
    const missing = Object.keys(SHEET_SCHEMA).filter((name) => !existing.has(name))
    if (missing.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      })
    }
    for (const [name, headers] of Object.entries(SHEET_SCHEMA)) {
      const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${name}'!1:1` })
      if (!(response.data.values || [])[0]?.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${name}'!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [headers] },
        })
      }
    }
  }

  async function readRows(sheetName) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A:ZZ` })
    const [headers = [], ...rows] = response.data.values || []
    return rows.filter((row) => row.some((value) => value !== '')).map((row, index) => ({
      rowNumber: index + 2,
      data: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])),
    }))
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
    })
  }

  async function updateRow(sheetName, rowNumber, data) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [serializeRow(sheetName, data)] },
    })
  }

  async function deleteRows(sheetName, rowNumbers) {
    if (!rowNumbers.length) return
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })
    const sheetId = (metadata.data.sheets || []).find(({ properties }) => properties.title === sheetName)?.properties?.sheetId
    if (sheetId === undefined) throw new Error(`Aba não encontrada: ${sheetName}.`)
    const requests = [...rowNumbers].sort((a, b) => b - a).map((rowNumber) => ({
      deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } },
    }))
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })
  }

  return { ensureSchema, readRows, appendRow, updateRow, deleteRows }
}
