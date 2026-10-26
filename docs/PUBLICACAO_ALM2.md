# Publicação do ALM 2.0: encerramento da Vercel

Estado verificado em 2026-10-26.

## 1. Decisão

- **Não há deploy do ALM nesta etapa**, em nenhuma plataforma.
- A Vercel deixou de ser o destino de publicação.
- **Nenhum destino alternativo foi escolhido nem configurado**: não há `Dockerfile`, proxy, configuração de hospedagem, banco de produção nem workflow de deploy no repositório.
- O ALM continua rodando localmente, conforme o README: `npm run dev` para o frontend e `npm run api` para o backend, com `ALM_BACKEND_MODE=postgres` para o modo PostgreSQL/WebAuthn.

## 2. O que saiu do repositório

| Item | Situação | Commit |
|---|---|---|
| `api/v1/[...path].mjs` (Vercel Function que rodava o backend legado do Google Sheets) | Removido. Nenhum script, teste ou import dependia dele | `a3a1e1d` |
| README (seção Deploy e passo do token do Drive), `scripts/google-drive-oauth-setup.mjs`, comentários em `src/` | Sem a Vercel como destino | `69ffd03` |
| Comentário de `backend/config/env.mjs` e origem de exemplo em `backend/attachments.test.mjs` | Genéricos, sem mudança de comportamento | `chore(backend): drop Vercel wording from env comment and test origin` |

Não existiam `vercel.json`, `.vercel/` nem workflow de deploy da Vercel. O único workflow (`.github/workflows/alm-database-ci.yml`) é o CI manual do banco.

Referências mantidas de propósito:

- **Contexto técnico, para o Goran revisar:** o comentário em `backend/attachments.mjs` e a linha de `docs/attachments-api.md` explicam de onde veio o limite de 4 MiB dos anexos (teto de resposta da antiga Function).
- **Histórico, preservado com nota no topo:** `docs/HANDOFF-GORAN-VERCEL-ROUTING-PRODUCTION.md` e `docs/HANDOFF-GORAN-ATTACHMENTS-DEBUG.md`.
- **Decisões antigas que já diziam "Vercel fora":** os documentos em `supabase/`.
- **Arquivos de apresentação, não alterados:** `docs/ALM_Apresentacao_*`.
- **Regra de segurança:** `src/features/auth/officialRules.test.mjs`, que proíbe domínio `.vercel.app` fixo no código.

## 3. Fora do repositório (pendente)

| Item | Estado em 2026-10-26 | Responsável |
|---|---|---|
| Integração Git do projeto Vercel `alm` com o `ALLM` | **Ativa.** Cada push em qualquer branch gera Preview, e cada push na `main` gera Production (último automático: Preview de `631b027`, 2026-10-26 18:52 UTC) | Lucas |
| Aplicação legada em `allm.vercel.app` | **No ar, não pausada** | Lucas |
| App da Vercel no GitHub | Instalado. Também atende outros repositórios da conta: **remover só o `ALLM`, não desinstalar** | Lucas |
| Variáveis de ambiente do projeto `alm` | Não verificadas: a equipe não tem acesso de leitura por ferramenta | Lucas |
| Credenciais Google do backend legado | Validade atual desconhecida; **revogação não confirmada** (seção 4) | Goran |

Até a integração ser desconectada, qualquer push no `ALLM` volta a publicar na Vercel.

## 4. Credenciais Google do backend legado

O backend legado (`backend/app.mjs`, `backend/config/env.mjs`, `backend/integrations/`) usa estas variáveis. Nenhum valor aparece aqui.

| Variável | Tipo | Segredo? |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Identificador da conta de serviço do Sheets | não |
| `GOOGLE_PRIVATE_KEY` | Chave privada dessa conta de serviço (escopo `spreadsheets`) | **sim** |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Identificador da planilha | não |
| `GOOGLE_OAUTH_CLIENT_ID` | Identificador do cliente OAuth do Drive | não |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Segredo desse cliente OAuth | **sim** |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Refresh token de uma conta Google real (escopo `drive.file`) | **sim** |
| `GOOGLE_DRIVE_FOLDER_ID` | Pasta do Drive (opcional) | não |
| `DRIVE_UPLOAD_ALLOWED_ORIGINS`, `CORS_ORIGIN` | Configuração | não |

O que se sabe sobre cada credencial:

- **No código:** todas as variáveis da tabela acima.
- **Na Vercel:** o handoff de 30/09 registra, a partir do painel, que Production recebeu as seis variáveis `GOOGLE_*` da tabela, exceto `GOOGLE_DRIVE_FOLDER_ID`, mais `DRIVE_UPLOAD_ALLOWED_ORIGINS`. Preview recebeu as 3 do Sheets. Ninguém conferiu se continuam lá.
- **Validade atual:** desconhecida.
- **Revogação confirmada:** nenhuma.

Ações, na ordem:

1. **Lucas:** pausar o projeto `alm` e desconectar o Git (seção 5).
2. **Goran:** no Google Cloud Console, **IAM e administrador → Contas de serviço →** conta do `GOOGLE_SERVICE_ACCOUNT_EMAIL` **→ Chaves**. Excluir a chave usada pela Vercel; só criar outra se ainda houver uso legítimo fora da Vercel.
3. **Goran:** revogar o `GOOGLE_OAUTH_REFRESH_TOKEN`. Entrar na Conta Google que autorizou o Drive, abrir `https://myaccount.google.com/connections` e remover o acesso do app OAuth do ALM. Em **APIs e serviços → Credenciais**, redefinir a chave secreta do cliente OAuth (`GOOGLE_OAUTH_CLIENT_SECRET`) se ele continuar em uso.
4. **Goran:** confirmar se a planilha e a pasta do Drive guardam dados reais e revisar com quem estão compartilhadas.
5. **Lucas:** depois da revogação, apagar essas variáveis do projeto `alm` na Vercel.
6. Registrar aqui a data de cada revogação **confirmada**.

## 5. Passos no painel (Lucas)

Antes de cada passo, conferir que a equipe é `lucasizaias`, o projeto é `alm` e o repositório ligado é `shoitzsx/ALLM`.

1. **Pausar a aplicação legada.** Vercel → equipe `lucasizaias` → projeto `alm` → **Settings → General → Pause Project**, a seção logo acima de "Delete Project". O painel pede o nome do projeto para confirmar. É reversível pelo botão **Resume Project**. Não excluir o projeto nem o domínio `allm.vercel.app` nesta etapa.
2. **Desconectar o Git.** Mesmo projeto → **Settings → Git → Connected Git Repository → Disconnect**. Isso impede novos deploys automáticos, mas não tira do ar o que já está publicado (por isso o passo 1).
3. **Tirar o `ALLM` do app no GitHub.** GitHub → **Settings → Applications → Installed GitHub Apps → Vercel → Configure → Repository access**.
   - Se estiver em "Only select repositories": remover só o `shoitzsx/ALLM` e salvar.
   - Se estiver em "All repositories": trocar para "Only select repositories" e marcar todos os outros repositórios que já usam a Vercel antes de salvar; senão eles perdem os deploys.
4. **Conferir.** Um push numa branch do `ALLM` não deve mais criar deployment pela `vercel[bot]` (GitHub → repositório → **Deployments**), e `allm.vercel.app` deve mostrar a página de projeto pausado.
