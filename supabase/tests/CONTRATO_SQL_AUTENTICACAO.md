# ALM — contrato SQL de matrícula/PIN, sessões e permissões

**Data:** 15/10/2026. **Escopo:** contrato do schema **existente** para
implementação futura da API Node.js pelo Goran. Não existe login humano
funcional implementado nem administrador real criado no staging.
Não cria endpoint, conta, PIN ou migration.

## 1. Tabelas e campos para a API

| Entidade SQL | Campos relevantes | Contrato existente |
|---|---|---|
| `alm.usuarios` | `id uuid` PK, `matricula text UNIQUE` (índice parcial, não nula para novos usuários), `nome`, `perfil`, `ativo`, `legado`, `email` | Matrícula com CHECK `^[0-9A-Z]{3,20}$`; zeros iniciais importam; `legado=true` permite usuários históricos sem matrícula |
| `alm.credenciais_pin` | `usuario_id uuid` PK/FK, `pin_hash text`, `algoritmo`, `pepper_versao`, `temporario`, `expira_em`, `definido_em`, `definido_por`, `falhas_consecutivas`, `ultima_falha_em`, `bloqueado_ate`, `bloqueado_em`, `motivo_bloqueio`, `ultimo_login_em` | `algoritmo` aceita `argon2id` ou `scrypt`. Falhas, expiração e bloqueio **não** são políticas automáticas completas: a API deve aplicá-las |
| `alm.sessoes` | `id uuid`, `usuario_id uuid`, `token_hash bytea UNIQUE`, `criada_em`, `ultimo_uso_em`, `ocioso_max_segundos`, `expira_em`, `revogada_em`, `motivo_revogacao`, `ip`, `user_agent`, `terminal` | CHECK de SHA-256 com 32 bytes (migration de segurança), `ocioso_max_segundos BETWEEN 60 AND 86400`, `expira_em > criada_em` |
| `alm.eventos_autenticacao` | `id bigint`, `ocorreu_em`, `tipo`, `usuario_id`, `ator_usuario_id`, `matricula_informada`, `sucesso`, `motivo`, `ip`, `user_agent`, `request_id` | Eventos são imutáveis; sem hash, PIN, token ou pepper em auditoria |
| `alm.papeis` | `codigo`, `nome`, `tipo`, `ativo`, `ordem` | Perfis funcionais e superiores |
| `alm.usuario_papeis` | `usuario_id`, `papel_codigo`, `papel_tipo`, `concedido_em`, `concedido_por`, `revogado_em`, `revogado_por` | Papel superior adicional ativo quando `revogado_em IS NULL` |

**Perfil funcional** em `usuarios.perfil`:
`ADMINISTRADOR`, `ALMOXARIFADO`, `SUPRIMENTOS`,
`CONSULTA`, `PORTARIA`.
Papel superior adicional em `usuario_papeis`:
`ENCARREGADO`, `SUPERVISOR`, `GERENTE`.
**A matriz de permissões por ação humana é responsabilidade do backend.**
A RLS técnica `p_tecnico` não autoriza pessoas individualmente.

## 2. Fluxo sugerido para o backend (a implementar)

1. Receber matrícula+PIN por rota de autenticação; normalizar matrícula
   conforme formato **aprovado** (nunca converter para número, pois
   zeros à esquerda são significativos).
2. No backend, com `alm_runtime_api` + `SET LOCAL ROLE alm_api`,
   localizar `usuarios` pela matrícula exata; exigir `ativo=true`.
   Usuário sem matrícula/credencial PIN não autentica por esse método.
3. Consultar `credenciais_pin` **internamente no servidor**;
   verificar `temporario`, `expira_em`, bloqueios e contadores.
   Verificar hash usando Argon2id com salt (ou scrypt justificado),
   e pepper versionado **fora** do banco. Não retornar hash ao cliente.
4. Em falha, registrar evento de autenticação e atualizar contador de
   forma resistente a concorrência, aplicando rate limit por matrícula
   e origem. Usar resposta pública uniforme para evitar enumeração
   de matrículas. Definir o bloqueio/recuperação com a equipe.
5. Em sucesso, atualizar metadados de credencial conforme a política
   aprovada, registrar `LOGIN_SUCESSO` e criar `alm.sessoes`.
   Gerar token opaco criptograficamente forte; salvar **somente**
   o SHA-256 do token como `bytea` de 32 bytes.
   Entregar token só por cookie `HttpOnly; Secure; SameSite=Lax`
   (avaliar CSRF e domínio/path).
6. Para cada requisição autenticada, comparar o SHA-256 do token
   apresentado com `sessoes.token_hash`, exigir
   `revogada_em IS NULL`, `expira_em > now()`, usuário ativo e
   tempo de ociosidade dentro de `ocioso_max_segundos` desde
   `ultimo_uso_em`. Atualizar `ultimo_uso_em` com regra de frequência
   e corrida definida no backend. Logout/revogação define
   `revogada_em` e registra evento.
7. Usuário autenticado não é automaticamente autorizado a toda
   operação: consultar perfil/papéis ativos e aplicar matriz de
   permissões no servidor.

**Esse é o fluxo a implementar, não uma prova de login E2E.**
`temporario=true` e `expira_em` presentes no schema não
estabelecem por si só o período máximo de validade de PIN.
Não confiar em `X-User-Id` vindo do browser.

### Consulta esquemática de localização

```sql
-- Executar pelo backend, em transação sob alm_api; parâmetros do driver.
SELECT u.id, u.matricula, u.nome, u.perfil, u.ativo,
       c.pin_hash, c.algoritmo, c.pepper_versao,
       c.temporario, c.expira_em, c.falhas_consecutivas,
       c.ultima_falha_em, c.bloqueado_ate, c.bloqueado_em
  FROM alm.usuarios AS u
  LEFT JOIN alm.credenciais_pin AS c ON c.usuario_id = u.id
 WHERE u.matricula = $1;
```

`pin_hash` nesse SELECT deve permanecer estritamente em memória no
backend durante a verificação: jamais enviar no JSON de resposta, log,
CSV ou auditoria. Não usar `SELECT *` nessas tabelas sensíveis.

## 3. Roles de conexão, grants e contexto

- `alm_runtime_api`: LOGIN técnico para conectar; `NOINHERIT`,
  `NOBYPASSRLS`, sem poderes administrativos. Limite de
  **5 conexões** configurado. Pode `SET ROLE alm_api`.
- `alm_runtime_job`: LOGIN técnico para tarefas internas, mesmas
  restrições; limite **2 conexões**. Pode `SET ROLE alm_job`.
- `alm_api`, `alm_job`: grupos de permissão `NOLOGIN`; ambos
  protegidos por RLS, sem `BYPASSRLS`.
- `alm_api`: SELECT/INSERT/UPDATE em `usuarios`, `credenciais_pin`,
  `sessoes` e operações relevantes; INSERT/SELECT nos eventos,
  **sem UPDATE/DELETE de eventos**. Não tem exclusão física de
  negócio.
- `alm_job`: **não possui SELECT de `pin_hash` nem
  `sessoes.token_hash`**. Lê somente colunas específicas de
  `alm.sessoes` para limpeza, com DELETE restrito ao job.
- `alm` não deve ser exposto ao navegador/Data API usando
  `anon` ou `authenticated`.

Para escritas autenticadas, usar **a mesma conexão e transação**:

```sql
BEGIN;
SET LOCAL ROLE alm_api;
SELECT set_config('app.usuario_id', $1, true);
SELECT set_config('app.request_id', $2, true);
-- SQL parametrizado da operação autorizada.
COMMIT;
```

`app.usuario_id` deve vir **da sessão validada no servidor**, não do
corpo da requisição. Para processos internos com `alm_job`,
configurar `app.ator_sistema` e não forjar usuário humano.
A auditoria exige **exatamente um** de `app.usuario_id` ou
`app.ator_sistema` nas operações que a utilizam.
Para falha de login, o usuário ainda não está autenticado:
não configurar uma identidade humana não verificada como ator.

A conexão foi testada no Supavisor Session :5432 e Transaction :6543
com ambos os logins em 15/10/2026. **Escolha inicial a validar no
backend local**: Session :5432, sem dependência de Vercel.
TLS obrigatório; compatibilidade do driver `pg`, timeouts,
prepared statements e limite de pool precisam de teste de integração.
Não usar `postgres`, `service_role` ou senha administrativa
na API cotidiana.

**Nomes de variáveis propostos, não contrato do código já existente:**
`ALM_DB_HOST`, `ALM_DB_PORT`, `ALM_DB_NAME`,
`ALM_DB_API_USER`, `ALM_DB_API_PASSWORD`,
`ALM_DB_JOB_USER`, `ALM_DB_JOB_PASSWORD`,
`ALM_DB_SSL_MODE`, `ALM_PIN_PEPPER_V1`.
Não versionar valores de segredos nem URLs com senha.

## 4. Erros SQL vs. regras da API

| Situação | Banco / comportamento | A API deve fazer |
|---|---|---|
| Matrícula não encontrada, inativa ou PIN errado | SELECT sem linha ou hash não confere | Resposta pública uniforme; não enumerar contas |
| PIN expirado, temporário ou bloqueado | Metadados persistidos no banco | Definir e aplicar política funcional aprovada |
| Sessão expirada/ociosa/revogada | Colunas de `sessoes` | Rejeitar mesmo se hash do token corresponder |
| Duplicata/índice único | SQLSTATE `23505` | Mapear conflito sem expor IDs sensíveis |
| FK inválida | `23503` | Erro de validação/associação |
| CHECK inválido | `23514` | Rejeitar dados inválidos |
| Campo NOT NULL ausente | `23502` | Rejeitar ou solicitar campo |
| Acesso negado ao papel | `42501` | Falha de autorização/configuração |
| Exceção de função PL/pgSQL | Em geral `P0001` + mensagem definida | Traduzir mensagem controladamente, sem escapar stacktrace |

**Não foram aprovadas:** tamanho de PIN, tentativas/bloqueio,
expiração/recuperação, frequência de renovação da sessão, regras
de primeiro administrador e eventual política multi-dispositivo.
Nenhum usuário/PIN real deve ser criado em migrations para suprir
essas definições.

## 5. Testes de aceite pendentes da API

Login válido e inválido, matrícula desconhecida, usuário inativo,
PIN temporário/bloqueado/expirado, concorrência no contador de falhas,
rate limit, reset, cookie e CSRF, sessão ociosa/absoluta/revogada,
logout, proibição de acesso entre perfis, job sem leitura de hash,
logs sem segredos, rollback em falhas e funcionamento com pooler.
Esses testes ainda não foram executados como fluxo funcional integrado.

**Arquivos-base:** `supabase/migrations/20261007160100_alm2_delta.sql`,
`20261015030000_alm_seguranca_auth.sql`,
`supabase/tests/CONTRATO_MATRICULA_PIN.md`,
`supabase/tests/HANDOFF_BACKEND_MATRICULA_PIN.md`.
