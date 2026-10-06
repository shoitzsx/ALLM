# 03 — Identidade, permissões e Portaria

**Dono:** Kobner · **UI:** Lucas · **Testes:** Marcelo · **Middleware/integração:** Goran

## 1. Requisitos

Do Lucas, nesta conversa: login por **matrícula**, com **PIN da própria aplicação** (teclado físico no desktop, teclado numérico na tela em equipamento de operação); **Portaria** separada do **Almoxarifado**; **excluir no Drive e na planilha só por superior** (encarregado, gerente etc.); **auditoria de tudo, incluindo exclusões**; permissões por perfil e por ação.

Do código atual (parte 02): hoje não há login. A identidade é um header falsificável, com fallback para Administrador, que aceita usuário inativo.

## 2. Decisão D03 — onde ficam as credenciais

A especificação do ChatGPT propôs **Supabase Auth** com e-mail sintético por matrícula (ex.: `m10482@dominio-interno`). Funciona, mas a evidência abaixo mostra que, **neste desenho**, ele entrega pouco e custa limites que a empresa vai sentir. A recomendação é guardar as credenciais no backend (Opção A) e tratar o Supabase Auth como Plano B.

| Critério | **A) Credenciais próprias no backend** (recomendada) | **B) Supabase Auth via backend, com e-mail sintético** |
|---|---|---|
| Identificador | Matrícula, nativa | O Auth identifica por **e-mail ou telefone**; matrícula exige e-mail sintético `[DOC-OFICIAL]` |
| Bloqueio por tentativas | Implementamos (tabela `credenciais_pin`) | O hook que permite isso (**Password Verification**) é de planos **Teams e Enterprise** `[DOC-OFICIAL]`; no Pro teríamos que checar o contador antes de chamar o Supabase, ou seja, a mesma lógica da opção A |
| Limite de logins | Nosso | **30 sign-ins por 5 min por IP** (ajustável). Via backend, todos saem de IPs dinâmicos da Vercel; direto do navegador, uma fábrica inteira atrás de um NAT compartilha o IP. Na troca de turno estoura `[DOC-OFICIAL]` |
| Sessão (inatividade, tempo máximo, sessão única) | Nossa (`alm.sessoes`) | Esses controles são do plano **Pro** `[DOC-OFICIAL]`. JWT padrão dura **1 h** `[DOC-OFICIAL]`; revogar na hora exige consultar o servidor de Auth a cada requisição (raciocínio, não verificado) |
| Segredo fora do banco (pepper) | Sim | Não existe |
| Navegador consulta o banco com JWT + RLS? | **Não** (D02) | Seria o ganho principal do Supabase Auth; **não será usado** |
| Auditoria por trigger (`app.usuario_id`) | Direta | Mapear `auth.users` ↔ `alm.usuarios` |
| Dois cadastros de usuário | Não | Sim (`auth.users` + `alm.usuarios`) |
| Configuração versionada | Tudo em migrations e código | Parte fica no painel do Supabase |
| Portabilidade | Qualquer Postgres | Presa ao Supabase |
| Risco principal | Erro nosso em hash/sessão | Dependência de plano e de limites |

**Critério de saída do spike S2** (2 dias do Kobner): ficar com A se (1) o hash levar menos de 500 ms no p95 numa função da Vercel, sem dependência nativa problemática; (2) os testes de bloqueio e de sessão da seção 9 passarem; (3) uma segunda pessoa revisar o módulo. Se qualquer um falhar, ir para B; a seção 11 lista o que muda.

## 3. PIN e credenciais (D04)

### 3.1 Regras do PIN

- **8 dígitos numéricos.** O Supabase diz que "menos de 8 caracteres não é recomendado" `[DOC-OFICIAL]`; 8 dígitos dá 10⁸ combinações, ainda pouco, por isso o resto do desenho compensa. 6 dígitos só com aprovação explícita (Q3) e bloqueio mais agressivo. 4 dígitos não.
- Rejeitar na criação: todos iguais (`00000000`), sequências (`12345678`, `87654321`), repetições curtas (`12121212`), e qualquer PIN que contenha a própria matrícula.
- Não repetir o PIN atual na troca.

### 3.2 Como guardar

```
segredo  = HMAC-SHA256( PEPPER[versao], matricula_normalizada || ":" || pin )
pin_hash = argon2id( segredo )          // ou scrypt nativo do Node, se o spike S2 apontar problema com binário nativo
```

- O **pepper** é um segredo longo e aleatório em variável de ambiente (nome sugerido: `ALM_PIN_PEPPER_V1`), **fora do banco**. Raciocínio: com 10⁸ combinações, qualquer hash rápido o bastante para um login pode ser quebrado offline se o banco ou um backup vazar; o pepper faz com que um vazamento **só do banco** não permita testar PINs.
- `pepper_versao` fica na linha; no login bem-sucedido com versão antiga, regravar o hash com a nova.
- Parâmetros: seguir a tabela vigente da OWASP (Password Storage Cheat Sheet) ao implementar; medir no S2. Salt por usuário (gerado pela própria função). Comparação em tempo constante.
- **Matrícula inexistente:** calcular um hash descartável para igualar o tempo de resposta.
- **Nunca** logar o corpo de `/auth/*`; ter teste que varre os logs procurando o PIN usado.

### 3.3 Bloqueio

| Situação | Efeito |
|---|---|
| 5 falhas seguidas na mesma matrícula | bloqueio de 15 min |
| 8 falhas seguidas | bloqueio de 1 h |
| 10 falhas seguidas | bloqueio até um superior desbloquear (`usuarios.block`) |
| Login com sucesso | zera o contador |
| Muitas falhas de **matrículas diferentes** no mesmo IP (padrão: mais de 30 em 10 min) | `429` por 10 min; o limite precisa ser generoso porque a empresa pode estar atrás de um único IP |

Resposta sempre genérica: "Matrícula ou PIN inválidos, ou acesso temporariamente bloqueado. Se continuar, procure seu supervisor." Isso evita enumerar matrículas. **Risco aceito:** alguém pode bloquear a matrícula de outra pessoa de propósito; por isso os bloqueios automáticos são temporários, geram evento e o limite por IP reduz a velocidade do atacante.

### 3.4 Ciclo de vida do usuário

```
Cadastro (RH/admin) ──> PIN temporário (8 dígitos, CSPRNG, expira em 72 h, temporario=true)
        │
        └─> 1º login ──> TROCA OBRIGATÓRIA ──> PIN definitivo (temporario=false)

Esqueci o PIN ──> superior com usuarios.reset_pin (posto INFERIOR ao do alvo)
                   ──> novo PIN temporário mostrado UMA vez ──> sessões do alvo revogadas ──> evento PIN_REDEFINIDO

Desligamento/afastamento ──> ativo=false ──> sessões revogadas ──> login negado ──> histórico preservado
Mudança de perfil ou papel ──> sessões do usuário revogadas (permissões efetivas mudaram)
```

- **Hierarquia para reset e bloqueio:** `CONSULTA, PORTARIA, ALMOXARIFADO, SUPRIMENTOS` (0) < `ENCARREGADO` (1) < `SUPERVISOR` (2) < `GERENTE` (3) < `ADMINISTRADOR` (4). Só se redefine o PIN de quem tem posto estritamente inferior; `ADMINISTRADOR` redefine qualquer um.
- **Usuário não é excluído**, só desativado. Isso preserva a autoria na auditoria.
- **Primeiro administrador:** script de bootstrap (`scripts/alm-create-admin.mjs`, a criar) que imprime o PIN temporário uma vez. O trigger de auditoria exige ator; o script define `app.ator_sistema`.
- **Importação de funcionários:** CSV `matricula;nome;setor;cargo;perfil;papel_superior` com dry-run e relatório de rejeições. O arquivo com PINs temporários deve ser entregue em mão, por superior, e destruído depois (a lista é o ativo mais sensível do processo). Formato real da matrícula: Q2.

## 4. Sessão

| Item | Regra |
|---|---|
| Token | 32 bytes aleatórios (CSPRNG) em base64url; no banco fica só o **SHA-256** (`alm.sessoes.token_hash`) |
| Cookie | `__Host-alm_session`; `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sem `Domain`. Em desenvolvimento (http://localhost): `alm_session` sem `Secure` |
| Validade (padrão da v1 §8) | 30 min de inatividade e 8 h absolutas |
| Validade da Portaria `[PROPOSTA]` | 10 min de inatividade e 12 h absolutas (terminal compartilhado). Ajustar com a operação |
| Renovação | `ultimo_uso_em` atualizado no máximo 1 vez por minuto; o frontend chama `POST /auth/ping` em atividade do usuário, no máximo a cada 2 min, para não derrubar quem digita um formulário longo |
| Rotação | novo token no login, na troca de PIN e na mudança de papéis; logout revoga |
| CSRF | `SameSite=Lax` + exigir `Content-Type: application/json` + conferir `Origin`/`Sec-Fetch-Site` nas mutações |
| Verificação por requisição | juntar `sessoes` + `usuarios` e exigir `ativo = true`, `revogada_em IS NULL`, não expirada. É uma leitura indexada, no mesmo banco |
| Terminal compartilhado | botão "Trocar usuário" sempre visível; ao sair, o frontend limpa o estado em memória do store |
| Limpeza | job apaga sessões expiradas há mais de 30 dias (único `DELETE` concedido, ao `alm_job`) |

## 5. API de autenticação

Mantém os códigos de erro em inglês já usados (`UNAUTHORIZED`, `FORBIDDEN`) e a mensagem em português; o `errorMessages.js` do frontend continua válido.

| Método e rota | Entrada | Saída | Erros |
|---|---|---|---|
| `POST /auth/login` | `{ matricula, pin }` | `200` `{ usuario, permissoes, deveTrocarPin, sessao:{ expiraEm, ociosoSegundos } }` + `Set-Cookie` | `401 INVALID_CREDENTIALS`, `429 TOO_MANY_ATTEMPTS` |
| `POST /auth/logout` | — | `204` | — |
| `GET /auth/me` | — | o payload atual **mais** `matricula`, `papeis`, `permissoes`, `deveTrocarPin`, `sessao` | `401 UNAUTHORIZED`, `401 SESSION_EXPIRED` |
| `POST /auth/trocar-pin` | `{ pinAtual, pinNovo }` | `204` | `401 INVALID_CREDENTIALS`, `422 WEAK_PIN` |
| `POST /auth/ping` | — | `204` | `401` |
| `POST /usuarios/:id/resetar-pin` | `{ motivo? }` | `200` `{ pinTemporario, expiraEm }` (**única** exibição) | `403 FORBIDDEN` (posto) |
| `POST /usuarios/:id/bloquear` / `desbloquear` | `{ motivo }` | `200` | `403 FORBIDDEN` |
| `POST /usuarios/:id/revogar-sessoes` | — | `204` | `403` |
| `POST /usuarios/:id/papeis` e `.../papeis/:papel/revogar` | `{ papel }` | `200` | `403`, `422` |

Enquanto `deveTrocarPin = true`, **todas** as rotas, exceto `/auth/me`, `/auth/trocar-pin` e `/auth/logout`, respondem `403 PIN_CHANGE_REQUIRED`.

Remoção do legado: o header `X-User-Id` e o fallback para `DEMO_USERS[0]` saem com uma flag `AUTH_MODE` (`legacy` | `session`). `legacy` existe **só em staging** para o frontend poder ser publicado antes do backend exigir sessão; em produção a flag nasce em `session`.

## 6. Fluxo de login

```
Navegador                       API /auth/login                         Postgres (alm)
   | POST {matricula, pin} ------->|                                          |
   |                               | normaliza matrícula; confere limite/IP --|
   |                               | SELECT usuario + credenciais_pin --------|
   |                               | (inexistente: hash descartável)          |
   |                               | usuário ativo? bloqueado_ate? ---------->|
   |                               | HMAC(pepper) + argon2id.verify           |
   |                               |--- falha: falhas++ , evento LOGIN_FALHA ->|
   |<-- 401 INVALID_CREDENTIALS ---|                                          |
   |                               |--- ok: zera falhas, cria sessão, evento ->|
   |<-- 200 + Set-Cookie ----------|     LOGIN_SUCESSO                        |
   | GET /auth/me ---------------->| permissões efetivas = perfil ∪ superior  |
```

## 7. Ameaças do PIN

| Ameaça | Mitigação | Risco residual |
|---|---|---|
| Força bruta numa matrícula | Bloqueio progressivo (3.3) | Bloqueio de propósito (DoS pontual) |
| Pulverização (um PIN comum contra todas as matrículas) | Rejeitar PINs triviais; limite por IP; alerta de falhas em matrículas distintas | NAT compartilhado obriga limite generoso |
| Vazamento do banco ou de backup | Pepper fora do banco + argon2id/scrypt | Se banco **e** pepper vazarem, 10⁸ é quebrável: segredo em cofre, acesso restrito, rotação por versão |
| Olhar por cima do ombro em terminal compartilhado | Sessão curta, "Trocar usuário", teclado virtual não resolve | Aceito |
| PIN anotado ou emprestado | Treinamento; auditoria mostra terminal e IP de cada login | Cultural |
| Roubo de sessão por XSS | Cookie `HttpOnly`, CSP, sem HTML injetado, dependências revisadas | Baixo |
| CSRF | Seção 4 | Baixo |
| Enumeração de matrículas | Resposta uniforme e tempo equalizado | Baixo |
| Superior abusa do reset | Hierarquia, PIN temporário que expira, troca obrigatória, evento e auditoria | Cultural |
| Credencial em log | Não logar `/auth/*`; teste que varre os logs | Baixo |

## 8. Papéis e permissões (D05)

### 8.1 Modelo

- Cada usuário tem **um perfil funcional** (`usuarios.perfil`): `ADMINISTRADOR`, `ALMOXARIFADO`, `SUPRIMENTOS`, `CONSULTA` ou `PORTARIA`. Os quatro primeiros **já existem** no código e na v1.
- Pode ter **um papel superior aditivo** (`alm.usuario_papeis`): `ENCARREGADO` ⊂ `SUPERVISOR` ⊂ `GERENTE`. São **cumulativos** (supervisor inclui tudo do encarregado), então um usuário normalmente tem só o mais alto.
- **Permissões efetivas = permissões do perfil ∪ permissões do papel superior.**
- A **matriz papel → permissões fica em código** (`backend/auth/permissions.mjs`, a criar), versionada e coberta por testes. O banco guarda só quem tem qual papel. Motivo: muda pouco, passa por revisão de PR, é testável tabela a tabela. Tabelas `permissoes` e `papeis_permissoes` editáveis em tempo de execução ficam para depois, se a empresa pedir (a especificação do ChatGPT as criaria já no MVP; é custo sem necessidade hoje).
- Cargo (título do RH) **não é papel**. Fica em `usuarios.cargo` só para exibição.
- Os papéis superiores e suas permissões são um **ponto de partida**; a lista real da empresa é a Q4.

### 8.2 Matriz inicial

`✓` tem · `○` tem com restrição de estado ou autoria (seção 8.3) · `—` não tem. Superiores são **cumulativos** e **somam** ao perfil funcional do usuário. Os códigos existentes foram mantidos (`recebimentos.read`, `itens.write`, `anexos.write`, `status.write`, `auditoria.read`...); `recebimentos.archive` vira alias de `recebimentos.delete` na transição.

| Permissão | ADMIN | ALMOX | SUPR | CONSU | PORT | +ENC | +SPV | +GER |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `recebimentos.read` | ✓ | ✓ | ✓ | ✓ | — | | | |
| `recebimentos.read_basico` (código, status, fornecedor, NF) | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| `recebimentos.create` | ✓ | ✓ | — | — | — | | | |
| `recebimentos.update` | ✓ | ✓ | ○ | — | — | | | |
| `recebimentos.export` | ✓ | ✓ | ✓ | ✓ | — | | | |
| `recebimentos.delete` (exclusão lógica) | ✓ | — | — | — | — | | ✓ | ✓ |
| `recebimentos.restore` | ✓ | — | — | — | — | | ✓ | ✓ |
| `recebimentos.reopen` (reabrir finalizado) | ✓ | — | — | — | — | | | |
| `itens.read` | ✓ | ✓ | ✓ | ✓ | — | | | |
| `itens.write` | ✓ | ✓ | — | — | — | | | |
| `itens.delete` | ✓ | ○ | — | — | — | ✓ | ✓ | ✓ |
| `anexos.read` | ✓ | ✓ | ✓ | ✓ | — | | | |
| `anexos.write` | ✓ | ✓ | ○ | — | — | | | |
| `anexos.delete` (exclusão lógica + quarentena) | ✓ | ○ | ○ | — | — | ✓ | ✓ | ✓ |
| `anexos.restore` | ✓ | — | — | — | — | | ✓ | ✓ |
| `anexos.purge` (purga definitiva) | ✓ | — | — | — | — | | | |
| `divergencias.read` | ✓ | ✓ | ✓ | ✓ | — | | | |
| `divergencias.write` | ✓ | ✓ | ○ | — | — | | | |
| `divergencias.resolve` / `divergencias.reopen` | ✓ | — | ✓ | — | — | | | |
| `status.write` | ✓ | ✓ | ○ | — | — | | | |
| `status.force` (fora do fluxo) | ✓ | — | — | — | — | | | |
| `portaria.read` | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| `portaria.write` (registrar chegada) | ✓ | ✓ | — | — | ✓ | | | |
| `portaria.link` (vincular a recebimento) | ✓ | ✓ | — | — | — | | | |
| `portaria.cancel` | ✓ | — | — | — | — | ✓ | ✓ | ✓ |
| `historico.read` | ✓ | ✓ | ✓ | ✓ | — | | | |
| `auditoria.read` (antes/depois) | ✓ | — | — | — | — | | ✓ | ✓ |
| `auditoria.tecnica` (IP, user-agent, request id) | ✓ | — | — | — | — | | | |
| `excluidos.read` (tela de excluídos) | ✓ | — | — | — | — | ✓ | ✓ | ✓ |
| `usuarios.read` | ✓ | — | — | — | — | | | ✓ |
| `usuarios.write` | ✓ | — | — | — | — | | | |
| `usuarios.reset_pin` / `usuarios.block` (posto inferior) | ✓ | — | — | — | — | | ✓ | ✓ |
| `papeis.write` (conceder/revogar papel superior) | ✓ | — | — | — | — | | | |
| `filtros.global` | ✓ | — | — | — | — | | ✓ | ✓ |
| `integracoes.read` | ✓ | — | — | — | — | | | ✓ |
| `integracoes.manage` | ✓ | — | — | — | — | | | |

Isto **aperta** o `SUPRIMENTOS` em relação ao código de hoje (hoje ele escreve em recebimentos, itens e anexos como o Almoxarifado). Comunicar à equipe antes de ligar.

### 8.3 Regras que dependem de estado ou de autoria

Não cabem em matriz; ficam no serviço, com teste por regra:

1. **Recebimento finalizado é imutável**, inclusive para filhos (itens, arquivos, divergências). Reabrir exige `recebimentos.reopen` e justificativa. O banco também impõe (trigger da v1).
2. `SUPRIMENTOS` em `recebimentos.update`: só campos de compra e documento (lista a fechar com o setor).
3. `SUPRIMENTOS` em `status.write`: só `Em conferência` e `Divergência identificada` (já é assim em `ROLE_STATUS_PERMISSIONS`).
4. `ALMOXARIFADO` em `itens.delete`: só com o recebimento em `Em digitação`.
5. `ALMOXARIFADO` e `SUPRIMENTOS` em `anexos.delete`: só o **próprio** arquivo, e só antes de finalizar (v1 §8). Quem precisa corrigir erro alheio chama um superior.
6. `usuarios.reset_pin` e `usuarios.block`: só sobre posto estritamente inferior (3.4).
7. `SUPRIMENTOS` em `divergencias.write`: só divergência documental.

### 8.4 Como aplicar

- Middleware `requirePermission('anexos.delete')` por rota; **negar por padrão**: rota sem declaração responde `403`.
- `/auth/me` devolve `permissoes`; a UI esconde ou desabilita o que não pode (parte 06). A UI **nunca** é a defesa.
- Teste automático **gerado a partir da matriz**: para cada rota × papel, o status esperado (`2xx`, `403`). Se alguém muda a matriz sem mudar o teste, o CI falha.
- RLS no Postgres é segundo muro (D02), não o primeiro: o backend acessa com a role técnica `alm_api`.

## 9. Testes obrigatórios desta parte (Marcelo)

- Bloqueio progressivo: 5, 8 e 10 falhas; reset do contador; desbloqueio por superior.
- Enumeração: resposta e tempo estatisticamente iguais para matrícula existente e inexistente.
- Sessão: expiração por inatividade e absoluta; revogação imediata ao desativar usuário e ao mudar papel; rotação no login.
- CSRF: mutação sem `Origin` válido é recusada.
- Troca obrigatória: nenhuma rota além das três permitidas responde antes da troca.
- Logs: varredura não encontra o PIN usado nos testes.
- Matriz gerada: todas as combinações rota × papel.
- Auditoria: trocar PIN gera linha em `historico_alteracoes` **sem** o hash (o trigger do delta); login gera `eventos_autenticacao`.
- Concorrência: duas trocas de PIN simultâneas não corrompem a credencial.

## 10. Regra de exclusão (pedido do Lucas)

| O quê | Quem pode excluir | Como | O que permanece |
|---|---|---|---|
| Arquivo no Drive | `ENCARREGADO`+ (e o autor, em rascunho) | Exclusão lógica + **quarentena** em pasta própria do Drive (parte 05) | Linha em `arquivos`, bytes na quarentena, auditoria com motivo |
| Purga definitiva do arquivo | `ADMINISTRADOR` (Q4: talvez `GERENTE` + `ADMINISTRADOR`) | Job autorizado, só depois da retenção | Auditoria e checksum |
| Linha na planilha | **Ninguém.** A planilha é espelho somente leitura | Para "apagar", exclui-se o **recebimento** no ALM (`SUPERVISOR`+) e o espelho reflete | Auditoria da exclusão |
| Recebimento | `SUPERVISOR`+ | Exclusão lógica com motivo; restaurar também é `SUPERVISOR`+ | Tudo, na tela "Excluídos" |
| Item | `ENCARREGADO`+ (Almoxarifado só em rascunho) | Exclusão lógica | Linha e auditoria |
| Chegada (Portaria) | `ENCARREGADO`+ cancela | Status `CANCELADA` + exclusão lógica | Linha e auditoria |
| Usuário | Ninguém exclui; `ADMINISTRADOR` desativa | `ativo = false` | Histórico e autoria |
| Auditoria | **Ninguém** | Tabela append-only (trigger + privilégios) | Tudo |

**Limite honesto:** o ALM só garante o que passa por ele. Quem tiver permissão de Editor direto no Drive ou na planilha pode apagar por fora. A defesa é de permissão do Google (pessoas como Leitor; só a identidade do ALM escreve) mais detecção por reconciliação. Detalhes na parte 05.

## 11. Se a equipe escolher o Plano B (Supabase Auth)

- `alm.credenciais_pin` e o hash/pepper saem; `auth.users` passa a guardar a senha (PIN), com `usuarios.auth_user_id` ligando os dois.
- Desligar **sign-ups públicos** e login anônimo no painel (senão qualquer um com a chave pública cria conta) e criar usuários só pelo backend com a chave secreta.
- O backend continua sendo o ponto de login (para aplicar o bloqueio por matrícula **antes** de chamar o Supabase), então o limite de 30/5 min por IP continua valendo; pedir aumento nas configurações de rate limit.
- Sessão por JWT: validar assinatura (JWKS), conferir `ativo` no banco **a cada requisição** para revogar na hora, e aceitar que inatividade e tempo máximo exigem Pro.
- Mantidos sem mudança: matriz de permissões, `usuario_papeis`, auditoria por trigger, `eventos_autenticacao`, API de usuários.

## 12. Fontes verificadas em 06/10/2026

- Rate limits do Auth: https://supabase.com/docs/guides/auth/rate-limits
- Hooks e planos: https://supabase.com/docs/guides/auth/auth-hooks e https://supabase.com/docs/guides/auth/auth-hooks/password-verification-hook
- Senhas: https://supabase.com/docs/guides/auth/passwords e https://supabase.com/docs/guides/auth/password-security
- Sessões: https://supabase.com/docs/guides/auth/sessions
- IPs dinâmicos da Vercel: https://vercel.com/docs/functions/limitations (link relacionado "fixed IP address")
- **A verificar:** valores vigentes da tabela OWASP; se o `@node-rs/argon2` roda sem problema na função da Vercel (spike S2).
