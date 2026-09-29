const FRIENDLY_MESSAGES = {
  UNAUTHORIZED: 'Sessão expirada. Atualize a página e tente novamente.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  RECEIPT_NOT_FOUND: 'Este recebimento não foi encontrado.',
  ATTACHMENT_NOT_FOUND: 'O arquivo não está mais disponível.',
  FILE_NOT_FOUND: 'O arquivo não está mais disponível.',
  ATTACHMENT_ALREADY_LINKED: 'Este arquivo já está vinculado ao recebimento.',
  FILE_NAME_REQUIRED: 'Selecione um arquivo válido.',
  FILE_NAME_TOO_LONG: 'O nome do arquivo é muito longo.',
  INVALID_FILE_SIZE: 'Tamanho de arquivo inválido.',
  FILE_TOO_LARGE: 'O arquivo excede o limite de 4 MiB.',
  UNSUPPORTED_FILE_TYPE: 'Este tipo de arquivo não é aceito.',
  INVALID_UPLOAD_FILE: 'O arquivo enviado não pôde ser confirmado. Tente novamente.',
  INVALID_FILE_DATA: 'Conteúdo do arquivo inválido.',
  FILE_SIZE_MISMATCH: 'O tamanho informado não corresponde ao conteúdo enviado.',
  DRIVE_NOT_CONFIGURED: 'O armazenamento de documentos ainda não está disponível.',
  UPLOAD_CANCELLED: 'Envio cancelado.',
}

export function friendlyAttachmentError(error) {
  const code = error?.code
  if (code && FRIENDLY_MESSAGES[code]) return FRIENDLY_MESSAGES[code]
  if (typeof code === 'string' && code.startsWith('DRIVE_')) {
    return 'Não foi possível concluir a operação com o armazenamento. Tente novamente.'
  }
  return error?.message || 'Não foi possível concluir a operação.'
}
