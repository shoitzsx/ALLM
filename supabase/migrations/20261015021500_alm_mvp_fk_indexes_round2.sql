-- Segunda rodada de indices prioritarios para o MVP.
-- Foco: historicos/auditoria e relacoes de armazenamento que crescem com o uso.
BEGIN;

CREATE INDEX ix_historico_recebimento_data
    ON alm.historico_alteracoes (recebimento_id, criado_em DESC)
    WHERE recebimento_id IS NOT NULL;

CREATE INDEX ix_status_historico_recebimento_data
    ON alm.recebimento_status_historico (recebimento_id, alterado_em DESC);

CREATE INDEX ix_storage_containers_recebimento
    ON alm.storage_containers (recebimento_id)
    WHERE recebimento_id IS NOT NULL;

CREATE INDEX ix_storage_containers_parent_namespace
    ON alm.storage_containers (parent_id, storage_provider, storage_namespace)
    WHERE parent_id IS NOT NULL;

CREATE INDEX ix_arquivo_acessos_arquivo_recebimento
    ON alm.arquivo_acessos (arquivo_id, recebimento_id);

CREATE INDEX ix_arquivo_backups_arquivo_recebimento
    ON alm.arquivo_backups (arquivo_id, recebimento_id);

COMMIT;
