# Backend PostgreSQL / WebAuthn N-2

O backend Node local pode iniciar com `ALM_BACKEND_MODE=postgres`. Esse modo usa
`alm_runtime_api` e `SET LOCAL ROLE alm_api` em transações PostgreSQL; não chama
Google Sheets. Não executa migrations ao iniciar. O schema necessário inclui
as migrations N-2 WebAuthn e de provisionamento do primeiro administrador.

Configure as variáveis `ALM_DB_*`, `ALM_PIN_PEPPER_V1`,
`ALM_WEBAUTHN_RP_ID` e `ALM_WEBAUTHN_ORIGINS` conforme `.env.example`.
No desenvolvimento pelo Vite, use `localhost` como RP ID e
`http://localhost:5173` como origem. A política final de PIN e o domínio HTTPS
definitivo ainda dependem de aprovação da equipe. Não envie senhas, PINs,
pepper ou tokens pelo Git ou por mensagens.

## Contrato HTTP disponível neste modo

Todos os caminhos abaixo começam em `/api/v1`. Requisições que alteram estado
exigem `Origin` exatamente igual a uma origem em `ALM_WEBAUTHN_ORIGINS`.
O navegador deve enviar cookies (`credentials: 'include'` quando necessário).
`X-User-Id` é ignorado.

| Método | Caminho | Resultado |
| --- | --- | --- |
| POST | `/auth/login-challenges` | `{matricula,pin}` → `201 {challengeId,options}` e cookie pré-MFA; sem sessão de negócio |
| POST | `/auth/login-challenges/:id/complete` | `{response}` WebAuthn → `200 {authenticated:true}` e cookie final |
| GET | `/auth/me` | Identidade SQL, perfil, papéis e permissões da sessão MFA; `401` sem ela |
| POST | `/auth/logout` | Revoga a sessão e limpa o cookie |
| POST | `/auth/initial-pin` | `{matricula,temporaryPin,newPin,activationCode}` troca o PIN temporário sem consumir o código |
| POST | `/auth/authenticators/registration-challenges` | Com sessão MFA recente ou `{matricula,pin,activationCode}` previamente autorizado → `201 {challengeId,options}` |
| POST | `/auth/authenticators` | `{challengeId,response}` e `activationCode` quando cabível → `201` após verificar attestation |
| GET | `/auth/authenticators` | Lista metadados dos dispositivos, sem chave pública |
| DELETE | `/auth/authenticators/:id` | `{reason}`; exige MFA recente e mantém ao menos um autenticador ativo |
| GET/POST | `/chegadas` | Lista/cria CHG conforme perfil; POST aceita dados operacionais validados |
| GET | `/chegadas/:id` | Detalhe de CHG |
| POST | `/chegadas/:id/iniciar-recebimento` | Conversão atômica CHG→REC; recebe `{pedido,tipo,fornecedor}` |
| GET/POST | `/recebimentos` | Lista/cria rascunho REC no PostgreSQL |
| GET | `/recebimentos/:id` | Detalhe principal do REC por UUID ou código |
| PATCH | `/recebimentos/:id` | Edita dados gerais de um REC não finalizado |
| GET/POST | `/recebimentos/:id/itens` | Lista/cria itens |
| PATCH/DELETE | `/recebimentos/:id/itens/:itemId` | Edita/remove logicamente um item |
| GET/POST | `/recebimentos/:id/divergencias` | Lista/cria divergências |
| POST | `/recebimentos/:id/divergencias/:divergenciaId/resolver` | Resolve com justificativa |
| POST | `/recebimentos/:id/divergencias/:divergenciaId/reabrir` | Reabre uma divergência |
| POST | `/recebimentos/:id/status` | Transição de status validada pelo banco |
| POST | `/recebimentos/:id/arquivar`, `/recebimentos/:id/restaurar` | Soft delete e restauração administrativos |
| GET | `/recebimentos/:id/historico/status`, `/recebimentos/:id/historico/auditoria` | Histórico do REC |
| GET | `/recebimentos/:id/anexos` | Lista anexos confirmados |
| POST | `/recebimentos/:id/anexos/upload-sessions` | Abre sessão resumível no Drive |
| POST | `/recebimentos/:id/anexos` | Confirma `fileId` do Drive no PostgreSQL |
| GET | `/recebimentos/:id/anexos/:anexoId/download` | Download autenticado com verificação de integridade |
| DELETE | `/recebimentos/:id/anexos/:anexoId` | Remoção lógica no banco e física no Drive |
| GET | `/visualizacao/:aba`, `/visualizacao/:aba/exportar.csv` | Consulta paginada e exportação CSV do PostgreSQL |
| GET | `/catalogos`, `/dashboard` | Leituras PostgreSQL protegidas por permissões |

O cookie final é `HttpOnly`, `Secure`, `SameSite=Strict`, host-only; no banco
fica somente o SHA-256 do token. Sessões legadas sem `mfa_metodo=WEBAUTHN`
são rejeitadas. O backend consome o desafio em transação própria, inclusive
quando a assinatura é inválida, e só envia o cookie final após criar a sessão
MFA com sucesso. O uso de `Origin` exato protege as mutações contra CSRF.

Erros relevantes: `401 INVALID_CREDENTIALS` para o primeiro fator inválido,
`401 AUTH_CHALLENGE_INVALID` para desafio/MFA inválido ou expirado,
`401 UNAUTHORIZED` para sessão ausente, `403 FORBIDDEN` para falta de permissão,
`403 ORIGIN_NOT_ALLOWED` para origem recusada e `429 TOO_MANY_ATTEMPTS` para
limitação local de tentativas.

## Armazenamento de anexos e limites atuais

- O PostgreSQL é a fonte dos dados operacionais. O Google Drive armazena apenas
  os bytes dos anexos; o vínculo, a categoria, a auditoria e o checksum ficam
  em `alm.arquivos`. A sessão resumível envia os bytes diretamente do navegador
  ao Drive. A confirmação consulta o arquivo, confere pasta, recebimento,
  categoria, tipo real e tamanho antes de gravar o vínculo. Downloads passam
  pelo backend autenticado e conferem SHA-256.
- Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` e
  `GOOGLE_OAUTH_REFRESH_TOKEN` novos, de um mesmo cliente OAuth, somente no
  servidor. `GOOGLE_DRIVE_FOLDER_ID` é opcional; sem ele a aplicação cria ou
  reutiliza a pasta de anexos no Drive. Não reutilize as credenciais antigas
  revogadas. O fluxo real com Google só pode ser homologado após essa configuração.
- Se a remoção lógica no PostgreSQL for confirmada e a exclusão no Drive falhar,
  a API responde `202` com `cleanupPending: true`. A interface informa a
  pendência; a limpeza física precisará de reconciliação operacional. Não
  interpretar `202` como exclusão física concluída.
- A tela de Visualização consulta as tabelas reais por aba, com filtros,
  ordenação, paginação e CSV. A consulta é somente leitura. Os dados legados
  do Sheets não são migrados automaticamente; isso exige plano separado.
- Não há nesta etapa uma interface para gestão administrativa de usuários.
- O primeiro administrador é criado somente por
  `backend/scripts/provision-first-admin.mjs`, com uma conexão operacional capaz
  de `SET ROLE alm_provisioner`. O comando exige `--approval-reference` e
  `--confirm PROVISION-FIRST-ADMIN`; gera PIN/código em memória, grava somente
  hashes e exibe os valores uma única vez para entrega por canal seguro. Exemplo:
  `node backend/scripts/provision-first-admin.mjs --matricula ADM001 --nome "Nome" --approval-reference CHANGE-1234 --confirm PROVISION-FIRST-ADMIN`.
  Configure `ALM_PROVISION_DATABASE_URL` e nunca redirecione a saída para arquivo.
  Uma segunda execução e qualquer segundo usuário com perfil `ADMINISTRADOR` são
  recusados pelo banco. Alterar o modelo singleton exige migration e aprovação
  explícitas; não deve ser contornado pela role da API.
- O PIN temporário deve ser trocado em `/auth/initial-pin` antes do desafio de
  cadastro. O código continua válido e não consumido durante a troca e a criação
  do desafio; só é consumido na transação que grava a passkey. O hash de PIN usa
  `scrypt`, salt individual e pepper versionado fora do banco. Argon2id ainda não
  foi integrado.
- O rate limit em memória auxilia o desenvolvimento local; a política final
  de bloqueio e sua coordenação entre instâncias ainda precisam ser fechadas.
- A migration N-2 está versionada na `main`, mas a aplicação em staging é
  responsabilidade do Kobner mediante autorização separada.

Os testes `backend/integration/authPostgres.test.mjs` e
`backend/postgresOperations.test.mjs` usam PostgreSQL 17
descartável em `127.0.0.1/alm_ci_clean` e uma role técnica local. Eles verificam
attestation e assinatura WebAuthn reais, sessão pós-MFA, replay, cookie pré-MFA,
sessão legada, autorização, escrita CHG/REC, itens, divergências, anexos com
Drive simulado e Visualização. Execute com
`ALM_DB_TEST_DISPOSABLE=YES` e as variáveis `ALM_DB_*` apontando somente à
instância descartável.
