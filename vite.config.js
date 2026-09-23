import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    // `@undecaf/zbar-wasm` carrega seu binário (`zbar.wasm`) via
    // `new URL('zbar.wasm', import.meta.url)`, relativo ao próprio módulo — o
    // pré-empacotamento de dependências do Vite em dev (esbuild, para
    // node_modules/.vite/deps/) copia só o JS gerado, não esse `.wasm`
    // irmão. Sem esta exclusão, a URL calculada em dev aponta para um
    // arquivo que não existe em node_modules/.vite/deps/, o servidor cai no
    // fallback de SPA e devolve `index.html` no lugar do binário — bug real
    // encontrado ao testar o benchmark de decoders (erro do WebAssembly:
    // "expected magic word ... found 3c 21 64 6f", que é "<!do" do HTML).
    // Excluir do pré-empacotamento faz o Vite servir o pacote direto de
    // node_modules em dev, onde o `.wasm` está de fato ao lado do `.mjs`.
    // Não afeta `npm run build` (que já resolvia o asset corretamente via a
    // análise de `new URL(..., import.meta.url)` do próprio build de
    // produção do Vite — ver README do módulo NF-e para os números).
    exclude: ['@undecaf/zbar-wasm'],
  },
})
