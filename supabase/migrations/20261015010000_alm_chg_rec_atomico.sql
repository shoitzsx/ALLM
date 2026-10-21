-- Contrato CHG -> REC: vinculo 1:1 e criacao atomica/idempotente.
BEGIN;

-- Um REC pode ter no maximo uma CHG vinculada durante toda a vida do registro.
-- RECs criados manualmente continuam permitidos, pois nao existe FK inversa obrigatoria.
CREATE UNIQUE INDEX uq_chegadas_recebimento
    ON alm.chegadas_portaria (recebimento_id)
    WHERE recebimento_id IS NOT NULL;

CREATE OR REPLACE FUNCTION alm.criar_recebimento_da_chegada(p_chegada_id uuid)
RETURNS TABLE (
    recebimento_id uuid,
    codigo varchar(20),
    reutilizado boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, alm
AS $$
DECLARE
    v_usuario_txt text := nullif(current_setting('app.usuario_id', true), '');
    v_sistema_txt text := nullif(current_setting('app.ator_sistema', true), '');
    v_usuario uuid;
    v_chegada alm.chegadas_portaria%ROWTYPE;
    v_recebimento_id uuid;
    v_codigo varchar(20);
BEGIN
    -- O fluxo e exclusivamente de usuario autenticado. A autoria vem do contexto
    -- da transacao, nao de um UUID fornecido pelo cliente.
    IF v_usuario_txt IS NULL OR v_sistema_txt IS NOT NULL THEN
        RAISE EXCEPTION 'Defina somente app.usuario_id para criar REC a partir de CHG';
    END IF;

    BEGIN
        v_usuario := v_usuario_txt::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'app.usuario_id invalido';
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM alm.usuarios u
        WHERE u.id = v_usuario
          AND u.ativo
    ) THEN
        RAISE EXCEPTION 'Usuario autenticado inexistente ou inativo';
    END IF;

    -- Serializa retries concorrentes da mesma CHG.
    SELECT c.*
      INTO v_chegada
      FROM alm.chegadas_portaria c
     WHERE c.id = p_chegada_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CHG inexistente: %', p_chegada_id;
    END IF;

    IF v_chegada.excluido_em IS NOT NULL THEN
        RAISE EXCEPTION 'CHG excluida nao pode gerar recebimento';
    END IF;

    -- Retry idempotente: se a mesma CHG ja foi vinculada, devolve o REC
    -- existente em vez de criar um segundo recebimento.
    IF v_chegada.recebimento_id IS NOT NULL THEN
        SELECT r.id, r.codigo
          INTO v_recebimento_id, v_codigo
          FROM alm.recebimentos r
         WHERE r.id = v_chegada.recebimento_id
           AND r.excluido_em IS NULL;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'REC vinculado a CHG nao esta ativo';
        END IF;

        RETURN QUERY SELECT v_recebimento_id, v_codigo, true;
        RETURN;
    END IF;

    IF v_chegada.status <> 'REGISTRADA' THEN
        RAISE EXCEPTION 'Somente CHG REGISTRADA pode gerar recebimento';
    END IF;

    INSERT INTO alm.recebimentos (
        origem,
        numero_nf,
        serie_nf,
        nfe_chave_acesso,
        fornecedor_id,
        responsavel_id,
        criado_por,
        alterado_por,
        dados_origem
    )
    VALUES (
        'OPERACIONAL',
        v_chegada.numero_nf,
        v_chegada.serie_nf,
        v_chegada.nfe_chave_acesso,
        v_chegada.fornecedor_id,
        v_usuario,
        v_usuario,
        v_usuario,
        jsonb_build_object(
            'chegada_portaria_id', v_chegada.id,
            'chegada_codigo', v_chegada.codigo
        )
    )
    RETURNING id, alm.recebimentos.codigo
      INTO v_recebimento_id, v_codigo;

    UPDATE alm.chegadas_portaria
       SET status = 'VINCULADA',
           recebimento_id = v_recebimento_id,
           vinculada_em = clock_timestamp(),
           vinculada_por = v_usuario,
           alterado_por = v_usuario
     WHERE id = v_chegada.id;

    RETURN QUERY SELECT v_recebimento_id, v_codigo, false;
END;
$$;

REVOKE ALL ON FUNCTION alm.criar_recebimento_da_chegada(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION alm.criar_recebimento_da_chegada(uuid) TO alm_api;

COMMIT;
