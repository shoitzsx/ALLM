-- Arquivos purgados nao podem ser restaurados como ativos.
-- Recuperacao de bytes requer novo registro/upload; nunca simular retorno fisico.
BEGIN;

CREATE OR REPLACE FUNCTION alm.bloquear_restauracao_arquivo_purgado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, alm
AS $$
BEGIN
    IF NEW.armazenamento_estado = 'PURGADO' AND NEW.excluido_em IS NULL THEN
        RAISE EXCEPTION 'Arquivo PURGADO nao pode estar logicamente ativo; realize novo upload';
    END IF;

    IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;

    IF OLD.armazenamento_estado = 'PURGADO' THEN
        IF NEW.armazenamento_estado IS DISTINCT FROM 'PURGADO' THEN
            RAISE EXCEPTION 'Arquivo PURGADO nao pode voltar a estado fisico ativo; realize novo upload';
        END IF;

        IF OLD.excluido_em IS NOT NULL AND NEW.excluido_em IS NULL THEN
            RAISE EXCEPTION 'Arquivo PURGADO nao pode ser restaurado logicamente; realize novo upload';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_arquivo_zz_bloquear_restauracao_purgado
BEFORE INSERT OR UPDATE ON alm.arquivos
FOR EACH ROW
EXECUTE FUNCTION alm.bloquear_restauracao_arquivo_purgado();

COMMIT;
