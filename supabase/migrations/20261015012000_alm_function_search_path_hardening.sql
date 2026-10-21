-- Hardening: fixa search_path das funcoes ALM apontadas pelo linter do Supabase.
BEGIN;

ALTER FUNCTION alm.normalizar_texto(text)
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.normalizar_identificador(text)
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.preparar_usuario()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.preparar_fornecedor()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.preparar_recebimento()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.preparar_item()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.validar_hierarquia_container()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.validar_arquivo_container()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.atualizar_controle_linha()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.atualizar_controle_usuario()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.atualizar_timestamp_catalogo()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.bloquear_mutacao_filho_finalizado()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.incrementar_versao_agregado()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.validar_finalizacao_recebimento()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.impedir_mutacao_historico()
    SET search_path = pg_catalog, alm;

ALTER FUNCTION alm.bloquear_edicao_recebimento_finalizado()
    SET search_path = pg_catalog, alm;

COMMIT;
