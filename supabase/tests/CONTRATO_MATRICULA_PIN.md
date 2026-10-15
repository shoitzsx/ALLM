# ALM — contrato de integracao: matricula + PIN / PostgreSQL 17

**Status:** preparacao de conexao (somente banco/documentacao). **Nao implantado.**
**Escopo:** somente \`supabase/\` na branch \`audit/alm-pin-login-pg17-20261015\`.
**Projeto de staging autorizado para consulta:** Almoxarifado ALM (\`uxfstabcpvmujvzijyqw\`).
**Nao alterar:** backend, frontend, Supabase remoto, roles existentes ou credenciais reais nesta etapa.

## Evidencia atual (15/10/2026)

- 11 migrations aplicadas em staging, 28/28 tabelas com RLS e Security Advisor sem alertas.
- \`alm.usuarios\`, \`alm.credenciais_pin\`, \`alm.sessoes\`, \`alm.eventos_autenticacao\` ja existem.
- Staging sem usuarios/PIN/sessoes registrados na revisao; nao criar administrador ficticio.
- \`alm_api\` e \`alm_job\` sao \`NOLOGIN\`, \`NOINHERIT\` e \`NOBYPASSRLS\`.
- Usuario de conexao \`postgres\` no staging nao possui \`SET\` para essas roles: **nao utilizar a credencial administrativa como login de runtime**.
- A API atual ainda usa \`X-User-Id\`/usuarios demo e Google Sheets. Por isso **nao ha autenticacao real implementada**.

## Decisao funcional: matricula + PIN

1. A identidade e \`usuarios.id\` (UUID), resolvida por \`usuarios.matricula\` normalizada; nunca confiar em ID enviado diretamente pelo navegador.
2. \`usuarios.ativo=false\`, matricula desconhecida, PIN incorreto ou credencial bloqueada/expirada impedem login.
3. O backend devera usar derivacao de hash resistente a tentativa offline (preferir Argon2id, com sal unico; scrypt se houver justificativa) e pepper versionado armazenado **fora do PostgreSQL**. \`credenciais_pin.pin_hash\` nunca guarda PIN puro.
4. PIN, hash, pepper, token de sessao e credenciais tecnicas nao aparecem em logs, payloads de auditoria, parametros de URL nem respostas HTTP.
5. Falhas e bloqueios serao registrados em \`credenciais_pin\`/\`eventos_autenticacao\`; aplicar protecao por matricula/origem com controles de abuso. Politica de tentativas, tamanho do PIN, tempo de bloqueio, rotacao e recuperacao dependem de confirmacao funcional da equipe.
6. Depois de autenticacao, gerar token opaco forte com CSPRNG. Persistir somente SHA-256 do token (32 bytes) em \`alm.sessoes\`; entregar cookie \`HttpOnly; Secure; SameSite=Lax\` com escopo limitado. Verificar expiracao absoluta/ociosidade e revogacao no servidor.
7. Em qualquer mutacao, backend deve abrir transacao explicita, assumir papel \`alm_api\`, configurar **exatamente um** de \`app.usuario_id\` ou \`app.ator_sistema\` com \`set_config(..., true)\` e fornecer \`app.request_id\` quando aplicavel. Nunca aceitar esses valores diretamente do cliente.
8. Nunca fazer chamada ao Google Drive enquanto um lock/transacao no PostgreSQL fica aberto.
9. Bootstrap do primeiro administrador exige fluxo administrativo autorizado e auditado; **nao incluir matricula/PIN/usuario seed em migration**.
10. Os valores de \`perfil\` persistidos no banco sao maiusculos (\`ADMINISTRADOR\`, \`ALMOXARIFADO\`, \`SUPRIMENTOS\`, \`CONSULTA\`, \`PORTARIA\`); a UI atual usa textos com iniciais maiusculas. O backend sera responsavel pelo mapeamento, jamais o banco pela confianca do perfil vindo do browser.

## Identidades tecnicas da conexao (ainda nao criar no staging)

- Manter \`alm_api\`/\`alm_job\` como roles de permissao **NOLOGIN**.
- Preparar dois logins **dedicados**, cada um \`LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION\`; gerar senhas distintas em gerenciador de segredos fora do repo.
- PostgreSQL 17 suporta membro com \`GRANT alm_api TO <login_api> WITH ADMIN FALSE, INHERIT FALSE, SET TRUE\`; para job, \`GRANT alm_job TO <login_job> WITH ADMIN FALSE, INHERIT FALSE, SET TRUE\`. Isso **nao pode ser aplicado cegamente**, pois requer prova com conexoes reais, compatibilidade com o pooler e verificacao de grants administrativos indiretos.
- Nunca dar \`BYPASSRLS\`, \`CREATEROLE\`, \`SUPERUSER\`, \`OWNER\`, \`CREATE ON SCHEMA alm\` ou privilégio de login direto nas tabelas.
- Dentro de transacao, backend usa \`SET LOCAL ROLE alm_api\` ou \`SET LOCAL ROLE alm_job\` e volta ao estado normal automaticamente ao terminar \`COMMIT\`/\`ROLLBACK\`.
- Armazenar conexoes de API e job **somente no servidor**, com TLS, limites de pool, timeout e rotacao. Para serverless, avaliar Supavisor **transaction mode** (:6543) e testar usuario customizado/papel no ambiente real. Nao presumir que Session pooler (:5432) e transaction pooler tenham mesmos detalhes de login.
- A primeira prova e o script \`supabase/tests/test-role-login.mjs\`, **apenas em** \`127.0.0.1:55433/alm_ci_clean\`. Ele cria dois logins de teste com senhas aleatorias em memoria, verifica autenticacao e \`SET LOCAL ROLE\`, testa acesso permitido/negado e remove os logins. **Nao usar o script no Supabase remoto**.

## Precondicoes antes de integrar no backend

- [ ] Prova local de login tecnico, \`SET LOCAL ROLE\`, RLS e separacao API/job aprovada.
- [ ] Politicas de comprimento do PIN, bloqueio, expiracao e recuperacao aprovadas pela equipe.
- [ ] Credenciais tecnicas reais criadas **somente apos autorizacao especifica**, com backup e plano de revogacao.
- [ ] Conexao real no Supabase com usuario customizado e Supavisor validada com \`SELECT session_user,current_user\` (nao divulgar segredos).
- [ ] Regras de papel funcional por operacao definidas no backend; \`p_tecnico\` autoriza roles tecnicas, **nao** substitui autorizacao por usuario humano.
- [ ] Backend troca \`X-User-Id\` por login e cookie de sessao verificado no servidor.
- [ ] Backend passa a usar PostgreSQL para persistencia do dominio, preservando Google Drive como storage de bytes quando definido.
- [ ] Testes E2E de login valido/invalido, bloqueio, sessao expirada/revogada, elevação de privilegio, concorrencia, auditoria e ausencia de segredo em logs.

## Rodar a prova LOCAL (Git Bash Windows)

Requer a instancia descartavel PostgreSQL 17 criada anteriormente, porta \`55433\`, com as 11 migrations.
Se a instancia estiver parada:

\`\`\`bash
"/c/Program Files/PostgreSQL/17/bin/pg_ctl.exe" \
  -D "$LOCALAPPDATA/Temp/alm_pg17_ci_11_isolado" \
  -o "-p 55433 -h 127.0.0.1" \
  -l "$LOCALAPPDATA/Temp/alm_pg17_ci_11_isolado/server.log" start
\`\`\`

\`\`\`bash
export ALM_DB_TEST_DEPS="$LOCALAPPDATA/Temp/opencode"
export ALM_LOCAL_DATABASE_URL="postgresql://postgres@127.0.0.1:55433/alm_ci_clean"
read -s -p "Senha do PostgreSQL isolado: " PGPASSWORD
echo
export PGPASSWORD
node supabase/tests/test-role-login.mjs
unset PGPASSWORD ALM_LOCAL_DATABASE_URL
\`\`\`

**Resultado esperado:** prova dos dois logins aprovada e logins temporarios apagados.
Nenhum dado de negocio sera gravado. Se o teste falhar, nao avancar para staging.
