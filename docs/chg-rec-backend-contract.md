# CHG → REC: contrato de backend em preparação

Este documento descreve o trabalho independente de persistência na branch do Goran. As rotas abaixo ainda não estão registradas no servidor. A criação persistente depende da operação transacional que o Kobner está definindo para o PostgreSQL.

## Fluxo e endpoints candidatos

1. `POST /api/v1/portaria/chegadas` registra uma CHG e retorna `201` com o identificador UUID e código humano gerados pelo banco. Não cria REC.
2. `GET /api/v1/portaria/chegadas` lista as CHGs permitidas ao usuário, com filtros e paginação a fechar com o frontend.
3. `GET /api/v1/portaria/chegadas/:id` consulta uma CHG permitida.
4. `POST /api/v1/portaria/chegadas/:id/iniciar-recebimento` cria um REC e vincula a CHG numa operação atômica, retornando `201`. Se a CHG já estiver vinculada, retorna o REC existente com `200`, sem criar outro.

O corpo de criação de CHG aceita `nfeChaveAcesso`, `numeroNf`, `serieNf`, `cnpjEmitente`, `fornecedor`, `metodoLeitura`, `confianca` e `observacoes`. O fornecedor pode ficar vazio. A identificação requer uma chave NF-e válida ou número da NF acompanhado de CNPJ válido. Quando há chave, o backend deriva NF, série e CNPJ e rejeita valores conflitantes. O método de leitura é obrigatório no schema atual, mas os valores finais de método e confiança ainda dependem de alinhamento com o scanner e com a migration.

O corpo de iniciar recebimento aceita somente `pedido`, `tipo` e `fornecedor` quando ausente na CHG. Pedido é obrigatório. Tipo segue as opções atuais de Recebimentos, com o padrão atual `Estoque`. NF, série, CNPJ e chave vêm da CHG; correções desses dados e do fornecedor existente exigem fluxo próprio. IDs, código, timestamps e ator nunca vêm do corpo da requisição.

As falhas de domínio seguem o envelope já usado pela API: `{ "error": { "code": "...", "message": "...", "details": { ... } } }`. Validação usa `422 VALIDATION_ERROR`. CHG ausente usa `404 ARRIVAL_NOT_FOUND`. CHG excluída, cancelada ou com vínculo inconsistente não pode iniciar REC. O mapper interno ainda rejeita uma CHG vinculada com `409 ARRIVAL_ALREADY_LINKED` para impedir uso incorreto; o endpoint de retry deve retornar o REC existente. O formato final dos corpos de resposta e dos filtros de listagem será fechado antes de implementar as rotas.

## Mapeamento de dados

| CHG | Entrada de REC | Observação |
| --- | --- | --- |
| `numeroNf` | `numeroNf` | Derivado da chave se ausente. |
| `serieNf` | `serieNf` | Derivada da chave se ausente. |
| `cnpjEmitente` | `cnpjFornecedor` | Mantido como texto de 14 dígitos. |
| `fornecedor` | `fornecedor` | Almoxarifado completa quando a CHG não tem fornecedor. |
| `nfeChaveAcesso` | `nfeChaveAcesso` | Existe na migration ALM 2.0; não existe no modelo atual gravado no Sheets. |
| Sem campo de pedido | `pedido` | Almoxarifado informa obrigatoriamente. |

`dataRecebimento` não é copiada de `chegada_em`: chegada e recebimento são eventos diferentes. O serviço atual de Recebimentos exige `dataRecebimento` e gera protocolo/ID a partir da lista do Sheets; portanto ele não pode ser chamado diretamente para este novo fluxo. O repositório PostgreSQL deverá usar os UUIDs e códigos gerados no banco.

## Garantias pendentes de persistência

- O banco deve executar geração do código, inserção do REC, vínculo da CHG e registro do ator numa única transação. `alm.proximo_codigo_recebimento(ano)` resolve apenas a geração do código.
- A regra 1:1 para vínculos CHG ↔ REC está confirmada para o MVP. O banco precisa impedir duas CHGs de apontarem para o mesmo REC, mantendo RECs manuais sem CHG. A transação e as constraints devem fornecer a garantia real contra requisições simultâneas.
- A requisição autenticada deve definir `app.usuario_id` no contexto transacional do banco. O campo de usuário enviado pelo cliente é ignorado na criação de CHG e rejeitado ao iniciar REC.
- No MVP, repetição da operação para a mesma CHG retorna o REC já vinculado. A função do banco deve consultar o vínculo antes de exigir novamente pedido, tipo ou fornecedor. O backend responderá `200` para esse caso e `201` para criação nova. `Idempotency-Key` pode ser acrescentada depois para outros tipos de retry; não substitui a unicidade CHG–REC.
- O backend atual ainda identifica usuário por `X-User-Id` e possui fallback de demonstração. Antes de expor as rotas da Portaria, a API precisa obter o usuário de uma sessão autenticada real, verificar autorização e configurar `app.usuario_id` no contexto da mesma transação.
- O schema atual de CHG restringe `metodo_leitura` e `confianca` a valores específicos; o contrato do scanner ainda deve ser comparado a essas listas antes da integração.
- A transição dos recebimentos do Sheets para PostgreSQL e a retirada definitiva do Sheets dependem de validação separada. Esta camada de domínio não cria novas abas nem sincronização com Sheets.
