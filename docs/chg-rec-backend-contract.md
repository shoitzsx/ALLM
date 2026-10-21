# CHG → REC: contrato de backend em preparação

## Implementação parcial de 15/10/2026

`backend/services/iniciarRecebimentoDaChegada.mjs` implementa a operação
transacional CHG → REC sobre um pool PostgreSQL fornecido pelo backend. A
operação configura `alm_api`, `app.usuario_id` e `app.request_id` na mesma
transação, valida perfil e estado da CHG, chama a função SQL do banco e só faz
`COMMIT` depois de gravar pedido, tipo e fornecedor. Se o preenchimento falha,
faz `ROLLBACK` da criação e do vínculo. Retry igual retorna o REC existente;
retry com pedido, tipo ou fornecedor divergente retorna
`409 ARRIVAL_RETRY_CONFLICT` sem modificar o registro.
Nesta primeira regra de autorização, apenas `ADMINISTRADOR` e `ALMOXARIFADO`
podem iniciar o REC; a equipe ainda deve confirmar a matriz de permissões
antes de publicar a rota.
Quando a CHG já registra um nome de fornecedor capturado, o serviço preserva
esse nome para validar o pedido e o retry, enquanto resolve a identidade do
fornecedor pelo vínculo ou CNPJ ativo do catálogo. Uma divergência entre o
nome capturado e o cadastro atual não renomeia o cadastro.

O módulo ainda não é uma rota pública. A sessão de matrícula/PIN e a conexão
`alm_runtime_api` precisam ser integradas antes de expô-lo; o `X-User-Id` da
API legada não deve ser usado como ator desta operação. Os testes atuais usam
um cliente PostgreSQL simulado e verificam transação, rollback, permissões e
retry. Falta validar o mesmo fluxo contra PostgreSQL real com as migrations do
PR #2, após a integração da branch e a configuração de conexão local.

## Validação PostgreSQL em 19/10/2026

`backend/config/postgres.mjs` cria um pool com a identidade técnica
`alm_runtime_api`, limite de três conexões e TLS com certificado e hostname
verificados. TLS pode ser desativado somente para `localhost`, `127.0.0.1` ou
`::1`. As variáveis de conexão estão descritas em `.env.example`. O pacote
`pg` foi adicionado somente a `backend/package.json`.

Depois de instalar as dependências de `backend/`, execute
`npm --prefix backend run test:postgres`. Com as variáveis `ALM_DB_*`
configuradas, esse comando verifica conexão, `SET LOCAL ROLE alm_api` e grants
dentro de uma transação encerrada com `ROLLBACK`. Sem conexão configurada,
o teste de rede é ignorado.

O teste que cria fixtures e exerce triggers, rollback, retry e duas conexões
simultâneas exige **uma base local descartável** já preparada com as migrations
do PR #2 e com o login técnico configurado. Ele só roda se o host for loopback,
o nome do banco ser exatamente `alm_ci_clean` e
`ALM_DB_TEST_DISPOSABLE=YES`. O teste deixa dados de teste nessa base; descarte
a base conforme o procedimento local após a execução. Não aponte esse teste
para staging ou produção. Em 19/10/2026, a suíte SQL do PR #2 (137 testes e
concorrência) e os testes reais do backend (permissões, rollback, retry e
concorrência) passaram em PostgreSQL 17.11 local. O banco utilizado foi
`alm_ci_clean`, descartável e restrito a loopback.

O instalador do PR #2 (`supabase/tests/apply-clean.mjs`) também exige uma base
vazia chamada `alm_ci_clean`, restrita a loopback. Execute a suíte SQL do
Kobner antes deste teste de integração, que deixa fixtures no banco. Em um
PostgreSQL local sem TLS, configure `ALM_DB_SSL_MODE=disable`; o pool rejeita
essa opção fora de loopback. Não execute o bootstrap de login destinado a
staging no banco descartável.

Este documento descreve o trabalho independente de persistência na branch do Goran. As rotas abaixo ainda não estão registradas no servidor. A função SQL de criação atômica está na branch do PR #2; a operação complementar do backend está implementada, aguardando sessão real e teste integrado.

## Fluxo e endpoints candidatos

1. `POST /api/v1/portaria/chegadas` registra uma CHG e retorna `201` com o identificador UUID e código humano gerados pelo banco. Não cria REC.
2. `GET /api/v1/portaria/chegadas` lista as CHGs permitidas ao usuário, com filtros e paginação a fechar com o frontend.
3. `GET /api/v1/portaria/chegadas/:id` consulta uma CHG permitida.
4. `POST /api/v1/portaria/chegadas/:id/iniciar-recebimento` cria um REC e vincula a CHG numa operação atômica, retornando `201`. Se a CHG já estiver vinculada, retorna o REC existente com `200`, sem criar outro.

O corpo de criação de CHG aceita `nfeChaveAcesso`, `numeroNf`, `serieNf`, `cnpjEmitente`, `fornecedor`, `metodoLeitura`, `confianca` e `observacoes`. O fornecedor pode ficar vazio. A identificação requer uma chave NF-e válida ou número da NF acompanhado de CNPJ válido. Quando há chave, o backend deriva NF, série e CNPJ e rejeita valores conflitantes. O método de leitura é obrigatório no schema atual, mas os valores finais de método e confiança ainda dependem de alinhamento com o scanner e com a migration.

O corpo de iniciar recebimento aceita somente `pedido`, `tipo` e `fornecedor` quando ausente na CHG. Pedido é obrigatório na primeira criação; um retry pode omiti-lo, mas valores enviados precisam coincidir com o REC existente. Tipo segue as opções atuais de Recebimentos, com o padrão atual `Estoque`. NF, série, CNPJ e chave vêm da CHG; correções desses dados e do fornecedor existente exigem fluxo próprio. IDs, código, timestamps e ator nunca vêm do corpo da requisição.

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

- A função SQL do PR #2 executa geração do código, inserção do REC, vínculo da CHG e registro do ator na transação aberta pelo backend. O backend completa pedido, tipo e fornecedor antes do `COMMIT`.
- A regra 1:1 para vínculos CHG ↔ REC está confirmada para o MVP. O PR #2 inclui índice único para impedir duas CHGs de apontarem para o mesmo REC, mantendo RECs manuais sem CHG. Ainda falta teste integrado de concorrência com a API.
- A requisição autenticada deve definir `app.usuario_id` no contexto transacional do banco. O campo de usuário enviado pelo cliente é ignorado na criação de CHG e rejeitado ao iniciar REC.
- No MVP, repetição da operação para a mesma CHG retorna o REC já vinculado quando os campos informados coincidem; dados divergentes retornam `409 ARRIVAL_RETRY_CONFLICT`. A função do banco consulta o vínculo antes de exigir novamente pedido, tipo ou fornecedor. O futuro endpoint responderá `200` para retry igual e `201` para criação nova. `Idempotency-Key` pode ser acrescentada depois para outros tipos de retry; não substitui a unicidade CHG–REC.
- O backend atual ainda identifica usuário por `X-User-Id` e possui fallback de demonstração. Antes de expor as rotas da Portaria, a API precisa obter o usuário de uma sessão autenticada real, verificar autorização e configurar `app.usuario_id` no contexto da mesma transação.
- O schema atual de CHG restringe `metodo_leitura` e `confianca` a valores específicos; o contrato do scanner ainda deve ser comparado a essas listas antes da integração.
- A transição dos recebimentos do Sheets para PostgreSQL e a retirada definitiva do Sheets dependem de validação separada. Esta camada de domínio não cria novas abas nem sincronização com Sheets.
