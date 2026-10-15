-- Indices prioritarios de FKs para o fluxo operacional do MVP.
-- Foco: joins/filtros frequentes e relacoes que crescem com o uso.
BEGIN;

-- Recebimentos: filtros e joins operacionais.
CREATE INDEX ix_recebimentos_fornecedor
    ON alm.recebimentos (fornecedor_id)
    WHERE excluido_em IS NULL AND fornecedor_id IS NOT NULL;

CREATE INDEX ix_recebimentos_responsavel
    ON alm.recebimentos (responsavel_id)
    WHERE excluido_em IS NULL AND responsavel_id IS NOT NULL;

CREATE INDEX ix_recebimentos_tipo
    ON alm.recebimentos (tipo_recebimento_id)
    WHERE excluido_em IS NULL AND tipo_recebimento_id IS NOT NULL;

-- Arquivos: navegacao por item/container dentro do recebimento.
CREATE INDEX ix_arquivos_item_recebimento
    ON alm.arquivos (item_id, recebimento_id)
    WHERE excluido_em IS NULL AND item_id IS NOT NULL;

CREATE INDEX ix_arquivos_container_recebimento
    ON alm.arquivos (storage_container_id, recebimento_id, tipo_arquivo_codigo)
    WHERE excluido_em IS NULL;

-- Portaria: localizacao por fornecedor nas chegadas ativas.
CREATE INDEX ix_chegadas_fornecedor
    ON alm.chegadas_portaria (fornecedor_id)
    WHERE excluido_em IS NULL AND fornecedor_id IS NOT NULL;

-- Divergencias: fluxo principal por recebimento/item.
CREATE INDEX ix_divergencias_recebimento
    ON alm.divergencias (recebimento_id, status)
    WHERE excluido_em IS NULL;

CREATE INDEX ix_divergencias_item_recebimento
    ON alm.divergencias (item_id, recebimento_id)
    WHERE excluido_em IS NULL AND item_id IS NOT NULL;

CREATE INDEX ix_divergencias_responsavel
    ON alm.divergencias (responsavel_tratamento_id)
    WHERE excluido_em IS NULL AND responsavel_tratamento_id IS NOT NULL;

-- Outbox: rastreamento dos eventos de um recebimento.
CREATE INDEX ix_outbox_recebimento
    ON alm.outbox (recebimento_id)
    WHERE recebimento_id IS NOT NULL;

-- RBAC: lookup inverso de usuarios por papel.
CREATE INDEX ix_usuario_papeis_papel
    ON alm.usuario_papeis (papel_codigo, papel_tipo)
    WHERE revogado_em IS NULL;

COMMIT;
