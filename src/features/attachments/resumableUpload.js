// Envia um arquivo em partes diretamente para a sessão resumível do Google
// Drive (sessionUrl), sem passar o binário pela Vercel Function. sessionUrl é
// uma URL externa temporária — não é uma chamada à API do ALM, por isso vive
// fora de src/api.js (ver docs/attachments-api.md).
export async function uploadFileToSession({ sessionUrl, chunkSize, file, onProgress, signal }) {
  const total = file.size
  let start = 0
  let finalFile = null

  while (start < total) {
    if (signal?.aborted) {
      const error = new Error('Envio cancelado.')
      error.code = 'UPLOAD_CANCELLED'
      throw error
    }

    const end = Math.min(start + chunkSize, total)
    const chunk = file.slice(start, end)
    let response
    try {
      response = await fetch(sessionUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` },
        body: chunk,
        signal,
      })
    } catch (exception) {
      if (exception?.name === 'AbortError') {
        const error = new Error('Envio cancelado.')
        error.code = 'UPLOAD_CANCELLED'
        throw error
      }
      const error = new Error('Falha de rede durante o envio.')
      error.code = 'DRIVE_UPLOAD_CHUNK_FAILED'
      throw error
    }

    if (response.status === 308) {
      // Sem header Range, o Drive não recebeu nenhum byte ainda — reenvia do
      // zero. Com o header, ele é a fonte da verdade sobre o que já foi
      // persistido (nunca assumimos que o chunk inteiro foi aceito).
      const range = response.headers.get('range')
      start = range ? Number(range.split('-')[1]) + 1 : 0
      onProgress?.(start, total)
      continue
    }

    if (response.status === 200 || response.status === 201) {
      finalFile = await response.json()
      onProgress?.(total, total)
      break
    }

    const details = await response.text().catch(() => '')
    const error = new Error(details || `Falha no envio ao armazenamento (${response.status}).`)
    error.status = response.status
    error.code = 'DRIVE_UPLOAD_CHUNK_FAILED'
    throw error
  }

  if (!finalFile?.id) {
    const error = new Error('O envio não retornou um identificador de arquivo.')
    error.code = 'DRIVE_UPLOAD_NO_ID'
    throw error
  }
  return finalFile
}
