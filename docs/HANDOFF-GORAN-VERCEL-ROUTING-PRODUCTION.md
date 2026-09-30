# Handoff técnico — Vercel, Production, Preview e roteamento da API

Estado da investigação em 30/09/2026

> Este documento **complementa** [`HANDOFF-GORAN-ATTACHMENTS-DEBUG.md`](./HANDOFF-GORAN-ATTACHMENTS-DEBUG.md), que contém o histórico completo de Google Drive, OAuth, CORS, quota do Google Sheets, anexos, `batchGet`, persistência específica de anexos, timeout/retry e debugging local. Não o substitui — aquele continua sendo a referência para tudo relacionado a upload/anexos. Ver também [`attachments-api.md`](./attachments-api.md) para o contrato da API.
>
> Este documento aqui foca exclusivamente na investigação de **Vercel / Production / Preview / roteamento da API** que começou com um incidente de 404 em Production em 30/09/2026 e levou à criação da branch `fix/vercel-api-routing`.

## Convenção de evidência

Cada afirmação factual abaixo está marcada com a origem da evidência, porque isso importa para decidir o que investigar vs. o que já está provado:

- **[Git/GitHub API]** — confirmado por comando `git` ou pela GitHub Deployments API, reproduzível por qualquer pessoa com acesso ao repositório.
- **[Código]** — confirmado lendo o código-fonte atual do repositório.
- **[Teste local]** — confirmado rodando o backend localmente nesta máquina.
- **[Dashboard Vercel]** — relatado pelo usuário a partir do painel da Vercel (Runtime Logs, tela de Environment Variables, histórico de deployments). Quem escreveu este documento **não tem acesso a CLI nem a token da Vercel neste ambiente** e não conseguiu ver essas telas diretamente — são repasses fiéis do que o usuário observou.
- **[Hipótese]** — ainda não confirmado; é uma explicação plausível que Goran precisa validar.

---

## 1. Resumo executivo

- Production está conectada corretamente ao Google Sheets **[Git/GitHub API + teste manual]**.
- As rotas simples da API em Production respondem 200 com dados reais.
- Rotas aninhadas (2+ segmentos depois de `/api/v1/`) em Production retornam 404 da própria Vercel, antes de chegar ao backend.
- Isso foi provado comparando o formato da resposta de erro (ver seção 7).
- Foi criada uma branch específica para corrigir o routing: `fix/vercel-api-routing`.
- Commit da correção experimental: `c7bffda` (`c7bffdade4a99e44b78e1eb8f5e0bc2a25eaa48d`).
- Foram criados `api/router.mjs` e `vercel.json`; `backend/app.mjs` foi ajustado para interpretar `?path=` quando o rewrite da Vercel é usado.
- Localmente a correção passou: `npm test` em 90/90, `npm run build` com sucesso **[Teste local, reconfirmado nesta sessão]**.
- O Preview com essa correção deixou de retornar o `NOT_FOUND` de routing e passou a invocar a Function **[Dashboard Vercel — Runtime Log]**.
- Porém o Preview atualmente cai em `500 FUNCTION_INVOCATION_FAILED` porque a Function não recebe `GOOGLE_SHEETS_SPREADSHEET_ID` **[Dashboard Vercel — Runtime Log]**.
- O usuário afirma que as três variáveis do Sheets já foram habilitadas para o ambiente Preview no painel, mas o Runtime Log do Preview mais recente ainda acusa a variável ausente **[Dashboard Vercel, com inconsistência ainda não explicada — ver seção 16]**.
- Portanto o próximo responsável pela Vercel deve investigar o escopo efetivo das Environment Variables e **gerar um novo Preview deployment** antes de tirar qualquer conclusão (ver seção 18 — há uma hipótese técnica concreta de por que isso é necessário, não só prudência).
- **Nenhum Production deploy da correção `c7bffda` deve ser feito antes dessa validação.**

---

## 2. Arquitetura de deploy

- **Frontend**: React + Vite, build via `vite build`. Confirmado nesta sessão: Vite `6.4.3`, build gera `dist/` com os assets esperados (incluindo `zbar-*.wasm` e o worker do `pdf.js`), sem erros — só o aviso conhecido de chunk size (ver seção 25) **[Teste local]**.
- **Production**: `https://allm.vercel.app`.
- **Backend**: Vercel Functions, no mesmo projeto do frontend (não há repositório/projeto separado).
- **API esperada**: tudo sob `/api/v1/*`.
- **Entrada anterior** (removida nesta branch): `api/v1/[...path].mjs` — um catch-all dinâmico do file-system routing da Vercel.
- **Nova entrada experimental** (branch `fix/vercel-api-routing`): `api/router.mjs` — Function de **caminho estático**.
- **Rewrite experimental** (`vercel.json`, novo arquivo, não existia antes):
  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "rewrites": [
      { "source": "/api/v1/:path*", "destination": "/api/router?path=:path*" }
    ]
  }
  ```
- `backend/app.mjs` continua sendo o único responsável pelo roteamento *interno* da API (decidir qual handler atende `recebimentos/:id`, `auth/me`, etc.) — isso não mudou. O que mudou foi só a camada da Vercel que decide se a requisição HTTP chega até essa Function.

---

## 3. Production atual

- SHA conhecido **[Git/GitHub API]**: `cedcb3f6695a86ef719923204e0e4e7ba1e322af`
- Mensagem do commit: `fix: complete attachment uploads reliably`
- Esse commit é do Goran.
- Confirmado via `git log --oneline --decorate --all`: `2f1e9b4` (que contém as correções de imports do frontend — `attachmentDownloadHref`, `friendlyAttachmentError`, `validateAttachmentFile`, `ALLOWED_ATTACHMENT_ACCEPT`, `ALLOWED_IMAGE_ACCEPT`, estado "Finalizando...") é **ancestral direto** de `cedcb3f` — a branch é linear, sem merges, nesse trecho:

  ```
  c7bffda (HEAD -> fix/vercel-api-routing) fix: route /api/v1/* through an explicit vercel.json rewrite
  cedcb3f (origin/main, main) fix: complete attachment uploads reliably
  2f1e9b4 fix: Drive upload CORS, Sheets read quota, and stale imports
  89cc8a5 feat: integrate resumable attachment uploads
  ```

  **Portanto: Production não perdeu as correções de frontend.** O diff do Goran em `cedcb3f` tocou só arquivos de backend (`backend/attachments.test.mjs`, `backend/integrations/googleSheets.mjs`, `backend/repositories/recebimentosRepository.mjs`, `backend/app.mjs`). Não afirme o contrário sem conferir `git show cedcb3f --stat` de novo — hashes podem ter mudado se alguém deu push depois deste documento (ver seção 34).

---

## 4. Testes reais em Production

Testado manualmente em `https://allm.vercel.app`:

| Rota | Resultado |
|---|---|
| `GET /api/v1/catalogos` | 200, JSON real |
| `GET /api/v1/dashboard` | 200, JSON real |
| `GET /api/v1/recebimentos` | 200, dados reais do Google Sheets |

Isso prova:
- a Function existe e é invocada;
- o backend inicializa (passa por `readEnvironment()` sem lançar exceção);
- o Google Sheets funciona;
- `GOOGLE_SHEETS_SPREADSHEET_ID` é válido;
- a Service Account é válida;
- `GOOGLE_PRIVATE_KEY` é válida;
- o ambiente de Production está funcional para Sheets.

---

## 5. Routing quebrado em Production

Rotas aninhadas testadas em `https://allm.vercel.app`:

```
GET /api/v1/recebimentos/REC-2026-0010
GET /api/v1/recebimentos/REC-2026-0011
GET /api/v1/auth/me
GET /api/v1/recebimentos/REC-2026-0010/itens
```

Resultado: **404 da própria Vercel**, formato:

```
The page could not be found
NOT_FOUND
gru1::...
```

Isso **não é** o formato de erro da nossa aplicação, que seria:

```json
{ "error": { "code": "RECEIPT_NOT_FOUND", "message": "..." } }
```

Conclusão: a requisição não chega a `backend/app.mjs`. O erro acontece na camada de roteamento da Vercel, antes de qualquer código nosso rodar.

---

## 6. Prova de que o recebimento existe

`REC-2026-0011` aparecia no retorno de `GET /api/v1/recebimentos` (200, listagem completa) — ou seja, **o recebimento existe no Sheets**.

Mesmo assim, `GET /api/v1/recebimentos/REC-2026-0011` retornava o `NOT_FOUND` da Vercel, não `RECEIPT_NOT_FOUND` da aplicação.

Isso elimina a hipótese de "o recebimento não existe" ou "é um `RECEIPT_NOT_FOUND` legítimo da aplicação". O mesmo padrão acontecia com recebimentos antigos e conhecidos, não só os criados durante o incidente.

---

## 7. Padrão do bug

Diagnóstico comportamental (baseado em testes HTTP diretos, não em inspeção de código da Vercel):

| Segmentos depois de `/api/v1/` | Resultado |
|---|---|
| 1 (`/catalogos`, `/dashboard`, `/recebimentos`, `/usuarios`) | Funciona |
| 2+ (`/auth/me`, `/recebimentos/:id`, `/recebimentos/:id/itens`) | 404 da Vercel |

**Importante**: não foi possível inspecionar o route manifest interno da Vercel nesta máquina (sem CLI/token). A frase "`api/v1/[...path].mjs` só estava casando exatamente um segmento" é uma **conclusão comportamental** baseada em testes de caixa-preta, não uma confirmação de como a Vercel compilou a rota internamente. Se Goran tiver acesso a mais ferramentas de diagnóstico da Vercel (CLI, suporte, etc.), vale revisitar a causa raiz — não é urgente, porque o contorno (seção 8) não depende de entender a causa exata.

---

## 8. Branch de correção

- Branch: `fix/vercel-api-routing` **[Git]**
- Commit: `c7bffda` (`c7bffdade4a99e44b78e1eb8f5e0bc2a25eaa48d`)
- Criada exclusivamente para testar a correção antes de Production.
- **Não está em `main`** no momento deste handoff — confirmado via `git branch -a --contains c7bffda`, que só lista `fix/vercel-api-routing` e seu remoto.

---

## 9. Alterações da branch

**Removido:**
- `api/v1/[...path].mjs` (e o diretório `api/v1/`, que ficou vazio)

**Criado:**
- `api/router.mjs` — mesmo papel do arquivo removido: expõe `createApp()` de `backend/app.mjs` como uma Vercel Function. Memoiza `createApp()` no escopo do módulo para reaproveitar o client do Google Sheets/Drive entre invocações "quentes".
- `vercel.json` — rewrite `/api/v1/:path*` → `/api/router?path=:path*` (conteúdo completo na seção 2).

**Alterado:**
- `backend/app.mjs`, função `routeParts()`:
  1. verifica se existe o query param `path`;
  2. se presente, usa esse valor para decidir a rota (`fromQuery.split('/').filter(Boolean)`);
  3. se ausente, cai de volta no comportamento antigo — `pathname` normal.

  Isso preserva o dev local (o proxy do Vite chama o backend direto, sem rewrite, então nunca existe `?path=`) e ao mesmo tempo atende o rewrite da Vercel em produção. O guard de "rota não encontrada" no topo de `handle()` também foi ajustado para não depender de `url.pathname` quando `path` está presente na query string.

  Nenhuma outra lógica de `backend/app.mjs` foi tocada — as adições do Goran (`isNfOnlyPatch`, `persistOrCleanupDrive`, `onPersistenceUnknown`, `updateNfFields`) continuam exatamente como estavam em `cedcb3f`.

---

## 10. Validação local da correção

Antes do push, testado localmente **[Teste local]**:
- formato antigo por `pathname` (dev local via proxy Vite) — sem regressão;
- formato novo simulando `?path=...` diretamente contra o backend local;
- rota com vários segmentos (`recebimentos/:id/itens`) via `?path=`;
- `?path=` combinado com outros query params já existentes (ex.: `?path=recebimentos&status=...`) — confirmado que o filtro `status` continuou funcionando normalmente, ou seja, o novo parâmetro não atropela os demais.

Resultado: funcionou localmente em todos os casos.

```
npm test   → 90/90
npm run build → sucesso
```

Ambos **reconfirmados nesta sessão**, na branch `fix/vercel-api-routing`, sem mudanças desde o commit `c7bffda`:

```
ℹ tests 90
ℹ pass 90
ℹ fail 0
```

`npm run build` gerou `dist/` normalmente com Vite 6.4.3 (ver aviso de chunk size na seção 25).

---

## 11. Preview deployment

- URL **[Git/GitHub API]**: `https://alm-5x7bsh3qb-lucasizaias.vercel.app`
- Branch: `fix/vercel-api-routing`
- Commit: `c7bffda`
- Deployment id (GitHub Deployments API): `6771973564`, status `success`, criado em `2026-09-30T22:57:23Z`.

O Preview está protegido pelo **Deployment Protection** da Vercel (SSO). Tentativa de acesso via `curl` retornou `302` para `vercel.com/sso-api?...` com um cookie `_vercel_sso_nonce` — **isso não é bug da aplicação**, é a proteção de acesso da própria Vercel para deployments de Preview. Quem escreveu este handoff não tem sessão autenticada na Vercel neste ambiente e não conseguiu contornar isso via linha de comando.

O usuário conseguiu acessar o Preview pelo navegador, já autenticado na Vercel.

---

## 12. Mudança de comportamento no Preview

**Antes** da correção: rotas aninhadas → `NOT_FOUND` da Vercel (mesmo padrão de Production, seção 7).

**Depois** da branch de routing: as requisições passaram a executar `api/router.mjs` — confirmado pelo Runtime Log **[Dashboard Vercel]**. Isto é, a parte de roteamento da Vercel (rewrite) está funcionando: o `NOT_FOUND` de plataforma nessa etapa desapareceu.

Porém, **todas** as rotas testadas no Preview atualmente retornam `500 FUNCTION_INVOCATION_FAILED`, incluindo:

```
/api/v1/catalogos
/api/v1/recebimentos
/api/v1/recebimentos/REC-2026-0010
/api/v1/auth/me
```

Note que isso inclui até `/api/v1/catalogos`, que é de 1 segmento só — ou seja, este erro **não é** o bug de routing original. É uma causa diferente (seção 13).

---

## 13. Runtime Log definitivo do Preview

**[Dashboard Vercel — relatado pelo usuário, sanitizado abaixo]**

```
Error: Variável de ambiente obrigatória ausente: GOOGLE_SHEETS_SPREADSHEET_ID.

Stack relevante:
required
  → readEnvironment
  → createApp
  → api/router.mjs

environment: preview
branch: fix/vercel-api-routing
status: 500
```

Também apareceram no log:

```
injected env (0) from .env
injected env (0) from backend/.env
```

Essas duas linhas são do `dotenv` tentando ler arquivos `.env` locais (`loadProjectEnvironment()` em `backend/config/env.mjs`) — que **não existem** no filesystem do deployment serverless (são `.gitignore`d, só existem nesta máquina local). Isso é esperado e **não significa, sozinho**, "a Vercel injetou zero variáveis de ambiente" — são domínios diferentes: o `dotenv` só reporta sobre os arquivos `.env`, não sobre `process.env` já populado pela plataforma.

A evidência que realmente importa é a mensagem de erro: **`process.env` não contém `GOOGLE_SHEETS_SPREADSHEET_ID` no momento em que a Function do Preview foi invocada.**

---

## 14. Estado das Environment Variables

**Production** recebeu manualmente (via painel):
```
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN
DRIVE_UPLOAD_ALLOWED_ORIGINS
```
Production funciona nas rotas simples (seção 4), o que confirma que essas variáveis estão corretas para o ambiente Production.

`VITE_API_URL`: **não deve ser usada** na arquitetura atual (frontend e backend vivem no mesmo domínio/projeto; não há necessidade de apontar para uma URL de API separada).

O usuário afirma que as 3 variáveis do Sheets também já foram habilitadas para o ambiente **Preview** no painel. Apesar disso, o Runtime Log do Preview (seção 13) ainda acusa `GOOGLE_SHEETS_SPREADSHEET_ID` ausente.

**Existe uma inconsistência entre "configuração percebida no painel" e "env efetivamente disponível no deployment Preview que rodou". Não inventar a causa aqui** — mas há uma hipótese concreta, verificável em poucos minutos:

> **[Hipótese, a confirmar]**: a Vercel resolve e "grava" as environment variables de um deployment **no momento do build/deploy**, não em tempo real. Se a variável foi marcada para o ambiente Preview **depois** que o deployment `6771973564` (22:57:23Z) já tinha sido criado, esse deployment específico nunca teria a variável — mesmo que o painel mostre "Preview" marcado agora. Isso também seria consistente com o padrão observado em Production (seção 20): lá, várias reimplantações manuais aconteceram depois do primeiro deploy do commit `cedcb3f`, no mesmo intervalo de tempo em que o usuário mexia nas envs — sugerindo que o usuário já topou com esse mesmo comportamento (precisar reimplantar para uma env nova "pegar") sem necessariamente ter associado as duas coisas.
>
> Se for isso, a solução não é mexer em código nem em escopo de novo — é **criar um novo deployment de Preview depois de confirmar o escopo**, exatamente como a seção 16 abaixo já pede.

Goran deve conferir diretamente no painel (ordem exata na seção 16) para confirmar ou descartar essa hipótese, não assumir que está certa.

---

## 15. O que o Goran deve checar na Vercel

Seção operacional. Projeto: `alm`.

Em **Settings → Environment Variables**, para cada uma de:
```
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
```
confirmar:
- [ ] o Environment inclui **Preview** (não só Production);
- [ ] não existe restrição incorreta de branch — se a Vercel oferecer "Preview Branches" com uma lista específica, essa lista precisa incluir `fix/vercel-api-routing` (ou estar configurada como "all branches");
- [ ] a variável está no **Project** correto (`alm`) — checar se não há projetos duplicados/antigos na conta;
- [ ] a variável está de fato **salva** (às vezes o painel mostra o campo preenchido mas não persiste sem um submit/save explícito);
- [ ] não existe outra variável com o mesmo nome duplicada ou conflitante em outro escopo.

**Não mostrar valores** em nenhum print, log ou mensagem compartilhada.

---

## 16. Novo Preview obrigatório

Depois de confirmar a env (seção 15): **não reutilizar a conclusão baseada no deployment antigo** (`6771973564`, 22:57:23Z). Pelo motivo técnico da seção 14 (hipótese de timing de build), o ideal é:

1. Criar/redeployar um novo Preview a partir de `fix/vercel-api-routing`.
2. Confirmar no próprio deployment criado:
   - Environment: `Preview`
   - Branch: `fix/vercel-api-routing`
   - Commit: `c7bffda`, ou um commit posterior que seja exclusivamente dessa correção de routing (nenhuma lógica de negócio).
3. Registrar: novo deployment ID, nova URL, horário — para este handoff poder ser atualizado depois.

---

## 17. Ordem dos testes do novo Preview

Sempre GET, somente leitura, nesta ordem:

1. `GET /api/v1/catalogos` → esperado `200`.
2. `GET /api/v1/recebimentos` → esperado `200`.
3. **Teste decisivo**: `GET /api/v1/recebimentos/REC-2026-0010` → esperado `200` e JSON da aplicação. **Não pode** retornar `NOT_FOUND` da Vercel.
4. `GET /api/v1/auth/me` → esperado resposta da aplicação — pode ser `200`, `401` ou `403` dependendo do header/usuário (isso é aceitável). **Não pode** ser `NOT_FOUND` da Vercel nem `FUNCTION_INVOCATION_FAILED`.

---

## 18. Teste de rota profunda

Depois dos 4 testes acima: testar uma rota com 4+ segmentos, **sem causar escrita** — por exemplo, um download de anexo inexistente (`/api/v1/recebimentos/:id/anexos/ANX-INEXISTENTE/download`) ou outro endpoint somente leitura equivalente.

Objetivo: receber um erro JSON da aplicação, como `ATTACHMENT_NOT_FOUND` — e **não** o `NOT_FOUND` da Vercel.

Isso prova que `/api/v1/:path*` realmente captura caminhos profundos, não só 2 níveis.

---

## 19. Não testar upload ainda

Até routing + Sheets estarem comprovados no Preview (seções 17 e 18 passando limpo):

- não adicionar OAuth ao Preview só por ansiedade;
- não criar recebimento;
- não fazer upload;
- não fazer PATCH;
- não fazer DELETE;
- não escrever no Sheets.

Só GET / somente leitura por enquanto.

---

## 20. Drive no Preview

Depois que o routing estiver funcionando: se Goran quiser testar upload pelo Preview, aí sim serão necessárias `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, e `DRIVE_UPLOAD_ALLOWED_ORIGINS` precisará incluir o domínio **exato** usado pelo Preview (a URL de Preview muda a cada deployment — ver `backend/integrations/googleDrive.mjs` / `parseOriginAllowlist` em `backend/config/env.mjs`). **Não usar wildcard `*`** nessa variável. Isso é etapa posterior, fora do escopo deste handoff.

---

## 21. Production não deve ser alterada ainda

Não promover `c7bffda` (merge em `main` + deploy) antes de, no novo Preview:
- [ ] a Function inicializar sem `FUNCTION_INVOCATION_FAILED`;
- [ ] `catalogos` → 200;
- [ ] `recebimentos` → 200;
- [ ] `recebimentos/:id` → chega ao backend (200 ou erro da aplicação, nunca NOT_FOUND da Vercel);
- [ ] `auth/me` → chega ao backend;
- [ ] rota profunda → chega ao backend;
- [ ] `npm test` → 90/90 (ou mais, se Goran adicionar testes);
- [ ] `npm run build` → sucesso.

---

## 22. Redeploys de Production observados durante a investigação

Durante a investigação, Production (`cedcb3f`, o mesmo commit, **sem alteração de código**) foi **reimplantado pelo menos 5 vezes** — confirmado via GitHub Deployments API (`gh api repos/:owner/:repo/deployments/6768565380/statuses`), cada status com uma `environment_url` de build diferente mas o mesmo deployment/commit:

| Horário (UTC) | URL do build |
|---|---|
| 2026-09-30T19:44:34Z | `alm-nf9xz7v3y-lucasizaias.vercel.app` |
| 2026-09-30T22:31:25Z | `alm-33fulaoks-lucasizaias.vercel.app` |
| 2026-09-30T22:36:07Z | `alm-1a7j4uvq7-lucasizaias.vercel.app` |
| 2026-09-30T23:12:58Z | `alm-m8g4jedgq-lucasizaias.vercel.app` |
| 2026-09-30T23:28:41Z (mais recente) | `alm-6cmxk3s37-lucasizaias.vercel.app` |

Isso é consistente com o usuário clicando "Redeploy" no painel repetidamente enquanto ajustava Environment Variables de Production. **Nenhum desses redeploys contém a correção `fix/vercel-api-routing`/`c7bffda`** — todos são o mesmo código de `cedcb3f`. Portanto nenhum deles serve para validar o novo routing; servem só para "Production está rodando a env mais recente configurada no painel, sobre o código antigo".

Não houve perda de código por causa disso — Production continua, em termos de código, exatamente no SHA `cedcb3f` conhecido. O único efeito de múltiplos redeploys é: cada rebuild recaptura o valor **atual** das env vars de Production naquele instante (ver a hipótese da seção 14 sobre por que isso importa para o caso do Preview).

---

## 23. Warnings do build

Vistos durante `npm run build` / `npm install`:
- `node-domexception` deprecated;
- avisos de `install-scripts` relacionados a `esbuild` e `tesseract.js`;
- Vite: aviso de chunk size (`NfeReaderPage-*.js` em ~1MB, `pdf.worker.min-*.mjs` em ~1.26MB).

Esses warnings não impediram o build (confirmado novamente nesta sessão — build terminou com `✓ built in 7.38s`). Não há evidência de relação entre eles e o routing ou o `FUNCTION_INVOCATION_FAILED`. Não gastar tempo neles agora.

---

## 24. Frontend em Production

As telas Visão geral, Recebimentos e Pendências chegaram a ficar vazias durante o incidente original — mas as APIs simples (`catalogos`, `dashboard`, `recebimentos`) retornavam dados (200). **Não assumir que é o mesmo problema do routing sem reproduzir depois da correção.**

Hipótese mais provável: a tela de detalhe (`DetailPage` ou equivalente) depende de `GET /api/v1/recebimentos/:id`, que estava quebrado (seção 5) — isso explicaria uma tela de detalhe vazia, mas não necessariamente as telas de **lista**, que usam endpoints de 1 segmento (já funcionando). Se as listas também ficaram vazias, pode ser uma causa frontend separada (ex.: um erro em cascata no React por causa de uma chamada que falhou, ou um problema de import — ver o handoff de anexos para o histórico de bugs de import já corrigidos em `2f1e9b4`).

Depois do routing corrigido e validado no Preview: fazer hard refresh em Production e validar o frontend separadamente, comparando contra este handoff antes de reimplementar qualquer coisa.

---

## 25. Dados criados durante os testes

Foram criados os recebimentos `REC-2026-0011` e `REC-2026-0012` durante a investigação do incidente original. Eles aparecem no Sheets/listagem normalmente.

- Não criar novamente.
- Não apagar manualmente.
- Não modificar só para "limpar".

Usar somente GET/leitura durante o debug de routing.

---

## 26. Relação com o handoff de anexos

Antes desta fase já existia um handoff extenso (`HANDOFF-GORAN-ATTACHMENTS-DEBUG.md`) cobrindo OAuth, Drive, CORS, `sessionUrl`, quota do Sheets, `batchGet`, `addAttachmentRow`, `removeAttachmentRow`, timeout/retry, requisições presas, serialização NF → upload, e possíveis arquivos órfãos no Drive.

Esse histórico continua válido — nada dele foi invalidado por esta investigação. O problema atual de routing da Vercel acontece **antes** de todas essas camadas: se a requisição não chega em `backend/app.mjs`, nenhuma dessas lógicas chega a rodar.

---

## 27. O que está confirmado

| Item | Status |
|---|---|
| Production Sheets funciona | ✅ Confirmado |
| Production rotas simples funcionam | ✅ Confirmado |
| Production rotas aninhadas recebem `NOT_FOUND` da Vercel | ✅ Confirmado |
| `REC-2026-0011` existe no Sheets | ✅ Confirmado |
| Branch de routing (`fix/vercel-api-routing`) foi criada e empurrada para `origin` | ✅ Confirmado |
| O novo rewrite chega em `api/router.mjs` no Preview (o `NOT_FOUND` de plataforma desaparece) | ✅ Confirmado (Runtime Log) |
| A Function do Preview atualmente morre por env ausente | ✅ Confirmado (Runtime Log) |
| Runtime Log aponta especificamente `GOOGLE_SHEETS_SPREADSHEET_ID` | ✅ Confirmado (Runtime Log) |
| Production não está rodando `c7bffda` | ✅ Confirmado (Git + GitHub Deployments API) |
| Nenhum Production deploy da correção de routing foi feito | ✅ Confirmado (GitHub Deployments API) |
| Production foi reimplantado 5x no mesmo commit (`cedcb3f`) durante a investigação | ✅ Confirmado (GitHub Deployments API) |
| `2f1e9b4` (correções de frontend) é ancestral de `cedcb3f` | ✅ Confirmado (Git) |

## 28. O que ainda não está confirmado

- Por que o Preview não recebe a env apesar do usuário afirmar tê-la habilitado para Preview (hipótese na seção 14: timing de build — precisa de novo deployment para confirmar ou descartar).
- Se o rewrite de `c7bffda` funciona **completamente** na Vercel quando a Function consegue inicializar (os testes A–D da seção 17 e o teste de rota profunda da seção 18 ainda não rodaram com sucesso).
- Se GET profundo (4+ segmentos) retorna corretamente depois que a env existir.
- Se POST/PATCH/DELETE são preservados pelo rewrite (só foi validado GET até agora, tanto localmente quanto a intenção de teste em Preview).
- Se upload funciona via Preview (fora de escopo até routing+Sheets estarem provados — seção 19).
- Se Production ficará de fato resolvida depois do merge (só saberemos depois de repetir os testes em Production pós-deploy).

---

## 29. Riscos

Habilitar as envs do Sheets em Preview permite que qualquer deployment de Preview acesse a **planilha real** de produção — não existe uma planilha de staging separada neste projeto. Mesmo que o plano seja só fazer GETs, as credenciais tecnicamente permitem escrita pelas rotas normais da aplicação (a Service Account não tem uma permissão "somente leitura" configurada à parte).

Ideal futuro: uma planilha de staging separada para Preview. Por enquanto: não executar endpoints mutáveis (POST/PATCH/DELETE) durante os testes iniciais de routing.

---

## 30. O que não fazer

- Não mexer novamente nas credenciais de Production sem evidência de que é necessário.
- Não alterar o Google Sheets manualmente.
- Não alterar OAuth por causa do routing (são camadas independentes).
- Não mexer no scanner de NF-e.
- Não mexer no frontend antes de provar a API.
- Não fazer rollback aleatório.
- Não promover o routing para Production sem validar no Preview primeiro.
- Não desativar o Deployment Protection sem necessidade real.
- Não usar token de bypass de proteção compartilhado em chat/mensagem.
- Não usar wildcard (`*`) em `DRIVE_UPLOAD_ALLOWED_ORIGINS`.
- Não recriar os recebimentos de teste já existentes (`REC-2026-0011`, `REC-2026-0012`).
- Não fazer force push nem reset em `main`.

---

## 31. Ordem recomendada para o Goran

1. Assumir acesso ao projeto `alm` na Vercel.
2. Rodar os comandos da seção 32 para confirmar o estado atual do Git antes de tocar em qualquer coisa.
3. Inspecionar as envs de Preview (seção 15).
4. Resolver a ausência de `GOOGLE_SHEETS_SPREADSHEET_ID` no runtime do Preview (seção 16 — provavelmente só precisa de um novo deployment, ver hipótese da seção 14).
5. Reimplantar `fix/vercel-api-routing` (novo Preview deployment).
6. Testar `/catalogos` (esperado 200).
7. Testar `/recebimentos` (esperado 200).
8. Testar `/recebimentos/REC-2026-0010` (teste decisivo — esperado 200 + JSON da aplicação).
9. Testar `/auth/me` (esperado resposta da aplicação, qualquer status).
10. Testar uma rota profunda somente leitura (esperado erro JSON da aplicação).
11. Confirmar que não existe mais `NOT_FOUND` de plataforma em nenhum dos testes acima.
12. Confirmar que não existe mais `FUNCTION_INVOCATION_FAILED`.
13. Validar `npm test` (90/90 ou mais).
14. Validar `npm run build`.
15. Revisar o diff completo da branch (`git diff main...fix/vercel-api-routing`).
16. Só então decidir merge para `main`.
17. Depois do merge, Production deploy.
18. Repetir os testes de rotas simples + profundas em Production.
19. Só depois retomar o trabalho de anexos/upload (handoff separado).

---

## 32. Estado de Git

Registrado neste handoff **[Git]**:
- `main` (Production conhecido): `cedcb3f`
- Branch da correção de routing: `fix/vercel-api-routing`
- Commit da correção de routing: `c7bffda`

**Antes de trabalhar, rodar:**
```bash
git fetch origin
git status
git log --oneline --decorate -10
git branch -a --contains c7bffda
```

**Não presumir que estes hashes continuam sendo `HEAD`** se houver commits novos depois da geração deste documento — confirme sempre com os comandos acima.

---

## 33. Segurança

**Nunca** colocar neste documento (nem em nenhum outro artefato compartilhado):
- `GOOGLE_PRIVATE_KEY` ou qualquer material privado de Service Account;
- OAuth Client Secret;
- OAuth Refresh Token;
- `sessionUrl` de upload resumível;
- access tokens;
- Drive `fileId`;
- `storageKey`.

Pode citar **nomes** das variáveis à vontade. Nunca copiar **valores**.

---

## 34. Status do routing — frase de referência

Não podemos dizer ainda: *"o routing fix está 100% funcionando."*

Podemos dizer: **"o novo routing avançou o request até `api/router.mjs`, eliminando o `NOT_FOUND` da Vercel nessa etapa do Preview; a validação funcional completa está bloqueada pela ausência da env do Sheets no runtime do Preview."**

Essa distinção importa: o problema de roteamento em si parece resolvido (na parte que já foi possível observar); o que falta é confirmar o resto da cadeia (Sheets → rotas aninhadas → verbos → rota profunda) com a env correta no Preview.

---

## Anexo — comandos usados para gerar a evidência deste documento

Para reprodutibilidade, os comandos abaixo (todos somente leitura) foram usados para confirmar os itens marcados **[Git/GitHub API]**:

```bash
git status --short --branch
git log --oneline --decorate -10 --all
git branch -a --contains c7bffda
gh api repos/:owner/:repo/deployments --jq '.[] | {id, sha, ref, environment, created_at}'
gh api repos/:owner/:repo/deployments/<id>/statuses --jq '.[] | {state, environment_url, description, created_at}'
```
