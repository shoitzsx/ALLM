/**
 * Cerimônia WebAuthn pela API NATIVA do navegador (sem dependência extra).
 *
 * O backend usa @simplewebauthn/server 14: as opções chegam como JSON
 * (`challenge`, `id` e `user.id` em Base64URL) e as respostas voltam como
 * AuthenticationResponseJSON / RegistrationResponseJSON — estes formatos foram
 * conferidos em backend/auth/webauthn.mjs e backend/integration/authPostgres.test.mjs.
 * Aqui só se converte entre esse JSON e os objetos do navegador.
 *
 * Nada daqui decide acesso: devolve a resposta do dispositivo para o servidor
 * verificar. Erros do navegador (cancelar, expirar, incompatível) passam
 * intactos; quem chama os traduz com `eventFromWebAuthnError` (webauthnSupport.js),
 * que olha só `error.name`, nunca a mensagem.
 */
export class WebAuthnDataError extends Error {
  constructor(message = 'Dados WebAuthn inválidos.') {
    super(message)
    this.name = 'WebAuthnDataError'
  }
}

const BASE64URL = /^[A-Za-z0-9_-]+$/
const TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'])
const USER_VERIFICATION = new Set(['required', 'preferred', 'discouraged'])
const RESIDENT_KEY = new Set(['required', 'preferred', 'discouraged'])
const ATTACHMENT = new Set(['platform', 'cross-platform'])
const ATTESTATION = new Set(['none', 'indirect', 'direct'])

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function bytesToBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decodifica Base64URL canônico (sem preenchimento) para bytes; recusa o resto. */
export function base64UrlToBytes(value, { minBytes = 1, maxBytes = 1024 } = {}) {
  if (typeof value !== 'string' || !BASE64URL.test(value) || value.length % 4 === 1) {
    throw new WebAuthnDataError('Valor Base64URL inválido.')
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  let binary
  try { binary = atob(padded) } catch { throw new WebAuthnDataError('Valor Base64URL inválido.') }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  if (bytes.length < minBytes || bytes.length > maxBytes || bytesToBase64Url(bytes) !== value) {
    throw new WebAuthnDataError('Valor Base64URL fora do tamanho ou não canônico.')
  }
  return bytes
}

const challengeBytes = (value) => base64UrlToBytes(value, { minBytes: 16, maxBytes: 1024 }).buffer

function transportsOf(values) {
  return Array.isArray(values) ? [...new Set(values.filter((value) => TRANSPORTS.has(value)))] : []
}

function credentialDescriptors(list) {
  if (list === undefined) return undefined
  if (!Array.isArray(list)) throw new WebAuthnDataError('Lista de credenciais inválida.')
  return list.map((item) => {
    if (!isObject(item) || item.type !== 'public-key') throw new WebAuthnDataError('Credencial inválida.')
    const descriptor = { type: 'public-key', id: base64UrlToBytes(item.id).buffer }
    const transports = transportsOf(item.transports)
    if (transports.length) descriptor.transports = transports
    return descriptor
  })
}

function validTimeout(value) {
  return Number.isFinite(value) && value >= 1000 && value <= 300_000 ? value : undefined
}

/** JSON de opções de LOGIN do servidor → `{ publicKey }` do navegador. */
export function buildRequestOptions(json) {
  if (!isObject(json)) throw new WebAuthnDataError('Opções ausentes.')
  const publicKey = { challenge: challengeBytes(json.challenge) }
  if (json.rpId !== undefined) {
    if (typeof json.rpId !== 'string' || !json.rpId) throw new WebAuthnDataError('rpId inválido.')
    publicKey.rpId = json.rpId
  }
  const allow = credentialDescriptors(json.allowCredentials)
  if (allow) publicKey.allowCredentials = allow
  if (json.userVerification !== undefined) {
    if (!USER_VERIFICATION.has(json.userVerification)) throw new WebAuthnDataError('userVerification inválido.')
    publicKey.userVerification = json.userVerification
  }
  const timeout = validTimeout(json.timeout)
  if (timeout) publicKey.timeout = timeout
  return { publicKey }
}

/** JSON de opções de CADASTRO do servidor → `{ publicKey }` do navegador. */
export function buildCreationOptions(json) {
  if (!isObject(json) || !isObject(json.rp) || !isObject(json.user)) throw new WebAuthnDataError('Opções ausentes.')
  const { rp, user } = json
  if (typeof rp.name !== 'string' || !rp.name) throw new WebAuthnDataError('Nome do site inválido.')
  if (rp.id !== undefined && (typeof rp.id !== 'string' || !rp.id)) throw new WebAuthnDataError('rp.id inválido.')
  if (typeof user.name !== 'string' || !user.name || typeof user.displayName !== 'string' || !user.displayName) {
    throw new WebAuthnDataError('Usuário inválido.')
  }
  if (!Array.isArray(json.pubKeyCredParams) || json.pubKeyCredParams.length === 0
    || json.pubKeyCredParams.some((param) => !isObject(param) || param.type !== 'public-key' || !Number.isInteger(param.alg))) {
    throw new WebAuthnDataError('Algoritmos inválidos.')
  }
  const publicKey = {
    rp: rp.id ? { name: rp.name, id: rp.id } : { name: rp.name },
    user: { id: base64UrlToBytes(user.id, { minBytes: 1, maxBytes: 64 }).buffer, name: user.name, displayName: user.displayName },
    challenge: challengeBytes(json.challenge),
    pubKeyCredParams: json.pubKeyCredParams.map(({ alg }) => ({ type: 'public-key', alg })),
  }
  const exclude = credentialDescriptors(json.excludeCredentials)
  if (exclude) publicKey.excludeCredentials = exclude
  if (json.attestation !== undefined) {
    if (!ATTESTATION.has(json.attestation)) throw new WebAuthnDataError('attestation inválido.')
    publicKey.attestation = json.attestation
  }
  if (json.authenticatorSelection !== undefined) {
    const selection = json.authenticatorSelection
    if (!isObject(selection)) throw new WebAuthnDataError('Seleção de autenticador inválida.')
    const clean = {}
    if (selection.userVerification !== undefined) {
      if (!USER_VERIFICATION.has(selection.userVerification)) throw new WebAuthnDataError('userVerification inválido.')
      clean.userVerification = selection.userVerification
    }
    if (selection.residentKey !== undefined) {
      if (!RESIDENT_KEY.has(selection.residentKey)) throw new WebAuthnDataError('residentKey inválido.')
      clean.residentKey = selection.residentKey
    }
    if (selection.authenticatorAttachment !== undefined) {
      if (!ATTACHMENT.has(selection.authenticatorAttachment)) throw new WebAuthnDataError('authenticatorAttachment inválido.')
      clean.authenticatorAttachment = selection.authenticatorAttachment
    }
    if (typeof selection.requireResidentKey === 'boolean') clean.requireResidentKey = selection.requireResidentKey
    publicKey.authenticatorSelection = clean
  }
  const timeout = validTimeout(json.timeout)
  if (timeout) publicKey.timeout = timeout
  return { publicKey }
}

const isBuffer = (value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value)
const encode = (value) => bytesToBase64Url(ArrayBuffer.isView(value)
  ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : value)

function requirePublicKeyCredential(credential) {
  if (!isObject(credential) || credential.type !== 'public-key' || typeof credential.id !== 'string'
    || !isBuffer(credential.rawId) || !isObject(credential.response)) {
    throw new WebAuthnDataError('Credencial devolvida pelo navegador é inválida.')
  }
}

function extensionResults(credential) {
  try { return credential.getClientExtensionResults?.() || {} } catch { return {} }
}

/** Credencial do navegador (login) → AuthenticationResponseJSON. */
export function serializeAssertion(credential) {
  requirePublicKeyCredential(credential)
  const { authenticatorData, clientDataJSON, signature, userHandle } = credential.response
  if (!isBuffer(authenticatorData) || !isBuffer(clientDataJSON) || !isBuffer(signature)) {
    throw new WebAuthnDataError('Resposta de autenticação incompleta.')
  }
  const json = {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: 'public-key',
    response: {
      authenticatorData: encode(authenticatorData),
      clientDataJSON: encode(clientDataJSON),
      signature: encode(signature),
      userHandle: isBuffer(userHandle) ? encode(userHandle) : null,
    },
    clientExtensionResults: extensionResults(credential),
  }
  if (ATTACHMENT.has(credential.authenticatorAttachment)) json.authenticatorAttachment = credential.authenticatorAttachment
  return json
}

/** Credencial do navegador (cadastro) → RegistrationResponseJSON. */
export function serializeAttestation(credential) {
  requirePublicKeyCredential(credential)
  const { clientDataJSON, attestationObject } = credential.response
  if (!isBuffer(clientDataJSON) || !isBuffer(attestationObject)) {
    throw new WebAuthnDataError('Resposta de cadastro incompleta.')
  }
  let transports = []
  try { transports = transportsOf(credential.response.getTransports?.()) } catch { transports = [] }
  const json = {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: 'public-key',
    response: { clientDataJSON: encode(clientDataJSON), attestationObject: encode(attestationObject), transports },
    clientExtensionResults: extensionResults(credential),
  }
  if (ATTACHMENT.has(credential.authenticatorAttachment)) json.authenticatorAttachment = credential.authenticatorAttachment
  return json
}

function notSupported() {
  return Object.assign(new Error('WebAuthn indisponível.'), { name: 'NotSupportedError' })
}

/**
 * Executa o login (segundo fator). Deve ser chamado dentro de um toque/clique do
 * usuário: o Safari exige gesto do usuário para abrir a interface de passkey.
 */
export async function authenticate(optionsJson, { credentials = globalThis.navigator?.credentials, signal } = {}) {
  const { publicKey } = buildRequestOptions(optionsJson)
  if (typeof credentials?.get !== 'function') throw notSupported()
  const credential = await credentials.get({ publicKey, signal })
  return serializeAssertion(credential)
}

/** Executa o cadastro de um dispositivo (também dentro de um gesto do usuário). */
export async function register(optionsJson, { credentials = globalThis.navigator?.credentials, signal } = {}) {
  const { publicKey } = buildCreationOptions(optionsJson)
  if (typeof credentials?.create !== 'function') throw notSupported()
  const credential = await credentials.create({ publicKey, signal })
  return serializeAttestation(credential)
}
