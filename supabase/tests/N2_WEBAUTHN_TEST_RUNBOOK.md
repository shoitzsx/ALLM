# ALM 2.0 — N-2 WebAuthn (implementação incremental para revisão)

**Status:** IMPLEMENTAÇÃO CANDIDATA, NÃO HOMOLOGADA. Os testes de integração PostgreSQL 17 **não foram executados** no ambiente desta entrega: faltam servidor PostgreSQL 17, `psql` e dependências `pg` locais. Não interpretar verificações estáticas como aprovação de SQL real. Staging e produção não foram alterados. Antes de merge/deploy: instalação limpa, regressões e revisão do Goran.

**Base obrigatória:** PR #2 `audit/alm-pin-login-pg17-20261015` no commit `da2ef653beda429f627323c86ae888c65977319a`. Não basear em `main` até a integração do PR #2. 11 migrations do PR #2 devem estar previamente instaladas; N-2 é o 12º arquivo **em `supabase/migrations/`**, separado do bootstrap histórico em `supabase/infrastructure/`.

## Arquivos

- `supabase/migrations/20261019180000_alm_n2_webauthn.sql`: quatro novas tabelas, extensões de sessão/eventos, triggers de integridade e auditoria mínima, revogação atômica por trigger, grants por coluna e RLS. Mantém compatibilidade com sessão legada **sem MFA** usada na suíte histórica; é proibido aceitá-la no middleware N-2.
- `supabase/tests/test-webauthn-n2.mjs`: integração SQL com PostgreSQL 17, incluindo concorrência real, desafio consumido, validação de vínculo na matrícula, grants, revogação e recusa de consumo expirado. Testes criam fixtures de usuários, credenciais e sessões. Executar apenas em banco descartável.

## Como testar localmente (somente localhost)

**Obrigatório:** criar instância **NOVA** PostgreSQL 17 em loopback, banco `alm_ci_clean`, sem schema `alm` ou roles técnicas. Node.js, `pg` e dependências do runner do PR #2 precisam estar instalados fora do repositório (ver `supabase/tests/README.md` da PR #2).

A suíte original `apply-clean.mjs` do PR #2 exige exatamente 28 tabelas; por isso ela **não deve ser executada de dentro da branch N-2**, que contém quatro tabelas adicionais. Execute a instalação base em um worktree separado **no commit do PR #2**, depois aplique **somente** o delta N-2 com `psql`:

```bash
# Na raiz do repositorio ALM: cria uma copia isolada do commit do PR #2.
git worktree add --detach ../ALLM_pr2_base da2ef653beda429f627323c86ae888c65977319a

export ALM_DB_TEST_DEPS="$LOCALAPPDATA/Temp/opencode"
export ALM_LOCAL_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/alm_ci_clean'
read -s -p 'Senha somente local do PG17: ' PGPASSWORD; echo
export PGPASSWORD

# Na copia PR #2: instala as 11 migrations e roda os 137 testes SQL.
(cd ../ALLM_pr2_base && node supabase/tests/apply-clean.mjs && node supabase/tests/run-database.mjs --local)

# Na branch N-2: aplica SOMENTE a migration nova na mesma base descartavel.
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55433 -U postgres -d alm_ci_clean \
  -f supabase/migrations/20261019180000_alm_n2_webauthn.sql
export ALM_DB_TEST_DISPOSABLE=YES
node --test supabase/tests/test-webauthn-n2.mjs
unset ALM_DB_TEST_DISPOSABLE PGPASSWORD ALM_LOCAL_DATABASE_URL
```

O comando `git worktree add` necessita da referência histórica já obtida com `git fetch`; não altera a branch atual nem `main`. Testes N-2 deixam fixtures no banco descartável; destruir o banco ao final. **Nunca reexecutar `apply-clean` ou a migration N-2 no mesmo banco.** Em ambiente de teste futuro o instalador deverá ser atualizado para aceitar as novas tabelas, com autorização separada.

## Contrato para Goran (@simplewebauthn/server 14.0.3)

- Salvar `credential.id` decodificado de Base64URL canônico como `bytea`, `credential.publicKey` como `bytea` COSE (Uint8Array) e `credential.counter` como `sign_count`; definir `algoritmo_cose` mediante parsing COSE validado, não receber do browser.
- PIN correto gera somente `alm.fluxos_auth_parcial`, com hash SHA-256 do cookie `__Host-alm_pre_mfa`. **Nunca** criar `alm.sessoes` antes da verificação WebAuthn.
- Na autenticação, inserir desafio com `challenge_hash` SHA-256 e `vinculo_fluxo_hash` igual ao hash do cookie; a FK tripla amarra usuário/fluxo/hash. No cadastro com sessão MFA, usar o **hash do cookie de sessão** como vínculo; com convite de ativação, usar o **hash do token aleatório do convite**, com FKs triplas que impedem misturar titulares ou hashes. Nunca aceitar o `challengeId` sozinho como autorização. Não gravar challenge bruto.
- Consumir desafio de forma única (`UPDATE ... WHERE consumido_em IS NULL AND expira_em > clock_timestamp() RETURNING ...`) e **COMMITAR esse consumo mesmo se a assinatura falhar**. A verificação da assinatura acontece fora da transação de consumo.
- Após WebAuthn aprovado, em NOVA transação com `SET LOCAL ROLE alm_api`, travar credencial `FOR UPDATE`, revalidar usuário, vínculo e revogação, consumir o fluxo parcial, inserir `alm.sessoes` com MFA completo, atualizar contador e registrar eventos; commit antes de enviar cookie final. O banco também protege sessão final com trigger e FK composta.
- Revogação de credencial exige `revogado_por` humano equivalente a `app.usuario_id`; trigger faz `UPDATE alm.sessoes ... revogada_em` no MESMO commit. Sem caminho técnico de revogação sistêmica nesta versão.
- Cadastro/recovery só com autorização de alta entropia e aprovação humana; `codigo_hash` é SHA-256 de token aleatório, nunca PIN curto. Autorizações e seus eventos são auditados sem copiar hash.
- Grants SQL não implementam autorização humana. Backend deve verificar sessão WebAuthn completa + permissão por operação, nunca confiar em `X-User-Id`.

## Decisões/bloqueios concretos a discutir

1. RP ID / origin do sistema e política de dispositivos; o banco guarda RP por desafio, mas a validação real cabe ao backend.
2. PIN de 8 dígitos, rate limit e expiração ainda aguardam aprovação funcional.
3. Primeiro admin / revogação excepcional sem ator humano não é coberto pelo modelo que exige `revogado_por`; precisa procedimento aprovado. Não cadastrar admin fictício.
4. `alm.sessoes` ainda permite linhas SEM MFA para preservar os 137 testes históricos; o trigger **somente** valida e trava as linhas MFA. É requisito de segurança do middleware N-2 rejeitar qualquer linha sem MFA. Um endurecimento futuro de obrigatoriedade em todo INSERT precisa de plano de transição e testes antes de aprovação.
5. Schema não fornece função SQL única para fim de MFA: a transação é coordenada pelo serviço Node; o próximo teste deve envolver a implementação do Goran com assinatura WebAuthn real.
6. Validar SQL real, triggers, grants por coluna e concorrência em PostgreSQL 17, além de testes end-to-end com assinaturas reais e a biblioteca fixada do Goran; repetir 137 testes SQL da base e 109 testes de backend e build. Nesta entrega nenhuma dessas suítes foi executada neste ambiente.

## Sem autorização para deploy

Não executar esta migration no staging nem em produção. Não alterar as 11 migrations históricas, a branch Goran, ou `main` para revisar este pacote.

## Evidências de execução neste ambiente

- Verificação `node --check` no arquivo de testes: **aprovada**.
- Inspeção estática de dependências de tabelas/índices do PR #2: realizada; **não equivale a parse ou execução SQL**.
- Instalação e testes PostgreSQL 17.11 reais: **bloqueados** por ausência de servidor PostgreSQL local e impossibilidade de instalação de pacotes nesta sessão.
- Os arquivos não incluem comandos que criem usuários no staging ou usem senhas remotas; execução real somente em `alm_ci_clean` descartável sob loopback.

## Dependência de homologação

Este delta depende estritamente do HEAD do PR #2 indicado acima. Não editar as 11 migrations históricas nem fazer merge automático do PR #2. Esta branch deve receber revisão antes de qualquer aplicação remota. O trabalho do Goran citado inclui arquivos ainda **sem commit no PC dele**, portanto não foi possível executar o backend de WebAuthn integrado nesta sessão.

## Nota da implementação incremental (19/10)

O delta exige também vinculação tripla de hash para REGISTRO (sessão autenticada ou autorização administrativa), além de AUTENTICACAO. Os triggers impedem consumo de fluxo, autorização ou desafio expirados. Os testes acrescentam essas regressões. A documentação técnica e o código ainda exigem teste real PostgreSQL 17 e revisão do Goran.
