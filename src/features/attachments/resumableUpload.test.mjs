import assert from 'node:assert/strict'
import { test } from 'node:test'
import { uploadFileToSession } from './resumableUpload.js'

function withMockedFetch(handler, run) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return run().finally(() => { globalThis.fetch = original })
}

test('envia em partes respeitando o chunkSize, com Content-Range inclusivo e sem pular/repetir bytes', async () => {
  const file = new File([new Uint8Array(2_500_000)], 'nota.pdf', { type: 'application/pdf' })
  const chunkSize = 1_000_000
  const ranges = []

  await withMockedFetch(async (url, init) => {
    const range = init.headers['Content-Range']
    ranges.push(range)
    const [, , end, total] = range.match(/bytes (\d+)-(\d+)\/(\d+)/).map(Number)
    const isLast = end + 1 === total
    if (isLast) return new Response(JSON.stringify({ id: 'drive-file-1' }), { status: 200 })
    return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } })
  }, async () => {
    const progressCalls = []
    const result = await uploadFileToSession({
      sessionUrl: 'https://example.com/session',
      chunkSize,
      file,
      onProgress: (sent, total) => progressCalls.push([sent, total]),
    })
    assert.deepEqual(result, { id: 'drive-file-1' })
    assert.deepEqual(ranges, [
      'bytes 0-999999/2500000',
      'bytes 1000000-1999999/2500000',
      'bytes 2000000-2499999/2500000',
    ])
    // último chunk tem só os bytes restantes (500000), não chunkSize inteiro
    assert.equal(progressCalls.at(-1)[0], 2_500_000)
    assert.equal(progressCalls.at(-1)[1], 2_500_000)
  })
})

test('sem header Range num 308, reenvia a partir do byte 0 (nenhum byte confirmado ainda)', async () => {
  const file = new File([new Uint8Array(1_500_000)], 'foto.jpg', { type: 'image/jpeg' })
  const seenStarts = []

  await withMockedFetch(async (url, init) => {
    const range = init.headers['Content-Range']
    const start = Number(range.match(/bytes (\d+)-/)[1])
    seenStarts.push(start)
    if (seenStarts.length === 1) {
      // primeira tentativa: servidor não confirma nenhum byte (sem header Range)
      return new Response(null, { status: 308 })
    }
    return new Response(JSON.stringify({ id: 'drive-file-2' }), { status: 200 })
  }, async () => {
    const result = await uploadFileToSession({ sessionUrl: 'https://example.com/session', chunkSize: 1_000_000, file })
    assert.deepEqual(result, { id: 'drive-file-2' })
    assert.deepEqual(seenStarts, [0, 0])
  })
})

test('308 é continuação, não erro — só status fora de 200/201/308 lança', async () => {
  const file = new File([new Uint8Array(10)], 'pequeno.pdf', { type: 'application/pdf' })
  await withMockedFetch(async () => new Response('falha', { status: 500 }), async () => {
    await assert.rejects(
      () => uploadFileToSession({ sessionUrl: 'https://example.com/session', chunkSize: 1_000_000, file }),
      { code: 'DRIVE_UPLOAD_CHUNK_FAILED' },
    )
  })
})

test('resposta final sem id lança em vez de resolver silenciosamente', async () => {
  const file = new File([new Uint8Array(10)], 'pequeno.pdf', { type: 'application/pdf' })
  await withMockedFetch(async () => new Response('{}', { status: 200 }), async () => {
    await assert.rejects(
      () => uploadFileToSession({ sessionUrl: 'https://example.com/session', chunkSize: 1_000_000, file }),
      { code: 'DRIVE_UPLOAD_NO_ID' },
    )
  })
})

test('sinal de cancelamento interrompe antes do próximo chunk', async () => {
  const file = new File([new Uint8Array(2_000_000)], 'grande.pdf', { type: 'application/pdf' })
  const controller = new AbortController()
  let calls = 0
  await withMockedFetch(async () => {
    calls += 1
    if (calls === 1) controller.abort()
    return new Response(null, { status: 308, headers: { Range: 'bytes=0-999999' } })
  }, async () => {
    await assert.rejects(
      () => uploadFileToSession({ sessionUrl: 'https://example.com/session', chunkSize: 1_000_000, file, signal: controller.signal }),
      { code: 'UPLOAD_CANCELLED' },
    )
    assert.equal(calls, 1)
  })
})
