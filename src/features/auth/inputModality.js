import { useEffect, useState } from 'react'

/**
 * Detecção progressiva do tipo de interação, para decidir se o teclado
 * numérico do ALM aparece por padrão. Usa as capacidades que o navegador
 * declara (ponteiro e hover), NÃO a largura da tela nem o user-agent: um
 * celular em paisagem é largo, e um notebook com a janela estreita não vira
 * celular.
 *
 * Regra: o teclado integrado é o padrão só quando o ponteiro PRIMÁRIO é
 * impreciso (dedo) e sem hover, e NÃO há mouse/trackpad algum conectado
 * (`any-pointer: fine`). Notebook com tela de toque, tablet com teclado e
 * trackpad, e desktop continuam com o teclado físico. Sem `matchMedia` no
 * navegador, cai no padrão seguro: sem teclado integrado.
 */
export const TOUCH_KEYPAD_QUERY = Object.freeze({
  primaryPointerCoarse: '(pointer: coarse)',
  primaryHoverNone: '(hover: none)',
  anyPointerFine: '(any-pointer: fine)',
})

function matches(matchMediaFn, query) {
  try {
    return Boolean(matchMediaFn(query)?.matches)
  } catch {
    return false
  }
}

export function prefersTouchKeypad(matchMediaFn) {
  if (typeof matchMediaFn !== 'function') return false
  return (
    matches(matchMediaFn, TOUCH_KEYPAD_QUERY.primaryPointerCoarse) &&
    matches(matchMediaFn, TOUCH_KEYPAD_QUERY.primaryHoverNone) &&
    !matches(matchMediaFn, TOUCH_KEYPAD_QUERY.anyPointerFine)
  )
}

/** Avisa quando o dispositivo muda (ex.: conectar um mouse). Devolve a função que cancela. */
export function subscribeToInteractionChanges(win, onChange) {
  if (!win || typeof win.matchMedia !== 'function') return () => {}
  const lists = Object.values(TOUCH_KEYPAD_QUERY).map((query) => win.matchMedia(query))
  lists.forEach((list) => {
    // Safari < 14 só tem addListener.
    if (typeof list.addEventListener === 'function') list.addEventListener('change', onChange)
    else if (typeof list.addListener === 'function') list.addListener(onChange)
  })
  return () => {
    lists.forEach((list) => {
      if (typeof list.removeEventListener === 'function') list.removeEventListener('change', onChange)
      else if (typeof list.removeListener === 'function') list.removeListener(onChange)
    })
  }
}

/** Hook: `true` quando o teclado integrado deve ser o padrão neste dispositivo. */
export function useTouchKeypadDefault() {
  const read = () => (typeof window === 'undefined' ? false : prefersTouchKeypad(window.matchMedia?.bind(window)))
  const [touchDefault, setTouchDefault] = useState(read)
  useEffect(() => {
    setTouchDefault(read())
    return subscribeToInteractionChanges(window, () => setTouchDefault(read()))
  }, [])
  return touchDefault
}
