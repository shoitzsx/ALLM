-- Hardening pontual, sem mudar o contrato de autenticacao da aplicacao.
-- Reforca a duracao do token hash e audita alteracoes relevantes sem copiar segredos.
BEGIN;

-- Funcao de trigger: nao necessita EXECUTE direto pelas roles da aplicacao.
REVOKE EXECUTE ON FUNCTION alm.bloquear_restauracao_arquivo_purgado() FROM PUBLIC;

-- O token opaco e entregue pela aplicacao; persistimos apenas seu SHA-256.
-- Se existir alguma sessao legada com hash invalido, o VALIDATE aborta a
-- transacao inteira (em vez de deixar o banco parcialmente migrado).
ALTER TABLE alm.sessoes
    ADD CONSTRAINT ck_sessoes_token_hash_32
    CHECK (octet_length(token_hash) = 32) NOT VALID;
ALTER TABLE alm.sessoes VALIDATE CONSTRAINT ck_sessoes_token_hash_32;

-- Historico de PIN: alteracoes de configuracao e bloqueio tambem sao eventos
-- auditaveis. Contadores de tentativas e timestamps de login sao operacionais
-- e devem ser rastreados via alm.eventos_autenticacao, evitando flood no log.
-- Nunca armazenar pin_hash nem token_hash em dados_antes / dados_depois.
CREATE OR REPLACE FUNCTION alm.auditar_credencial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, alm
AS $audit$
DECLARE
    v_usuario_txt text := nullif(current_setting('app.usuario_id', true), '');
    v_sistema_txt text := nullif(current_setting('app.ator_sistema', true), '');
    v_campos text[];
    v_antes jsonb;
    v_depois jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_campos := ARRAY[
            'pin_hash', 'algoritmo', 'pepper_versao', 'temporario',
            'expira_em', 'definido_em', 'definido_por',
            'bloqueado_ate', 'bloqueado_em', 'motivo_bloqueio'
        ];
    ELSE
        SELECT array_agg(campo ORDER BY ordem)
          INTO v_campos
          FROM (
              VALUES
                  (1, 'pin_hash', OLD.pin_hash IS DISTINCT FROM NEW.pin_hash),
                  (2, 'algoritmo', OLD.algoritmo IS DISTINCT FROM NEW.algoritmo),
                  (3, 'pepper_versao', OLD.pepper_versao IS DISTINCT FROM NEW.pepper_versao),
                  (4, 'temporario', OLD.temporario IS DISTINCT FROM NEW.temporario),
                  (5, 'expira_em', OLD.expira_em IS DISTINCT FROM NEW.expira_em),
                  (6, 'definido_em', OLD.definido_em IS DISTINCT FROM NEW.definido_em),
                  (7, 'definido_por', OLD.definido_por IS DISTINCT FROM NEW.definido_por),
                  (8, 'bloqueado_ate', OLD.bloqueado_ate IS DISTINCT FROM NEW.bloqueado_ate),
                  (9, 'bloqueado_em', OLD.bloqueado_em IS DISTINCT FROM NEW.bloqueado_em),
                  (10, 'motivo_bloqueio', OLD.motivo_bloqueio IS DISTINCT FROM NEW.motivo_bloqueio)
          ) AS mudancas(ordem, campo, mudou)
         WHERE mudou;

        -- Tentativas falhas e uso de sessao nao sao mudancas de credencial.
        IF v_campos IS NULL THEN
            RETURN NEW;
        END IF;

        v_antes := jsonb_build_object(
            'algoritmo', OLD.algoritmo,
            'pepper_versao', OLD.pepper_versao,
            'temporario', OLD.temporario,
            'expira_em', OLD.expira_em,
            'definido_em', OLD.definido_em,
            'definido_por', OLD.definido_por,
            'bloqueado_ate', OLD.bloqueado_ate,
            'bloqueado_em', OLD.bloqueado_em,
            'motivo_bloqueio_presente', nullif(btrim(OLD.motivo_bloqueio), '') IS NOT NULL
        );
    END IF;

    IF (v_usuario_txt IS NULL) = (v_sistema_txt IS NULL) THEN
        RAISE EXCEPTION 'Defina exatamente um ator: app.usuario_id ou app.ator_sistema';
    END IF;

    v_depois := jsonb_build_object(
        'algoritmo', NEW.algoritmo,
        'pepper_versao', NEW.pepper_versao,
        'temporario', NEW.temporario,
        'expira_em', NEW.expira_em,
        'definido_em', NEW.definido_em,
        'definido_por', NEW.definido_por,
        'bloqueado_ate', NEW.bloqueado_ate,
        'bloqueado_em', NEW.bloqueado_em,
        'motivo_bloqueio_presente', nullif(btrim(NEW.motivo_bloqueio), '') IS NOT NULL
    );

    INSERT INTO alm.historico_alteracoes (
        recebimento_id, entidade, entidade_id, acao, usuario_id,
        ator_tipo, ator_identificador, request_id, ip, user_agent,
        dados_antes, dados_depois, campos_alterados
    ) VALUES (
        NULL,
        'alm.credenciais_pin',
        NEW.usuario_id::text,
        CASE WHEN TG_OP = 'INSERT' THEN 'INSERCAO' ELSE 'ALTERACAO' END,
        v_usuario_txt::uuid,
        CASE WHEN v_usuario_txt IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END,
        coalesce(v_usuario_txt, v_sistema_txt),
        nullif(current_setting('app.request_id', true), '')::uuid,
        nullif(current_setting('app.ip', true), '')::inet,
        nullif(current_setting('app.user_agent', true), ''),
        v_antes,
        v_depois,
        v_campos
    );

    RETURN NEW;
END;
$audit$;

-- Mantem a funcao restrita ao uso pelo trigger.
REVOKE EXECUTE ON FUNCTION alm.auditar_credencial() FROM PUBLIC;

COMMIT;
