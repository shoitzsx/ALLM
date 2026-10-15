# ALM — contrato de integracao: matricula + PIN / PostgreSQL 17

**Status:** prova local **APROVADA**; logins técnicos provisionados no staging, senhas configuradas privadamente pelo operador e testes Supavisor **Session :5432 / Transaction :6543 APROVADOS para API e JOB**, em 15/10/2026. Integração funcional do backend e do login matrícula + PIN **PENDENTE**. Nenhuma credencial versionada.
**Escopo:** somente `supabase/` na branch `audit/alm-pin-login-pg17-20261015`.
**Decisão de arquitetura vigente:** Supabase/PostgreSQL é a persistência
oficial; Sheets é legado em migração, Drive guarda bytes dos anexos; o
desenvolvimento e a validação são locais. Vercel não é requisito atual.
Ver `supabase/ARQUITETURA_ATUAL_2026-10-15.md`.
**Projeto de staging validado:** Almoxarifado ALM (`uxfstabcpvmujvzijyqw`).
**Escopo:** backend e frontend não alterados. Provisionamento de logins no Supabase ocorreu sob autorização específica; **não realizar novas mutações remotas sem nova aprovação**.

## Evidencia atual (15/10/2026)

- 11 migrations de domínio aplicadas em staging, mais 1 migration de infraestrutura para logins (12 no histórico), 28/28 tabelas com RLS e Security Advisor sem alertas após o bootstrap.
- `alm.usuarios`, `alm.credenciais_pin`, `alm.sessoes`, `alm.eventos_autenticacao` ja existem.
- Staging sem usuarios/PIN/sessoes registrados na revisao; nao criar administrador ficticio.
- `alm_api` e `alm_job` sao `NOLOGIN`, `NOINHERIT` e `NOBYPASSRLS`.
- Usuario de conexao `postgres` no staging nao possui `SET` para essas roles: **nao utilizar a credencial administrativa como login de runtime**.
- A API atual ainda usa `X-User-Id`/usuarios demo e Google Sheets. Por isso **nao ha autenticacao real implementada**.

## Decisao funcional: matricula + PIN

1. A identidade e `usuarios.id` (UUID), resolvida por `usuarios.matricula` normalizada; nunca confiar em ID enviado diretamente pelo navegador.
2. `usuarios.ativo=false`, matricula desconhecida, PIN incorreto ou credencial bloqueada/expirada impedem login.
3. O backend devera usar derivacao de hash resistente a tentativa offline (preferir Argon2id, com sal unico; scrypt se houver justificativa) e pepper versionado armazenado **fora do PostgreSQL**. `credenciais_pin.pin_hash` nunca guarda PIN puro.
4. PIN, hash, pepper, token de sessao e credenciais tecnicas nao aparecem em logs, payloads de auditoria, parametros de URL nem respostas HTTP.
5. Falhas e bloqueios serao registrados em `credenciais_pin`/`eventos_autenticacao`; aplicar protecao por matricula/origem com controles de abuso. Politica de tentativas, tamanho do PIN, tempo de bloqueio, rotacao e recuperacao dependem de confirmacao funcional da equipe.
6. Depois de autenticacao, gerar token opaco forte com CSPRNG. Persistir somente SHA-256 do token (32 bytes) em `alm.sessoes`; entregar cookie `HttpOnly; Secure; SameSite=Lax` com escopo limitado. Verificar expiracao absoluta/ociosidade e revogacao no servidor.
7. Em qualquer mutacao, backend deve abrir transacao explicita, assumir papel `alm_api`, configurar **exatamente um** de `app.usuario_id` ou `app.ator_sistema` com `set_config(..., true)` e fornecer `app.request_id` quando aplicavel. Nunca aceitar esses valores diretamente do cliente.
8. Nunca fazer chamada ao Google Drive enquanto um lock/transacao no PostgreSQL fica aberto.
9. Bootstrap do primeiro administrador exige fluxo administrativo autorizado e auditado; **nao incluir matricula/PIN/usuario seed em migration**.
10. Os valores de `perfil` persistidos no banco sao maiusculos (`ADMINISTRADOR`, `ALMOXARIFADO`, `SUPRIMENTOS`, `CONSULTA`, `PORTARIA`); a UI atual usa textos com iniciais maiusculas. O backend sera responsavel pelo mapeamento, jamais o banco pela confianca do perfil vindo do browser.

## Identidades tecnicas da conexao (provisionadas e testadas no staging)

- Manter `alm_api`/`alm_job` como roles de permissao **NOLOGIN**.
- Os logins dedicados `alm_runtime_api` e `alm_runtime_job` foram criados com `LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`; o operador configurou duas senhas fora do repo. Armazená-las exclusivamente em gerenciador de segredos.
- PostgreSQL 17 suporta `GRANT ... WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`; os dois grants corretos foram criados e comprovados com conexões reais nos dois modos do pooler. **Não reaplicar a DDL**; ver `supabase/tests/STAGING_LOGINS_RUNBOOK.md`.
- Nunca dar `BYPASSRLS`, `CREATEROLE`, `SUPERUSER`, `OWNER`, `CREATE ON SCHEMA alm` ou privilégio de login direto nas tabelas.
- Dentro de transacao, backend usa `SET LOCAL ROLE alm_api` ou `SET LOCAL ROLE alm_job` e volta ao estado normal automaticamente ao terminar `COMMIT`/`ROLLBACK`.
- Armazenar conexões de API e job **somente no servidor**, com TLS, limites de pool, timeout e rotação. O desenvolvimento deve funcionar com backend **local**, sem pressupor Vercel/serverless. Os modos Supavisor Session (:5432) e Transaction (:6543) foram aprovados nos testes técnicos com usuários customizados; escolher a conexão de execução após validar driver e carga reais.
- A primeira prova e o script `supabase/tests/test-role-login.mjs`, **apenas em** `127.0.0.1:55433/alm_ci_clean`. Ele cria dois logins de teste com senhas aleatorias em memoria, verifica autenticacao e `SET LOCAL ROLE`, testa acesso permitido/negado e remove os logins. **Nao usar o script no Supabase remoto**.

## Precondicoes antes de integrar no backend

- [x] Prova local de login tecnico e `SET LOCAL ROLE` para API/job aprovada; acessos indevidos negados. RLS tambem coberta na suite anterior de 137 testes PostgreSQL 17.
- [ ] Politicas de comprimento do PIN, bloqueio, expiracao e recuperacao aprovadas pela equipe.
- [x] Logins técnicos criados após autorização específica com `PASSWORD NULL` inicial, senhas definidas privadamente após o bootstrap, e plano de revogação documentado.
- [x] Conexões reais de `alm_runtime_api` e `alm_runtime_job` validadas no Supavisor Session :5432 e Transaction :6543, com `session_user`/`current_user` esperados (sem divulgar segredos).
- [ ] Regras de papel funcional por operacao definidas no backend; `p_tecnico` autoriza roles tecnicas, **nao** substitui autorizacao por usuario humano.
- [ ] Backend troca `X-User-Id` por login e cookie de sessao verificado no servidor.
- [ ] Backend passa a usar PostgreSQL para persistencia do dominio, preservando Google Drive como storage de bytes quando definido.
- [ ] Testes E2E de login valido/invalido, bloqueio, sessao expirada/revogada, elevação de privilegio, concorrencia, auditoria e ausencia de segredo em logs.

## Rodar a prova LOCAL (Git Bash Windows)

Requer a instancia descartavel PostgreSQL 17 criada anteriormente, porta `55433`, com as 11 migrations.
Se a instancia estiver parada:

```bash
"/c/Program Files/PostgreSQL/17/bin/pg_ctl.exe" \
  -D "$LOCALAPPDATA/Temp/alm_pg17_ci_11_isolado" \
  -o "-p 55433 -h 127.0.0.1" \
  -l "$LOCALAPPDATA/Temp/alm_pg17_ci_11_isolado/server.log" start
```

```bash
export ALM_DB_TEST_DEPS="$LOCALAPPDATA/Temp/opencode"
export ALM_LOCAL_DATABASE_URL="postgresql://postgres@127.0.0.1:55433/alm_ci_clean"
read -s -p "Senha do PostgreSQL isolado: " PGPASSWORD
echo
export PGPASSWORD
node supabase/tests/test-role-login.mjs
unset PGPASSWORD ALM_LOCAL_DATABASE_URL
```

**Execucao registrada em 15/10/2026:** prova aprovada em PostgreSQL 17.11 local, com logs `NEGADO CORRETAMENTE` antes do `SET ROLE`, `APROVADO` para `alm_api` e `alm_job`, e negacao da leitura de PIN e `token_hash` ao job. Nenhum erro de limpeza apareceu no resultado; a verificacao independente do catalogo de roles temporarias permanece opcional.
Nenhum dado de negócio foi gravado na prova local. **Posteriormente foram validados os dois logins no Supavisor remoto, nos modos Session e Transaction**. Isso ainda **não equivale à autenticação matrícula + PIN implementada no backend**; conferir `supabase/tests/HANDOFF_BACKEND_MATRICULA_PIN.md`.
