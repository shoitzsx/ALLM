import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Fingerprint, Info, RefreshCw, ShieldAlert } from 'lucide-react'
import { AuthLayout } from './AuthLayout.jsx'
import { useAuth } from './AuthProvider.jsx'
import { MATRICULA_OVERFLOW_MESSAGE } from './authErrors.js'
import { applyMatriculaInput, applyPinInput, isMatriculaComplete, isPinComplete } from './credentialsInput.js'
import { ACTIVATION_CODE_PATTERN, FIRST_ACCESS_PROBLEM, checkFirstAccessInput, firstAccessErrorCopy, firstAccessProblemCopy } from './firstAccessRules.js'
import { REGISTRATION_REASON, REGISTRATION_STATUS, createRegistrationFlow } from './registrationFlow.js'
import { register } from './webauthnBrowser.js'
import { getWebAuthnSupport } from './webauthnSupport.js'
import './auth.css'

const TONE_ICON = { error: AlertTriangle, warning: ShieldAlert, info: Info }

// Primeiro acesso (PIN temporário → troca → primeira passkey) ou novo dispositivo (PIN já definitivo).
const MODE = Object.freeze({ FIRST: 'first', DEVICE: 'device' })

/**
 * Ativação de passkey com um código autorizado antes por quem administra o ALM:
 *
 *   PRIMEIRO ACESSO (o PIN que a pessoa recebeu é TEMPORÁRIO):
 *     POST /auth/initial-pin {matricula, temporaryPin, newPin, activationCode}   → {pinChanged:true}
 *     POST /auth/authenticators/registration-challenges {matricula, pin: <PIN NOVO>, activationCode}
 *     POST /auth/authenticators {challengeId, response, activationCode}
 *   NOVO DISPOSITIVO (o PIN já é definitivo): só os dois últimos passos.
 *
 * Não é cadastro livre: sem um código válido (uso único, com validade, emitido para esta
 * matrícula) o servidor recusa com a mesma resposta de credenciais inválidas, e o código só
 * é consumido por ele, quando a passkey é gravada. Aqui só se coletam os dados e se abre a
 * passkey num toque do usuário. Trocar o PIN NÃO cria sessão: depois da passkey a pessoa
 * ainda entra pelo login, com matrícula, PIN e passkey.
 *
 * Segredos: PIN temporário, PIN novo e código SAEM DA TELA no envio (campos de senha) e nunca
 * vão à URL, ao storage nem ao console. Quem guarda o necessário até o fim do cadastro é só o
 * fluxo (registrationFlow.js), em memória; ele esquece tudo ao concluir, falhar de forma
 * definitiva ou cancelar.
 */
export function ActivatePasskeyPage() {
  const session = useAuth()
  const { api } = session

  const [mode, setMode] = useState(MODE.FIRST)
  const [matricula, setMatricula] = useState('')
  const matriculaRef = useRef('')
  const [overflow, setOverflow] = useState(0)
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [code, setCode] = useState('')
  const [problem, setProblem] = useState(null)
  const [state, setState] = useState({ status: REGISTRATION_STATUS.IDLE })
  const alertRef = useRef(null)

  const flow = useMemo(() => (api ? createRegistrationFlow({
    api,
    webauthn: { register },
    getSupport: () => getWebAuthnSupport(window),
    emit: (next) => setState(next),
  }) : null), [api])
  useEffect(() => {
    flow?.activate()
    return () => flow?.dispose()
  }, [flow])

  const starting = state.status === REGISTRATION_STATUS.STARTING
  const interrupted = state.status === REGISTRATION_STATUS.ERROR && state.reason === REGISTRATION_REASON.INTERRUPTED
  // Passkey a um toque: o desafio já foi aceito (inclui o toque cancelado/expirado, que mantém o mesmo desafio).
  const ready = state.status === REGISTRATION_STATUS.READY || state.status === REGISTRATION_STATUS.CONFIRMING || interrupted
  const confirming = state.status === REGISTRATION_STATUS.CONFIRMING
  const done = state.status === REGISTRATION_STATUS.DONE
  // PIN já trocado, cadastro parado por motivo passageiro: dá para continuar sem trocar de novo.
  const resumable = state.status === REGISTRATION_STATUS.ERROR && state.canResume === true && !interrupted
  const pinChanged = state.pinChanged === true

  // Cadastro que terminou em erro e volta ao formulário (só "interrompido" e "retomável" seguem
  // com o que está na memória): o fluxo esquece o PIN novo e o código que ainda guardava.
  useEffect(() => {
    if (state.status === REGISTRATION_STATUS.ERROR && !interrupted && state.canResume !== true) flow?.cancel()
  }, [state, interrupted, flow])

  // O PIN já foi trocado e não dá para retomar aqui: o caminho agora é "Novo dispositivo", com o PIN novo.
  useEffect(() => {
    if (state.status === REGISTRATION_STATUS.ERROR && state.pinChanged === true && state.canResume !== true && !interrupted) setMode(MODE.DEVICE)
  }, [state, interrupted])

  const errorCopy = problem
    ? firstAccessProblemCopy(problem)
    : state.status === REGISTRATION_STATUS.ERROR ? firstAccessErrorCopy(state) : null
  const ErrorIcon = errorCopy ? TONE_ICON[errorCopy.tone] || Info : Info

  useEffect(() => {
    if (errorCopy) alertRef.current?.focus()
  }, [errorCopy?.title, problem, state])

  function wipeSecrets() {
    setPin('')
    setNewPin('')
    setConfirmPin('')
    setCode('')
  }

  function handleMatricula(event) {
    const result = applyMatriculaInput(matriculaRef.current, event.target.value)
    matriculaRef.current = result.value
    setMatricula(result.value)
    setOverflow((current) => (result.overflow ? current + 1 : 0))
    setProblem(null)
  }

  function changeMode(next) {
    if (next === mode || starting) return
    flow?.cancel()
    wipeSecrets()
    setProblem(null)
    setState({ status: REGISTRATION_STATUS.IDLE })
    setMode(next)
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (!flow || starting) return
    const trimmedCode = code.trim()

    if (mode === MODE.FIRST) {
      const checked = checkFirstAccessInput({ matricula, temporaryPin: pin, newPin, confirmPin, activationCode: code })
      if (!checked.ok) {
        // Formato dos dados de acesso: mesma mensagem genérica do servidor, e os segredos saem da tela.
        // Só a divergência/igualdade dos PINs (conferida no que a pessoa digitou) deixa o resto no lugar.
        if (checked.problem === FIRST_ACCESS_PROBLEM.INVALID) wipeSecrets()
        else { setNewPin(''); setConfirmPin('') }
        setProblem(checked.problem)
        return
      }
      setProblem(null)
      // Os segredos saem dos campos já no envio; as cópias abaixo vivem só nesta chamada.
      const temporaryPin = pin
      const definitivePin = newPin
      wipeSecrets()
      void flow.beginFirstAccess({ matricula, temporaryPin, newPin: definitivePin, activationCode: trimmedCode })
      return
    }

    if (!isMatriculaComplete(matricula) || !isPinComplete(pin) || !ACTIVATION_CODE_PATTERN.test(trimmedCode)) {
      // Mesma mensagem genérica do servidor: não diz qual dado falhou nem a regra.
      wipeSecrets()
      setProblem(FIRST_ACCESS_PROBLEM.INVALID)
      return
    }
    setProblem(null)
    // PIN e código saem dos campos já no envio; as cópias abaixo vivem só nesta chamada.
    const submittedPin = pin
    wipeSecrets()
    void flow.begin({ matricula, pin: submittedPin, activationCode: trimmedCode })
  }

  function restart() {
    flow?.cancel()
    wipeSecrets()
    setProblem(null)
    setState({ status: REGISTRATION_STATUS.IDLE })
  }

  const startingLabel = state.step === 'pin' ? 'Trocando o PIN…' : state.step === 'challenge' ? 'Preparando o cadastro…' : 'Verificando…'
  const firstMode = mode === MODE.FIRST

  return (
    <AuthLayout envNote="Ambiente de validação — ativação de passkey com código autorizado.">
      <div className="auth-card">
        <header className="auth-card-header">
          <h1>Ativar passkey</h1>
          <p>
            {firstMode
              ? 'No primeiro acesso, troque o PIN temporário por um PIN seu e cadastre a passkey deste dispositivo. Use o código de ativação fornecido por quem administra o ALM.'
              : 'Use o código de ativação fornecido por quem administra o ALM para cadastrar a passkey deste dispositivo.'}
          </p>
        </header>

        {errorCopy ? (
          <div className={`auth-alert auth-alert-${errorCopy.tone}`} role={errorCopy.tone === 'error' ? 'alert' : 'status'} ref={alertRef} tabIndex={-1}>
            <ErrorIcon size={18} aria-hidden="true" />
            <div>
              <strong>{errorCopy.title}</strong>
              <span>{errorCopy.description}</span>
            </div>
          </div>
        ) : null}

        {done ? (
          <div className="auth-step-actions">
            <div className="auth-alert auth-alert-info" role="status">
              <CheckCircle2 size={18} aria-hidden="true" />
              <div>
                <strong>Passkey cadastrada.</strong>
                <span>{pinChanged ? 'Seu novo PIN e a passkey já valem. Agora entre com sua matrícula, PIN e passkey.' : 'Agora entre com sua matrícula, PIN e passkey.'}</span>
              </div>
            </div>
            <a className="btn btn-primary btn-lg" href="#/login">Ir para o login</a>
          </div>
        ) : ready ? (
          <div className="auth-step-actions">
            <div className="auth-alert auth-alert-info" role="status">
              <Fingerprint size={18} aria-hidden="true" />
              <div>
                <strong>Confirme no seu dispositivo</strong>
                <span>{pinChanged ? 'Seu PIN foi trocado. Siga as instruções do dispositivo para criar a passkey.' : 'Siga as instruções do dispositivo para criar a passkey.'}</span>
              </div>
            </div>
            <button className="btn btn-primary btn-lg auth-passkey-start" type="button" onClick={() => void flow.confirm()} disabled={confirming}>
              {confirming ? <RefreshCw size={16} className="spin" aria-hidden="true" /> : <Fingerprint size={16} aria-hidden="true" />}
              {confirming ? 'Aguardando o dispositivo…' : 'Usar a passkey'}
            </button>
            <button className="btn btn-secondary btn-lg" type="button" onClick={restart} disabled={confirming}>Cancelar</button>
          </div>
        ) : resumable ? (
          <div className="auth-step-actions">
            <button className="btn btn-primary btn-lg auth-resume" type="button" onClick={() => void flow.resume()}>
              <RefreshCw size={16} aria-hidden="true" /> Continuar o cadastro
            </button>
            <button className="btn btn-secondary btn-lg" type="button" onClick={restart}>Cancelar</button>
          </div>
        ) : (
          <form method="post" onSubmit={handleSubmit} aria-busy={starting}>
            <div className="auth-entry-zone">
              <fieldset className="auth-mode" disabled={starting}>
                <legend>Qual é a sua situação?</legend>
                <label className="auth-mode-option">
                  <input type="radio" name="activation-mode" value={MODE.FIRST} checked={firstMode} onChange={() => changeMode(MODE.FIRST)} />
                  <span><strong>Primeiro acesso</strong> — recebi um PIN temporário</span>
                </label>
                <label className="auth-mode-option">
                  <input type="radio" name="activation-mode" value={MODE.DEVICE} checked={!firstMode} onChange={() => changeMode(MODE.DEVICE)} />
                  <span><strong>Novo dispositivo</strong> — já tenho o meu PIN</span>
                </label>
              </fieldset>

              <div className="field">
                <label htmlFor="activate-matricula">Matrícula</label>
                <input
                  id="activate-matricula"
                  name="matricula"
                  type="text"
                  inputMode="text"
                  autoComplete="username"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  value={matricula}
                  onChange={handleMatricula}
                  disabled={starting}
                  aria-describedby={overflow ? 'activate-matricula-limit' : 'activate-matricula-hint'}
                  required
                />
                <div className="auth-field-note">
                  {overflow ? (
                    <span id="activate-matricula-limit" key={overflow} role="alert" className="auth-field-hint auth-field-hint-error">{MATRICULA_OVERFLOW_MESSAGE}</span>
                  ) : (
                    <span id="activate-matricula-hint" className="auth-field-hint">Até 20 letras ou números</span>
                  )}
                </div>
              </div>

              <div className="field">
                <label htmlFor="activate-pin">{firstMode ? 'PIN temporário' : 'PIN'}</label>
                <input
                  id="activate-pin"
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  enterKeyHint="next"
                  autoComplete="off"
                  value={pin}
                  onChange={(event) => { setPin((current) => applyPinInput(current, event.target.value)); setProblem(null) }}
                  disabled={starting}
                  required
                />
              </div>

              {firstMode ? (
                <>
                  <div className="field">
                    <label htmlFor="activate-new-pin">Novo PIN</label>
                    <input
                      id="activate-new-pin"
                      name="newPin"
                      type="password"
                      inputMode="numeric"
                      enterKeyHint="next"
                      autoComplete="new-password"
                      value={newPin}
                      onChange={(event) => { setNewPin((current) => applyPinInput(current, event.target.value)); setProblem(null) }}
                      disabled={starting}
                      aria-describedby="activate-new-pin-hint"
                      required
                    />
                    <div className="auth-field-note">
                      <span id="activate-new-pin-hint" className="auth-field-hint">8 dígitos, diferente do temporário</span>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="activate-confirm-pin">Confirmar novo PIN</label>
                    <input
                      id="activate-confirm-pin"
                      name="confirmPin"
                      type="password"
                      inputMode="numeric"
                      enterKeyHint="next"
                      autoComplete="new-password"
                      value={confirmPin}
                      onChange={(event) => { setConfirmPin((current) => applyPinInput(current, event.target.value)); setProblem(null) }}
                      disabled={starting}
                      required
                    />
                  </div>
                </>
              ) : null}

              <div className="field">
                <label htmlFor="activate-code">Código de ativação</label>
                <input
                  id="activate-code"
                  name="activationCode"
                  type="password"
                  inputMode="text"
                  enterKeyHint="go"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={code}
                  onChange={(event) => { setCode(event.target.value); setProblem(null) }}
                  disabled={starting}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={starting}>
                {starting ? <RefreshCw size={16} className="spin" aria-hidden="true" /> : null}
                {starting ? startingLabel : firstMode ? 'Trocar o PIN e continuar' : 'Continuar'}
              </button>
            </div>
          </form>
        )}

        {!done ? (
          <p className="auth-footnote"><a href="#/login">Voltar ao login</a></p>
        ) : null}
      </div>
    </AuthLayout>
  )
}
