// Script de uso único (rodar localmente) para obter o GOOGLE_OAUTH_REFRESH_TOKEN.
//
// Pré-requisitos:
// 1. No Google Cloud Console, crie um "OAuth 2.0 Client ID" do tipo "Desktop app"
//    (não precisa registrar redirect URI de produção — localhost já é aceito).
// 2. Ative a Google Drive API no projeto.
// 3. Preencha GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET no .env e rode:
//      node scripts/google-drive-oauth-setup.mjs
// 4. Abra a URL impressa, faça login com a conta Google que vai guardar os anexos
//    e autorize. O refresh token aparece no terminal — copie para GOOGLE_OAUTH_REFRESH_TOKEN
//    no seu .env (local) e nas variáveis de ambiente da Vercel (produção).

import http from 'node:http'
import crypto from 'node:crypto'
import '../backend/config/env.mjs'
import { GOOGLE_DRIVE_SCOPES, createGoogleDriveOAuthClient } from '../backend/integrations/googleDrive.mjs'

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error('Defina GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET no ambiente antes de rodar este script.')
  process.exit(1)
}

const PORT = 53682
const redirectUri = `http://localhost:${PORT}/oauth2callback`
const oauth2Client = createGoogleDriveOAuthClient(clientId, clientSecret, redirectUri)
const state = crypto.randomBytes(24).toString('hex')

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  state,
  scope: GOOGLE_DRIVE_SCOPES,
})

console.log('\nAbra esta URL no navegador e autorize o acesso com a conta que vai guardar os anexos:\n')
console.log(authUrl, '\n')

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri)
  if (url.pathname !== '/oauth2callback') { res.writeHead(404); res.end(); return }
  const code = url.searchParams.get('code')
  if (!code || url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<p>Retorno OAuth inválido. Feche esta aba e rode o script novamente.</p>')
    server.close()
    process.exitCode = 1
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<p>Autorizado! Pode fechar esta aba e voltar ao terminal.</p>')
  server.close()
  try {
    const { tokens } = await oauth2Client.getToken(code)
    if (!tokens.refresh_token) {
      console.error('\nO Google não devolveu refresh_token. Revogue o acesso em https://myaccount.google.com/permissions e rode o script de novo (o parâmetro prompt=consent força um novo refresh token).')
      process.exit(1)
    }
    console.log('\nRefresh token obtido. Adicione ao seu .env e às variáveis de ambiente da Vercel:\n')
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`)
    process.exit(0)
  } catch (error) {
    console.error('\nFalha ao trocar o código por tokens:', error.message)
    process.exit(1)
  }
})

server.listen(PORT, () => console.log(`Aguardando autorização em ${redirectUri} ...`))
server.on('error', (error) => { console.error(`Não foi possível abrir ${redirectUri}:`, error.message); process.exit(1) })
