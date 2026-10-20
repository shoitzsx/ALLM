-- Defesa de integridade sobre base + delta; nao altera a extracao da v1.
BEGIN;

REVOKE ALL ON alm.recebimento_numeradores FROM alm_api, alm_job;

ALTER TABLE alm.filtros_salvos ADD CONSTRAINT ck_filtros_exclusao CHECK (
    (excluido_em IS NULL AND excluido_por IS NULL AND motivo_exclusao IS NULL)
    OR (excluido_em IS NOT NULL AND excluido_por IS NOT NULL
        AND nullif(btrim(motivo_exclusao), '') IS NOT NULL)
);

-- Regra de integridade da secao 4, mantida fora da base extraida da secao 3.
CREATE UNIQUE INDEX uq_itens_recebimento_numero_ativo
    ON alm.recebimento_itens (recebimento_id, numero_item)
    WHERE excluido_em IS NULL;

CREATE INDEX ix_recebimentos_ativos ON alm.recebimentos (recebido_em DESC, id)
    WHERE excluido_em IS NULL;
CREATE INDEX ix_arquivos_recebimento_ativos ON alm.arquivos (recebimento_id, id)
    WHERE excluido_em IS NULL;

CREATE OR REPLACE FUNCTION alm.bloquear_mutacao_filho_finalizado()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_antigo uuid;
    v_novo uuid;
    v_finalizado boolean := false;
    v_pai record;
    v_sistema text := nullif(current_setting('app.ator_sistema', true), '');
    v_tecnicas constant text[] := ARRAY[
        'status_upload', 'integridade_verificada_em', 'storage_etag',
        'storage_version_id', 'provider_metadata', 'alterado_em',
        'alterado_por', 'versao', 'armazenamento_estado', 'quarentena_em',
        'purga_prevista_em', 'purgado_em', 'purgado_por'
    ];
BEGIN
    IF TG_OP <> 'INSERT' THEN v_antigo := OLD.recebimento_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_novo := NEW.recebimento_id; END IF;

    -- Ambos os pais, em ordem deterministica. NULL nao e finalizado.
    FOR v_pai IN
        SELECT id, status FROM alm.recebimentos
        WHERE id IN (v_antigo, v_novo) ORDER BY id FOR UPDATE
    LOOP
        IF v_pai.status IS NOT DISTINCT FROM 'CONFERIDO_FINALIZADO' THEN
            v_finalizado := true;
        END IF;
    END LOOP;

    IF NOT v_finalizado THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    -- Excecao identica ao delta: somente arquivo, sistema, mesmo pai,
    -- mesmo dado funcional e transicao tecnica de upload ja permitida.
    IF TG_TABLE_NAME = 'arquivos' AND TG_OP = 'UPDATE' AND v_sistema IS NOT NULL THEN
        IF (to_jsonb(OLD) - v_tecnicas) = (to_jsonb(NEW) - v_tecnicas)
           AND OLD.status_upload = 'DISPONIVEL'
           AND NEW.status_upload IN ('DISPONIVEL', 'INCONSISTENTE') THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'Reabra o recebimento antes de alterar itens, arquivos ou divergencias';
END;
$$;

CREATE OR REPLACE FUNCTION alm.incrementar_versao_agregado()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_antigo uuid;
    v_novo uuid;
    v_id uuid;
    v_usuario uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN v_antigo := OLD.recebimento_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_novo := NEW.recebimento_id; END IF;
    FOR v_id IN SELECT id FROM alm.recebimentos
        WHERE id IN (v_antigo, v_novo) ORDER BY id FOR UPDATE
    LOOP
        UPDATE alm.recebimentos SET alterado_por = coalesce(v_usuario, alterado_por)
        WHERE id = v_id;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION alm.bloquear_edicao_recebimento_finalizado()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_ignoradas constant text[] := ARRAY[
        'alterado_em', 'alterado_por', 'versao', 'busca_fts',
        'numero_nf_busca', 'pedido_busca', 'fornecedor_busca'
    ];
BEGIN
    IF OLD.status IS DISTINCT FROM 'CONFERIDO_FINALIZADO' THEN RETURN NEW; END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- preparar_recebimento ja ajustou a qualidade ao reabrir.
        IF NEW.status IS NULL OR NEW.qualidade_dados <> 'PENDENTE_CONFERENCIA'
           OR (to_jsonb(OLD) - v_ignoradas - ARRAY['status', 'qualidade_dados'])
              IS DISTINCT FROM
              (to_jsonb(NEW) - v_ignoradas - ARRAY['status', 'qualidade_dados']) THEN
            RAISE EXCEPTION 'Reabertura deve alterar somente status e qualidade';
        END IF;
    ELSIF (to_jsonb(OLD) - v_ignoradas) IS DISTINCT FROM (to_jsonb(NEW) - v_ignoradas) THEN
        RAISE EXCEPTION 'Reabra o recebimento antes de alterar dados funcionais';
    END IF;
    RETURN NEW;
END;
$$;

-- BEFORE triggers rodam por nome: controle -> preparar -> validar -> zz.
-- O guard ve a linha normalizada; historico/auditoria AFTER so rodam se aceito.
CREATE TRIGGER trg_recebimento_zz_bloquear_finalizado
BEFORE UPDATE ON alm.recebimentos
FOR EACH ROW EXECUTE FUNCTION alm.bloquear_edicao_recebimento_finalizado();

REVOKE ALL ON FUNCTION alm.bloquear_edicao_recebimento_finalizado() FROM PUBLIC;

-- Exclusao/restauracao logica de recebimentos/arquivos continua sendo UPDATE
-- atomico dos tres campos, validado pelos CHECKs existentes. Nenhum cascade,
-- DELETE, alteracao automatica de estado fisico ou integracao externa.
COMMIT;
