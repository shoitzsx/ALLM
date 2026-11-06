# Recuperação excepcional do primeiro administrador

Procedimento para o **mesmo UUID** de `MKADM001`, depois da exposição do PIN temporário, do código de ativação e de parte do pepper antigo. **Não** executa o bootstrap nem cria outro administrador. Esta alteração está apenas versionada; não foi aplicada no Supabase remoto e o backend não foi publicado. A aplicação controlada da migration está descrita em [APLICACAO-MIGRATION-RECUPERACAO.md](APLICACAO-MIGRATION-RECUPERACAO.md).

## Preparação e autorização

1. Kobner aprova a referência do incidente, identifica o operador externo e autoriza a janela de recuperação. Confirme o UUID real de `MKADM001` por canal administrativo confiável. A identidade informada em `--operator` é uma referência auditada; o controle de acesso efetivo é o login operacional restrito, capaz apenas de `SET ROLE alm_provisioner`.
2. Interrompa logins e o backend durante a janela. Aplique a migration `20261106120000_alm_recuperacao_primeiro_administrador.sql` pelo processo versionado e controlado. Ela não deve ser aplicada automaticamente nem por este script.
3. Gere **novo** `ALM_PIN_PEPPER_V2` (mínimo 32 caracteres aleatórios) em um gerenciador de segredos. Configure-o no ambiente privado do script e do backend atualizado. Use a mesma versão 2 nos dois. Não reutilize o V1. Se houver outros usuários com `pepper_versao=1`, mantenha V1 apenas enquanto seus PINs são migrados; sua exposição exige um plano separado para eles. Se não houver, remova V1 do backend após a recuperação.
4. Configure `ALM_PROVISION_DATABASE_URL` para o login operacional temporário e restrito. Confirme que esse login não tem privilégios diretos nas tabelas e que consegue apenas assumir `alm_provisioner`. Não execute como superusuário nem use a conexão da API. Não coloque URL, pepper, PIN ou código na linha de comando, no Git ou em mensagens.

## Execução única

Crie e registre um UUID de requisição **antes** da execução. Em terminal privado interativo, sem redirecionamento nem gravação de sessão, execute:

```powershell
node backend/scripts/recover-first-admin.mjs --usuario-id <UUID-EXISTENTE> --matricula MKADM001 --incident INC-REFERENCIA --operator OPERADOR-EXTERNO --request-id <UUID-DA-REQUISICAO> --valid-hours 24 --confirm RECOVER-FIRST-ADMIN
```

A transação revoga autorizações abertas e passkeys, invalida desafios, fluxos parciais e sessões, troca o PIN e o código por hashes novos e registra incidente, operador, `request_id` e contagens em `alm.recuperacoes_primeiro_administrador`. O novo PIN fica temporário e deverá ser trocado no primeiro acesso. A função rejeita repetir o mesmo `request_id`; não atribui revogação ao Kobner.

**Somente após confirmação do `COMMIT` e postcheck** o terminal mostra o PIN e o código novos, uma vez. Entregue-os ao titular por canal seguro e faça o cadastro de uma nova passkey. O postcheck verifica mesmo UUID, pepper versão 2, uma autorização nova, ausência de passkeys, sessões e fluxos ativos. A tabela de recuperação tem RLS e nenhuma policy para a API ou para `alm_provisioner`; a consulta é exposta apenas por função controlada.

## Se algo falhar

Pare. **Não repita o comando** nem altere o `request_id` para tentar de novo. Antes do `COMMIT`, a transação deve reverter integralmente; se a conexão cair durante o `COMMIT` ou o postcheck falhar, o resultado pode ser incerto e os segredos podem não ter sido exibidos. Consulte a função `alm.verificar_recuperacao_primeiro_administrador(request_id, usuario_id)` pelo login operacional, em transação de leitura com `SET LOCAL ROLE alm_provisioner`, e investigue a auditoria pelo incidente. Uma nova tentativa exige decisão explícita e nova referência administrativa.

Não reinicie o backend antes de confirmar a versão 2 do pepper e o resultado seguro do postcheck. Não aplique esta migration nem execute este procedimento no Supabase remoto sem autorização de Kobner.
