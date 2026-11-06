# Aplicação controlada da migration de recuperação

Preparação para o projeto Supabase de staging, **sem executar a recuperação de MKADM001**. A migration é `supabase/migrations/20261106120000_alm_recuperacao_primeiro_administrador.sql`. Este roteiro não autoriza aplicar migrations pendentes adicionais, alterar o histórico manualmente nem executar `db reset`.

## Antes de conectar

1. Obter aprovação de Kobner, revisão e merge do PR de recuperação na `main`. Confirmar com ele o projeto Supabase e a janela. A referência `uxfstabcpvmujvzijyqw` aparece na documentação histórica; confirmar no painel antes de vincular o CLI. Garantir backup ou ponto de restauração adequado. Apenas um operador executa a aplicação.
2. Instalar/autenticar o Supabase CLI no terminal privado. Nesta máquina, o CLI ainda não está instalado. Vincular **somente** o projeto aprovado, sem incluir senha na linha de comando.
3. Executar `supabase migration list --remote` e o precheck SQL abaixo por conexão administrativa de leitura. A versão imediatamente anterior `20261021120000` deve estar registrada; `20261106120000` deve estar ausente. Se houver divergência, **parar**.
4. Executar `supabase db push --dry-run --remote`. Prosseguir somente se a lista mostrar **exatamente** `20261106120000_alm_recuperacao_primeiro_administrador.sql`. O CLI aplica todas as migrations pendentes; se houver outra, **parar** e alinhar o histórico. Não usar `--include-all`, `--include-seed` ou `migration repair` como atalho.

### Precheck SQL (somente leitura)

```sql
SELECT current_database() AS banco, current_user AS login_banco,
  (SELECT count(*) FROM alm.usuarios WHERE perfil='ADMINISTRADOR') AS total_admins,
  (SELECT id FROM alm.usuarios WHERE matricula='MKADM001' AND perfil='ADMINISTRADOR') AS uuid_existente,
  EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261021120000') AS bootstrap_registrado,
  EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261106120000') AS recuperacao_registrada,
  to_regclass('alm.recuperacoes_primeiro_administrador') AS tabela_recuperacao;

SELECT u.id, p.pepper_versao, p.temporario,
  (SELECT count(*) FROM alm.autorizacoes_webauthn a
    WHERE a.usuario_id=u.id AND a.consumido_em IS NULL AND a.revogado_em IS NULL) AS autorizacoes_abertas
FROM alm.usuarios u JOIN alm.credenciais_pin p ON p.usuario_id=u.id
WHERE u.matricula='MKADM001';
```

Esperado: `total_admins=1`, UUID conhecido, `bootstrap_registrado=true`, `recuperacao_registrada=false`, tabela de recuperação ausente. Registrar o UUID e os metadados da segunda consulta **sem hashes nem segredos**.

## Aplicação única

Com o dry run conferido e autorização confirmada, executar **uma vez**:

```text
supabase db push --remote
```

Não incluir seed ou roles. Não repetir após erro ou perda de conexão: consultar o histórico e o catálogo antes de qualquer nova decisão. O CLI deve registrar a versão aplicada em `supabase_migrations.schema_migrations`; não editar essa tabela diretamente.

## Postcheck SQL (somente leitura)

```sql
SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261106120000') AS versao_registrada,
  c.relrowsecurity AS tabela_com_rls,
  has_function_privilege('alm_provisioner',
    'alm.recuperar_primeiro_administrador(uuid,text,text,bytea,smallint,timestamptz,text,text,uuid)',
    'EXECUTE') AS provisioner_executa,
  has_function_privilege('alm_api',
    'alm.recuperar_primeiro_administrador(uuid,text,text,bytea,smallint,timestamptz,text,text,uuid)',
    'EXECUTE') AS api_executa,
  has_table_privilege('alm_provisioner','alm.recuperacoes_primeiro_administrador','SELECT')
    AS provisioner_le_tabela
FROM pg_class c WHERE c.oid='alm.recuperacoes_primeiro_administrador'::regclass;

SELECT u.id, p.pepper_versao, p.temporario,
  (SELECT count(*) FROM alm.autorizacoes_webauthn a
    WHERE a.usuario_id=u.id AND a.consumido_em IS NULL AND a.revogado_em IS NULL) AS autorizacoes_abertas
FROM alm.usuarios u JOIN alm.credenciais_pin p ON p.usuario_id=u.id
WHERE u.matricula='MKADM001';
```

Esperado: `true, true, true, false, false`, respectivamente; UUID e os outros metadados do administrador **iguais ao precheck**. Esta migration é apenas DDL: não deve trocar PIN, código, pepper ou sessão. Se qualquer resultado divergir, parar e investigar. Depois, com aprovação e pepper V2 pronto, seguir o procedimento separado em `docs/RECUPERACAO-PRIMEIRO-ADMIN.md`.

Após a recuperação, desabilitar/remover **somente o login operacional temporário** conforme a aprovação do Kobner. Preservar a role `alm_provisioner` sem LOGIN e o login da API que o backend utiliza. Publicar o backend e testar HTTPS apenas depois do postcheck da recuperação e da configuração privada do pepper V2.
