# Contexto de trabalho: Kobner e Marcelo (banco, identidade, RBAC, qualidade e release)

**Data:** 06/10/2026 · **Base:** `fix/vercel-api-routing` em `48b1583` e `main` em `780062a` · **Fonte:** `docs/alm2/` (README e partes 01 a 08)

**Atenção:** estes caminhos **ainda não existem** no repositório; foram definidos pela especificação e serão criados pelo dono indicado: `backend/auth/`, `backend/db/`, `backend/jobs/`, `supabase/`, `shared/domain.mjs`, `docs/openapi.yaml`, `tests/`, `.github/`, `scripts/alm-*.mjs`, `scripts/smoke-*.mjs`, `scripts/migrate-*.mjs`, `src/api/errorMessages.js` e as pastas novas de `src/features/`. Todo o resto citado existe hoje.

O Marcelo trabalha junto do Kobner: este arquivo é dos dois. Ele diz **quais arquivos são de vocês, quais não são e quando precisam avisar alguém antes de editar**. Use-o como contexto no início de qualquer sessão de trabalho, sua ou de uma IA.

## 0. Regra de ouro e instruções para a IA

> **Se você precisar editar um arquivo que NÃO é seu (🔴) ou uma zona compartilhada (⚠️): pare. Mande mensagem ao dono ANTES de editar** (modelo na seção 8). Se a zona tem ⏸, **espere o OK** do dono. Faça a menor mudança possível, em PR separado, com o dono como revisor, e avise de novo quando mergear.

Cole este bloco no início da sessão com a sua IA:

```
Você é o assistente do Kobner/Marcelo no projeto ALM. Antes de editar qualquer arquivo,
consulte as seções 3, 4 e 5 do CONTEXTO-KOBNER.md:
- 🟢 arquivo do Kobner ou do Marcelo: pode editar.
- 🔴 arquivo de outro dono: NÃO edite. Diga a quem pedir e redija a mensagem.
- ⚠️ zona compartilhada: pare, redija o aviso (modelo da seção 8) e espere a pessoa confirmar
  que o dono foi avisado. Se tiver ⏸, espere também o OK do dono.
Ao terminar, liste os arquivos alterados agrupados em 🟢, ⚠️ e 🔴.
Nunca abra, leia ou imprima .env nem backend/.env. Nunca faça commit nem push sem pedido
explícito. Nunca aplique DDL em staging ou produção sem o Kobner. Nunca registre PIN, token,
hash ou segredo em log, teste ou documento.
```

Leitura obrigatória: `docs/alm2/README.md`, **parte 03** (Kobner é dono), parte 04 (schema, roles e auditoria), parte 01 (decisões), `docs/alm2/sql/001_alm2_delta.sql`, e a seção 3 do `ARQUITETURA_TECNICA_ALM.md` (DDL base). **Marcelo:** parte 07 (testes, CI, roadmap, spikes), parte 05 seção 4 (matriz de falhas) e parte 03 seção 9 (testes de segurança).

## 1. Sua frente

**Kobner: banco, identidade e RBAC.** Decisões em que é dono: **D01** (Postgres no Supabase), **D02** (lado do schema: roles, grants, RLS, schema fora da Data API), **D03** (autenticação), **D04** (PIN), **D05** (papéis e permissões), **D08** (auditoria no banco), **D13** (ambientes). Spikes: **S1** e **S2** (este com o Goran). Perguntas à empresa que leva: Q2, Q3, Q4, Q11.

**Marcelo: QA, release e observabilidade** (proposta, Q13). Decisões: **D18** (integrar branches e validar o Preview). Spike: **S7** (com o Goran). Entregas: CI, smoke, E2E, banco de testes, carga, caos, restauração, checklist de virada, painéis e alertas.

Vocês **não** são donos de: regras de recebimento, integrações do Google (Drive e Sheets), jobs, telas.

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

## 3. 🟢 Seus arquivos (vocês editam livremente)

**Kobner. Ainda não existem (a criar):**

- `supabase/**`: `migrations/` (extrair o DDL da v1, seção 3 do `ARQUITETURA_TECNICA_ALM.md`, e aplicar o delta), `seed.sql`, `config.toml`, testes SQL
- `backend/auth/**`: `permissions.mjs` (matriz papel → permissão), `credentials.mjs` (PIN, pepper, hash), `session.mjs`, `lockout.mjs`, `login.mjs` (handlers de `/auth/*` e de gestão de usuário), `config.mjs` (variáveis de auth) e os testes ao lado (`*.test.mjs`)
- `scripts/alm-create-admin.mjs`, `scripts/alm-import-usuarios.mjs`
- Docs: `docs/alm2/sql/**` (já existem: `001_alm2_delta.sql` e `validate-sql.mjs`), `docs/alm2/03-identidade-permissoes-portaria.md`; o lado do schema da parte 04

**Marcelo. Ainda não existem (a criar):**

- `.github/workflows/**` (CI), `.github/CODEOWNERS` (depois que o time confirmar os usuários do GitHub)
- `eslint.config.js` (com `no-undef` e `react/jsx-no-undef`)
- `tests/**`: `db/`, `integration/`, `e2e/`, `load/`, `chaos/`, `fixtures/`; `playwright.config.*`
- `scripts/smoke-*.mjs` (rotas simples e profundas, `auth/me`, health)
- `docs/runbooks/**` (restauração, virada, incidente) e o checklist de virada
- No `package.json` raiz: o script `test` e as dependências de teste (⚠️ ver seção 5)

## 4. 🔴 Não mexam (peçam ao dono)

| Área | Dono | Como pedir |
|---|---|---|
| `src/**` (inclui `src/data.js`, `src/api.js`) | Lucas | Mensagem com o contrato ou o comportamento esperado. Para testes E2E: os fluxos que a tela precisa expor |
| `backend/**` exceto `backend/auth/**`, `api/**`, `vercel.json`, `docs/attachments-api.md`, `docs/openapi.yaml` | Goran | Mensagem com o que precisam (schema não é dele: ele pede a vocês) |
| `backend/*.test.mjs` e `src/**/*.test.mjs` existentes | Goran / Lucas | O Marcelo acrescenta testes novos; para alterar um existente, avisa o autor |
| `ARQUITETURA_TECNICA_ALM.md` | Congelado | Leiam (é a fonte do DDL); não editem |

## 5. ⚠️ Zonas de contato (avisar antes de mexer)

| Arquivo | Por quê | Quem avisar | Como |
|---|---|---|---|
| `backend/app.mjs` ⏸ | Autenticação entra em `requestUser` (linha 75) e nas rotas `/auth/*` e `/usuarios/*` | **Goran** | **Preferido:** vocês entregam `backend/auth/` com API documentada (`authenticate`, `requirePermission`, handlers) e o Goran liga. Se tiverem de editar: aviso + OK, só as linhas de auth |
| `backend/services/recebimentosService.mjs` ⏸ (linhas 6–16) | `permissions()`, `isAdmin`, `canWrite`, `actor` | **Goran** | Vocês definem a regra em `backend/auth/permissions.mjs`; o Goran troca as chamadas |
| `backend/config/env.mjs` | Carrega as variáveis do backend | **Goran** | Não toquem: as variáveis de auth ficam em `backend/auth/config.mjs` |
| `backend/db/tx.mjs` (a criar, Goran) | `withActor` define `app.usuario_id`/`app.ator_sistema` que os triggers exigem | **Goran** | Vocês **consomem**. Se o Goran atrasar a entrega, avisem; não escrevam uma versão paralela |
| `vercel.json` ⏸ | Cabeçalhos de segurança, CSP, crons | **Goran** (e **Lucas** para CSP) | Vocês **propõem** os cabeçalhos; Lucas confirma que o frontend suporta; Goran aplica |
| `package.json`, `package-lock.json` | `scripts.test`, devDependencies (Playwright, ESLint), dependências de auth (`@node-rs/argon2` ou nenhuma, se for `scrypt`) | **Todos** | Antes de adicionar ou atualizar; 1 por PR; `npm install`, nunca editar o lock |
| `.env.example` | Nomes novos: `ALM_PIN_PEPPER_V1`, `DATABASE_URL_API`, `DATABASE_URL_JOB`, `CRON_SECRET` | **Todos** | Ao criar; só nomes |
| ESLint e CI sobre `src/` e `backend/` (Marcelo) | Uma regra nova pode fazer o build de outra pessoa falhar | **Lucas** e **Goran** | Começar como *warning*; promover a *error* depois do aceite deles |
| `docs/alm2/04-dados-auditoria-busca.md` | O schema é de vocês; consultas, API e busca são do Goran | **Goran** | Editem só a metade do schema; combinem o resto |
| `supabase/**` ↔ consultas do Goran | Uma migration pode quebrar uma consulta | **Goran** | **Antes** de aplicar uma migration que altera ou remove coluna, tabela ou índice usados pelo backend: aviso com o diff do schema |

## 6. Contratos entre vocês

**O que vocês entregam**

| Para | O quê | Quando |
|---|---|---|
| Lucas | Contrato `/auth/*` e payload de `/auth/me` (parte 03 seção 5) e a lista de códigos de permissão (`PERMISSIONS`) | F0 |
| Goran | Migrations aplicadas em staging, com o diff do schema; `backend/auth/` com API documentada | F1 e F2 |
| Goran | Revisão do SQL das consultas dele (e ele revisa o seu) | contínuo |
| Todos | Matriz de permissões gerada em teste; CI funcionando; smoke do Preview | F0 a F2 |

**O que vocês esperam dos outros**

| De | O quê | Quando |
|---|---|---|
| Goran | `backend/db/tx.mjs` (`withActor`) para a auth gravar sessão e eventos com o ator certo | início da F1 (semana 2) |
| Goran | Ligar o módulo `backend/auth/` no `app.mjs` e trocar `permissions()` | F2 |
| Goran | `docs/openapi.yaml` para o Marcelo validar no CI | F1 |
| Lucas | Fluxos de tela para os E2E; scripts `validate-*.mjs` do scanner disponíveis para o CI | F2 em diante |

**Entre Kobner e Marcelo:** testes de unidade ficam ao lado do código, escritos por quem escreveu (`backend/auth/*.test.mjs` é do Kobner). O que atravessa camadas fica em `tests/**` (Marcelo): matriz rota × papel gerada, bloqueio, enumeração, CSRF, varredura de logs, concorrência do código REC, restauração.

## 7. Tarefas por fase

**Kobner**

| Fase | Tarefas | Arquivos |
|---|---|---|
| **F0** | **S1:** `supabase start`; extrair o DDL da v1 para `supabase/migrations/`; aplicar o delta; teste de 50 inserts concorrentes; acesso por `pg` via pooler (sem query nomeada, `set_config(..., true)`); login técnico `alm_api_app`. **S2** com o Goran: hash p95 < 500 ms numa função da Vercel; decidir D03. Criar projeto de staging em São Paulo (depende de Q7) | `supabase/**` |
| **F1** | Migrations v1 + delta em staging; roles `alm_api_app` e `alm_job_app`, grants, timeouts por `ALTER ROLE`; schema `alm` fora da Data API; seeds de catálogos e papéis; revisão cruzada do SQL do Goran | `supabase/**` |
| **F2** | Módulo de auth: credenciais (PIN + pepper), sessão, bloqueio, `login`, `logout`, `me`, `trocar-pin`, `ping`, gestão de usuário (resetar PIN, bloquear, revogar sessões, papéis); matriz de permissões em código; scripts de admin e de importação de funcionários; entregar o contrato ao Lucas | `backend/auth/**`, `scripts/alm-*.mjs` |
| **F5–F6** | Ajustes de `chegadas_portaria`; índices de busca (v1 seção 4) | `supabase/**` |
| **F8** | Backup (Pro + `pg_dump` diário externo), retenção e LGPD no banco, revisão de segurança | `supabase/**`, `docs/runbooks/**` (com o Marcelo) |
| **F9** | Virada do banco | `supabase/**` |

**Marcelo**

| Fase | Tarefas | Arquivos |
|---|---|---|
| **F0** | **S7** com o Goran: merge de `main` na branch (dry-run sem conflito) e Preview com **todas** as variáveis; smoke de rotas profundas; CI mínimo (`npm test`, validador SQL, ESLint, `npm audit`, build); `CODEOWNERS`; confirmar Q13 | `.github/**`, `scripts/smoke-*.mjs`, `eslint.config.js` |
| **F1** | Banco de testes (Postgres efêmero); teste de concorrência do código REC; auditoria imutável; finalização; quarentena em recebimento finalizado | `tests/db/**` |
| **F2** | Matriz rota × papel gerada; bloqueio progressivo; enumeração; CSRF; varredura de logs; sessão | `tests/integration/**` |
| **F3–F4** | Matriz de falhas (parte 05 seção 4) com dublês de Drive e Sheets; testes de caos | `tests/chaos/**` |
| **F5** | E2E da Portaria com fixtures | `tests/e2e/**` |
| **F6** | Carga com 100 mil recebimentos sintéticos (metas da v1) | `tests/load/**` |
| **F8** | Restauração de backup; E2E completo; checklist da v1 seção 18; alertas | `tests/**`, `docs/runbooks/**` |
| **F9** | Checklist de virada e de rollback | `docs/runbooks/**` |

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
7. **Específico de banco:** nenhuma migration é editada depois de aplicada, e nenhum DDL roda em staging ou produção fora do fluxo de migrations do Kobner. Mensagens com PIN, hash, token ou `sessionUrl` são proibidas, até em exemplo.
8. **Kobner e Marcelo:** avisos sobre segurança e banco vão para o Kobner; sobre CI e testes, para o Marcelo; em dúvida, para os dois.
