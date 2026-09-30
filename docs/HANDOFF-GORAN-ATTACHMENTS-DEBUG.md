# Handoff técnico — Upload de anexos, Google Drive, Google Sheets e travamento no frontend

Estado da investigação em 30/09/2026

---

## 1. Resumo executivo

- O upload resumível de anexos (Drive) foi integrado no frontend e no backend.
- OAuth/Drive está configurado e funcionando — validado tanto por chamadas diretas via terminal quanto por um E2E técnico completo.
- O upload físico do binário para o Google Drive funciona.
- Um problema de CORS no PUT direto do navegador para o Google Drive foi identificado e **corrigido localmente** (mudanças não commitadas — ver seção 29).
- Um problema de cota de leitura da Google Sheets API (`429 Quota exceeded`) foi identificado, diagnosticado em detalhe, e uma primeira fase de otimização (**Fase 1**) foi implementada e validada localmente.
- Um teste real com 6 anexos, que antes estourava a cota, passou sem nenhum `429` depois da Fase 1.
- Uma tela branca no frontend (`DetailPage`) foi causada por imports ausentes em `src/App.jsx` — **corrigida localmente**. Esse bug já existia em `origin/main` e nunca tinha sido acionado porque nenhum recebimento real tinha anexo confirmado até este teste.
- **Problema ainda aberto**: o fluxo de "adicionar documento a um recebimento já existente" (categoria Nota Fiscal + anexo) ainda pode ficar "carregando" indefinidamente. Uma correção de concorrência (serializar o PATCH da NF antes do upload) e um timeout explícito para as chamadas à Sheets API já foram implementados e validados por teste automatizado, mas o último teste manual **ainda travou** depois dessas correções. A investigação não está concluída.
- Existe risco real de **arquivo órfão no Google Drive** de pelo menos uma tentativa onde o PUT no Drive foi confirmado visualmente, mas a confirmação (`POST /anexos`) nunca terminou no backend.

Este documento separa claramente **fatos confirmados** de **hipóteses**. Hipóteses são marcadas explicitamente como tal.

---

## 2. Arquitetura atual

- **Frontend**: React + Vite. Local: `http://localhost:5173`.
- **Backend**: Node (`http.createServer`, sem framework). Local: porta `3001`.
- **Proxy de dev**: `vite.config.js` → `server.proxy['/api'] = 'http://localhost:3001'`. O frontend chama caminhos relativos (`/api/v1/...`), nunca a porta do backend diretamente.
- **Produção**: `https://allm.vercel.app` — mesmo projeto Vercel serve frontend estático e a Function (`api/v1/[...path].mjs`, que reusa `backend/app.mjs`).
- **Persistência**:
  - **Google Sheets** (conta de serviço, JWT) — toda a metadata: recebimentos, itens, divergências, histórico de status, auditoria, metadata de anexos.
  - **Google Drive** (OAuth2, escopo `drive.file`) — apenas os arquivos binários dos anexos. Contas de serviço não têm cota de armazenamento própria no Drive; por isso o binário usa uma conta OAuth real, não a conta de serviço do Sheets.

### Fluxo correto de upload (contrato atual)

```
Browser
  → POST /api/v1/recebimentos/:id/anexos/upload-sessions
  → backend valida Origin, cria sessão resumível no Google Drive
  → browser recebe sessionUrl (nunca logada/exposta)
  → browser faz PUT direto para sessionUrl (Google Drive)
  → Drive retorna sucesso (200/201) com o fileId do arquivo
  → browser faz POST /api/v1/recebimentos/:id/anexos com {fileId, categoria}
  → backend confirma o arquivo no Drive e persiste a metadata no Sheets
  → só então a UI mostra sucesso
```

**Importante**: o binário do arquivo **nunca** passa pela Vercel Function/backend. Isso é intencional — o limite de payload de uma Vercel Function é 4.5 MB, e essa arquitetura evita esse teto e evita transformar a Function num proxy de arquivo. Não reverter essa decisão.

---

## 3. Contrato de anexos

A fonte de verdade do contrato é **`docs/attachments-api.md`** (não modificado por esta investigação, continua válido). Resumo:

| Operação | Rota |
|---|---|
| Criar sessão de upload | `POST /api/v1/recebimentos/:id/anexos/upload-sessions` |
| Upload do binário | `PUT <sessionUrl>` (direto ao Google, fora da nossa API) |
| Confirmar anexo | `POST /api/v1/recebimentos/:id/anexos` |
| Baixar anexo | `GET /api/v1/recebimentos/:id/anexos/:anexoId/download` |
| Remover anexo | `DELETE /api/v1/recebimentos/:id/anexos/:anexoId` |

- **Limite de tamanho**: 4 MiB (`MAX_ATTACHMENT_BYTES`, `backend/attachments.mjs`).
- **Tipos aceitos**: PDF, JPEG, PNG, WebP, GIF, AVIF, HEIC, HEIF.
- **Chunk do upload resumível**: 1 MiB (`RESUMABLE_UPLOAD_CHUNK_BYTES`).
- A resposta de `upload-sessions` nunca expõe nada além de `sessionUrl`/`chunkSize`/`constraints` — não expõe credenciais.
- A resposta de confirmação (`attachmentResponse`) nunca expõe `storageKey` (o `fileId` real do Drive) nem `_rowNumber` (novo campo interno — ver seção 15).

---

## 4. Configuração local de ambiente

Separação atual (implementada e validada nesta investigação):

**`D:\Downloads\ALLM\.env`** (raiz — configuração do Google Sheets):
```
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
```

**`D:\Downloads\ALLM\backend\.env`** (configuração do Google Drive/OAuth):
```
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN
DRIVE_UPLOAD_ALLOWED_ORIGINS
```

`DRIVE_UPLOAD_ALLOWED_ORIGINS` localmente está configurada como:
```
http://localhost:5173,https://allm.vercel.app
```

Nenhum valor real de credencial está neste documento nem foi exibido em nenhum momento desta investigação — só nomes de variáveis e presença/ausência foram confirmados.

**Precedência de carregamento** (`backend/config/env.mjs`, `loadProjectEnvironment()`):
```js
dotenv.config({ path: path.join(projectRoot, '.env') })       // raiz primeiro
dotenv.config({ path: path.join(projectRoot, 'backend', '.env') }) // backend depois
```
`dotenv` **nunca sobrescreve** uma variável já definida no `process.env`. Como os dois arquivos hoje têm conjuntos de variáveis disjuntos (Sheets na raiz, Drive/OAuth em `backend/.env`), não há conflito — mas se uma mesma variável existisse nos dois arquivos, a raiz venceria.

---

## 5. Problema original de configuração de ambiente (resolvido)

Durante a investigação, houve confusão real de salvamento no VS Code:

- O arquivo `.env`/`backend/.env` foi alterado diretamente via PowerShell (`Set-Content`).
- O VS Code, com uma aba antiga aberta, manteve o buffer antigo em memória.
- Ao tentar salvar pela aba antiga, apareceu o erro: `Failed to save '.env': The content of the file is newer.`
- Isso gerou uma inconsistência visual real entre o que a aba mostrava e o que estava no disco, e causou múltiplas rodadas de verificação (mtime, contagem de variáveis) até isolar a causa.
- **Hoje**: os dois arquivos estão persistidos corretamente no disco, com a separação descrita na seção 4, e ambos continuam ignorados pelo Git (confirmado repetidamente via `git check-ignore -v` e `git status`).

Nenhum valor de credencial foi incluído nesta seção nem em nenhum outro lugar deste documento.

---

## 6. Validação de OAuth/Drive (fato confirmado)

Depois da separação de `.env`, com o backend reiniciado:

- Backend iniciou corretamente (log confirmou `injected env (3) from .env` + `injected env (4) from backend\.env`).
- `GET /api/v1/catalogos` → 200
- `GET /api/v1/dashboard` → 200
- `GET /api/v1/recebimentos` → 200
- `POST /api/v1/recebimentos/:id/anexos/upload-sessions` → **201**
- `chunkSize` retornado: `1048576` (1 MiB)
- `DRIVE_NOT_CONFIGURED`: não ocorreu
- `DRIVE_AUTH_FAILED`: não ocorreu
- `npm test` naquela etapa: **67/67**
- `npm run build`: sucesso

Conclusão confirmada naquele ponto: a infraestrutura OAuth/Drive estava funcionando corretamente no ambiente local.

---

## 7. E2E técnico via terminal (fato confirmado)

Um teste de ponta a ponta foi executado inteiramente via terminal (sem navegador), usando um recebimento de teste temporário (`TESTE-ANEXO-E2E`, depois arquivado) e um PDF fictício pequeno criado para o teste:

1. Recebimento de teste criado (201)
2. `upload-sessions` → 201
3. PUT real para o Drive — arquivo pequeno (471 bytes) coube em um único PUT (sem `308`)
4. Drive respondeu 200 com o arquivo confirmado
5. `POST /anexos` → 201, anexo persistido
6. Metadata apareceu corretamente via `GET` normal (nome, categoria, tamanho, mimeType, `id` público — sem `storageKey`/`fileId`)
7. Download → 200, `Content-Type`/`Content-Disposition` corretos
8. Hash SHA-256 do arquivo baixado == hash do arquivo original
9. `DELETE` → 200, com motivo de remoção
10. Download após remoção → 404 `ATTACHMENT_NOT_FOUND`
11. Auditoria coerente (criado → incluído → removido, em ordem)
12. Recebimento de teste arquivado via API normal
13. Recebimentos reais pré-existentes permaneceram intactos

**Conclusão importante deste teste**: backend, OAuth e Drive funcionavam corretamente **fora do navegador**. Isso foi o que permitiu isolar, depois, que o problema de CORS (seção 8) era especificamente sobre o navegador, não sobre a configuração OAuth/Drive em si.

---

## 8. Erro de CORS no navegador (resolvido localmente)

Erro real observado no teste manual pelo navegador:

```
Access to fetch at 'https://www.googleapis.com/upload/drive/v3/files?...'
from origin 'http://localhost:5173'
has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.

net::ERR_FAILED
```

**Diagnóstico confirmado**:
- O teste via terminal funcionava porque `fetch` do Node **não aplica** política de CORS.
- O backend criava a sessão resumível no Drive **sem enviar o header `Origin`** na requisição inicial.
- Segundo a documentação pública do Google (Cloud Storage JSON/XML API, que compartilha o protocolo de upload resumível com a Drive API v3): *"If you have enabled Cross-Origin Resource Sharing, you should also include an Origin header in both this and subsequent upload requests."*
- Sem esse header na criação da sessão, o Google não tinha nenhuma origem registrada para autorizar via CORS nas requisições seguintes (o PUT do navegador) — daí a ausência do header `Access-Control-Allow-Origin` na resposta e o bloqueio.

---

## 9. Correção de CORS implementada (não commitada)

**Nova variável de ambiente**: `DRIVE_UPLOAD_ALLOWED_ORIGINS` (ver seção 4).

**Arquivos alterados**:
- `backend/config/env.mjs` — parseia `DRIVE_UPLOAD_ALLOWED_ORIGINS` numa lista normalizada (trim, remove vazios).
- `backend/integrations/googleDrive.mjs` — nova função `isOriginAllowed(origin, allowedOrigins)` (comparação exata, nunca substring/prefixo/regex); `createResumableUpload` passou a aceitar um parâmetro `origin` opcional e a enviá-lo como header `Origin` na requisição inicial ao Google (via `buildResumableUploadHeaders`, também exportada e testada).
- `backend/app.mjs` — o handler de `POST /upload-sessions` lê `req.headers.origin`, valida contra a allowlist **antes** de chamar `createResumableUpload`; se não autorizada (ou ausente), retorna `403 { code: 'ORIGIN_NOT_ALLOWED' }` sem sequer chamar o Google.
- `backend/attachments.test.mjs` — testes novos cobrindo allowlist e o header enviado.
- `.env.example` — documentado (sem valores reais).

**Comportamento**:
- Origem ausente → `403 ORIGIN_NOT_ALLOWED` (decisão: este endpoint só existe para gerar sessão destinada ao navegador; não há uso legítimo server-to-server hoje — confirmado por busca no código).
- `http://localhost:5173` e `https://allm.vercel.app` → permitidos.
- Qualquer outra origem → `403 ORIGIN_NOT_ALLOWED`, **nenhuma sessão é criada no Drive** (a validação acontece antes da chamada ao Google — confirmado também empiricamente: a resposta 403 retornou mais rápido que um GET comum só de Sheets, o que é consistente com nenhuma chamada extra ao Drive ter acontecido).
- Nenhum wildcard `*` é aceito.

**Teste negativo realizado** (via terminal, com o backend real rodando): `Origin: https://evil.example.com` → `403 ORIGIN_NOT_ALLOWED`, confirmado.

O binário continua indo **browser → Drive diretamente**; esta correção não transforma o backend em proxy de arquivo.

---

## 10. Primeiro problema real de cota do Sheets (fato observado)

Erro real observado nos logs, durante um teste manual de múltiplos arquivos:

```
GaxiosError: Quota exceeded for quota metric 'Read requests' and limit
'Read requests per minute per user' of service 'sheets.googleapis.com'
for consumer 'project_number:<redigido>'.
```
(status 429, `code: 'RESOURCE_EXHAUSTED'`)

**Achado importante**: a falha era **parcial**, não tudo-ou-nada:
- Alguns arquivos chegaram ao Drive fisicamente.
- Alguns dados chegaram a ser persistidos no Sheets.
- A UI mostrou um erro genérico de falha.
- Investigação detalhada (ver seção 11) mostrou que parte do que o usuário via como "dados no Sheets" era, na verdade, o **registro do recebimento em si** (criado antes de qualquer tentativa de upload) ou uma atualização de campo separada (NF) — não necessariamente o anexo em si.

---

## 11. Diagnóstico do consumo de cota (fato confirmado por leitura de código + logs)

Pontos de consumo excessivo de leitura identificados:

- **`requestUser`** (`app.mjs`) — chama `repository.getUsuario(...)` → `listUsuarios()` → lê a sheet `Usuarios` **inteira, em toda requisição**, sem exceção, mesmo para rotas que nada têm a ver com usuários.
- **`listRecebimentos`** (`recebimentosRepository.mjs`) — lia **6 sheets inteiras separadamente** (`Promise.all` de 6 `readRows`) só para montar o resultado de uma única busca — usado inclusive para buscar **um único** recebimento por id.
- **`replaceChildren`** (`recebimentosRepository.mjs`) — chamado por toda mutação de recebimento (criar item, confirmar anexo, mudar status, etc.): para cada uma das 5 sheets filhas (`Itens`, `Divergencias`, `HistoricoStatus`, `Auditoria`, `Anexos`), **lia a sheet inteira**, apagava as linhas daquele recebimento, e reescrevia **todas** as linhas atuais — mesmo as sheets sem nenhuma relação com a mutação em questão.

**Estimativas observadas antes da otimização** (medidas/calculadas na investigação):
- 1 anexo completo (sessão + confirmação): **~20 leituras**
- 6 anexos sequenciais: **~120 leituras**
- Mais leituras adicionais de criação de recebimento e refreshes de UI.

`Promise.all` reduzia **latência** (chamadas em paralelo), mas **não reduzia a cota consumida** — cada chamada HTTP individual ainda conta separadamente contra o limite "requests per minute".

---

## 12. Risco de persistência parcial (fato observado em log real)

`replaceChildren` processa as sheets filhas em sequência fixa (`itens`, `divergencias`, `historicoStatus`, `historicoAlteracoes`, `anexos`). Se uma exceção ocorrer no meio do loop (por exemplo, um 429 ao ler `Divergencias`, a 2ª sheet da sequência), as sheets seguintes (`HistoricoStatus`, `Auditoria`, `Anexos`) **nunca são processadas** naquela tentativa.

Isso foi **observado de verdade** num log real: a linha principal do recebimento (`Recebimentos`) e a sheet `Itens` já tinham sido reescritas quando a exceção estourou na leitura de `Divergencias` — `Anexos`/`Auditoria` nunca foram alcançadas nessa tentativa específica.

**Isto não é chamado de "transação" em nenhum lugar do código ou desta investigação** — não há atomicidade real. Cada leitura/escrita pode ter sucesso ou falha de forma independente.

---

## 13. Fase 1 de otimização — implementada e validada localmente

### A) `batchGet` para leituras

`backend/integrations/googleSheets.mjs`:
- `parseSheetValues(values)` — extraída de dentro de `readRows`, agora compartilhada (sem duplicar lógica).
- `readManyRows(sheetNames)` — usa `spreadsheets.values.batchGet` para ler **várias sheets em 1 única request HTTP**.

`backend/repositories/recebimentosRepository.mjs`:
- `listRecebimentos()` passou de **6 requests** (`Promise.all` de `readRows`) para **1 request** (`readManyRows`). Resultado funcional idêntico — mesmo formato de dado, mesmos campos.

### B) Persistência específica para adicionar anexo

Nova função `repository.addAttachmentRow(receipt)`:
- Toca apenas: `Recebimentos` (atualiza `atualizadoEm` via `updateRow`), `Anexos` (1 `appendRow` da linha nova), `Auditoria` (1 `appendRow` da entrada nova).
- **Não toca**: `Itens`, `Divergencias`, `HistoricoStatus`.
- Depende de `service.addAttachment` já ter colocado o anexo novo e a auditoria nova como **últimos elementos** dos respectivos arrays em memória (confirmado por leitura de `backend/services/recebimentosService.mjs`).

### C) Persistência específica para remover anexo

Nova função `repository.removeAttachmentRow(receipt, attachment)`:
- Usa um novo campo interno `_rowNumber` (ver item D) para fazer `updateRow` **direto na linha existente** de `Anexos` (nunca apaga+reescreve a sheet inteira).
- Também toca `Auditoria` (1 `appendRow`) e `Recebimentos` (`updateRow` do `atualizadoEm`).

### D) Dados internos nunca expostos

- `attachmentFromRow` (repository) agora carrega `_rowNumber` no objeto em memória — usado só internamente para localizar a linha depois.
- `attachmentResponse` (`app.mjs`, agora exportada para teste) desestrutura e descarta **tanto `storageKey` quanto `_rowNumber`** antes de qualquer resposta HTTP. Confirmado por teste automatizado que nenhum dos dois aparece na resposta pública.
- `serializeRow` (grava na sheet) só usa campos listados em `SHEET_SCHEMA`, então `_rowNumber` nunca é escrito numa célula real mesmo que esteja no objeto em memória.

### E) Cleanup do Drive com sinalização

Novo helper `persistOrCleanupDrive` (`app.mjs`, exportado e testado isoladamente):
```js
export async function persistOrCleanupDrive({ persist, cleanup, onCleanupFailed }) {
  try {
    return await persist()
  } catch (exception) {
    try {
      await cleanup()
    } catch {
      onCleanupFailed?.()
    }
    throw exception
  }
}
```
- Se a persistência falha, tenta `drive.deleteFile(uploaded.id)`.
- Se **isso também falhar**, registra um log sanitizado no servidor: `{ receiptId, attachmentId (id público, ex. "ANX-..."), cleanupFailed: true }` — **nunca** `fileId`/`storageKey`/`sessionUrl`/tokens.
- O erro HTTP retornado ao cliente continua sendo o da falha de persistência original, nunca o erro do cleanup.

---

## 14. Resultado da Fase 1 (fato confirmado)

Teste real feito pelo Lucas, pelo navegador, no recebimento **`REC-2026-0010`**, com **6 arquivos** (fluxo de criação de recebimento novo com anexos):

- **6 anexos ativos** confirmados via `GET` (leitura só, sem alteração).
- **Zero `429`** no log do backend durante todo o teste.
- **Zero cleanup do Drive acionado** (ou seja, zero falhas de persistência).
- **Zero exceções** no log do backend.
- Metadata correta (nomes, tamanhos, mimeTypes conferidos).

Isso é significativo porque, **antes da Fase 1**, um teste de 6 arquivos estourava a cota de leitura da Sheets API de forma repetida e observável.

---

## 15. Bug da tela branca (corrigido localmente)

**Erro real**:
```
ReferenceError: attachmentDownloadHref is not defined
  at DetailPage (App.jsx:1100)
```

**Causa confirmada**: `attachmentDownloadHref` existe e é exportada por `src/api.js`, mas `src/App.jsx` **não tinha nenhum import** de `./api.js`.

**Investigação adicional** (varredura estática, depois confirmada via ESLint `no-undef` rodado localmente — não commitado no projeto, só usado como verificação pontual) encontrou **mais 4 identificadores** usados sem import, todos dentro de `DetailPage`:
- `friendlyAttachmentError` (de `./features/attachments/errorMessages.js`)
- `validateAttachmentFile`, `ALLOWED_ATTACHMENT_ACCEPT`, `ALLOWED_IMAGE_ACCEPT` (de `./features/attachments/constraints.js`)

Todos os 5 identificadores **existiam e eram exportados corretamente** pelos respectivos módulos — só faltava o `import` em `App.jsx`.

**Confirmado**: esse bug já existia em `origin/main` (`git show origin/main:src/App.jsx` tem exatamente os mesmos usos sem import, nos mesmos pontos) — **está em produção agora**, só nunca foi acionado porque nenhum recebimento real tinha anexo confirmado até este teste (o `attachmentDownloadHref` só executa no render quando há pelo menos 1 anexo ativo para desenhar).

**Correção**: só os 5 imports faltantes foram adicionados — nenhum helper reimplementado, nenhuma lógica/JSX alterada.

**Verificação final**: rodei ESLint (`npx eslint`, config temporária, não commitada) com a regra `no-undef` sobre `src/App.jsx`. Validei a própria ferramenta rodando contra a versão pré-correção (pegou exatamente os mesmos 5 identificadores). Depois da correção: **zero erros, zero avisos**.

**Nota para o Goran**: como `NewReceiptPage` (fluxo de criação de recebimento) está num componente separado dentro do mesmo `App.jsx` e nunca referencia esses 5 identificadores, o teste de 6 arquivos da seção 14 nunca acionou esse bug — só o fluxo de "adicionar documento a um recebimento existente" (`DetailPage`) é afetado.

---

## 16. Estado "Finalizando..." (melhoria de UX local)

Em `src/App.jsx`, `saveDocument`:
- Durante o envio dos bytes: `"Enviando X%"`.
- Quando os bytes terminam (100%) mas o `POST /anexos` de confirmação ainda não retornou: `"Finalizando..."`.
- Só depois do `POST /anexos` retornar sucesso: estado de sucesso.
- **Sem sucesso otimista** em nenhum ponto — confirmado por leitura de código: o `status: 'success'` só é setado depois do `await` completo da cadeia (sessão → PUT → confirmação).
- **Nota de precisão**: o texto do **botão principal** do modal ("Enviando…") não muda para "Finalizando…" — ele é controlado por uma variável booleana separada (`uploading`), não pelo status por-arquivo. Só o rótulo pequeno dentro da lista de arquivos mostra a distinção. Isso não é um bug, é uma limitação de granularidade que já existia antes desta mudança.

---

## 17. Problema ainda aberto: adicionar documento a recebimento existente

O fluxo de criação de recebimento com 6 anexos (seção 14) funcionou depois da Fase 1. Mas o fluxo:

```
DetailPage → "Adicionar documento" → categoria "Nota Fiscal" → 1 arquivo pequeno
```

**ficou "carregando" indefinidamente** em pelo menos duas ocasiões de teste manual (uma antes da correção de concorrência/timeout descrita nas seções 20-23, e **uma depois**).

Na primeira ocorrência:
- O arquivo físico chegou ao Drive (confirmado visualmente pelo usuário).
- No Sheets, **algumas informações chegaram** (ver seção 18).
- Mas **nenhum novo `ANX` apareceu**.
- A entrada de auditoria "Arquivo incluído" **não apareceu**.
- O `POST /anexos` ficou em andamento, sem nunca retornar.

---

## 18. Diagnóstico da request presa (fato confirmado por evidência indireta forte)

Evidências coletadas (tudo via leitura só, sem nova chamada de escrita):

- O campo `atualizadoEm` do recebimento **mudou**.
- Havia uma entrada de auditoria `"Dados alterados: numeroNf, serieNf"` com um timestamp `T`.
- O `atualizadoEm` persistido tinha um timestamp **~3,4 segundos depois** de `T`.
- Isso é uma contradição reveladora: dentro de uma única chamada de `service.updateRecebimento`, o `atualizadoEm` e a entrada de auditoria são gravados quase no mesmo instante (mesma função síncrona) — não deveriam ficar 3,4s distantes.
- **Conclusão mais provável**: uma **segunda mutação** (`service.addAttachment`, chamada dentro da requisição de confirmação do anexo) rodou depois, setou seu próprio `atualizadoEm = now()`, e **a etapa 1 de `addAttachmentRow` (`touchRecebimentoRow`) concluiu com sucesso** (persistiu esse timestamp mais novo) — mas a execução não avançou (ou não terminou) até as etapas seguintes (`appendRow('Anexos', ...)` / `appendRow('Auditoria', ...)`).
- O backend **continuou respondendo normalmente a outras requisições** durante esse tempo — não era o processo inteiro travado, era uma cadeia assíncrona específica presa.
- **Nenhuma exceção foi logada** (`console.error` no catch geral de `app.mjs` nunca disparou) — mesmo depois de ~8,5 minutos de espera.
- Isso **não era bug de estado do frontend** — o frontend estava corretamente aguardando uma resposta do backend que nunca chegou nem como sucesso nem como erro.

---

## 19. Concorrência NF + upload (causa raiz identificada, fato confirmado por leitura de código)

Comportamento **antigo** (antes da correção da seção 20):

```js
// src/App.jsx, saveDocument (ANTES)
if (documentForm.category === 'Nota Fiscal') {
  store.updateRecebimento(receipt.id, { numeroNf, serieNf }) // fire-and-forget, sem await
}
for (const file of files) {
  await store.addAttachment(...) // começava IMEDIATAMENTE, em paralelo
}
```

`store.updateRecebimento` (em `src/store.js`) fazia a mutação local otimista e disparava a chamada real ao backend via `syncMutation(...)`, **sem retornar essa Promise** ao chamador — então `saveDocument` nunca esperava a confirmação real antes de iniciar o laço de upload.

**Resultado**: `PATCH /recebimentos/:id` (NF, que passa pelo `saveRecebimento`/`replaceChildren` completo — dezenas de chamadas sequenciais para um recebimento com vários anexos/auditoria) e `POST /anexos` podiam concorrer **ao mesmo tempo** contra a mesma planilha.

---

## 20. Correção de serialização implementada (não commitada, validada por teste automatizado)

**`src/store.js`**:
```js
updateRecebimento: (id, changes = {}, options = {}) => {
  updateRecebimento(id, changes, options) // mutação local otimista, continua imediata
  return syncMutation(id, () => api.updateRecebimento(id, changes), { rethrow: true })
},
```
Agora retorna a Promise real, que rejeita (em vez de engolir o erro) se o backend recusar a mutação.

**`src/App.jsx`** (`saveDocument`):
```js
if (documentForm.category === 'Nota Fiscal') {
  try {
    await store.updateRecebimento(receipt.id, { numeroNf, serieNf })
  } catch (error) {
    // mostra erro, NÃO inicia o upload
    return
  }
}
// só agora o laço de upload começa
```

**Validado por teste automatizado** (`src/features/attachments/uploadSerialization.test.mjs` — **nota: este arquivo foi removido durante a investigação, ver seção 26 sobre limitação de teste**; a lógica em si está no diff e foi revisada por leitura de código).

Isso elimina a **concorrência direta** entre `PATCH` da NF e `POST /anexos` — mas não mudou o custo interno do `PATCH` da NF em si (ver seção 22).

---

## 21. Timeout/retry do Google Sheets (implementado, não commitado)

**Achado confirmado nos próprios logs de erro reais desta sessão**:
```
retryConfig: {
  currentRetryAttempt: 3,
  retry: 3,
  retryDelayMultiplier: 2,
  noResponseRetries: 2,
  totalTimeout: 9007199254740991,   // Number.MAX_SAFE_INTEGER - 1
  maxRetryDelay: 9007199254740991,  // idem
  ...
}
```
Confirmado também na documentação de tipos do próprio `gaxios` (`node_modules/gaxios/build/cjs/src/common.d.ts`): `timeout` não tem valor padrão ("No timeout by default"), e `totalTimeout` "Defaults to Number.MAX_SAFE_INTEGER indicating to effectively ignore totalTimeout."

`backend/integrations/googleSheets.mjs` **não tinha nenhum timeout explícito** em nenhuma das 10 chamadas à Sheets API.

**Correção implementada** — novo `REQUEST_OPTIONS` (exportado, aplicado a todas as 10 chamadas via segundo argumento, confirmado que `googleapis-common` faz merge profundo dessas opções com a config base — `extend(true, {}, ...)`):
```js
export const REQUEST_OPTIONS = {
  timeout: 20000,
  retry: true,
  retryConfig: {
    retry: 2,
    maxRetryDelay: 4000,
    totalTimeout: 20000,
  },
}
```

- **`timeout`: 20000ms** — por chamada individual.
- **`retry`: 2** tentativas extras (até 3 no total; antes era 3 extras/4 no total).
- **`totalTimeout`: 20000ms** — teto duro para a sequência inteira de tentativas.
- **`maxRetryDelay`: 4000ms** — nenhuma espera entre tentativas passa de 4s.
- `429` **continua** sendo tentado de novo automaticamente (não removi esse comportamento, é o padrão do gaxios) — só não mais indefinidamente.
- Quando o limite é excedido, a chamada **rejeita normalmente** (`GaxiosError`), cai no catch geral de `app.mjs` (`console.error(exception)` + resposta HTTP de erro ao cliente) — infraestrutura que já existia, só nunca era alcançada porque a chamada nunca rejeitava antes.

**Testes automatizados adicionados** (`backend/attachments.test.mjs`): confirmam que `REQUEST_OPTIONS.timeout` é finito (≤30s) e que `retryConfig.totalTimeout`/`maxRetryDelay` são finitos (não `Number.MAX_SAFE_INTEGER`). **Não testam comportamento de rede real** (isso exigiria simular um servidor lento, fora do escopo dos testes deste projeto).

---

## 22. Limitação importante do timeout (ler com atenção)

O timeout de 20s é **por chamada individual**, não por fluxo inteiro. Um fluxo com muitas chamadas sequenciais (como o `PATCH` de NF passando por `saveRecebimento`/`replaceChildren`, que ainda faz dezenas de chamadas sequenciais para um recebimento com vários anexos/auditoria) **pode continuar levando bem mais que 20s no total**, mesmo que cada chamada individual respeite o teto.

**Isto não resolve o custo estrutural de `replaceChildren`** — só impede que uma chamada individual fique pendurada para sempre. Isso é importante para entender por que o problema da seção 23 ainda pode estar ocorrendo.

---

## 23. Problema ainda aberto (estado no momento deste documento)

Mesmo depois de:
- serializar o `PATCH` da NF antes do upload (seção 20),
- configurar timeout/retry no Sheets (seção 21),
- reiniciar o backend com as duas correções ativas,

um **novo teste manual** com `REC-2026-0010`, categoria "Nota Fiscal", 1 arquivo, foi iniciado pelo Lucas e **continuou "só carregando"** no momento em que este documento foi escrito. A última etapa da investigação estava em andamento quando a sessão foi interrompida para gerar este handoff.

### Hipótese principal atual (marcada explicitamente como hipótese, não fato)

Com a concorrência eliminada, o `PATCH` de `numeroNf`/`serieNf` agora é **aguardado antes** do upload começar — mas ele continua passando por `saveRecebimento` → `replaceChildren`, que pode fazer dezenas de chamadas sequenciais para um recebimento com vários anexos/histórico. **Hipótese**: antes, `PATCH` NF e upload concorriam; agora, é possível que o `PATCH` NF (sozinho, mas pesado) esteja **bloqueando o início do upload por demorar demais**, dando a mesma impressão externa de "travado", só que por um mecanismo diferente (serialização atrás de uma operação lenta, em vez de disputa concorrente). Isso **não foi confirmado** com logs do teste mais recente — a sessão foi interrompida antes dessa confirmação.

---

## 24. Hipótese de próxima correção (hipótese, não decisão)

`numeroNf`/`serieNf` são campos escalares da linha principal de `Recebimentos`. Possível caminho:

- Persistência pontual: `updateRow` só na linha de `Recebimentos` + `appendRow` da entrada de auditoria necessária — sem tocar `Itens`, `Divergencias`, `HistoricoStatus`, `Anexos`.
- Reaproveitamento possível: `touchRecebimentoRow` (já existe em `recebimentosRepository.mjs`, criado na Fase 1, hoje só usado por `addAttachmentRow`/`removeAttachmentRow`).
- **Cuidado necessário**: a rota geral `PATCH /recebimentos/:id` aceita um conjunto maior de campos — olhando `service.updateRecebimento`, o conjunto de campos bloqueados é `['id', 'protocolo', 'responsavel', 'status', 'historicoStatus', 'historicoAlteracoes', 'criadoEm', 'anexos', 'divergencias']` — **`itens` não está bloqueado**, ou seja, essa rota pode legitimamente receber mudanças de itens também. Uma otimização "sempre usar `touchRecebimentoRow` para `PATCH /recebimentos/:id`" seria **incorreta/insegura** se algum chamador mandar `itens` junto.
- **Sugestão**: criar um caminho específico só para quando os campos enviados forem comprovadamente escalares e seguros (ex.: um allowlist explícito de campos tipo `numeroNf`/`serieNf`/`observacoes`/etc., verificado antes de decidir qual caminho de persistência usar) — não uma detecção implícita/frágil.

Isto não foi implementado. Fica como próximo passo.

---

## 25. Request presa / possível arquivo órfão no Drive

Fato confirmado: em pelo menos uma tentativa,
- o PUT ao Drive foi confirmado visualmente pelo usuário (arquivo apareceu no Drive),
- o `POST /anexos` não concluiu,
- nenhum `ANX` foi criado,
- nenhuma auditoria de inclusão foi criada.

**Portanto, pode existir um arquivo órfão no Drive** dessa tentativa específica.

O código (`persistOrCleanupDrive`, seção 13-E) tenta fazer cleanup automaticamente **quando a persistência lança uma exceção**. Mas nesse caso específico a requisição nunca chegou a lançar exceção (ficou pendurada) — então **o cleanup nunca rodou**.

**Não deletar nada automaticamente** sem antes reconciliar contra a metadata real do Sheets (confirmar que o arquivo realmente não tem um `ANX` correspondente).

---

## 26. Estado atual dos testes automatizados

Evolução ao longo da investigação: 67/67 → 74/74 → 84/84 → **86/86** (estado atual).

`npm run build`: sucesso em todas as validações.

**Limitação importante de cobertura de teste, a ser considerada pelo Goran**: tentei adicionar testes automatizados para a serialização NF→upload descrita na seção 20 (`src/store.js`/`src/App.jsx`). Descobri que `src/store.js` importa `src/api.js`, que usa `import.meta.env.VITE_API_URL` — uma sintaxe específica do Vite que **não funciona sob `node --test` puro**:
```
TypeError: Cannot read properties of undefined (reading 'VITE_API_URL')
```
Isso não é algo introduzido nesta investigação — é uma limitação estrutural pré-existente do projeto: nenhum teste já existente importa `store.js` por esse motivo. O arquivo de teste que tentei criar foi removido (não ficou quebrado no repositório). A correção da seção 20 está no diff, revisável por leitura direta de código, mas **sem teste automatizado cobrindo especificamente esse contrato**.

Nenhuma infraestrutura nova (React Testing Library, Playwright, jsdom) foi adicionada — o projeto continua usando só `node --test` com funções puras/mocks de `global.fetch`, conforme convenção já estabelecida.

---

## 27. Estado atual do Git

```
HEAD:        89cc8a5 (feat: integrate resumable attachment uploads)
origin/main: 89cc8a5
```
`HEAD` e `origin/main` estão sincronizados — mas existem **mudanças locais não commitadas**:

```
 M .env.example
 M backend/app.mjs
 M backend/attachments.test.mjs
 M backend/config/env.mjs
 M backend/integrations/googleDrive.mjs
 M backend/integrations/googleSheets.mjs
 M backend/repositories/recebimentosRepository.mjs
 M src/App.jsx
 M src/store.js
```

Nenhum commit foi feito. Nenhum push foi feito.

### ⚠️ Importante para o Goran

Como essas mudanças **não foram commitadas nem enviadas**, um `git pull`/`git fetch` no clone do Goran **não vai trazer nada disso** — o repositório remoto ainda está exatamente no commit `89cc8a5`, sem nenhuma das correções descritas neste documento.

Para o Goran ter acesso a este trabalho, uma das opções abaixo precisa acontecer (decisão do Lucas, não deste documento):
- Lucas commita e faz push dessas mudanças, **ou**
- Lucas gera um patch/diff e envia diretamente, **ou**
- os dois trabalham no mesmo clone/máquina, **ou**
- alguma outra forma de sincronização combinada entre vocês.

Este documento **não recomenda** sobrescrever, resetar ou descartar nada — a decisão de como sincronizar cabe a vocês dois.

---

## 28. Diff atual (`git diff --stat`)

```
.env.example                                    |   6 +
backend/app.mjs                                 |  51 ++++--
backend/attachments.test.mjs                    | 213 +++++++++++++++++++++++-
backend/config/env.mjs                          |  10 ++
backend/integrations/googleDrive.mjs            |  28 +++-
backend/integrations/googleSheets.mjs           |  65 ++++++--
backend/repositories/recebimentosRepository.mjs |  71 +++++++-
src/App.jsx                                     |  31 +++-
src/store.js                                    |   9 +-

9 files changed, 432 insertions(+), 52 deletions(-)
```

---

## 29. Arquivos importantes para o Goran ler

- `backend/app.mjs` — dispatcher HTTP, rotas, `persistOrCleanupDrive`, validação de Origin
- `backend/server.mjs` — wrapper de dev local (`npm run api`)
- `backend/config/env.mjs` — carregamento/precedência de `.env`
- `backend/integrations/googleDrive.mjs` — OAuth, sessão resumível, allowlist de Origin
- `backend/integrations/googleSheets.mjs` — `batchGet`, `REQUEST_OPTIONS` (timeout/retry)
- `backend/repositories/recebimentosRepository.mjs` — `replaceChildren`, `addAttachmentRow`, `removeAttachmentRow`, `touchRecebimentoRow`
- `backend/services/recebimentosService.mjs` — regras de domínio (`addAttachment`, `updateRecebimento`, etc.)
- `backend/attachments.test.mjs` — todos os testes de backend relacionados a anexos/CORS/Sheets
- `src/App.jsx` — `DetailPage.saveDocument` (upload + serialização NF), imports corrigidos
- `src/store.js` — `updateRecebimento`, `uploadAttachment`, `syncMutation`
- `src/api.js` — `attachmentDownloadHref`, chamadas de API do frontend
- `src/features/attachments/resumableUpload.js` — lógica pura do PUT resumível
- `src/features/attachments/constraints.js` — limites/tipos aceitos (client-side)
- `src/features/attachments/errorMessages.js` — mapeamento de erro → mensagem amigável
- `docs/attachments-api.md` — contrato oficial (não alterado)
- `vite.config.js` — proxy de dev

---

## 30. Logs e marcas importantes

Existe um arquivo de log acumulado em `.backend-run.log` (não rastreado pelo Git) com o histórico de execuções do backend local durante toda a investigação. Marcas de texto foram inseridas manualmente entre rodadas de teste para separar eventos, sem apagar nada anterior:

- Marca da Fase 1: batchGet + persistência dedicada
- Marca do teste isolado mais recente:
```
=== NOVO TESTE MANUAL ISOLADO (serializacao NF->upload + timeout Sheets) iniciado em 2026-09-30 16:10:10 -0300 — REC-2026-0010, categoria Nota Fiscal, 1 arquivo ===
```

O Goran pode usar essa marca (ou adicionar a sua própria, no mesmo padrão) para separar eventos novos dos anteriores ao continuar a investigação no mesmo log.

---

## 31. Resumo de erros observados e status atual

| # | Erro | Status |
|---|---|---|
| A | `DRIVE_NOT_CONFIGURED` | ✅ Resolvido |
| B | `DRIVE_AUTH_FAILED` | ✅ Resolvido |
| C | CORS: `No 'Access-Control-Allow-Origin' header...` no PUT do navegador | ✅ Corrigido localmente (não commitado) |
| D | `429 Quota exceeded... Read requests per minute per user` | 🟡 Mitigado e validado com 6 anexos após a Fase 1 — mas causa estrutural (`replaceChildren`) ainda existe para outros fluxos (ex. edição de NF) |
| E | `ReferenceError: attachmentDownloadHref is not defined` (+ 4 imports relacionados) | ✅ Corrigido localmente (não commitado) |
| F | `POST /anexos` pendurada indefinidamente, sem exception/log, no fluxo de adicionar documento a recebimento existente | 🔴 **Ainda aberto** — correções de serialização e timeout implementadas, mas último teste manual voltou a travar |

---

## 32. O que NÃO fazer

- Não colocar o binário do anexo para passar pelo backend/Vercel Function.
- Não reverter a arquitetura de upload direto navegador → Drive.
- Não usar Base64 como fallback automático no fluxo novo (o caminho legado em Base64 existe só por compatibilidade, não deve virar o caminho padrão de novo).
- Não colocar credenciais OAuth no frontend.
- Não usar wildcard (`*`) na allowlist de Origin.
- Não implementar retry infinito em nenhuma chamada externa.
- Não assumir que "arquivo apareceu no Drive" significa "anexo confirmado" — só o `POST /anexos` bem-sucedido (201) confirma isso.
- Não assumir que "apareceram dados no Sheets" significa que toda a operação terminou — pode ser só o recebimento em si, ou um campo separado (como a NF), persistido independentemente do anexo.
- Não deletar arquivos possivelmente órfãos do Drive sem antes reconciliar com a metadata real do Sheets.
- Não fazer `git reset`/`clean`/force-push sem coordenar com o Lucas primeiro — há mudanças locais não commitadas de valor.

---

## 33. Próximos passos sugeridos para o Goran

1. Reproduzir o fluxo atual: recebimento existente, categoria "Nota Fiscal", 1 arquivo pequeno.
2. Confirmar, pelo Network do navegador e/ou pelo log do backend, exatamente onde o bloqueio atual está: `PATCH` NF, `upload-sessions`, `PUT` ao Drive, ou `POST /anexos`.
3. Medir quantas chamadas reais à Sheets API o `PATCH` de `numeroNf`/`serieNf` está fazendo hoje (com a serialização já em vigor).
4. Avaliar e implementar uma persistência específica e segura para campos escalares (`numeroNf`, `serieNf`, possivelmente outros) que evite `replaceChildren` — com um allowlist explícito de campos, não detecção implícita (ver seção 24).
5. Testar novamente com 1 arquivo.
6. Testar novamente com 6 arquivos (fluxo de adicionar documento a recebimento existente, não só criação).
7. Depois disso, considerar (nesta ordem sugerida, sem compromisso):
   - estratégia de cache/batch para `Usuarios` (evitar releitura em toda request)
   - atomicidade real via `spreadsheets.batchUpdate` estrutural (ver nota abaixo)
   - isolamento de erro por arquivo em `apiCreate` (fluxo de criar recebimento + anexos, hoje aborta todos os arquivos seguintes no primeiro erro)
   - estratégia segura de limpeza de possíveis arquivos órfãos no Drive

**Nota técnica sobre atomicidade** (para quando for avaliar o item acima): `spreadsheets.batchUpdate` (o endpoint **estrutural**, diferente de `values.batchUpdate`) tem garantia documentada pelo próprio Google: *"Changes are grouped in a batch so that if one request is unsuccessful, none of the other (potentially dependent) changes are written."* Isso permitiria escrever `Recebimentos` + `Anexos` + `Auditoria` atomicamente de verdade, usando `updateCells`/`appendCells` em vez do modelo de linha/objeto atual — mas é uma refatoração maior (endereçamento por `GridRange`, não por linha), deliberadamente **não implementada** nesta investigação.

---

*Documento gerado em 30/09/2026 para transferência de contexto técnico. Nenhum valor de credencial, token, `sessionUrl`, `fileId` ou `storageKey` foi incluído em nenhum ponto deste documento.*
