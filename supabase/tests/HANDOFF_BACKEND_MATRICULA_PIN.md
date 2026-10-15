# ALM — handoff para integração do backend (matrícula + PIN)

**Data:** 15/10/2026
**Ambiente de validação:** Supabase **Almoxarifado ALM**, projeto
`uxfstabcpvmujvzijyqw`, PostgreSQL 17.11, região sa-east-1.
**Escopo desta entrega:** banco, credenciais de conexão e documentação; **nenhuma
alteração de backend/frontend, deploy Vercel ou dados de negócio.**
**Situação:** acesso técnico pronto no staging. A autenticação de matrícula + PIN
**não está implementada no backend**.

**Arquitetura vigente (15/10/2026):** PostgreSQL/Supabase é a fonte oficial
dos dados estruturados; Google Drive guarda bytes de anexos. Sheets é somente
persistência legada a migrar, **sem espelho novo**. Frontend/backend serão
desenvolvidos e testados localmente; **Vercel fica fora do escopo atual**.
Ver `supabase/ARQUITETURA_ATUAL_2026-10-15.md`.

## Contratos complementares

- `supabase/tests/CONTRATO_SQL_AUTENTICACAO.md`
- `supabase/tests/CONTRATO_CHG_REC_SCANNER.md`
- `supabase/tests/MAPEAMENTO_LEGADO_E_RASCUNHOS.md`

Esses contratos especificam a estrutura **já existente** e separam
propostas de integração/regras **pendentes de aprovação**. Nenhum deles
constitui implementação de API ou migration aplicada.

## Matriz de testes de conexão (evidência: saída de psql fornecida pelo operador)

| Papel de conexão | Supavisor Session :5432 | Supavisor Transaction :6543 | Resultado |
|---|---|---|---|
| `alm_runtime_api` -> `alm_api` | APROVADO | APROVADO | `session_user=alm_runtime_api`, `current_user=alm_api`, `count(alm.usuarios)=0` |
| `alm_runtime_job` -> `alm_job` | APROVADO | APROVADO | `session_user=alm_runtime_job`, `current_user=alm_job`, leitura de `alm.sessoes` permitida, `has_column_privilege` em `pin_hash` e `token_hash` = false |

Em todos os quatro testes, o operador usou `PGSSLMODE=require`, transação
explícita com `BEGIN; SET LOCAL ROLE ...; ...; ROLLBACK;` e recebeu saída sem
erro. No teste do job a tabela `alm.sessoes` retornou zero linhas.

**Distinção importante:** os testes locais anteriores executaram leituras
proibidas e observaram negação; no staging os testes do job conferiram a
**metainformação da permissão** `has_column_privilege(...)=false`.
A validação de aplicação completa (login PIN real, criação/revogação de sessão,
escrita auditada e carga concorrente através do pooler) ainda não foi feita.

## Roles e credenciais

- `alm_api` e `alm_job`: roles de permissão `NOLOGIN`, sem `BYPASSRLS`.
- `alm_runtime_api` e `alm_runtime_job`: logins separados,
  `LOGIN NOINHERIT NOBYPASSRLS`, sem `SUPERUSER`, `CREATEROLE`,
  `CREATEDB` ou `REPLICATION`, com limites 5 e 2 conexões.
- Grants de membership: `SET TRUE` apenas para o grupo correspondente,
  `INHERIT FALSE`, `ADMIN FALSE`; sem direito ao outro papel.
- Provisionamento feito sob autorização específica. A migration de
  infraestrutura `20261015045033_alm_runtime_logins_bootstrap` criou as
  contas com `PASSWORD NULL`; **depois** o operador definiu senhas distintas
  via `psql \password` fora do repositório e autenticou as duas contas.
- **Jamais** registrar senhas, conexão com senha embutida, PIN, hash/pepper ou
  token de sessão no Git, logs, prints, tickets ou frontend.
- SQL de infraestrutura histórico, sem segredo:
  `supabase/infrastructure/20261015045033_alm_runtime_logins_bootstrap.sql`.
  As **11 migrations de domínio** não foram alteradas; staging possui
  **12 entradas** no histórico por incluir o bootstrap de logins.
- `alm` não é exposto diretamente a `anon`/`authenticated`; a política RLS
  técnica autoriza `alm_api` e `alm_job`. As **regras de autorização por
  perfil humano devem ser aplicadas pela API**, não apenas por `p_tecnico`.

## Contrato para o backend (tarefa futura de outro integrante)

1. Substituir `X-User-Id` e os usuários demo por autenticação servidor:
   localizar `alm.usuarios` pela `matricula`, verificar status ativo e
   bloquear credenciais inválidas/expiradas/bloqueadas; resposta uniforme para
   matrícula ou PIN inválidos. Confirmar política de PIN com a equipe.
2. Conferir PIN no servidor usando hash adequado (preferência Argon2id com
   salt único; alternativa scrypt se justificada) e **pepper versionado fora
   do banco**. Limitar tentativas por matrícula/IP; não registrar PIN/hash
   em logs ou trilhas.
3. Criar sessão opaca com token aleatório criptograficamente seguro; guardar
   **somente SHA-256 (32 bytes)** em `alm.sessoes`; cookie
   `HttpOnly; Secure; SameSite=Lax`; implementar validade absoluta,
   inatividade, revogação e logout. Tratar CSRF em endpoints mutáveis.
4. Conectar somente no backend Node.js **em execução local**, usando TLS
   e segredo gerenciado. Os modos **Supavisor Session :5432** e
   **Transaction :6543** foram testados, mas a escolha depende de driver,
   padrão de conexões e testes de carga reais — **não da Vercel**.
   Usar host oficial copiado do Dashboard. Jamais usar `postgres` ou
   `service_role` como identidade de execução da API.
5. Toda operação que requer role técnica e trilha auditável deve usar **o
   mesmo cliente PostgreSQL e uma transação explícita**. Exemplo esquemático
   para operação de usuário *já autenticado*:

   ```sql
   BEGIN;
   SET LOCAL ROLE alm_api;
   SELECT set_config('app.usuario_id', $1, true); -- UUID do usuário da sessão validada
   SELECT set_config('app.request_id', $2, true); -- UUID da requisição
   -- Definir app.ip e app.user_agent quando exigidos por auditoria.
   -- Comando de negócio parametrizado.
   COMMIT; -- ROLLBACK em qualquer falha
   ```

   Nunca aceitar `app.usuario_id`, perfil ou `app.ator_sistema` diretamente
   do corpo/cabeçalhos do navegador. Para processo interno, usar
   `alm_runtime_job`, `SET LOCAL ROLE alm_job` e `app.ator_sistema` conforme
   o contrato auditável, sem forjar identidade humana.
6. **Não confiar em estado de sessão** entre transações no pooler :6543;
   utilizar `SET LOCAL` e liberar o cliente no `finally`. Evitar prepared
   statements nomeados e testar compatibilidade do driver `pg`.
7. Adaptar domínio atual: `USR-001` não é UUID; perfis de UI como
   `Administrador` devem ser mapeados aos valores SQL como
   `ADMINISTRADOR`. **PostgreSQL/Supabase é a persistência principal
   definida**, não uma opção futura. O backend atual ainda grava no Sheets;
   substituí-lo pelo PostgreSQL mediante testes e plano de migração
   preservando dados, sem criar espelho ou sincronização novos.
   Google Drive permanece responsável pelos bytes de anexos; os metadados
   e vínculos ficam no Supabase. A consulta tipo planilha no dashboard
   será somente leitura, com exportação CSV pela aplicação.
8. Não manter transação ou lock PostgreSQL aberto durante uploads ao Drive.

## Check-list de aceite antes de usar dados reais

- [x] 11 migrations de domínio, 28 tabelas/policies técnicas e suíte SQL
      aprovadas no estágio anterior (137 testes PostgreSQL local,
      114 testes staging).
- [x] Dois logins técnicos provisionados no staging e senhas configuradas
      interativamente fora do GitHub.
- [x] Session :5432 para API e job validado.
- [x] Transaction :6543 para API e job validado.
- [x] `session_user` e `current_user` verificados sob `SET LOCAL ROLE`.
- [x] Permissões de colunas sensíveis do job resultaram `false`.
- [ ] Políticas funcionais do PIN, reset/recuperação e bootstrap do
      primeiro administrador aprovadas.
- [ ] Backend integrado a PostgreSQL com autenticação real e autorização
      por pessoa/ação, sem `X-User-Id` confiado.
- [ ] Testes E2E: login válido/inválido, rate limit, expiração, bloqueio,
      troca de PIN, logout, revogação, sessões concorrentes e CSRF.
- [ ] Transações auditadas de escrita e rollback, concorrência, erros de
      rede e compatibilidade driver/pooler sob carga.
- [ ] Plano de migração/recuperação dos dados do Sheets validado.
- [ ] Segredos nos ambientes de deploy configurados por responsável
      autorizado, sem exposição ao frontend.
- [ ] CI/billing GitHub Actions solucionado e execução automatizada
      revisada (continua pendente de contexto prévio).

## Segurança e rollback

Para falha operacional, desabilitar os logins em procedimento autorizado
(`ALTER ROLE ... NOLOGIN`) e revogar a distribuição dos segredos.
A restauração pontual `REVOKE`/`DROP ROLE` consta no
`supabase/tests/STAGING_LOGINS_RUNBOOK.md`. **Não** executar essas
instruções automaticamente, não usar `DROP OWNED` ou resetar o projeto.

**Referência técnica:** `supabase/tests/CONTRATO_MATRICULA_PIN.md` e
`supabase/tests/STAGING_LOGINS_RUNBOOK.md`.
