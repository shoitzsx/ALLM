# Contrato de anexos

Base URL: `/api/v1`. Todas as chamadas para a API usam `Content-Type: application/json` e `X-User-Id`. O navegador envia os bytes diretamente a uma sessão temporária do Google Drive; `GOOGLE_OAUTH_CLIENT_SECRET` e `GOOGLE_OAUTH_REFRESH_TOKEN` nunca chegam ao cliente.

## Limites e tipos

- Tipos aceitos: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`, `image/heic`, `image/heif`.
- Fluxo resumível: até 4 MiB por arquivo, em partes de 1 MiB (múltiplas de 256 KiB). O download passa pela Function autenticada da Vercel, que limita respostas a 4,5 MB.
- O fluxo Base64 antigo continua apenas como compatibilidade para clientes anteriores e aceita até 3 MiB. A nova interface deve usar o fluxo resumível.

## Upload resumível

1. Inicie a sessão:

```http
POST /recebimentos/:recebimentoId/anexos/upload-sessions

{
  "name": "nota-fiscal.pdf",
  "mimeType": "application/pdf",
  "size": 2457600,
  "categoria": "Nota Fiscal"
}
```

Resposta `201`:

```json
{
  "upload": {
    "sessionUrl": "https://www.googleapis.com/upload/drive/v3/files?...",
    "method": "PUT",
    "chunkSize": 1048576
  },
  "constraints": { "maxBytes": 4194304, "chunkBytes": 1048576 }
}
```

`sessionUrl` é temporária e sensível: mantenha-a somente em memória, não em logs, estado persistido ou planilha.

2. Faça `PUT` direto para `sessionUrl`, enviando cada `Blob` de 1 MiB com `Content-Range: bytes inicio-fim/tamanhoTotal`. Resposta `308` significa que a parte foi aceita; continue a partir do próximo byte. A última parte retorna `200` ou `201` com o metadado do Drive, inclusive `id`.

O nome salvo no Drive recebe o protocolo do recebimento e uma sequência de quatro dígitos, por exemplo `REC-2026-0017_0001_baixados.jpg`. A sequência considera todos os anexos registrados para esse recebimento, inclusive os removidos. O nome original continua sendo exibido na interface e armazenado na planilha.

3. Confirme a persistência no ALM. O `fileId` recebido no passo anterior só é usado nesta chamada:

```http
POST /recebimentos/:recebimentoId/anexos

{ "fileId": "id-do-arquivo-drive", "categoria": "Nota Fiscal" }
```

Resposta `201`: objeto de anexo. A API confere que o arquivo pertence à sessão/pasta daquele recebimento, grava seu `fileId` no Google Sheets como `storageKey`, e retorna uma URL interna de download. `storageKey` não é exposto à interface.

```json
{
  "id": "ANX-...",
  "nome": "nota-fiscal.pdf",
  "categoria": "Nota Fiscal",
  "tipo": "Nota Fiscal",
  "mimeType": "application/pdf",
  "tamanho": 2457600,
  "dataInclusao": "2026-09-28T...Z",
  "incluidoPor": { "id": "USR-001", "nome": "..." },
  "url": "/api/v1/recebimentos/:recebimentoId/anexos/ANX-.../download",
  "removido": false
}
```

## Leitura e download

`GET /recebimentos/:recebimentoId/anexos` responde `200` com `{ "data": [anexos ativos] }`.

`GET /recebimentos/:recebimentoId/anexos/:anexoId/download` faz proxy autenticado do Drive. Fotos seguras são retornadas inline; PDF e formatos sem prévia segura são retornados como download, com `X-Content-Type-Options: nosniff`.

## Remoção

```http
DELETE /recebimentos/:recebimentoId/anexos/:anexoId

{ "reason": "Documento substituído" }
```

Resposta `200` devolve o anexo com `removido: true`. O backend exclui o arquivo físico no Drive e persiste a remoção e a auditoria no Sheets. Repetir uma remoção após um `404` do Drive é seguro: arquivo já inexistente é tratado como removido.

## Erros

Erros seguem `{ "error": { "code", "message", "details"? } }`.

| Status | Código | Quando ocorre |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | `X-User-Id` ausente ou inválido |
| 403 | `FORBIDDEN` | perfil Consulta ou recebimento finalizado sem privilégio administrativo |
| 404 | `RECEIPT_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`, `FILE_NOT_FOUND` | recurso inexistente ou removido |
| 409 | `ATTACHMENT_ALREADY_LINKED` | o mesmo `fileId` já foi confirmado para o recebimento |
| 422 | `FILE_NAME_REQUIRED`, `INVALID_FILE_SIZE`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `INVALID_UPLOAD_FILE` | metadados, tipo, limite ou `fileId` inválidos |
| 422 | `INVALID_FILE_DATA`, `FILE_SIZE_MISMATCH` | somente no legado Base64 |
| 502 | `DRIVE_AUTH_FAILED`, `DRIVE_FOLDER_UNAVAILABLE`, `DRIVE_UPLOAD_SESSION_FAILED`, `DRIVE_OPERATION_FAILED` | falha de OAuth ou da API Google Drive |
| 503 | `DRIVE_NOT_CONFIGURED` | variáveis OAuth do Drive ainda não foram configuradas |
