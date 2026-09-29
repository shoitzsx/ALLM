import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// O .env fica na raiz do projeto (mesmo arquivo que o Vite usa para VITE_*),
// resolvido a partir deste arquivo para funcionar independentemente do
// diretório usado para iniciar o processo. Em produção (Vercel) este arquivo
// não existe e a chamada abaixo é um no-op silencioso — as variáveis vêm
// direto de process.env, injetadas pela plataforma.
export function loadProjectEnvironment() {
  dotenv.config({ path: path.join(projectRoot, '.env') })
  dotenv.config({ path: path.join(projectRoot, 'backend', '.env') })
}

loadProjectEnvironment()

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}.`)
  return value
}

export function readEnvironment() {
  const drive = {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null,
    refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() || null,
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || null,
  }

  return {
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '0.0.0.0',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    google: {
      spreadsheetId: required('GOOGLE_SHEETS_SPREADSHEET_ID'),
      serviceAccountEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
      privateKey: required('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      drive,
    },
  }
}
