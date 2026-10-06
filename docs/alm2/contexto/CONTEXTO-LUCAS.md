# Contexto de trabalho: Lucas (frontend, scanner e produto)

**Data:** 06/10/2026 · **Base:** `fix/vercel-api-routing` em `48b1583` e `main` em `780062a` · **Fonte:** `docs/alm2/` (README e partes 01 a 08)

**Atenção:** estes caminhos **ainda não existem** no repositório; foram definidos pela especificação e serão criados pelo dono indicado: `backend/auth/`, `backend/db/`, `backend/jobs/`, `supabase/`, `shared/domain.mjs`, `docs/openapi.yaml`, `tests/`, `.github/`, `scripts/alm-*.mjs`, `scripts/smoke-*.mjs`, `scripts/migrate-*.mjs`, `src/api/errorMessages.js` e as pastas novas de `src/features/`. Todo o resto citado existe hoje.

Este arquivo diz **quais arquivos são seus, quais não são e quando você precisa avisar alguém antes de editar**. Use-o como contexto no início de qualquer sessão de trabalho, sua ou de uma IA.

## 0. Regra de ouro e instruções para a IA

> **Se você precisar editar um arquivo que NÃO é seu (🔴) ou uma zona compartilhada (⚠️): pare. Mande mensagem ao dono ANTES de editar** (modelo na seção 8). Se a zona tem ⏸, **espere o OK** do dono. Faça a menor mudança possível, em PR separado, com o dono como revisor, e avise de novo quando mergear.

Cole este bloco no início da sessão com a sua IA:

```
Você é o assistente do Lucas no projeto ALM. Antes de editar qualquer arquivo, consulte as
seções 3, 4 e 5 do CONTEXTO-LUCAS.md:
- 🟢 arquivo do Lucas: pode editar.
- 🔴 arquivo de outro dono: NÃO edite. Diga ao Lucas a quem pedir e redija a mensagem.
- ⚠️ zona compartilhada: pare, redija o aviso (modelo da seção 8) e espere o Lucas confirmar
  que o dono foi avisado. Se tiver ⏸, espere também o OK do dono.
Ao terminar, liste os arquivos alterados agrupados em 🟢, ⚠️ e 🔴.
Nunca abra, leia ou imprima .env nem backend/.env. Nunca faça commit nem push sem pedido
explícito. Nenhuma regra de negócio nova no cliente: o servidor manda.
```

Leitura obrigatória: `docs/alm2/README.md`, **parte 06** (você é o dono), parte 01 (decisões), parte 03 seções 5 e 8 (contrato de login e permissões que você consome), parte 04 seções 7 e 8 (busca e contrato da API), parte 05 seção 2.6 (exportação).

## 1. Sua frente

Frontend, UX, scanner e produto. Decisões em que você é dono ou co-dono: **D15** (UI da Portaria), **D16** (frontend com o servidor como autoridade), **D14** (UI de busca e filtros). Spike seu: **S6** (login e Portaria em tablet real). Perguntas à empresa que você leva: Q2, Q7, Q9, Q12.

Você **não** é dono de: hash de PIN, sessão, RLS, migrations, OAuth do Drive, jobs, espelho do Sheets.

## 2. Mapa geral de donos (igual nos 3 arquivos)

Legenda: **Dono** edita livremente; os demais **não editam** e pedem ao dono. ⚠️ = zona de contato: quem precisar mexer **avisa o dono ANTES**. ⏸ = além de avisar, **espera o OK** do dono. "(a criar)" = o arquivo ainda não existe.

| Caminho | Dono | Regra para os outros |
|---|---|---|
| `src/**` (tudo, exceto `src/data.js`) | Lucas | Não editar. Pedir ao Lucas |
| `src/data.js` ⚠️⏸ | Lucas | O backend importa dele (`backend/app.mjs:2`, `backend/services/recebimentosService.mjs:2`): `DEMO_USERS`, `RECEBIMENTO_STATUS`, `STATUS_TRANSITIONS`, `ROLE_STATUS_PERMISSIONS`, `STATUS_OPTIONS`, `DOCUMENT_TYPE_OPTIONS`, `UNIT_OPTIONS`, `RECEIPT_TYPE_OPTIONS`, `SUPPLIER_OPTIONS`, `DIVERGENCE_TYPE_OPTIONS`. O Lucas avisa o Goran (e o Kobner, se envolver perfil ou permissão) antes de renomear, remover ou mudar a forma de qualquer um. Goran e Kobner não editam o arquivo |
| `src/api.js` ⚠️ | Lucas | Só o Lucas edita. Quem muda o contrato da API (rotas, payload, códigos de erro, headers, cookies) avisa o Lucas antes de mergear: Goran (recursos) e Kobner (`/auth/*`) |
| `src/features/nfeReader/**` | Lucas | Exclusivo (scanner). Ninguém mais edita |
| `index.html`, `vite.config.js`, `public/**` ⚠️ | Lucas | `index.html` tem script inline de tema e a CSP (cabeçalhos) depende dele: mudar a CSP ou o script exige acordo Lucas + Kobner + Goran. `vite.config.js` faz proxy de `/api` para `localhost:3001`: se o Goran mudar a porta do backend, avisa o Lucas |
| `scripts/copy-vendor-assets.mjs` ⚠️ | Lucas | É o `postinstall`: roda no `npm install` de todos. Avisar todos antes de mudar |
| `backend/app.mjs`, `backend/server.mjs` ⚠️⏸ | Goran | O Kobner precisa ligar a autenticação (`requestUser` em `app.mjs:75` e rotas `/auth/*`). O Kobner entrega o módulo `backend/auth/` e o Goran liga. Se o Kobner precisar editar o arquivo: avisar e esperar OK |
| `backend/services/**` ⚠️⏸ | Goran | `permissions()`, `isAdmin`, `canWrite`, `actor` (`recebimentosService.mjs:6-16`) são RBAC: o Kobner define a regra em `backend/auth/permissions.mjs` e o Goran troca as chamadas. Kobner não edita |
| `backend/repositories/**` | Goran | O Kobner revisa o SQL (revisão cruzada), não edita |
| `backend/integrations/**`, `backend/attachments.mjs`, `backend/config/env.mjs` | Goran | Não editar. Variáveis de auth ficam em `backend/auth/config.mjs` (Kobner), para não tocar `env.mjs` |
| `backend/db/**`, `backend/jobs/**` (a criar) | Goran | O Kobner usa `withActor` (`backend/db/tx.mjs`) em `backend/auth/`; não edita |
| `backend/auth/**` (a criar) | Kobner | O Goran importa, não edita |
| `supabase/**` (a criar), `docs/alm2/sql/**` | Kobner | Exclusivo. Mudança de schema pedida pelo Goran: mensagem com a necessidade exata (tabela, coluna, índice). **Ninguém além do Kobner aplica DDL** em staging ou produção. Migration já aplicada nunca é editada: cria-se outra |
| `api/router.mjs`, `vercel.json` ⚠️⏸ | Goran | Já quebrou produção uma vez (routing). Crons: Goran. Cabeçalhos de segurança e CSP: Kobner propõe, Lucas confirma que o frontend suporta, Goran aplica |
| `package.json`, `package-lock.json`, `backend/package*.json` ⚠️ | Compartilhado | Qualquer mudança de dependência: avisar todos antes, 1 dependência por PR, lockfile só via `npm install` (nunca à mão). `scripts.test` é do Marcelo |
| `.env.example` ⚠️ | Compartilhado | Só nomes, nunca valores. Cada um edita a sua seção. Avisar ao criar variável nova (todos precisam configurar local e Vercel) |
| `.github/**`, `eslint.config.*`, `tests/**`, `scripts/smoke-*.mjs` (a criar) | Marcelo (com Kobner) | Regra de lint ou CI que possa quebrar `src/` ou `backend/`: avisar Lucas e Goran e começar como *warning* |
| `backend/*.test.mjs` | Goran | O Marcelo pode **acrescentar** arquivos de teste; não altera os existentes sem avisar |
| `src/**/*.test.mjs`, `validate-*.mjs` | Lucas | Idem |
| `scripts/google-drive-oauth-setup.mjs`, `scripts/migrate-*.mjs` (a criar) | Goran | |
| `scripts/alm-create-admin.mjs`, `scripts/alm-import-usuarios.mjs` (a criar) | Kobner | |
| `shared/domain.mjs` (a criar; tira as constantes de `src/data.js`) ⚠️⏸ | Goran cria, Lucas aprova | Mudança coordenada Goran + Lucas; o Kobner opina sobre perfis e permissões |
| `docs/openapi.yaml` (a criar) | Goran | O Marcelo valida no CI; Lucas e Kobner conferem o que consomem |
| `docs/alm2/**` | Por parte (README da pasta) | Decisão D## só muda com acordo da equipe |
| `docs/attachments-api.md`, `docs/HANDOFF-GORAN-*` | Goran | |
| `docs/HANDOFF-LUCAS-*`, `docs/ALM_Apresentacao_*`, `promptV1.md`, `promptV2.md` | Lucas | |
| `ARQUITETURA_TECNICA_ALM.md` ⏸ | Congelado | Ninguém edita sem acordo da equipe |
| `README.md` (raiz) ⚠️ | Compartilhado | Cada um edita só a seção da própria área |
| Branches `main` e `fix/vercel-api-routing` ⏸ | Goran + Marcelo | Divergiram. Ninguém abre feature nova até o merge e o Preview validado (decisão D18, spike S7) |

## 3. 🟢 Seus arquivos (você edita livremente)

**Já existem:**

- `src/App.jsx`, `src/store.js`, `src/api.js`, `src/ui.jsx`, `src/theme.jsx`, `src/main.jsx`, `src/styles.css`
- `src/layout/**` (Sidebar, MobileHeader, MobileNav, navigation)
- `src/components/**` (dashboard, recebimentos, shared)
- `src/features/attachments/**`
- `src/features/nfeReader/**` (inclui `testFixtures/`, `decoders/`, README e os `validate-*.mjs`)
- `src/data.js` (⚠️⏸ ver seção 5)
- `index.html`, `vite.config.js`, `public/**`, `scripts/copy-vendor-assets.mjs` (⚠️ ver seção 5)
- Testes: `src/**/*.test.mjs`
- Docs: `docs/HANDOFF-LUCAS-*`, `docs/ALM_Apresentacao_*`, `docs/alm2/06-frontend-scanner-notificacoes.md`, `promptV1.md`, `promptV2.md`

**A criar (suas):**

- `src/features/auth/` (`AuthProvider`, `LoginPage`, `PinPad`, `ChangePinPage`, `usePermissions`)
- `src/features/portaria/` (início, revisão, resultado, lista de chegadas)
- `src/features/admin/` (usuários, auditoria, excluídos, integrações)
- `src/features/search/` (filtros, filtros salvos, autocomplete)
- `src/features/export/`, `src/features/notifications/`
- `src/api/errorMessages.js` (mensagem por código de erro, para toda a API)

## 4. 🔴 Não mexa (peça ao dono)

| Área | Dono | Como pedir |
|---|---|---|
| `backend/**` (exceto `backend/auth/**`), `api/**`, `vercel.json`, `docs/attachments-api.md`, `docs/openapi.yaml` | Goran | Mensagem descrevendo o comportamento que a tela precisa (rota, campo, erro) |
| `backend/auth/**`, `supabase/**`, `docs/alm2/sql/**`, `docs/alm2/03-*` | Kobner | Mensagem com o que a tela precisa do login ou do `permissoes` |
| `.github/**`, `eslint.config.*`, `tests/**`, `scripts/smoke-*.mjs` | Marcelo (com Kobner) | Mensagem com o fluxo a cobrir |
| `ARQUITETURA_TECNICA_ALM.md` | Congelado | Combinar com a equipe |

## 5. ⚠️ Zonas de contato (avisar antes de mexer)

| Arquivo | Por quê | Quem avisar | Como |
|---|---|---|---|
| `src/data.js` ⏸ | O backend importa 10 nomes dele (lista na seção 2) | **Goran** (e **Kobner** se for perfil ou permissão) | Antes de renomear, remover ou mudar a forma de `DEMO_USERS`, `RECEBIMENTO_STATUS`, `STATUS_TRANSITIONS`, `ROLE_STATUS_PERMISSIONS`, catálogos. Adicionar um export novo não exige aviso. A correção do `csvCell` (linha 499) não mexe nesses nomes |
| `src/api.js` | O contrato vem de outros | Você **recebe** o aviso | Se mudar o jeito de chamar a API (ex.: `If-Match`, cookies), confira antes o contrato em `docs/openapi.yaml` e na parte 03 seção 5. Não invente rota |
| `index.html` (script inline) e qualquer fonte ou script externo novo | A CSP (cabeçalhos em `vercel.json`) bloqueia o que ela não conhece | **Kobner** e **Goran** | Antes de tirar o script inline do tema ou de adicionar script, fonte ou imagem de outro domínio |
| `vite.config.js` | Proxy `/api` → `localhost:3001` e cookies de sessão em dev | **Goran** | Antes de mudar proxy, porta ou `server.*` |
| `scripts/copy-vendor-assets.mjs` | Roda no `postinstall` de todo mundo | **Todos** | Antes de mudar |
| `package.json`, `package-lock.json` | Dependência nova mexe no lockfile de todos | **Todos** | Antes de adicionar ou atualizar; 1 por PR; `npm install`, nunca editar o lock |
| `.env.example` | Variável `VITE_*` nova precisa ser configurada na Vercel | **Todos** | Ao criar |
| `src/features/attachments/constraints.js` | Espelha os limites do backend (`backend/attachments.mjs`) e `docs/attachments-api.md` | **Goran** | Os limites (hoje 4 MiB) mudam por decisão do Goran (spike S3); você só espelha. Não mude sozinho |
| `src/features/nfeReader/analysisBuilder.js`, `receiptHandoff.js` (forma do resultado do scanner) | O payload de `POST /portaria/chegadas` sai daqui | **Goran** | Antes de mudar nomes ou forma de `chaveAcesso`, `numeroNf`, `serieNf`, `cnpjFornecedor`, método e confiança |
| `docs/alm2/**` (partes que não são suas) | Decisões são da equipe | Dono da parte | Só edite a parte 06. Para as outras, abra a discussão |

## 6. Contratos entre vocês

**O que você entrega**

- **Para o Goran:** o payload do scanner para a Portaria (`chaveAcesso`, `numeroNf`, `serieNf`, `cnpjFornecedor`, `metodoLeitura`, `confianca`) e a lista de campos que cada tela precisa (dashboard, lista, detalhe) antes de ele fechar o OpenAPI.
- **Para o Kobner:** o fluxo de login que a UI espera (matrícula + PIN, troca obrigatória, bloqueio, "Trocar usuário", aviso de expiração) para ele conferir contra o contrato.
- **Para o Marcelo:** os fluxos para E2E e os `validate-*.mjs` do scanner rodando em CI.

**O que você espera dos outros**

| De | O quê | Quando |
|---|---|---|
| Kobner | Contrato `/auth/*` e `/auth/me` (parte 03 seção 5) e a lista de códigos de permissão (`PERMISSIONS`) | F0 (você usa mock até lá) |
| Goran | `docs/openapi.yaml` com `versao`/`If-Match`, `requestId`, cursor e códigos de erro | F1 |
| Goran | Limite de arquivo e regra de download após o spike S3 | F3 |
| Marcelo | Preview estável com alias fixo e smoke de rotas | F0 |

## 7. Suas tarefas por fase

| Fase | Tarefas | Arquivos |
|---|---|---|
| **F0** (agora) | Login, `usePermissions` e guarda de rotas contra **mock** (`VITE_AUTH_MOCK`, só dev); toast com `INFO`/`WARNING`/`PROGRESS`; `errorMessages` global; correção do `csvCell` (já testada, falta seu OK); levar Q2, Q7, Q9 à empresa; combinar com o Goran a extração de `shared/domain.mjs` | `src/features/auth/**`, `src/ui.jsx`, `src/api/errorMessages.js`, `src/data.js:499` |
| **F1–F2** | Store passos 1 a 3 (autenticação, mutações com o servidor como autoridade, `versao` e 409); troca de PIN; remover `DEMO_USERS`, `DEMO_CURRENT_USER`, `setApiUser`; `credentials: 'same-origin'` e sair o `X-User-Id` quando o backend exigir sessão | `src/store.js`, `src/api.js`, `src/App.jsx`, `src/data.js` ⚠️ |
| **F3** | Exclusão com motivo obrigatório; tela "Excluídos"; compressão e remoção de EXIF das fotos; novo limite de arquivo (S3) | `src/App.jsx`, `src/features/attachments/**`, `src/features/admin/**` |
| **F4** | Botão Exportar (CSV ou Google Sheets); estado do espelho | `src/features/export/**` |
| **F5** | Portaria completa (início, revisão, resultado, duplicidade, digitar chave); enviar `nfeChaveAcesso` no novo recebimento | `src/features/portaria/**`, `src/features/nfeReader/**` (só o handoff) |
| **F6** | Busca no servidor, filtros salvos, ordenação, cursor, dashboard do servidor; store passo 4 | `src/features/search/**`, `src/store.js`, `src/components/**` |
| **F7** | Telas de usuários, auditoria e integrações; notificações persistentes (se houver tempo) | `src/features/admin/**`, `src/features/notifications/**` |
| **F8–F9** | Acessibilidade (tabela só-mouse, foco no modal); E2E com o Marcelo; rodada física antes de reativar o scanner ao vivo; treinamento | `src/**` |

## 8. Como avisar e como fazer PR em arquivo de outro dono

**Antes** de editar (mensagem ao dono, no canal do time):

```
[ALM · AVISO DE ALTERAÇÃO]
Para: @<dono>        De: <você>        Data: <dd/mm>
Arquivo: <caminho>   (zona ⚠️ ou ⏸)
O que vou mudar: <1 a 3 linhas: função, linhas>
Por quê: <decisão D## ou tarefa>
Impacto em você: <o que pode quebrar ou o que você precisa ajustar>
Branch/PR: <nome>  (você é o revisor)
Quando pretendo mexer: <data/hora>
Preciso do seu OK antes? <sim (⏸) | só aviso>
```

**Depois** de mergear:

```
[ALM · FEITO] <arquivo> mergeado em <commit>. O que mudou: ... O que você precisa fazer: ...
```

Regras:

1. **Avisar antes, não depois.** Em zona ⏸, sem OK não se edita.
2. **PR separado**, só com essa mudança, **o dono como revisor obrigatório**. Sem refactor de brinde e sem reformatar o arquivo inteiro.
3. Se o dono já tem branch mexendo no mesmo arquivo, pergunte qual é. Quem mergeia primeiro vence; o outro faz rebase.
4. **Sem resposta em 1 dia útil:** em zona ⏸ não edite e escale ao Lucas (coordenação); em zona ⚠️ sem ⏸ dá para seguir se a mudança for pequena e reversível, avisando de novo.
5. **Exceção:** produção fora do ar. Corrige, e avisa o dono em seguida, com o motivo.
6. **Nunca** commit de `.env`, de segredo ou de lockfile alterado à mão.
