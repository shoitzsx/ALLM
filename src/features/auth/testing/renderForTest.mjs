// Só para testes: compila os componentes .jsx de src/features/auth/ em memória
// (esbuild, que já acompanha o Vite — nenhuma dependência nova) e os renderiza
// para HTML no servidor com react-dom/server. Dá para conferir a MARCAÇÃO
// (rótulos, papéis ARIA, atributos do formulário) sem DOM nem navegador.
// Comportamento real (foco, toque, teclado físico) é verificado em navegador,
// fora desta suíte.
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const AUTH_DIR = join(ROOT, 'src', 'features', 'auth').replaceAll('\\', '/')

let cached = null

/** Devolve `{ React, renderToStaticMarkup, LoginPage, PinKeypad, PasskeyStep }` da MESMA cópia do React. */
export async function loadAuthComponents() {
  if (cached) return cached
  const entry = `
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    export { React, renderToStaticMarkup }
    export { LoginPage } from '${AUTH_DIR}/LoginPage.jsx'
    export { PinKeypad } from '${AUTH_DIR}/PinKeypad.jsx'
    export { PasskeyStep } from '${AUTH_DIR}/PasskeyStep.jsx'
  `
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, sourcefile: 'entry.jsx', loader: 'jsx' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
    loader: { '.css': 'empty', '.jsx': 'jsx' },
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env': '{}' },
  })
  const dir = mkdtempSync(join(tmpdir(), 'alm-auth-test-'))
  try {
    const file = join(dir, 'bundle.cjs')
    writeFileSync(file, result.outputFiles[0].text)
    cached = createRequire(import.meta.url)(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return cached
}

/**
 * Renderiza com um `window` mínimo (o roteador por hash lê `window.location`
 * ao montar). `matchMedia` opcional simula o tipo de interação do dispositivo.
 */
export function withWindow({ hash = '', matchMedia, isSecureContext = true } = {}, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  globalThis.window = { location: { hash }, isSecureContext, ...(matchMedia ? { matchMedia } : {}) }
  try {
    return fn()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  }
}
