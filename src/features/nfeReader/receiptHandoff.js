/**
 * Transporta os dados confirmados na Leitura automática de NF-e até o
 * formulário "Novo recebimento" — sem passar pela URL (o payload não cabe
 * bem numa query string) e sem `localStorage`/`sessionStorage` (não deve
 * sobreviver a um F5 nem vazar entre sessões; é só um handoff dentro da
 * mesma navegação SPA, que já não recarrega a página — ver
 * `layout/navigation.js`, `navigate()`).
 *
 * IMPORTANTE — leitura e limpeza são operações separadas de propósito:
 * `App.jsx` roda em `<React.StrictMode>` (main.jsx), que em desenvolvimento
 * chama a função inicializadora de `useState` DUAS VEZES a cada montagem,
 * exatamente para detectar inicializadores impuros. Uma primeira versão
 * deste módulo tinha uma única função "pega e limpa" chamada direto no
 * inicializador — a primeira chamada consumia o valor real, a segunda via
 * `null` (já limpo), e o React descartava o resultado da primeira, então o
 * formulário sempre abria vazio (bug real, encontrado testando com
 * Playwright, não suposição). Por isso: `peekPendingReceiptPrefill()` é uma
 * leitura NÃO destrutiva, segura para chamar quantas vezes o React quiser
 * durante a renderização; `clearPendingReceiptPrefill()` é quem realmente
 * apaga o valor, chamada uma vez num `useEffect` (fase de commit, depois da
 * renderização) — idempotente, então não importa quantas vezes rode.
 */
let pending = null

export function setPendingReceiptPrefill(data) {
  pending = data
}

/** Leitura não destrutiva — segura para chamar mais de uma vez (StrictMode). */
export function peekPendingReceiptPrefill() {
  return pending
}

/** Limpa de verdade — chamar depois que o valor já foi aplicado ao formulário, nunca dentro do inicializador de useState. Idempotente. */
export function clearPendingReceiptPrefill() {
  pending = null
}
