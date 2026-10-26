# Publicação do ALM 2.0

Estado em 2026-10-26. **Proposta pendente de aprovação do Lucas; nada aqui foi publicado ainda.**

## 1. Situação

- A Vercel deixou de ser o destino do ALM, e a Function `api/v1/[...path].mjs` foi removida do repositório.
- A produção legada (`https://allm.vercel.app`, backend Google Sheets) continua no ar até ser desligada no painel da Vercel. Ver a seção 6.
- O backend PostgreSQL/WebAuthn (`ALM_BACKEND_MODE=postgres`) ainda não foi executado contra um PostgreSQL real fora das máquinas da equipe. O primeiro administrador depende do PR #6.

## 2. Requisitos que vêm do código

| Item | Requisito | Origem |
|---|---|---|
| Origem | Frontend (`dist/`) e API (`/api/v1`) na **mesma origem HTTPS** | `src/api.js` usa caminho relativo; cookies `__Host-` |
| Cookies | `__Host-alm_pre_mfa` e `__Host-alm_session`: `HttpOnly; Secure; SameSite=Strict; Path=/`, sem `Domain` | `backend/auth/webauthnSecurity.mjs` |
| WebAuthn | `ALM_WEBAUTHN_RP_ID` = host definitivo; `ALM_WEBAUTHN_ORIGINS` = `https://<host>` exato. Passkeys ficam presas ao RP ID: trocar de domínio depois invalida todas | `backend/config/postgresEnv.mjs` |
| Mutações | Exigem `Origin` igual a `ALM_WEBAUTHN_ORIGINS`; não é preciso nem desejável abrir CORS | `backend/appPostgres.mjs` |
| Processo | Node.js 24, processo de longa duração (`node backend/server.mjs`), escutando em `127.0.0.1:3001` por padrão | `backend/server.mjs`, `package.json` |
| Instâncias | **Uma**: o limitador de tentativas fica em memória | `backend/auth/postgresAuth.mjs` |
| Banco | PostgreSQL 17, TLS `verify-full` (CA opcional em `ALM_DB_SSL_CA_FILE`), login técnico `alm_runtime_api` | `backend/config/postgres.mjs`, `supabase/config.toml` |
| Segredos | Só no ambiente do servidor, nunca com prefixo `VITE_` | README |

Variáveis do servidor (somente nomes):

- Modo e sessão: `ALM_BACKEND_MODE=postgres`, `ALM_PIN_LENGTH`, `ALM_PIN_PEPPER_V1` (segredo).
- WebAuthn: `ALM_WEBAUTHN_RP_ID`, `ALM_WEBAUTHN_ORIGINS`, `ALM_WEBAUTHN_RP_NAME`.
- Banco: `ALM_DB_HOST`, `ALM_DB_PORT`, `ALM_DB_NAME`, `ALM_DB_API_USER`, `ALM_DB_API_PASSWORD` (segredo), `ALM_DB_SSL_MODE=verify-full`, `ALM_DB_SSL_CA_FILE`.
- Opcionais: `HOST` e `PORT`. `CORS_ORIGIN` não é usado no modo `postgres`.

## 3. Proposta

| Camada | Onde | Por quê |
|---|---|---|
| Frontend + backend | **Fly.io, região `gru` (São Paulo)**: um app, uma máquina sempre ligada, imagem Docker com Caddy (serve `dist/` e repassa `/api/v1` para o Node em `127.0.0.1:3001`) | Mesma origem sem mudar código; processo Node contínuo; perto dos usuários e do banco; certificado TLS gerenciado; a imagem roda igual em qualquer VPS se for preciso sair |
| PostgreSQL 17 | **Supabase** (já aprovado pela equipe), plano Pro, região `sa-east-1` (São Paulo) | Banco gerenciado com backups diários; o Kobner já opera o staging lá; sem porta administrativa própria exposta |
| Domínio | Subdomínio da empresa (ex.: `alm.<dominio>`), via CNAME para o Fly | RP ID estável para as passkeys; `*.fly.dev` só para teste, nunca para passkeys definitivas |

Custos aproximados (conferir no painel antes de contratar):

- **Fly.io:** `shared-cpu-1x` 512 MB custa US$ 3,69/mês em `iad` (o preço varia por região). Os 10 primeiros certificados são gratuitos. Exige cartão.
- **Supabase Pro:** a partir de US$ 25/mês, com US$ 10 de crédito de computação (uma instância Micro) e backups diários por 7 dias. O PITR é cobrado à parte.
- **IPv4 dedicado do Supabase:** cerca de US$ 4/mês, só se a conexão direta for necessária.

Ordem de grandeza: US$ 30–40/mês.

A validar antes de decidir:

- **Kobner:**
  - versão 17 do projeto Supabase de produção;
  - conexão do Fly ao Supabase: pooler em modo sessão (porta 5432) ou conexão direta via IPv6/IPv4 dedicado;
  - TLS `verify-full` com o CA da Supabase;
  - criação do login `alm_runtime_api`.
- **Goran:** atrás do proxy, o backend vê o IP do Caddy. O limitador continua por matrícula e o bloqueio de 5 falhas continua no banco, mas a auditoria perde o IP real. Exige configurar a confiança no cabeçalho do proxy.

Descartadas:

- **Vercel:** descontinuada; o modelo de Functions não comporta o limitador em memória de instância única.
- **Firebase Hosting + Cloud Run:** a documentação do Firebase diz que só o cookie `__session` chega ao serviço, o que derrubaria os cookies `__Host-alm_*`.
- **Render:** sem região na América do Sul. É alternativa viável com Supabase nos EUA, com mais latência.
- **Supabase Edge Functions / Cloudflare Workers:** exigiriam reescrever o backend.
- **VPS própria:** mais barata, mas exige manutenção de sistema operacional, firewall e monitoramento. Faz sentido se a empresa já tiver infraestrutura e alguém para operá-la.

## 4. Deploy e reversão (quando aprovado)

- **Deploy:** `fly deploy` a partir de um checkout limpo de um commit marcado da `main`. O GitHub Actions está bloqueado por faturamento, então o deploy é manual e registrado.
- **Segredos:** `fly secrets set`, nunca no repositório nem em `fly.toml`.
- **Reversão:** `fly releases` mostra as versões; `fly deploy --image <imagem anterior>` volta uma versão.
- **Migrations:** só para frente, aplicadas pelo Kobner antes do código que depende delas, com backup. A versão anterior do app precisa continuar compatível com o esquema novo.
- **Logs:** `fly logs` (saída padrão). Antes da produção, conferir que nenhum caminho do backend registra PIN, código de ativação, cookie de sessão ou credenciais do banco.

## 5. Passo a passo

| # | Etapa | Responsável |
|---|---|---|
| 1 | Desligar a integração e a produção legada da Vercel (seção 6) | Lucas (+ Goran para as credenciais Google) |
| 2 | Aprovar o destino, criar contas (Fly.io; organização Supabase Pro) e meio de pagamento | Lucas |
| 3 | Definir o subdomínio definitivo e quem administra o DNS | Lucas / TI da empresa |
| 4 | Revisar e integrar o PR #6 (primeiro administrador) | Goran (revisão), Kobner (merge) |
| 5 | Ajustar o IP real atrás do proxy | Goran |
| 6 | Criar o projeto Supabase de produção, aplicar as migrations com backup e criar `alm_runtime_api` | Kobner |
| 7 | Criar `Dockerfile`, `Caddyfile` e `fly.toml`, testados localmente | Lucas / Goran |
| 8 | Publicar em ambiente de homologação (`*.fly.dev`), apontando para um banco de homologação, e rodar o roteiro de ponta a ponta | Equipe |
| 9 | Apontar o DNS, emitir o certificado e configurar `ALM_WEBAUTHN_RP_ID`/`ORIGINS` com o domínio final | Lucas / Goran |
| 10 | Provisionar o Kobner como administrador e validar o primeiro acesso real | Kobner |
| 11 | Considerar publicado só depois do login real validado no domínio final | Equipe |

Itens, anexos, edição e conclusão de recebimentos ainda não estão ligados ao PostgreSQL; a publicação inicial cobre login, sessão, Portaria (CHG), recebimentos (campos principais) e painel.

## 6. Desligar a Vercel (ações no painel)

1. **Vercel → projeto `alm` → Settings → Git → Disconnect.** Interrompe os deploys automáticos da `main` e dos PRs.
2. Decidir entre **pausar** o projeto (reversível) e excluí-lo. Exclusão só depois de confirmar que nenhum outro sistema usa o projeto ou o domínio `allm.vercel.app`.
3. **Settings → Environment Variables:** remover as variáveis `GOOGLE_*` e `DRIVE_*`. O Goran deve **revogar e reemitir** as credenciais Google que estavam lá: conta de serviço do Sheets e refresh token OAuth do Drive.
4. **GitHub → Settings → Applications → Vercel → Configure:** remover só o repositório `ALLM` do acesso do app. **Não desinstalar o app:** outros repositórios da mesma conta usam a Vercel. Pelo mesmo motivo, não excluir a conta nem a equipe da Vercel.
5. Os ambientes `Production` e `Preview` e o histórico de deployments do GitHub ficam como histórico.
