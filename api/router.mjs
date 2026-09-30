import { createApp } from '../backend/app.mjs'

// Caminho estático de propósito: api/v1/[...path].mjs (o catch-all dinâmico
// anterior) não estava resolvendo rotas com mais de 1 segmento neste
// deployment — /api/v1/recebimentos/:id, /api/v1/auth/me etc. voltavam
// 404 da própria Vercel, antes de chegar em qualquer código nosso. O
// rewrite em vercel.json (/api/v1/:path* -> /api/router?path=:path*) repassa
// o caminho original via query string para esta Function fixa; ver
// routeParts em backend/app.mjs.
//
// Memoizado no escopo do módulo: instâncias "quentes" da function reaproveitam
// a mesma app (e portanto o mesmo cliente Google Sheets/Drive) entre invocações.
const appPromise = createApp()

export default async function handler(request, response) {
  const { handle } = await appPromise
  return handle(request, response)
}
