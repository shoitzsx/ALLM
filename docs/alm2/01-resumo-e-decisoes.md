# 01 — Resumo e registro de decisões

## 1. O ALM 2.0 em uma página

O ALM deixa de ser uma interface sobre uma planilha e passa a ser um sistema com banco de verdade, identidade real, auditoria e dois ambientes de uso (Portaria e Almoxarifado). Quatro mudanças sustentam isso:

1. **PostgreSQL no Supabase é a fonte da verdade.** O schema `alm` já está desenhado e é reaproveitado do `ARQUITETURA_TECNICA_ALM.md` v1.0 (nomes em português, triggers de auditoria, validação de finalização, busca). O Sheets deixa de ser banco.
2. **Só o backend fala com o banco.** O navegador nunca consulta o Supabase. Isso simplifica segurança e permite transações de verdade.
3. **Login por matrícula + PIN, com credenciais próprias no backend** (recomendação D03; o Supabase Auth fica como Plano B, com a evidência na parte 03).
4. **Drive guarda bytes; Sheets é espelho.** Exclusão é lógica no banco e física só por job autorizado, passando por uma quarentena. O Sheets é regenerado a partir do banco e nunca é editado por pessoas.

```
 Navegador (React/Vite)            Tablet/PC da Portaria (mesmo app, rota /portaria)
        |  HTTPS, cookie de sessão HttpOnly, mesmo domínio
        v
 +---------------------------------------------------------------+
 | Vercel (plano Pro, região São Paulo)                          |
 |  Frontend estático  +  Função /api/v1/*  (backend/app.mjs)     |
 |    sessão -> permissões (RBAC) -> serviços de domínio          |
 |    repositório Postgres (driver pg, 1 transação por mutação)   |
 |    jobs internos: Cron 1/min + waitUntil após a resposta       |
 +-------------+---------------------------+---------------------+
               | pooler transacional       | googleapis
               | (porta 6543, IPv4)        |
               v                           v
 +---------------------------+   +-------------------------------------+
 | Supabase (região SP)      |   | Google                              |
 |  Postgres, schema alm     |   |  Drive : bytes dos arquivos         |
 |  (fora da Data API)       |   |          (quarentena p/ exclusão)   |
 |  triggers de auditoria    |   |  Sheets: espelho + exportações      |
 |  sessões, RBAC, outbox    |   |          (somente leitura p/ gente) |
 +---------------------------+   +-------------------------------------+
```

O que **não** muda: React/Vite, o scanner, o upload direto navegador→Drive, o contrato `/api/v1` atual, os 5 status e os 4 perfis existentes.

## 2. Registro de decisões

Status: **Aprovada** (já decidida por quem decide) · **Recomendada** (aguarda aprovação) · **Aberta** (falta informação, ver perguntas Q) · **Spike** (decide depois de um teste curto, parte 07).

| ID | Decisão | Resumo da recomendação | Status | Dono | Detalhe |
|---|---|---|---|---|---|
| D01 | Banco | PostgreSQL gerenciado no Supabase, schema `alm` da v1 §3, nomes em português | **Aprovada** (preferência do Lucas; compatível com a "decisão fixa" PostgreSQL da v1) | Kobner | 04 |
| D02 | Acesso ao banco | Só o backend; schema `alm` fora da Data API; roles `alm_api`/`alm_job`; pooler transacional; `set_config(..., true)` por transação; RLS como segundo muro | Recomendada | Kobner + Goran | 04 |
| D03 | Autenticação | Credenciais próprias (matrícula + PIN), sessão opaca em Postgres, cookie HttpOnly. Plano B: Supabase Auth via BFF | Recomendada, **Spike S2** | Kobner | 03 |
| D04 | PIN | 8 dígitos, hash com pepper, bloqueio progressivo por matrícula, troca obrigatória no 1º acesso, reset por superior | Recomendada (Q3) | Kobner | 03 |
| D05 | Papéis | 5 funcionais (`ADMINISTRADOR`, `ALMOXARIFADO`, `SUPRIMENTOS`, `CONSULTA`, `PORTARIA`) + 3 superiores aditivos (`ENCARREGADO`, `SUPERVISOR`, `GERENTE`); matriz em código, testada; quem tem qual papel no banco | Recomendada (Q4) | Kobner | 03 |
| D06 | Código do recebimento | `REC-AAAA-NNNNNN`, gerado **só pelo banco** (a trigger da v1 recusa código informado); a importação segue a ordem do número legado para reproduzir a numeração; o original fica em `codigo_legado` e a API aceita os dois | Recomendada | Goran | 04 |
| D07 | Exclusão | Uma só: exclusão lógica (`excluido_*`); `arquivado*` do Sheets é absorvido; `arquivar/restaurar` viram alias | Recomendada | Goran | 04 |
| D08 | Auditoria | Triggers no banco (antes/depois, append-only) + tabelas de eventos (acesso a arquivo, autenticação, exportação); tabelas com segredo ficam fora do trigger genérico | Recomendada | Kobner / Goran | 04 |
| D09 | Drive | Só bytes; exclusão = **quarentena em pasta própria** (nunca a lixeira do Drive); purga só por job autorizado; upload direto mantido; identidade depende de Workspace | Recomendada (Q1, Q8, Q12) | Goran | 05 |
| D10 | Sheets | Espelho somente leitura em **planilha nova**; sincronização por snapshot idempotente; escrita `RAW`; exportação formatada no layout legado; CSV com neutralização de fórmulas | Recomendada (Q14) | Goran | 05 |
| D11 | Jobs | Outbox transacional (`alm.outbox`), processada por `waitUntil` + Cron de 1 min (exige Vercel Pro) | Recomendada, **Spike S5** | Goran | 05 |
| D12 | Hospedagem | Manter Vercel, **plano Pro** (Hobby é não comercial), região São Paulo; Supabase em São Paulo. Plano B: Cloud Run da v1 sem mudar contratos | Aberta (Q7) | Lucas + Goran | 07 |
| D13 | Ambientes | Local (Supabase CLI), staging e produção separados, com planilhas e pastas Drive separadas; Preview nunca com dados reais | Recomendada | Kobner + Marcelo | 07 |
| D14 | Pesquisa | No servidor (FTS + trigram da v1), cursor, filtros declarativos validados por allowlist, filtros salvos `PRIVADO`/`GLOBAL` | Recomendada | Goran + Lucas | 04, 06 |
| D15 | Portaria | Módulo próprio: entidade `chegadas_portaria`; captura fotográfica do scanner (scanner ao vivo segue oculto); perfil `PORTARIA` vê só Portaria e status básico | Recomendada (Q5, Q6) | Lucas (UI), Goran/Kobner (API/DB) | 03, 06 |
| D16 | Frontend | Servidor é a autoridade; `versao`/`If-Match`; 401/403/409 tratados; ações condicionadas por `permissoes`; 5 níveis de notificação | Recomendada | Lucas | 06 |
| D17 | Responsabilidades | Lucas: frontend/scanner/produto. Goran: backend/domínio/integrações. Kobner: banco/identidade/RBAC. Marcelo: QA/release/observabilidade (proposta) | Aberta (Q13) | todos | 07 |
| D18 | Pré-requisito | Integrar `main` e a branch do rewrite, e validar rotas profundas em Preview, **antes** de qualquer feature | Recomendada, **Spike S7** | Marcelo + Goran | 07 |
| D19 | Dados atuais | Se o Sheets/Drive atuais forem de teste, recomeçar limpo; se forem reais, importação idempotente com relatório | Aberta (Q9) | Goran | 07 |
| D20 | Contrato da API | Preservar `/api/v1` atual (camelCase, `{error:{code,message,details}}`); acrescentar `versao`/`If-Match`, `requestId` e cursor; remover `X-User-Id`. O desenho REST da v1 (snake_case, `problem+json`, `/transicoes`) fica superado | Recomendada | Goran | 04 |

## 3. Perguntas para a empresa

Estas respostas destravam decisões. O "padrão assumido" é o que esta revisão usa se ninguém responder, para o trabalho não parar.

| # | Pergunta | Por que importa | Padrão assumido |
|---|---|---|---|
| Q1 | A empresa tem **Google Workspace** com administrador? | Shared Drive e service account só existem com Workspace. Sem isso, o Drive depende de uma conta OAuth | Não (Plano B do D09) |
| Q2 | De onde vem a lista de funcionários (RH)? Qual o formato da matrícula (tamanho, letras, zeros à esquerda)? | Importação de usuários e `CHECK` de matrícula | Texto alfanumérico, 3 a 20 caracteres, maiúsculo |
| Q3 | PIN de 8 dígitos é aceitável para o operador e para a Portaria? | Usabilidade × segurança | 8 dígitos |
| Q4 | Quem pode **excluir, restaurar e purgar** o quê? Quanto tempo a quarentena retém? | Matriz de permissões e job de purga | Tabela da parte 03; retenção 90 dias; purga só `ADMINISTRADOR` |
| Q5 | A Portaria só registra a chegada, ou também vincula/cancela? | Permissões do perfil `PORTARIA` | Registra; vincular é do Almoxarifado; cancelar é de superior |
| Q6 | A mesma NF pode chegar duas vezes? | Duplicidade na Portaria e no recebimento | Portaria bloqueia duplicata ativa; recebimento só alerta |
| Q7 | Aprovação de custo: Vercel Pro + Supabase Pro (e PITR?) | Produção legal e com backup | Pro nos dois, sem PITR |
| Q8 | Antivírus nos anexos é exigência da empresa? | Inviável dentro de função serverless; muda a hospedagem | Não no MVP |
| Q9 | Os dados atuais do Sheets e do Drive são reais ou de teste? | Define se há migração ou recomeço | Teste |
| Q10 | RPO/RTO aceitos: perder até 24 h (backup diário) ou 15 min (PITR, +US$ 100/mês)? | Custo e desenho de backup | 24 h, com dump diário em local separado |
| Q11 | Por quanto tempo guardar a auditoria? Qual a base legal (LGPD) para IP e user-agent? | Retenção e acesso | 5 anos, IP/UA só para administrador (validar com jurídico/DPO) |
| Q12 | Qual o tamanho máximo de arquivo desejado? | Hoje 4 MiB; a v1 prevê 20 MiB (foto) e 50 MiB (PDF) | 4 MiB até o spike S3 passar; depois 20 MiB |
| Q13 | O Marcelo aceita a frente de QA, release e observabilidade? | Hoje não há dono de testes de ponta a ponta | Sim (proposta) |
| Q14 | Quem precisa **abrir** as planilhas de espelho e exportação, e com qual conta Google? | O login por matrícula não revela e-mail; o ALM não sabe quem compartilhar | Pasta compartilhada gerida por administrador |

## 4. O que mudou em relação à especificação do ChatGPT

Detalhes e evidências na parte 08. Os pontos que mais pesam:

1. **Ele ignorou o `ARQUITETURA_TECNICA_ALM.md`.** Reinventou tabelas em inglês, protocolo, auditoria e RBAC, em vez de usar o DDL pronto.
2. **Autenticação.** Propôs Supabase Auth com e-mail sintético. Verifiquei que o hook de bloqueio por tentativas é exclusivo de planos Teams/Enterprise, que o login tem limite padrão de 30 por 5 minutos **por IP** (uma empresa inteira atrás de um NAT estoura isso na troca de turno) e que controle de sessão por inatividade é recurso Pro. E, como o navegador nunca consulta o banco, o principal benefício do Supabase Auth (JWT → RLS) não seria usado.
3. **Como o backend fala com o banco.** Não disse. Cliente REST do Supabase não faz transação com vários comandos; é preciso driver Postgres via pooler.
4. **Onde roda o "worker"** da outbox. Não disse. Cron da Vercel Hobby roda **1 vez por dia**; por minuto só no Pro.
5. **Custo e licença.** Esqueceu que a Vercel Hobby é **não comercial**.
6. **Drive.** "Mover para a lixeira com retenção de 60/90 dias" não funciona: a lixeira do Drive apaga sozinha em 30 dias. E `appProperties` (usado hoje) é invisível para outra identidade.
7. **Sheets.** "Upsert por ID" não existe no Sheets e a quota é 60 requisições/min **por usuário** (uma service account é um usuário). A alternativa é snapshot idempotente.
8. **Auditoria.** Propôs gravar eventos pela aplicação. Trigger no banco não pode ser esquecido por um bug. Além disso, o trigger genérico da v1 copiaria hash de PIN para a auditoria se fosse aplicado à tabela de credenciais.
9. **Papéis.** Inventou 9 papéis sem mapear para os 4 perfis reais; trocou os códigos de permissão em português por inglês.
10. **`arquivado` × exclusão.** Listou o evento de arquivar sem ter a coluna.
11. **Frontend.** Tratou como "tela de login". O store de 1.086 linhas é local-first e duplica regra de negócio; migrar para servidor-autoridade é o maior item de trabalho do Lucas.
12. **Segurança já existente.** Não viu que o export CSV do frontend não neutraliza fórmulas (`=`, `+`, `-`, `@`).
13. **Sem estimativas.** A v1 estima 10 a 12 semanas; aqui o roadmap tem fases, donos, saídas e spikes.

## 5. Próximas 72 horas

1. **Integrar as linhas de trabalho.** A branch `fix/vercel-api-routing` (rewrite do `vercel.json`) e a `main` (`780062a`, melhorias de anexos) divergiram em `cedcb3f`. O dry-run do merge não acusa conflito. Depois do merge: novo Preview com **todas** as variáveis de ambiente, e testar rotas profundas (spike S7). Hoje o fix do routing **não está validado**.
2. **Responder Q1, Q2, Q7 e Q9.** São as que mais mudam o escopo.
3. **Kobner:** subir o Supabase local (`supabase start`), aplicar o DDL da v1 + `sql/001_alm2_delta.sql`, e iniciar os spikes S1 e S2.
4. **Goran:** spikes S3 (download em streaming > 4,5 MB) e S4 (checksum e `properties` no Drive).
5. **Lucas:** tela de login e guarda de rotas contra um `/auth/me` simulado (parte 06, seção 9), sem esperar o backend.
6. **Marcelo:** se aceitar a frente, montar o smoke test de rotas profundas e o CI com `npm test` + validador SQL.
7. **Correção imediata e pequena, independente de tudo:** neutralizar fórmulas no `csvCell` (`src/data.js:499`). Detalhe na parte 05.
