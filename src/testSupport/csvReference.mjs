/**
 * Leitor de CSV de referência (RFC 4180) usado só pelos testes: NÃO é o serializador do projeto e não
 * compartilha código com ele — serve para conferir a estrutura real das células de um CSV gerado.
 * Estrito de propósito: aspas fora do lugar, aspas sem fechar ou texto depois das aspas lançam erro.
 */
export function parseCsv(text, delimiter = ';') {
  let source = text
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1)
  const rows = []
  let row = []
  let field = ''
  let i = 0
  const n = source.length
  let atFieldStart = true
  while (i < n) {
    const ch = source[i]
    if (atFieldStart && ch === '"') {
      i += 1
      let closed = false
      while (i < n) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') { field += '"'; i += 2; continue }
          closed = true
          i += 1
          break
        }
        field += source[i]
        i += 1
      }
      if (!closed) throw new Error('CSV inválido: aspas sem fechar')
      if (i < n && source[i] !== delimiter && source[i] !== '\r' && source[i] !== '\n') {
        throw new Error(`CSV inválido: texto depois das aspas na posição ${i}`)
      }
      atFieldStart = false
      continue
    }
    if (ch === delimiter) { row.push(field); field = ''; atFieldStart = true; i += 1; continue }
    if (ch === '\r' && source[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; atFieldStart = true; i += 2; continue }
    if (ch === '\n' || ch === '\r') throw new Error('CSV inválido: quebra de linha fora de aspas que não é CRLF')
    if (ch === '"') throw new Error(`CSV inválido: aspas no meio de um campo sem aspas (posição ${i})`)
    field += ch
    atFieldStart = false
    i += 1
  }
  if (field !== '' || row.length > 0 || !atFieldStart) { row.push(field); rows.push(row) }
  return rows
}
