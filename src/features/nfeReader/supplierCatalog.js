/**
 * Catálogo local CNPJ → nome do fornecedor, isolado neste módulo.
 *
 * Único ponto do app que usa localStorage: o restante da aplicação
 * permanece volátil (decisão já tomada no MVP). Serve para pré-preencher o
 * fornecedor quando a chave da NF-e traz um CNPJ já conhecido, e é
 * alimentado a cada nota confirmada manualmente.
 */

const STORAGE_KEY = 'alm:nfeReader:fornecedores:v1'

function readCatalog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeCatalog(catalog) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog))
  } catch {
    // localStorage indisponível (modo privado, quota excedida, etc.): segue sem persistir.
  }
}

export function getSupplierByCnpj(cnpjDigits) {
  if (!cnpjDigits) return null
  return readCatalog()[cnpjDigits] || null
}

export function saveSupplier(cnpjDigits, nome) {
  if (!cnpjDigits || !nome) return
  const catalog = readCatalog()
  catalog[cnpjDigits] = nome
  writeCatalog(catalog)
}

export function listSuppliers() {
  return Object.entries(readCatalog()).map(([cnpj, nome]) => ({ cnpj, nome }))
}
