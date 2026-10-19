import { readFileSync } from 'node:fs'
import pg from 'pg'
import { loadProjectEnvironment } from './env.mjs'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function required(source, name) {
  const value = source[name]?.trim()
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}.`)
  return value
}

export function readPostgresConfig(source = process.env) {
  const host = required(source, 'ALM_DB_HOST')
  const database = required(source, 'ALM_DB_NAME')
  const user = required(source, 'ALM_DB_API_USER')
  const password = required(source, 'ALM_DB_API_PASSWORD')
  const port = Number(source.ALM_DB_PORT || 5432)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ALM_DB_PORT deve ser uma porta válida.')
  }

  const sslMode = (source.ALM_DB_SSL_MODE || 'verify-full').trim()
  if (!['verify-full', 'disable'].includes(sslMode)) {
    throw new Error('ALM_DB_SSL_MODE deve ser verify-full ou disable.')
  }
  if (sslMode === 'disable' && !LOOPBACK_HOSTS.has(host)) {
    throw new Error('TLS só pode ser desativado para PostgreSQL em loopback local.')
  }
  if (sslMode === 'disable' && source.ALM_DB_SSL_CA_FILE?.trim()) {
    throw new Error('ALM_DB_SSL_CA_FILE exige ALM_DB_SSL_MODE=verify-full.')
  }

  const ssl = sslMode === 'disable' ? false : { rejectUnauthorized: true }
  if (ssl && source.ALM_DB_SSL_CA_FILE?.trim()) {
    ssl.ca = readFileSync(source.ALM_DB_SSL_CA_FILE.trim())
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl,
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 15000,
    application_name: 'alm-api',
  }
}

// Carrega apenas variáveis locais; a conexão é criada sob demanda.
export function createPostgresPool(source = process.env) {
  loadProjectEnvironment()
  return new pg.Pool(readPostgresConfig(source))
}
