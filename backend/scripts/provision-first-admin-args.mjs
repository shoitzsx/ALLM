const MATRICULA = /^[0-9A-Z]{3,20}$/

export function parseProvisionArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
      throw new Error('Argumentos invalidos ou duplicados.')
    }
    values.set(key, value)
  }
  const allowed = new Set(['--matricula', '--nome', '--approval-reference', '--confirm', '--valid-hours'])
  if ([...values.keys()].some((key) => !allowed.has(key))) throw new Error('Argumento desconhecido.')
  const matricula = values.get('--matricula')?.trim().toUpperCase()
  const nome = values.get('--nome')?.trim()
  const approvalReference = values.get('--approval-reference')?.trim()
  const confirmation = values.get('--confirm')
  const validHours = Number(values.get('--valid-hours') || 24)
  if (!MATRICULA.test(matricula || '') || !nome || nome.length > 200) {
    throw new Error('Matricula ou nome invalidos.')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/ -]{2,117}[A-Za-z0-9]$/.test(approvalReference || '')) {
    throw new Error('Informe uma referencia de aprovacao valida.')
  }
  if (confirmation !== 'PROVISION-FIRST-ADMIN') {
    throw new Error('Aprovacao explicita ausente: use --confirm PROVISION-FIRST-ADMIN.')
  }
  if (!Number.isInteger(validHours) || validHours < 1 || validHours > 72) {
    throw new Error('--valid-hours deve estar entre 1 e 72.')
  }
  return { matricula, nome, approvalReference, validHours }
}
