-- Move extensoes para schema dedicado e atualiza referencias explicitas.
BEGIN;

ALTER EXTENSION unaccent SET SCHEMA extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

CREATE OR REPLACE FUNCTION alm.normalizar_texto(p_texto text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, alm
AS $$
    SELECT btrim(
        regexp_replace(
            lower(extensions.unaccent(coalesce(p_texto, ''))),
            '[^a-z0-9]+',
            ' ',
            'g'
        )
    );
$$;

CREATE OR REPLACE FUNCTION alm.normalizar_identificador(p_texto text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, alm
AS $$
    SELECT upper(
        regexp_replace(
            extensions.unaccent(coalesce(p_texto, '')),
            '[^A-Za-z0-9]',
            '',
            'g'
        )
    );
$$;

CREATE OR REPLACE FUNCTION alm.preparar_recebimento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, alm
AS $$
DECLARE
    v_ano smallint;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.origem = 'MIGRACAO' THEN
            NEW.qualidade_dados := coalesce(NEW.qualidade_dados, 'NAO_CONFERIDO');
            NEW.status := NULL;
        ELSE
            NEW.qualidade_dados := coalesce(NEW.qualidade_dados, 'PENDENTE_CONFERENCIA');
            NEW.status := coalesce(NEW.status, 'EM_DIGITACAO');
        END IF;
    ELSIF NEW.origem IS DISTINCT FROM OLD.origem THEN
        RAISE EXCEPTION 'origem do recebimento e imutavel';
    ELSIF OLD.status = 'CONFERIDO_FINALIZADO'
          AND NEW.status IS DISTINCT FROM 'CONFERIDO_FINALIZADO' THEN
        NEW.qualidade_dados := 'PENDENTE_CONFERENCIA';
    END IF;

    IF NEW.status = 'CONFERIDO_FINALIZADO' THEN
        NEW.qualidade_dados := 'CONFERIDO';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.codigo IS NOT NULL THEN
            RAISE EXCEPTION 'codigo e gerado exclusivamente pelo banco';
        END IF;
        v_ano := coalesce(
            extract(year FROM NEW.recebido_em AT TIME ZONE 'America/Sao_Paulo')::smallint,
            NEW.ano_referencia,
            extract(year FROM clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::smallint
        );
        NEW.codigo := alm.proximo_codigo_recebimento(v_ano);
    ELSIF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
        RAISE EXCEPTION 'codigo do recebimento e imutavel';
    END IF;

    IF NEW.fornecedor_id IS NOT NULL
       AND (
           TG_OP = 'INSERT'
           OR NEW.fornecedor_id IS DISTINCT FROM OLD.fornecedor_id
           OR nullif(btrim(NEW.fornecedor_nome_snapshot), '') IS NULL
       ) THEN
        SELECT coalesce(f.nome_fantasia, f.razao_social), f.cnpj
          INTO NEW.fornecedor_nome_snapshot, NEW.fornecedor_cnpj_snapshot
          FROM alm.fornecedores f
         WHERE f.id = NEW.fornecedor_id;
    ELSIF NEW.origem = 'OPERACIONAL' AND NEW.fornecedor_id IS NULL THEN
        NEW.fornecedor_nome_snapshot := NULL;
        NEW.fornecedor_cnpj_snapshot := NULL;
    END IF;

    NEW.numero_nf_busca := alm.normalizar_identificador(NEW.numero_nf);
    NEW.pedido_busca := alm.normalizar_identificador(NEW.pedido_compra);
    NEW.fornecedor_busca := alm.normalizar_texto(
        concat_ws(' ', NEW.fornecedor_nome_snapshot, NEW.fornecedor_cnpj_snapshot)
    );
    NEW.busca_fts :=
          setweight(to_tsvector('simple', NEW.numero_nf_busca), 'A')
        || setweight(to_tsvector('simple', NEW.pedido_busca), 'A')
        || setweight(to_tsvector('portuguese', extensions.unaccent(coalesce(NEW.fornecedor_nome_snapshot, ''))), 'B')
        || setweight(to_tsvector('portuguese', extensions.unaccent(coalesce(NEW.observacoes, ''))), 'D');
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION alm.preparar_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, alm
AS $$
BEGIN
    NEW.codigo_produto_busca := alm.normalizar_identificador(NEW.codigo_produto);
    NEW.descricao_busca := alm.normalizar_texto(NEW.descricao);
    NEW.busca_fts :=
          setweight(to_tsvector('simple', NEW.codigo_produto_busca), 'A')
        || setweight(to_tsvector('portuguese', extensions.unaccent(NEW.descricao)), 'B')
        || setweight(to_tsvector('portuguese', extensions.unaccent(coalesce(NEW.observacoes, ''))), 'C');
    RETURN NEW;
END;
$$;

COMMIT;
