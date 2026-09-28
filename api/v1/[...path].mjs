import { createApp } from '../../backend/app.mjs'

// Memoizado no escopo do módulo: instâncias "quentes" da function reaproveitam
// a mesma app (e portanto o mesmo cliente Google Sheets/Drive) entre invocações.
const appPromise = createApp()

export default async function handler(request, response) {
  const { handle } = await appPromise
  return handle(request, response)
}
