import React from 'react'
import { Check, Delete } from 'lucide-react'
import { KEYPAD_KEY, KEYPAD_LAYOUT } from './pinKeypad.js'

/**
 * Teclado numérico do ALM — só apresentação. Atende UM campo por vez (o que
 * tem o foco: matrícula ou PIN; `fieldLabel` diz qual). Não guarda o valor, não envia
 * nada, não conhece o formulário: avisa qual tecla foi tocada (`onKey`) e quem
 * o usa decide o que fazer (LoginPage atualiza o campo; "Continuar" chama o
 * envio do formulário).
 *
 * Acessibilidade:
 * - grupo nomeado; cada tecla é um <button> real (teclado físico: Tab/Enter/
 *   Espaço; leitor de tela: "1", "Apagar último dígito", "Continuar");
 * - área de toque de pelo menos 48px (ver .auth-keypad-key em auth.css);
 * - `valuePreview` é só visual (celular em paisagem rola o campo para fora da
 *   tela): quem usa passa os dígitos da matrícula ou só pontos para o PIN;
 * - o leitor de tela ouve só QUANTOS dígitos há (nunca quais) e de qual campo,
 *   numa região `status` fora da tela; a legenda visual "Digitando em …" é
 *   escondida dele para não repetir.
 * - o mousedown não tira o foco do campo ativo: o campo continua sendo o
 *   dono do foco enquanto se toca no teclado.
 */
export function PinKeypad({ onKey, digitCount = 0, disabled = false, id, fieldLabel, valuePreview = '' }) {
  const countText =
    digitCount === 0 ? 'Nenhum dígito informado.' : `${digitCount} ${digitCount === 1 ? 'dígito informado' : 'dígitos informados'}.`
  // Com um campo nomeado, a contagem diz de qual campo é: "Matrícula: 3 dígitos informados."
  const spokenText = fieldLabel ? `${fieldLabel}: ${countText.charAt(0).toLowerCase()}${countText.slice(1)}` : countText

  return (
    <div
      className="auth-keypad"
      id={id}
      role="group"
      aria-label="Teclado numérico do ALM"
      onMouseDown={(event) => event.preventDefault()}
    >
      {fieldLabel ? (
        <p className="auth-keypad-target" aria-hidden="true">
          Digitando em <strong>{fieldLabel}</strong>
          {valuePreview ? <span className="auth-keypad-value">{valuePreview}</span> : null}
        </p>
      ) : null}
      <div className="auth-keypad-grid">
        {KEYPAD_LAYOUT.map((key) => {
          if (key === KEYPAD_KEY.BACKSPACE) {
            return (
              <button
                key={key}
                type="button"
                className="auth-keypad-key auth-keypad-key-action"
                data-key={key}
                aria-label="Apagar último dígito"
                disabled={disabled}
                onClick={() => onKey(key)}
              >
                <Delete size={22} aria-hidden="true" />
              </button>
            )
          }
          if (key === KEYPAD_KEY.CONTINUE) {
            return (
              <button
                key={key}
                type="button"
                className="auth-keypad-key auth-keypad-key-continue"
                data-key={key}
                disabled={disabled}
                onClick={() => onKey(key)}
              >
                <Check size={18} aria-hidden="true" />
                <span>Continuar</span>
              </button>
            )
          }
          return (
            <button
              key={key}
              type="button"
              className="auth-keypad-key"
              data-key={key}
              disabled={disabled}
              onClick={() => onKey(key)}
            >
              {key}
            </button>
          )
        })}
      </div>
      <span className="auth-sr-only" role="status" aria-live="polite">
        {spokenText}
      </span>
    </div>
  )
}
