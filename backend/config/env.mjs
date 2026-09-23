import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// O arquivo de ambiente do backend é encontrado independentemente do diretório
// usado para iniciar o processo (`npm run api` na raiz ou `npm start` no backend).
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') })

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}.`)
  return value
}

export function readEnvironment() {
  return {
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '0.0.0.0',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    uploadDir: process.env.ALM_UPLOAD_DIR,
    google: {
      spreadsheetId: required('GOOGLE_SHEETS_SPREADSHEET_ID'),
      serviceAccountEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
      privateKey: required('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    },
  }
}
