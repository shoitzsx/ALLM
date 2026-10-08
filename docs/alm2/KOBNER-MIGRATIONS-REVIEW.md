# Proposta de migrations — frente Kobner

Base analisada: `fix/vercel-api-routing` @ `ed0d2f3962c525cb32b39029e696af16ea15c1d3`.

## Situação
Esta proposta NÃO foi commitada, NÃO alterou nenhuma branch e NÃO foi executada no Supabase.

## Estrutura preparada
- `supabase/migrations/20261007160000_alm_v1_base.sql`
- `supabase/migrations/20261007160100_alm2_delta.sql`
- atualização proposta de `docs/alm2/sql/001_alm2_delta.sql`

## Correções no delta
1. Usuários existentes da v1 entram como `legado=true` durante a migration; o default é trocado para `false` imediatamente depois para novos usuários.
2. `oidc_issuer` e `oidc_subject` passam a ser opcionais apenas em conjunto.
3. Portaria: vínculo exige `recebimento_id`, `vinculada_em` e `vinculada_por` ao mesmo tempo.
4. Portaria: `numero_nf` vazio não satisfaz mais a identificação.
5. `alm_job` perde SELECT em `credenciais_pin` e `eventos_autenticacao`.
6. `alm_job` lê somente colunas não sensíveis de `sessoes`, sem `token_hash`.
7. `alm_api` apenas insere em `outbox`; processamento da fila e estado de `espelho_sheets` ficam com `alm_job`.

## Migration base
O DDL base foi extraído mecanicamente dos quatro blocos SQL da seção 3 de `ARQUITETURA_TECNICA_ALM.md`.
Nenhuma regra funcional da v1 foi alterada nessa extração.

## PENDÊNCIA BLOQUEADORA
Antes de executar qualquer migration no Supabase real:
- confirmar o schema onde a extensão `unaccent` está/será instalada;
- o DDL v1 usa `public.unaccent(...)`;
- a documentação atual do Supabase recomenda extensões no schema `extensions`;
- o projeto "ALM recebimentos" está INACTIVE e não foi restaurado.

## Fora do escopo
Vercel, Google Sheets e Google Drive não fazem parte desta etapa.
