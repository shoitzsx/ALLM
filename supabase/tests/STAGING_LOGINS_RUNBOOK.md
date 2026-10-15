# ALM — plano de staging para logins tecnicos (sem execucao remota)

**Estado em 15/10/2026:** preflight de leitura **APROVADO**. Criacao de logins
**NAO AUTORIZADA NEM EXECUTADA**. Esta nota nao contem credenciais.

## Escopo e garantias

- **Unico destino permitido:** Supabase `Almoxarifado ALM`, ID `uxfstabcpvmujvzijyqw`, PG 17.11.
- **Nao tocar:** outros projetos Supabase; `backend/`, `src/`, Vercel, Google Sheets/Drive, registros de usuarios/PIN.
- **Sem aplicar migration agora:** contas de conexao sao recursos de infraestrutura,
  provisionados separadamente apos autorizacao explicita, com segredo em gerenciador seguro.
- Roles de permissao preexistentes: `alm_api` e `alm_job`, ambas `NOLOGIN` e `NOBYPASSRLS`.
- `postgres` tem membership com `ADMIN OPTION=true`, `INHERIT=false` e `SET=false`
  para ambas as roles (verificado no catalogo do staging). **Nao usar
  `SET ROLE` diretamente como `postgres` no runtime.**
- O staging tinha 11 migrations, 28 tabelas e 28 policies; nenhuma linha em
  `alm.usuarios`, `alm.credenciais_pin` ou `alm.sessoes`.
- Dois logins temporarios e `SET LOCAL ROLE` passaram no PostgreSQL 17.11
  local na porta 55433, com acessos proibidos negados; limpeza validada (0
  logins temporarios). **Isso nao prova conectividade via Supavisor.**

## Contratos a validar ANTES de escrever no staging

1. Confirmar o nome/ID do projeto no Dashboard e exportar snapshot de
   `pg_roles`, `pg_auth_members` e privileges atuais (sem acessar senhas).
2. Autorizar separadamente **somente** dois logins novos:
   `alm_runtime_api` e `alm_runtime_job`.
3. Guardar senhas fortes e diferentes no gerenciador de segredos. Nao passar
   senhas na linha de comando, no Git, em tickets, em prints ou neste chat.
4. Obter o host oficial do Supavisor em **Connect** no dashboard, sem inventar
   nome de host. Para teste: modo Session na porta **5432**; para avaliacao
   serverless depois: modo Transaction na **6543**.
5. Testar autenticação do login personalizado no pooler; nomes de usuario
   customizados devem seguir a sintaxe exibida no Dashboard/Supavisor.
   Nao presumir que uma conexao direta aprovada implica pooler aprovado.

## DDL previsto — RASCUNHO, nao executar sem autorizacao nova

Conectar via `psql` ao projeto de staging como operador administrativo
autorizado. Validar `current_database()`, host do Dashboard e roles antes de
criar contas. As senhas sao configuradas em **passo interativo separado** para
nao entrarem na migration ou no historico Git.

```sql
-- APENAS APLICAR DEPOIS DA CONFIRMACAO EXPLICITA DE EXECUCAO REMOTA.
-- psql em staging com o usuario administrativo autorizado.
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

Com `psql` conectado ao staging, rodar separadamente:

```text
\password alm_runtime_api
\password alm_runtime_job
```

O comando `\password` coleta o segredo interativamente e pode aplicar
hash no cliente; nunca ecoar ou versionar as senhas. Enquanto
`PASSWORD NULL`, o login nao autentica via senha.

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

- Confirmar comprimento/complexidade do PIN, politica de bloqueio,
  redefinicao, expiracao e bootstrap auditado do primeiro administrador.
- Integracao no backend: autenticar por matricula+PIN, hash Argon2id/scrypt
  com pepper fora do banco, cookie opaco, sessao revogavel, transacao
  parametrizada com ator, `SET LOCAL ROLE`, auditoria e rate limiting.
- O frontend e backend permanecem sem modificacoes por esta atividade.

## Referencias oficiais

- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/troubleshooting/custom-role-inherits-privileges-that-were-not-explicitly-granted-ddaa1c
