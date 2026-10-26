import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AlertTriangle, Eye, EyeOff, Info, Keyboard, RefreshCw, ShieldAlert } from 'lucide-react'
import { useHashRoute } from '../../layout/navigation.js'
import { AUTH_EVENT, AUTH_STATUS, LOGIN_FAILURE, UNSUPPORTED_REASON, createInitialState, isSecondFactorStep, transition } from './authStates.js'
import { CHALLENGE_EXPIRED_COPY, MATRICULA_OVERFLOW_MESSAGE, NOT_AVAILABLE_COPY, SESSION_EXPIRED_COPY, getLoginFailureCopy } from './authErrors.js'
import { applyKeypadKey, KEYPAD_FIELD, KEYPAD_KEY, keypadMaxLength } from './pinKeypad.js'
import { applyMatriculaInput, applyPinInput, canSubmitCredentials, isMatriculaComplete, isPinComplete, sanitizeMatriculaInput } from './credentialsInput.js'
import { useTouchKeypadDefault } from './inputModality.js'
import { PinKeypad } from './PinKeypad.jsx'
import { PasskeyStep } from './PasskeyStep.jsx'
import { AuthLayout } from './AuthLayout.jsx'
import { useAuth } from './AuthProvider.jsx'
import { FLOW_SIGNAL, createLoginFlow } from './loginFlow.js'
import { authenticate } from './webauthnBrowser.js'
import { getWebAuthnSupport } from './webauthnSupport.js'
import { AUTH_ROUTES } from './routeAccess.js'
import './auth.css'

/**
 * Pré-visualização visual, só em desenvolvimento: `#/login?state=<nome>`.
 * `import.meta.env.DEV` garante que isto não existe em produção — fora do
 * `npm run dev` o parâmetro é ignorado e a tela abre sempre no formulário.
 * Nada disto autentica nem concede acesso: são textos e ícones fixos, vindos
 * dos mesmos estados que a tela usa de verdade, só para revisar cada caso
 * antes de o backend existir.
 */
const PREVIEWS = {
  invalid: { failure: LOGIN_FAILURE.CREDENCIAIS },
  limit: { failure: LOGIN_FAILURE.LIMITE },
  unavailable: { failure: LOGIN_FAILURE.INDISPONIVEL },
  expired: { notice: SESSION_EXPIRED_COPY },
  loading: { status: AUTH_STATUS.VERIFICANDO_CREDENCIAIS },
  'second-factor': { status: AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR },
  interrupted: { status: AUTH_STATUS.CONFIRMACAO_INTERROMPIDA },
  'no-passkey': { status: AUTH_STATUS.PASSKEY_NAO_CADASTRADA },
  unsupported: { status: AUTH_STATUS.DISPOSITIVO_INCOMPATIVEL, reason: UNSUPPORTED_REASON.SEM_WEBAUTHN },
  insecure: { status: AUTH_STATUS.DISPOSITIVO_INCOMPATIVEL, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO },
  network: { status: AUTH_STATUS.ERRO_CONEXAO, retryStatus: AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR },
  'factor-error': { status: AUTH_STATUS.ERRO_SEGUNDO_FATOR },
}

/** O PIN nunca aparece na legenda do teclado: só pontos (no máximo 12, para não quebrar a linha). */
function maskedPreview(pin) {
  return pin.length > 12 ? `${'•'.repeat(12)}…` : '•'.repeat(pin.length)
}

const ALERT_ICONS = { error: AlertTriangle, warning: ShieldAlert, info: Info }

function initialStateFor(preview) {
  if (!preview) return createInitialState()
  const { notice: _notice, status, ...extra } = preview
  return createInitialState(status || AUTH_STATUS.CREDENCIAIS, extra)
}

/**
 * Tela de acesso. Com o `AuthProvider` (aplicação real) o envio executa o login
 * de verdade, por loginFlow.js: matrícula + PIN → desafio WebAuthn (toque do
 * usuário) → sessão confirmada pelo servidor em GET /auth/me. Esta tela não
 * concede acesso a ninguém: quem autentica é o servidor, e a tela só reflete
 * o resultado. Nunca grava em localStorage/sessionStorage/cookie, nunca usa
 * DEMO_USERS e nunca coloca matrícula ou PIN na URL; o PIN sai do campo no
 * envio. Sem Provider ou numa pré-visualização (`?state=`, só em DEV) nada é
 * enviado à rede: só se mostra o estado visual e o aviso de ambiente sem acesso.
 */
function LoginScreen({ preview }) {
  const session = useAuth()
  // Fluxo real só com o Provider da aplicação e fora de pré-visualização.
  const realFlow = Boolean(session.api) && !preview
  const [auth, dispatch] = useReducer(transition, preview, initialStateFor)
  const [matricula, setMatricula] = useState('')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [notice, setNotice] = useState(preview?.notice || (session.reason === 'expired' ? SESSION_EXPIRED_COPY : null))
  // A passkey está aberta no dispositivo (botão desativado enquanto isso).
  const [ceremonyBusy, setCeremonyBusy] = useState(false)
  // Teclado do ALM: padrão só em toque puro (ver inputModality.js); quem
  // preferir o do dispositivo alterna aqui. Fica só na memória da página.
  const touchDefault = useTouchKeypadDefault()
  const [nativeKeyboard, setNativeKeyboard] = useState(false)
  // Campo que o teclado do ALM está atendendo (o que tem o foco): matrícula, PIN ou nenhum.
  const [activeField, setActiveField] = useState(null)
  // Número da última tentativa recusada pela checagem LOCAL de formato (0 = nenhuma).
  const [localRejection, setLocalRejection] = useState(0)
  // Número da última entrada de matrícula RECUSADA por passar de 6 dígitos (0 = nenhuma).
  // O aviso fica no lugar da orientação "Até 6 números" (mesma linha: nada se desloca).
  const [matriculaOverflow, setMatriculaOverflow] = useState(0)

  const matriculaRef = useRef(null)
  const pinRef = useRef(null)
  const alertRef = useRef(null)
  const keypadRef = useRef(null)
  const zoneRef = useRef(null)
  // Verdadeiro só durante um foco dado por SCRIPT (tela abre, erro, voltar): ele
  // não abre o teclado do ALM sozinho — no iOS o foco por script também não
  // abre o teclado do aparelho. O toque do usuário no campo abre.
  const quietFocusRef = useRef(false)
  // Espelho do valor da matrícula: a recusa de excesso compara com o valor
  // ATUAL, mesmo com dois toques/eventos antes da próxima renderização.
  const matriculaValueRef = useRef('')
  const timerRef = useRef(null)
  const previousStatus = useRef(auth.status)

  // Sinais do fluxo real → máquina de estados da tela. Sempre a versão mais recente (ref).
  const signalRef = useRef(() => {})
  signalRef.current = (event) => {
    if (event.type === FLOW_SIGNAL.CEREMONY_RUNNING) setCeremonyBusy(true)
    else if (event.type === FLOW_SIGNAL.CEREMONY_IDLE) setCeremonyBusy(false)
    else if (event.type === FLOW_SIGNAL.CHALLENGE_EXPIRED) {
      dispatch({ type: AUTH_EVENT.BACK })
      setNotice(CHALLENGE_EXPIRED_COPY)
    } else if (event.type === FLOW_SIGNAL.SIGNED_IN) {
      // Nada a fazer aqui: o Provider já tem a sessão validada pelo servidor e o
      // roteador (App) leva o usuário para dentro. A tela não concede nada.
    } else dispatch(event)
  }
  const flow = useMemo(() => (realFlow ? createLoginFlow({
    api: session.api,
    webauthn: { authenticate },
    getSupport: () => getWebAuthnSupport(window),
    refreshSession: session.readSession,
    emit: (event) => signalRef.current(event),
  }) : null), [realFlow, session.api, session.readSession])
  useEffect(() => {
    flow?.activate()
    return () => flow?.dispose()
  }, [flow])

  const loading = auth.status === AUTH_STATUS.VERIFICANDO_CREDENCIAIS
  // Checagem local do tamanho da matrícula: mesma mensagem de credenciais
  // inválidas, sem dizer qual campo nem qual regra. Nada é enviado.
  const failure = auth.failure || (localRejection ? LOGIN_FAILURE.CREDENCIAIS : null)
  const failureCopy = failure ? getLoginFailureCopy(failure) : null
  const alertCopy = failureCopy || notice
  const isFieldError = Boolean(failureCopy?.fieldLevel)
  const AlertIcon = alertCopy ? ALERT_ICONS[alertCopy.tone] || Info : Info
  const keypadEnabled = touchDefault && !nativeKeyboard
  const fieldActive = activeField !== null
  const overflowShown = matriculaOverflow > 0
  // O teclado numérico do ALM atende só o PIN: a matrícula tem letras e usa o teclado do dispositivo.
  const showKeypad = keypadEnabled && activeField === KEYPAD_FIELD.PIN && !loading

  function focusQuietly(element) {
    quietFocusRef.current = true
    try {
      element?.focus()
    } finally {
      quietFocusRef.current = false
    }
  }

  useEffect(() => {
    focusQuietly(matriculaRef.current)
    return () => window.clearTimeout(timerRef.current)
  }, [])

  // Voltar do passo da passkey devolve o foco ao primeiro campo.
  useEffect(() => {
    if (previousStatus.current !== AUTH_STATUS.CREDENCIAIS && auth.status === AUTH_STATUS.CREDENCIAIS) {
      focusQuietly(matriculaRef.current)
    }
    previousStatus.current = auth.status
  }, [auth.status])

  useEffect(() => {
    if (!alertCopy) return
    // role="alert" já anuncia a mensagem; o foco só se move quando há algo
    // acionável: erro de credenciais manda o usuário de volta ao campo.
    if (isFieldError) focusQuietly(matriculaRef.current)
    else alertRef.current?.focus()
  }, [alertCopy, isFieldError, localRejection])

  // Ao abrir o teclado do ALM, garante que ele fica visível (cartão alto em tela baixa).
  useEffect(() => {
    if (showKeypad) keypadRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [showKeypad])

  function submit() {
    if (loading) return
    if (!canSubmitCredentials({ matricula, pin })) {
      // Campo vazio: leva o foco a ele em vez de "enviar" nada.
      if (sanitizeMatriculaInput(matricula).length === 0) matriculaRef.current?.focus()
      else pinRef.current?.focus()
      return
    }
    setNotice(null)
    setMatriculaOverflow(0)
    if (!isMatriculaComplete(matricula) || !isPinComplete(pin)) {
      // Matrícula curta ou PIN que não tem 8 dígitos: recusa aqui mesmo, com a
      // mensagem genérica de sempre. O PIN também é apagado — assim não se
      // descobre qual dos dois estava errado nem qual é a regra.
      setPin('')
      setShowPin(false)
      setLocalRejection((current) => current + 1)
      return
    }
    setLocalRejection(0)
    dispatch({ type: AUTH_EVENT.SUBMIT_CREDENTIALS })
    // O PIN sai do campo no envio; a cópia abaixo vive só nesta chamada e vai
    // direto ao corpo da requisição (nunca à URL, ao storage ou ao console).
    const submittedPin = pin
    setPin('')
    setShowPin(false)
    if (flow) {
      void flow.start({ matricula, pin: submittedPin })
      return
    }
    // Sem fluxo real (pré-visualização em DEV ou tela isolada sem Provider):
    // nada é enviado — só o estado visual de carregamento e o aviso de que
    // este ambiente não dá acesso. Nenhum caminho aqui termina em "autenticado".
    timerRef.current = window.setTimeout(() => {
      dispatch({ type: AUTH_EVENT.BACK })
      setNotice(NOT_AVAILABLE_COPY)
    }, 900)
  }

  function handleSubmit(event) {
    event.preventDefault()
    submit()
  }

  function commitMatricula(value) {
    matriculaValueRef.current = value
    setMatricula(value)
  }

  // Digitação, colagem e preenchimento automático passam por aqui. Letras viram
  // maiúsculas. Mais de 20 caracteres: a entrada INTEIRA é recusada (nada de
  // cortar nos 20 primeiros), o valor que já estava no campo fica e o aviso aparece.
  function handleMatriculaChange(event) {
    setLocalRejection(0)
    const result = applyMatriculaInput(matriculaValueRef.current, event.target.value)
    commitMatricula(result.value)
    setMatriculaOverflow((current) => (result.overflow ? current + 1 : 0))
  }

  function handlePinChange(event) {
    setLocalRejection(0)
    setPin((current) => applyPinInput(current, event.target.value))
  }

  // O teclado numérico do ALM digita só o PIN (até 8 dígitos; o 9º é ignorado).
  // "Continuar" envia o formulário.
  function handleKeypadKey(key) {
    if (key === KEYPAD_KEY.CONTINUE) {
      submit()
      return
    }
    setLocalRejection(0)
    setPin((current) => applyKeypadKey(current, key, { maxLength: keypadMaxLength(KEYPAD_FIELD.PIN) }))
  }

  // Tudo acontece DENTRO do clique, de forma síncrona. O Safari do iOS só abre o
  // teclado virtual quando o foco é dado no mesmo gesto do usuário; adiar o foco
  // (requestAnimationFrame, setTimeout) faz o campo ganhar foco sem teclado.
  // `flushSync` aplica o novo `inputMode` ao DOM antes do foco, para o navegador
  // ler o tipo de teclado certo (nativo ou nenhum) no momento em que o recebe.
  // A alternância vale só para o PIN (a matrícula sempre usa o teclado do
  // dispositivo): o foco vai para o PIN no mesmo gesto.
  function toggleNativeKeyboard() {
    flushSync(() => {
      setNativeKeyboard((current) => !current)
      setActiveField(KEYPAD_FIELD.PIN)
    })
    const input = pinRef.current
    if (!input) return
    // Campo já focado: sai e entra de novo no mesmo gesto para o navegador reler o tipo de teclado.
    if (document.activeElement === input) input.blur()
    input.focus()
  }

  // O teclado do ALM abre quando o usuário seleciona a matrícula ou o PIN (foco
  // ou toque) e atende o campo selecionado. Só fecha por uma saída DELIBERADA da
  // zona (matrícula + PIN + teclado + alternância + Entrar): o foco vai para outro
  // elemento ou há um clique/toque fora dela. Passar da matrícula ao PIN não
  // fecha nem reabre nada. A alternância e o botão Entrar ficam na zona mas NÃO
  // abrem o teclado sozinhos. Isso evita o teclado abrir/fechar embaixo do dedo:
  // se o teclado aparecesse ou sumisse entre o início e o fim do toque, o botão
  // tocado se mexeria de lugar e o toque erraria o alvo (ou apertaria uma tecla).
  function fieldOf(element) {
    const target = element?.closest?.('[data-keypad-target]')?.dataset.keypadTarget
    return Object.values(KEYPAD_FIELD).includes(target) ? target : null
  }

  function selectField(field) {
    if (!field) return
    // Foco por script não ABRE o teclado, mas com ele já aberto o campo atendido muda junto com o foco.
    const quiet = quietFocusRef.current
    // O aviso de excesso é da matrícula: sai ao passar para outro campo.
    if (field !== KEYPAD_FIELD.MATRICULA) setMatriculaOverflow(0)
    setActiveField((current) => (quiet && current === null ? null : field))
  }

  function handleZoneFocus(event) {
    selectField(fieldOf(event.target))
  }

  // O toque num campo que JÁ tem o foco não gera evento de foco; o clique cobre
  // esse caso (ex.: o teclado foi fechado tocando fora e o usuário volta ao campo).
  function handleZoneClick(event) {
    selectField(fieldOf(event.target))
  }

  // `relatedTarget` nulo NÃO diz que o foco saiu da zona: o Safari não dá foco a
  // botões ao tocar, um toque em área não focável ou a troca de app/aba também
  // chegam assim, e o teclado sumiria (e a tecla se moveria) no meio do toque.
  // Sem destino, não se decide aqui — o clique fora da zona (efeito abaixo) cuida disso.
  function handleZoneBlur(event) {
    const next = event.relatedTarget
    if (next && !event.currentTarget.contains(next)) {
      setActiveField(null)
      setMatriculaOverflow(0)
    }
  }

  useEffect(() => {
    if (!fieldActive && !overflowShown) return undefined
    // Clique/toque FORA da zona: fecha o teclado do ALM e tira o aviso de excesso
    // da matrícula (o mesmo que acontece quando o foco vai para outro elemento).
    // Dentro da zona (campos, rótulos, teclado, alternância, Entrar) nada disto
    // acontece. `composedPath()` e não `contains(event.target)`: o clique pode
    // trocar o ícone do botão (mostrar/ocultar PIN) antes deste ouvinte rodar, e
    // um alvo já removido do DOM pareceria "fora" da zona.
    function closeOnOutsideClick(event) {
      if (!event.composedPath().includes(zoneRef.current)) {
        setActiveField(null)
        setMatriculaOverflow(0)
      }
    }
    document.addEventListener('click', closeOnOutsideClick)
    return () => document.removeEventListener('click', closeOnOutsideClick)
  }, [fieldActive, overflowShown])

  if (isSecondFactorStep(auth)) {
    return (
      <PasskeyStep
        state={auth}
        preview={Boolean(preview)}
        busy={flow ? ceremonyBusy : undefined}
        onStart={flow ? () => void flow.confirm() : undefined}
        onRetry={() => {
          dispatch({ type: AUTH_EVENT.RETRY })
          // O toque em "Tentar novamente" já é o gesto que a passkey exige.
          if (flow) void flow.confirm()
        }}
        onBack={() => {
          flow?.cancel()
          setCeremonyBusy(false)
          dispatch({ type: AUTH_EVENT.BACK })
        }}
      />
    )
  }

  return (
    <form className="auth-card" method="post" onSubmit={handleSubmit} aria-busy={loading}>
      {preview ? (
        <p className="auth-preview-badge">Pré-visualização demonstrativa: não concede acesso.</p>
      ) : null}
      <header className="auth-card-header">
        <h1>Entrar</h1>
        <p>Use sua matrícula e PIN para acessar o ALM. Depois do PIN, será pedida a confirmação pela passkey do seu dispositivo.</p>
      </header>

      {alertCopy ? (
        <div
          id="login-alert"
          key={localRejection}
          className={`auth-alert auth-alert-${alertCopy.tone}`}
          role="alert"
          ref={alertRef}
          tabIndex={-1}
        >
          <AlertIcon size={18} aria-hidden="true" />
          <div>
            <strong>{alertCopy.title}</strong>
            <span>{alertCopy.description}</span>
          </div>
        </div>
      ) : null}

      <div
        className="auth-entry-zone"
        ref={zoneRef}
        onFocus={handleZoneFocus}
        onBlur={handleZoneBlur}
        onClick={handleZoneClick}
      >
        <div className="field">
          <label htmlFor="login-matricula">Matrícula</label>
          <input
            id="login-matricula"
            name="matricula"
            type="text"
            // Letras e números (3 a 20), sempre em MAIÚSCULAS, preservando zeros à
            // esquerda: continua TEXTO, nunca number. Teclado do dispositivo (tem letras).
            inputMode="text"
            enterKeyHint="next"
            autoComplete="username"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            data-keypad-target={KEYPAD_FIELD.MATRICULA}
            ref={matriculaRef}
            value={matricula}
            onChange={handleMatriculaChange}
            disabled={loading}
            aria-invalid={isFieldError || undefined}
            aria-describedby={`${matriculaOverflow ? 'login-matricula-limit' : 'login-matricula-hint'}${isFieldError ? ' login-alert' : ''}`}
            required
          />
          <div className="auth-field-note">
            {matriculaOverflow ? (
              // role="alert" + key: anuncia a recusa, inclusive quando se repete.
              <span id="login-matricula-limit" key={matriculaOverflow} role="alert" className="auth-field-hint auth-field-hint-error">
                {MATRICULA_OVERFLOW_MESSAGE}
              </span>
            ) : (
              <span id="login-matricula-hint" className="auth-field-hint">
                Até 20 letras ou números
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="login-pin">PIN</label>
          <div className="auth-pin-field">
            <input
              id="login-pin"
              name="pin"
              type={showPin ? 'text' : 'password'}
              // "none": com o teclado do ALM ativo, o do aparelho não abre junto.
              // Digitação física, colagem e preenchimento assistido continuam valendo.
              inputMode={keypadEnabled ? 'none' : 'numeric'}
              enterKeyHint="go"
              autoComplete="current-password"
              data-keypad-target={KEYPAD_FIELD.PIN}
              ref={pinRef}
              value={pin}
              onChange={handlePinChange}
              disabled={loading}
              aria-invalid={isFieldError || undefined}
              aria-describedby={isFieldError ? 'login-alert' : undefined}
              required
            />
            <button
              type="button"
              className="auth-pin-toggle"
              data-keypad-target={KEYPAD_FIELD.PIN}
              onClick={() => setShowPin((current) => !current)}
              aria-label={showPin ? 'Ocultar PIN' : 'Mostrar PIN'}
              aria-pressed={showPin}
              disabled={loading}
            >
              {showPin ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          {/* Acima do teclado de propósito: a alternância não muda de lugar quando o teclado abre ou fecha. */}
          {touchDefault ? (
            <button
              type="button"
              className="auth-keyboard-toggle"
              onClick={toggleNativeKeyboard}
              aria-pressed={nativeKeyboard}
              disabled={loading}
            >
              <Keyboard size={15} aria-hidden="true" />
              {nativeKeyboard ? 'Usar o teclado numérico do ALM' : 'Usar o teclado do dispositivo'}
            </button>
          ) : null}

          {showKeypad ? (
            <div ref={keypadRef}>
              <PinKeypad
                onKey={handleKeypadKey}
                digitCount={pin.length}
                fieldLabel="PIN"
                valuePreview={maskedPreview(pin)}
                disabled={loading}
              />
            </div>
          ) : null}
        </div>

        <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
          {loading ? <RefreshCw size={16} className="spin" aria-hidden="true" /> : null}
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </div>

      {realFlow ? (
        <p className="auth-footnote">
          Primeiro acesso ou novo dispositivo? <a href={`#${AUTH_ROUTES.activate}`}>Ativar passkey</a>
        </p>
      ) : null}
    </form>
  )
}

export function LoginPage() {
  const route = useHashRoute()
  const previewKey = import.meta.env.DEV ? route.query.get('state') : null
  const preview = previewKey && Object.prototype.hasOwnProperty.call(PREVIEWS, previewKey) ? PREVIEWS[previewKey] : null

  const session = useAuth()
  const envNote = session.api
    ? 'Ambiente de validação — acesso com matrícula, PIN e passkey.'
    : 'Ambiente de validação — esta tela ainda não envia nenhum dado de login.'

  return (
    <AuthLayout envNote={envNote}>
      {/* `key`: trocar `?state=` remonta a tela já no estado pedido. */}
      <LoginScreen key={previewKey || 'live'} preview={preview} />
    </AuthLayout>
  )
}
