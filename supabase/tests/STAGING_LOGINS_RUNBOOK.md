# ALM — provisao e validacao de logins tecnicos no staging

**Estado em 15/10/2026:** criacao dos dois logins tecnicos **APROVADA e EXECUTADA**
no projeto `Almoxarifado ALM` (`uxfstabcpvmujvzijyqw`).
Ambos foram criados originalmente com `PASSWORD NULL`. Depois, o
operador configurou senhas distintas de forma interativa via `psql \password`
e comprovou autenticação real pelos poolers **Session :5432** e
**Transaction :6543** para API e JOB. Nenhuma senha consta nesta nota.

A ferramenta Supabase registrou a operacao como migration
`20261015045033_alm_runtime_logins_bootstrap`. O SQL exato consta em
`supabase/infrastructure/20261015045033_alm_runtime_logins_bootstrap.sql`,
separado das **11 migrations de dominio** sob `supabase/migrations/` para
nao modificar a instalacao limpa local. O historico remoto tem agora 12 entradas.

## Escopo e garantias

- **Unico destino permitido:** Supabase `Almoxarifado ALM`, ID `uxfstabcpvmujvzijyqw`, PG 17.11.
- **Nao tocar:** outros projetos Supabase; `backend/`, `src/`, Vercel, Google Sheets/Drive, registros de usuarios/PIN.
- **Migration de infraestrutura aplicada e registrada em staging**: criadas duas roles
  de login, sem senhas, e dois memberships com `SET TRUE`/`INHERIT FALSE`.
  Nenhuma role de negocio nem tabela foi alterada; nao repetir essa DDL.
- Roles de permissao preexistentes: `alm_api` e `alm_job`, ambas `NOLOGIN` e `NOBYPASSRLS`.
- `postgres` tem membership com `ADMIN OPTION=true`, `INHERIT=false` e `SET=false`
  para ambas as roles (verificado no catalogo do staging). **Nao usar
  `SET ROLE` diretamente como `postgres` no runtime.**
- Antes da criacao, o staging tinha 11 migrations, 28 tabelas e 28 policies;
  depois, 12 entradas no historico, as mesmas 28 tabelas e 28 policies.
  Nao foram criados usuarios humanos, PINs ou sessoes.
- Dois logins temporarios e `SET LOCAL ROLE` passaram no PostgreSQL 17.11
  local na porta 55433, com acessos proibidos negados; limpeza validada (0
  logins temporarios). **Isso nao prova conectividade via Supavisor.**

## Contratos restantes antes de habilitar os logins

1. **Concluido:** confirmados projeto, roles, memberships e historico; criados
   apenas `alm_runtime_api` e `alm_runtime_job`.
2. **Concluido:** o operador configurou senhas distintas no `psql \password`
   e autenticou ambas as contas sem informar os segredos nesta conversa.
   **Confirmar que as senhas estejam guardadas** no gerenciador de segredos;
   não inserir senha em CLI, Git, tickets, prints ou frontend.
3. **Concluido:** obtido host do Supavisor pelo Dashboard; validada conexão
   criptografada via Session na porta **5432**.
4. **Concluido:** logins personalizados API e JOB validaram `SET LOCAL ROLE`
   também no modo Transaction na porta **6543**.
   Ainda pendem testes E2E, concorrencia sob carga e integraçao da aplicação.

## DDL aplicada — APENAS REFERENCIA, NAO REEXECUTAR

Esses comandos ja foram executados por meio da ferramenta de migration
com guards preventivos e `PASSWORD NULL`. **Nao executar novamente**.
As senhas foram configuradas separadamente, de forma privada, no `psql`,
sem serem adicionadas a migrations ou ao historico Git.

```sql
-- REFERENCIA DO ESTADO JA APLICADO; NAO EXECUTAR NOVAMENTE.
CREATE ROLE alm_runtime_api LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 5 PASSWORD NULL;

CREATE ROLE alm_runtime_job LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 2 PASSWORD NULL;

GRANT alm_api TO alm_runtime_api
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT alm_job TO alm_runtime_job
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
```

Com `psql` conectado ao staging, **os seguintes comandos ja foram
executados** pelo operador (nao precisam ser repetidos):

```text
\password alm_runtime_api
\password alm_runtime_job
```

O comando `\password` coletou as senhas sem expor o texto no GitHub.
O `PASSWORD NULL` descrito no SQL acima representa **somente o estado do
bootstrap**, não o estado atual. Os dois logins ja autenticaram no staging.

## Evidencias dos testes reais (15/10/2026)

Todos os quatro testes foram executados pelo operador com `psql`,
`PGSSLMODE=require`, conexoes autenticadas pelos usernames personalizados
na forma `role.project-ref` e cada consulta em
`BEGIN; SET LOCAL ROLE ...; ...; ROLLBACK;`:

| Login tecnico | Session :5432 | Transaction :6543 | Identidade dentro da transacao |
|---|---|---|---|
| `alm_runtime_api` | PASSOU | PASSOU | `session_user=alm_runtime_api`, `current_user=alm_api` |
| `alm_runtime_job` | PASSOU | PASSOU | `session_user=alm_runtime_job`, `current_user=alm_job` |

API: `SELECT count(*) FROM alm.usuarios` retornou `0` nos dois modos.
JOB: `SELECT id, ultimo_uso_em FROM alm.sessoes LIMIT 1` retornou 0
linhas; `has_column_privilege(..., 'pin_hash', 'SELECT')` e
`has_column_privilege(..., 'token_hash', 'SELECT')` retornaram `false`
nos dois modos. Todos os testes encerraram com `ROLLBACK`, sem erros.
O banco nao recebeu dados de negocio nesses testes.

**Limite da evidência:** foi testada conectividade e identidade de role,
não um fluxo funcional de matricula + PIN nem concorrência sob carga.
A leitura direta dos campos proibidos foi efetivamente negada nos testes
locais anteriores; no staging a negativa foi validada via
`has_column_privilege`.

## Teste de privilegios apos autorizacao

Com conexoes **separadas** para cada novo usuario, usando credenciais
protegidas e SSL/TLS:

```sql
-- Em conexao autenticada como alm_runtime_api.
SELECT session_user, current_user; -- ambos: alm_runtime_api
BEGIN;
SET LOCAL ROLE alm_api;
SELECT session_user, current_user; -- login tecnico, role alm_api
SELECT count(*) FROM alm.usuarios; -- deve funcionar
ROLLBACK;
```

```sql
-- Em conexao autenticada como alm_runtime_job.
SELECT session_user, current_user; -- ambos: alm_runtime_job
BEGIN;
SET LOCAL ROLE alm_job;
SELECT id, ultimo_uso_em FROM alm.sessoes LIMIT 1; -- permitido
-- Consultas a pin_hash e token_hash DEVEM receber 42501.
ROLLBACK;
```

A ausencia de `SET ROLE` deve negar `USAGE` no schema `alm`.
Repetir o teste no **Supavisor Session** e em **Transaction**. Em Transaction
mode todas as configuracoes de contexto devem usar `SET LOCAL` DENTRO de
`BEGIN` / `COMMIT` ou `ROLLBACK`; nao confiar em estado entre requisicoes.
No client `pg`, evitar prepared statements nomeados nesse modo.

Complementar com catalogo (sem senhas):

```sql
SELECT pg_has_role('alm_runtime_api','alm_api','SET') AS api_pode_set,
       pg_has_role('alm_runtime_api','alm_job','SET') AS api_nao_pode_job,
       pg_has_role('alm_runtime_job','alm_job','SET') AS job_pode_set,
       pg_has_role('alm_runtime_job','alm_api','SET') AS job_nao_pode_api,
       has_schema_privilege('alm_runtime_api','alm','USAGE') AS api_sem_heranca,
       has_schema_privilege('alm_runtime_job','alm','USAGE') AS job_sem_heranca;
```

Esperado: `true, false, true, false, false, false`. Conferir tambem
`rolbypassrls=false`, `rolsuper=false`, `rolcreaterole=false` para
ambos. Nunca habilitar direitos via `PUBLIC` ou `service_role` para
contornar falha de login.

## Estrategia de falha e reversao

1. Se a autenticacao no Supavisor ou `SET LOCAL ROLE` falhar,
   **nao integrar backend, nao abrir grants, nao ativar trafego real**.
2. Revogar segredos no gerenciador e desabilitar novas conexoes:
   `ALTER ROLE alm_runtime_api NOLOGIN;` /
   `ALTER ROLE alm_runtime_job NOLOGIN;`.
3. Depois de confirmar ausencia de sessoes e dependencias, rollback pontual
   **somente dos dois logins novos**:

```sql
-- Plano para operador autorizado; nao executar automaticamente.
REVOKE alm_api FROM alm_runtime_api;
REVOKE alm_job FROM alm_runtime_job;
DROP ROLE alm_runtime_api;
DROP ROLE alm_runtime_job;
```

4. Validar que as 11 migrations originais, 28 tabelas, policies e
   `alm_api`/`alm_job` permaneceram intactos.
5. Em falha parcial, interromper e inspecionar; nao executar `DROP OWNED`,
   `DROP SCHEMA`, `supabase db reset` ou `supabase db push`.

## Pendente com a equipe

> Estado deste runbook em 15/10/2026. A implementacao posterior adicionou a
> migration local de bootstrap, `POST /api/v1/auth/initial-pin` e o script
> `backend/scripts/provision-first-admin.mjs`; isso nao autoriza aplica-los em
> staging. Consulte `backend/POSTGRES_N2.md` para o contrato vigente.

- Continuam pendentes a aprovacao operacional para staging, recuperacao e a
  politica definitiva de comprimento/complexidade e bloqueio do PIN.

## Referencias oficiais

- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/troubleshooting/custom-role-inherits-privileges-that-were-not-explicitly-granted-ddaa1c
