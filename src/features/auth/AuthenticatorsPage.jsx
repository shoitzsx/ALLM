import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Fingerprint, Info, RefreshCw, ShieldAlert, Smartphone, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/shared/PageHeader.jsx'
import { EmptyState, Modal } from '../../ui.jsx'
import { useAuth } from './AuthProvider.jsx'
import { REGISTRATION_REASON, REGISTRATION_STATUS, createRegistrationFlow } from './registrationFlow.js'
import { activeCount, canRevoke, describeAuthenticator, deviceErrorCopy, registrationErrorCopy, validateRevocationReason } from './deviceCopy.js'
import { register } from './webauthnBrowser.js'
import { getWebAuthnSupport } from './webauthnSupport.js'
import './auth.css'

const TONE_ICON = { error: AlertTriangle, warning: ShieldAlert, info: Info }

function Notice({ copy, children }) {
  const Icon = TONE_ICON[copy.tone] || Info
  return (
    <div className={`auth-alert auth-alert-${copy.tone}`} role={copy.tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>{copy.title}</strong>
        <span>{copy.description}</span>
        {children}
      </div>
    </div>
  )
}

/**
 * Meus dispositivos: lista, cadastra e remove as passkeys do PRÓPRIO usuário
 * (GET/POST/DELETE /auth/authenticators). A autorização é do servidor: ele só
 * mexe nos dispositivos da sessão atual, exige MFA recente para cadastrar e
 * remover, e mantém ao menos um dispositivo ativo. Aqui só se apresenta.
 *
 * A passkey só abre dentro de um toque (Safari): o cadastro tem dois passos —
 * "Cadastrar novo dispositivo" pede o desafio; "Confirmar no dispositivo" abre a passkey.
 */
export function AuthenticatorsPage() {
  const session = useAuth()
  const { api, expireSession, signOut } = session

  const [list, setList] = useState({ status: 'loading', rows: [], error: null })
  const [registration, setRegistration] = useState({ status: REGISTRATION_STATUS.IDLE })
  const [success, setSuccess] = useState(null)
  const [revoking, setRevoking] = useState(null) // { row, reason, error, submitting }
  const [signOutError, setSignOutError] = useState(null)

  const load = useCallback(async () => {
    if (!api) return
    setList((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const rows = await api.listAuthenticators()
      setList({ status: 'ready', rows, error: null })
    } catch (error) {
      if (error?.kind === 'unauthorized') { expireSession(); return }
      setList({ status: 'error', rows: [], error: error?.kind || 'unavailable' })
    }
  }, [api, expireSession])

  useEffect(() => { void load() }, [load])

  const flow = useMemo(() => (api ? createRegistrationFlow({
    api,
    webauthn: { register },
    getSupport: () => getWebAuthnSupport(window),
    emit: (state) => setRegistration(state),
  }) : null), [api])
  useEffect(() => {
    flow?.activate()
    return () => flow?.dispose()
  }, [flow])

  // Cadastro concluído → atualiza a lista; sessão perdida → volta ao login.
  useEffect(() => {
    if (registration.status === REGISTRATION_STATUS.DONE) {
      setSuccess('Dispositivo cadastrado.')
      void load()
    }
    if (registration.status === REGISTRATION_STATUS.ERROR && registration.reason === REGISTRATION_REASON.UNAUTHORIZED) expireSession()
  }, [registration, load, expireSession])

  const rows = list.rows
  const active = activeCount(rows)
  const busy = registration.status === REGISTRATION_STATUS.STARTING || registration.status === REGISTRATION_STATUS.CONFIRMING

  function beginRegistration() {
    setSuccess(null)
    setSignOutError(null)
    void flow?.begin()
  }

  async function leaveToReauthenticate() {
    const result = await signOut()
    if (!result.ok) setSignOutError(deviceErrorCopy(result.kind))
  }

  function openRevoke(row) {
    setSuccess(null)
    setRevoking({ row, reason: '', error: null, submitting: false })
  }

  async function submitRevoke(event) {
    event?.preventDefault()
    if (!revoking || revoking.submitting) return
    const checked = validateRevocationReason(revoking.reason)
    if (!checked.ok) {
      setRevoking({ ...revoking, error: { tone: 'warning', title: checked.message, description: '' } })
      return
    }
    setRevoking({ ...revoking, submitting: true, error: null })
    try {
      const result = await api.revokeAuthenticator(revoking.row.id, checked.value)
      setRevoking(null)
      if (result.currentSessionRevoked) {
        // O servidor já encerrou esta sessão (o dispositivo removido era o usado para entrar).
        expireSession()
        return
      }
      setSuccess('Dispositivo removido.')
      void load()
    } catch (error) {
      if (error?.kind === 'unauthorized') { setRevoking(null); expireSession(); return }
      if (error?.kind === 'not_found') { setRevoking(null); void load(); return }
      setRevoking((current) => (current ? { ...current, submitting: false, error: deviceErrorCopy(error?.kind) } : current))
    }
  }

  const registrationError = registration.status === REGISTRATION_STATUS.ERROR
    ? registrationErrorCopy(registration.reason, registration.unsupported)
    : null

  return (
    <div className="page auth-devices">
      <PageHeader
        title="Meus dispositivos"
        description="Passkeys cadastradas para entrar no ALM. Mantenha pelo menos um dispositivo ativo."
      >
        <button className="btn btn-primary" type="button" onClick={beginRegistration} disabled={busy || registration.status === REGISTRATION_STATUS.READY || !flow}>
          <Smartphone size={16} aria-hidden="true" /> Cadastrar novo dispositivo
        </button>
      </PageHeader>

      {success ? (
        <div className="auth-alert auth-alert-info" role="status">
          <Info size={18} aria-hidden="true" />
          <div><strong>{success}</strong></div>
        </div>
      ) : null}

      {registration.status === REGISTRATION_STATUS.STARTING ? (
        <div className="panel auth-device-step" role="status" aria-live="polite">
          <RefreshCw size={18} className="spin" aria-hidden="true" />
          <span>Preparando o cadastro…</span>
        </div>
      ) : null}

      {registration.status === REGISTRATION_STATUS.READY || registration.status === REGISTRATION_STATUS.CONFIRMING ? (
        <div className="panel auth-device-step">
          <Fingerprint size={20} aria-hidden="true" />
          <div className="auth-device-step-copy">
            <strong>Confirme no dispositivo que deseja cadastrar</strong>
            <span>Siga as instruções do dispositivo para criar a passkey.</span>
          </div>
          <div className="auth-device-step-actions">
            <button className="btn btn-primary" type="button" onClick={() => void flow.confirm()} disabled={registration.status === REGISTRATION_STATUS.CONFIRMING}>
              {registration.status === REGISTRATION_STATUS.CONFIRMING ? <RefreshCw size={16} className="spin" aria-hidden="true" /> : <Fingerprint size={16} aria-hidden="true" />}
              {registration.status === REGISTRATION_STATUS.CONFIRMING ? 'Aguardando o dispositivo…' : 'Confirmar no dispositivo'}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => { flow.cancel(); setRegistration({ status: REGISTRATION_STATUS.IDLE }) }}>Cancelar</button>
          </div>
        </div>
      ) : null}

      {registrationError ? (
        <Notice copy={registrationError}>
          <span className="auth-device-actions">
            {registration.reason === REGISTRATION_REASON.RECENT_MFA_REQUIRED ? (
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void leaveToReauthenticate()}>Sair e entrar de novo</button>
            ) : registration.reason === REGISTRATION_REASON.INTERRUPTED ? (
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void flow.confirm()}>Tentar novamente</button>
            ) : registration.reason === REGISTRATION_REASON.UNSUPPORTED || registration.reason === REGISTRATION_REASON.UNAUTHORIZED ? null : (
              <button className="btn btn-secondary btn-sm" type="button" onClick={beginRegistration}>Tentar novamente</button>
            )}
          </span>
        </Notice>
      ) : null}

      {signOutError ? <Notice copy={signOutError} /> : null}

      <section className="panel auth-device-list" aria-label="Dispositivos cadastrados" aria-busy={list.status === 'loading'}>
        {list.status === 'loading' && rows.length === 0 ? (
          <div role="status" aria-live="polite">
            <EmptyState icon={RefreshCw} iconClassName="spin" title="Carregando dispositivos…" description="Buscando as passkeys cadastradas." />
          </div>
        ) : null}

        {list.status === 'error' ? (
          <div role="alert">
            <EmptyState
              icon={AlertTriangle}
              title={deviceErrorCopy(list.error).title}
              description={deviceErrorCopy(list.error).description}
              action={<button className="btn btn-secondary" type="button" onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" /> Tentar novamente</button>}
            />
          </div>
        ) : null}

        {list.status === 'ready' && rows.length === 0 ? (
          <EmptyState icon={Smartphone} title="Nenhum dispositivo cadastrado." description="Cadastre um dispositivo para continuar entrando no ALM." />
        ) : null}

        {rows.length > 0 ? (
          <ul className="auth-device-items">
            {rows.map((row) => {
              const device = describeAuthenticator(row)
              return (
                <li key={row.id} className={`auth-device-item${device.revoked ? ' is-revoked' : ''}`}>
                  <span className="auth-device-icon" aria-hidden="true"><Fingerprint size={20} /></span>
                  <div className="auth-device-copy">
                    <strong>{device.name}</strong>
                    <span>{device.method} · cadastrado em {device.created}</span>
                    <span>Último uso: {device.lastUsed}</span>
                    {device.syncedAcrossDevices ? <span>Passkey sincronizada entre aparelhos da mesma conta.</span> : null}
                  </div>
                  <div className="auth-device-state">
                    {device.revoked ? (
                      <span className="auth-device-badge is-revoked">Removido em {device.revokedAt}</span>
                    ) : (
                      <span className="auth-device-badge">Ativo</span>
                    )}
                    {canRevoke(rows, row) ? (
                      <button className="btn btn-danger-soft btn-sm" type="button" onClick={() => openRevoke(row)}>
                        <Trash2 size={14} aria-hidden="true" /> Remover
                      </button>
                    ) : !device.revoked && active <= 1 ? (
                      <span className="auth-device-hint">Único dispositivo ativo</span>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <Modal
        open={Boolean(revoking)}
        title="Remover dispositivo"
        description="Este dispositivo não poderá mais ser usado para entrar no ALM."
        onClose={() => { if (!revoking?.submitting) setRevoking(null) }}
        footer={(
          <>
            <button className="btn btn-secondary" type="button" onClick={() => setRevoking(null)} disabled={revoking?.submitting}>Cancelar</button>
            <button className="btn btn-danger-soft" type="submit" form="auth-revoke-form" disabled={revoking?.submitting}>
              {revoking?.submitting ? <RefreshCw size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
              {revoking?.submitting ? 'Removendo…' : 'Remover dispositivo'}
            </button>
          </>
        )}
      >
        {revoking ? (
          <form id="auth-revoke-form" className="auth-revoke-form" onSubmit={submitRevoke}>
            <div className="field">
              <label htmlFor="revoke-reason">Motivo da remoção</label>
              <textarea
                id="revoke-reason"
                name="reason"
                rows={3}
                maxLength={200}
                value={revoking.reason}
                onChange={(event) => setRevoking({ ...revoking, reason: event.target.value, error: null })}
                disabled={revoking.submitting}
                aria-invalid={revoking.error?.tone === 'warning' && !revoking.reason.trim() ? true : undefined}
                autoFocus
                required
              />
            </div>
            {revoking.error ? <Notice copy={revoking.error} /> : null}
          </form>
        ) : null}
      </Modal>
    </div>
  )
}
