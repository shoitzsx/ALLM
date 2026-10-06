# Contexto de trabalho: Goran (backend, domínio, integrações e confiabilidade)

**Data:** 06/10/2026 · **Base:** `fix/vercel-api-routing` em `48b1583` e `main` em `780062a` · **Fonte:** `docs/alm2/` (README e partes 01 a 08)

**Atenção:** estes caminhos **ainda não existem** no repositório; foram definidos pela especificação e serão criados pelo dono indicado: `backend/auth/`, `backend/db/`, `backend/jobs/`, `supabase/`, `shared/domain.mjs`, `docs/openapi.yaml`, `tests/`, `.github/`, `scripts/alm-*.mjs`, `scripts/smoke-*.mjs`, `scripts/migrate-*.mjs`, `src/api/errorMessages.js` e as pastas novas de `src/features/`. Todo o resto citado existe hoje.

Este arquivo diz **quais arquivos são seus, quais não são e quando você precisa avisar alguém antes de editar**. Use-o como contexto no início de qualquer sessão de trabalho, sua ou de uma IA.

## 0. Regra de ouro e instruções para a IA

> **Se você precisar editar um arquivo que NÃO é seu (🔴) ou uma zona compartilhada (⚠️): pare. Mande mensagem ao dono ANTES de editar** (modelo na seção 8). Se a zona tem ⏸, **espere o OK** do dono. Faça a menor mudança possível, em PR separado, com o dono como revisor, e avise de novo quando mergear.

Cole este bloco no início da sessão com a sua IA:

```
Você é o assistente do Goran no projeto ALM. Antes de editar qualquer arquivo, consulte as
seções 3, 4 e 5 do CONTEXTO-GORAN.md:
- 🟢 arquivo do Goran: pode editar.
- 🔴 arquivo de outro dono: NÃO edite. Diga ao Goran a quem pedir e redija a mensagem.
- ⚠️ zona compartilhada: pare, redija o aviso (modelo da seção 8) e espere o Goran confirmar
  que o dono foi avisado. Se tiver ⏸, espere também o OK do dono.
Ao terminar, liste os arquivos alterados agrupados em 🟢, ⚠️ e 🔴.
Nunca abra, leia ou imprima .env nem backend/.env. Nunca faça commit nem push sem pedido
explícito. Nunca crie migration nem aplique DDL: schema é do Kobner. Nenhuma chamada externa
(Drive, Sheets) dentro de transação do Postgres. Nunca grave sessionUrl, token ou segredo em
log, banco ou documento.
```

Leitura obrigatória: `docs/alm2/README.md`, **partes 02, 04 e 05** (você é dono), parte 01 (decisões), parte 03 seção 5 (contrato de auth que o Kobner entrega e que você liga), parte 07 seções 1 e 8 (importação e spikes), e `docs/HANDOFF-GORAN-*`.

## 1. Sua frente

Backend, domínio, integrações e confiabilidade. Decisões em que é dono: **D02** (camada de acesso ao banco), **D06** (código do recebimento), **D07** (exclusão lógica), **D09** (Drive), **D10** (Sheets), **D11** (jobs e outbox), **D14** (API de busca), **D19** (migração dos dados atuais), **D20** (contrato da API). Spikes: **S3, S4, S5**; **S7** com o Marcelo; **S2** com o Kobner. Perguntas à empresa que leva: Q1, Q8, Q12, Q14.

Você **não** é dono de: schema e migrations, hash de PIN, sessão, matriz de permissões, telas, CI.

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

- `backend/app.mjs`, `backend/server.mjs` (⚠️⏸ para o Kobner, ver seção 5)
- `backend/services/**` (`recebimentosService.mjs`), `backend/repositories/**` (`recebimentosRepository.mjs`)
- `backend/integrations/**` (`googleDrive.mjs`, `googleSheets.mjs`), `backend/attachments.mjs`, `backend/attachments.test.mjs`
- `backend/config/env.mjs`, `backend/package.json`, `backend/package-lock.json`
- `api/router.mjs`, `vercel.json` (⚠️⏸ ver seção 5)
- `scripts/google-drive-oauth-setup.mjs`
- Docs: `docs/attachments-api.md`, `docs/HANDOFF-GORAN-*`, `docs/alm2/05-arquivos-sheets-jobs.md`; o lado de consultas e API da parte 04

**A criar (seus):**

- `backend/db/` (`pool.mjs`, `config.mjs`, **`tx.mjs` com `withActor`**: é a primeira entrega, o Kobner depende dela)
- `backend/repositories/` (`postgresRecebimentosRepository.mjs` e o de chegadas, com mapeadores para o camelCase atual)
- `backend/services/` (portaria, exportações, filtros salvos, busca)
- `backend/jobs/` (drenar outbox, espelho do Sheets, quarentena e purga do Drive, reconciliação)
- `backend/integrations/` (evolução do Drive; exportação formatada do Sheets)
- `scripts/migrate-*.mjs` (importador do Sheets, `drive-copy`)
- `docs/openapi.yaml`
- `shared/domain.mjs` (⚠️⏸: criado por você, **aprovado pelo Lucas**)
- Testes ao lado do código: `backend/**/*.test.mjs`

## 4. 🔴 Não mexa (peça ao dono)

| Área | Dono | Como pedir |
|---|---|---|
| `src/**` (inclui `src/data.js`, `src/api.js`) | Lucas | Mensagem com o contrato e o que a tela precisa mudar |
| `supabase/**`, `docs/alm2/sql/**` | Kobner | Mensagem com a **necessidade exata**: tabela, coluna, índice ou constraint, e a consulta que depende disso. **Você não cria migration nem aplica DDL** |
| `backend/auth/**`, `docs/alm2/03-*` | Kobner | Mensagem com o que o backend precisa da autenticação |
| `.github/**`, `eslint.config.*`, `tests/**`, `scripts/smoke-*.mjs` | Marcelo (com Kobner) | Mensagem com o comportamento a cobrir |
| `ARQUITETURA_TECNICA_ALM.md` | Congelado | Leia (é a fonte do DDL e do desenho de arquivos); não edite |

## 5. ⚠️ Zonas de contato (avisar antes de mexer)

| Arquivo | Por quê | Quem avisar | Como |
|---|---|---|---|
| `src/data.js` ⏸ | Você importa 10 nomes dele (`app.mjs:2`, `recebimentosService.mjs:2`) | **Lucas** | **Você não edita.** Para desacoplar, proponha `shared/domain.mjs`: você cria, o Lucas aprova e troca os imports do frontend |
| `src/api.js` | Contrato da API | **Lucas** | **Antes de mergear** qualquer mudança de rota, payload, código de erro ou header (`If-Match`, `X-Request-Id`, cookies), avise o Lucas. Ele implementa o cliente; você não edita o arquivo |
| `backend/app.mjs` ⏸ e `backend/services/recebimentosService.mjs:6-16` ⏸ | O Kobner entrega `backend/auth/` e **você liga** (`requestUser` na linha 75, rotas `/auth/*`, troca de `permissions()`) | **Kobner** (informar) | O arquivo é seu; o aviso é para o Kobner saber quando o código dele passa a ser usado. Se ele pedir para editar o arquivo, ele avisa você antes |
| `backend/db/tx.mjs` | O Kobner usa `withActor` em `backend/auth/` | **Kobner** | Avise antes de mudar a assinatura. Entregue na semana 2 da F1 |
| `vercel.json` ⏸ e `api/router.mjs` | Cabeçalhos de segurança e CSP; crons; rewrite que já quebrou produção | **Kobner** (cabeçalhos), **Lucas** (CSP), **Marcelo** (smoke) | Crons e rewrite são seus, mas avise todos antes de mexer. A CSP vem do Kobner e passa pelo Lucas antes de você aplicar |
| `backend/config/env.mjs` | Variáveis do backend | **Kobner** | As variáveis de auth ficam em `backend/auth/config.mjs`. As de banco (`DATABASE_URL_API`, `DATABASE_URL_JOB`) são suas em `backend/db/config.mjs` |
| `package.json`, `package-lock.json`, `backend/package*.json` | `pg`, `@vercel/functions` e o que vier | **Todos** | Antes de adicionar ou atualizar; 1 por PR; `npm install`, nunca editar o lock |
| `.env.example` | Nomes novos (`GOOGLE_SHEETS_MIRROR_ID`, `DATABASE_URL_*`, `CRON_SECRET`) | **Todos** | Ao criar; só nomes |
| `docs/alm2/04-dados-auditoria-busca.md` | O schema é do Kobner; consultas, API e busca são suas | **Kobner** | Edite só a metade das consultas e da API |
| `docs/attachments-api.md` e limites em `backend/attachments.mjs` | O frontend espelha os limites em `constraints.js` | **Lucas** | Quando o spike S3 mudar o limite (hoje 4 MiB), avise o Lucas antes de mergear |
| Branches `main` e `fix/vercel-api-routing` ⏸ | Divergiram em `cedcb3f`; o rewrite só existe na branch | **Marcelo** e **Lucas** | Você e o Marcelo executam o merge e o Preview (S7); ninguém abre feature antes |
| `backend/*.test.mjs` | O Marcelo pode querer alterar testes existentes | **Marcelo** | Ele pode acrescentar arquivos novos; para alterar os seus, ele avisa você |

## 6. Contratos entre vocês

**O que você entrega**

| Para | O quê | Quando |
|---|---|---|
| Kobner | `backend/db/tx.mjs` (`withActor`) e a configuração de acesso ao banco | início da F1 (semana 2) |
| Kobner | As necessidades de schema por mensagem (tabela, coluna, índice, consulta) | contínuo |
| Lucas | `docs/openapi.yaml` com `versao`/`If-Match`, `requestId`, cursor e códigos de erro; payloads de lista, detalhe, dashboard e Portaria | F1 |
| Lucas | Novo limite de arquivo e regra de download (S3) | F3 |
| Marcelo | OpenAPI para validar no CI; dublês de Drive e Sheets para os testes de falha | F1 a F3 |

**O que você espera dos outros**

| De | O quê | Quando |
|---|---|---|
| Kobner | Migrations aplicadas em staging, com o diff do schema | F1 |
| Kobner | `backend/auth/` com API documentada (`authenticate`, `requirePermission`, handlers) e `backend/auth/permissions.mjs` | F2 |
| Lucas | Payload do scanner para a Portaria e a lista de campos que cada tela precisa | antes de fechar o OpenAPI |
| Marcelo | Preview estável, smoke de rotas profundas, CI | F0 |

## 7. Suas tarefas por fase

| Fase | Tarefas | Arquivos |
|---|---|---|
| **F0** | **S7** com o Marcelo (merge de `main` na branch e Preview com **todas** as variáveis); **S3** (download em streaming de ≥ 20 MB); **S4** (`sha256Checksum`, `Range`, `properties`, mover entre pastas, Shared Drive se houver Workspace); **S5** (`waitUntil`, Cron de 1 min, `pg_cron`/`pg_net`, snapshot de 10 mil linhas no Sheets); **S2** com o Kobner; versionar o `HANDOFF-GORAN-BACKEND-INFRA-COMPLETE.md` em `docs/` (hoje só foi colado); combinar com o Lucas o `shared/domain.mjs` | `docs/**`, `api/**`, `vercel.json`, spikes |
| **F1** | **`backend/db/tx.mjs` (`withActor`) primeiro**; `PostgresRecebimentosRepository` (leitura, depois escrita) com mapeadores camelCase; flag `REPOSITORY=sheets\|postgres`; `versao` e `If-Match`; `X-Request-Id`; mapa de erros do banco; `docs/openapi.yaml` | `backend/db/**`, `backend/repositories/**`, `backend/services/**`, `backend/app.mjs` |
| **F2** | Ligar `backend/auth/` no `app.mjs` (flag `AUTH_MODE`, remover `X-User-Id`); trocar `permissions()` pelo módulo do Kobner | `backend/app.mjs`, `backend/services/recebimentosService.mjs` |
| **F3** | Confirmação de upload com `sha256Checksum` e assinatura; quarentena, restauração e purga; reconciliador; download em stream; limites; `files.delete` **só** no módulo de purga | `backend/integrations/googleDrive.mjs`, `backend/jobs/**`, `backend/attachments.mjs` |
| **F4** | Snapshot do Sheets (escrever por cima, limpar a cauda; `RAW`); exportação formatada no layout legado; runner da outbox (`waitUntil` + Cron); `GET /integracoes/estado` | `backend/jobs/**`, `backend/integrations/**` |
| **F5** | API da Portaria (serviço, repositório, rotas, vínculo, duplicidade) | `backend/services/**`, `backend/repositories/**`, `backend/app.mjs` |
| **F6** | Busca no servidor, filtros salvos, cursor, dashboard e exportação com os mesmos filtros | `backend/services/**`, `backend/repositories/**` |
| **F7** | Endpoints de auditoria, excluídos e integrações | `backend/**` |
| **F8–F9** | Importador do Sheets (D19) e `drive-copy` se Q9 = dados reais; runbooks de integração; virada | `scripts/migrate-*.mjs`, `docs/**` |

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
7. **Específico de backend:** mudança de contrato da API é avisada ao Lucas **antes** do merge. Pedido de schema ao Kobner sempre com a consulta que depende dele.
