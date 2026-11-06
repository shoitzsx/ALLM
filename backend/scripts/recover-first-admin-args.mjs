const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{2,117}[A-Za-z0-9]$/

export function parseRecoveryArguments(argv) {
  if (argv.length % 2 !== 0) throw new Error('Argumentos incompletos.')
  const values = new Map()
  for (let i = 0; i < argv.length; i += 2) {
    const [key, value] = [argv[i], argv[i + 1]]
    if (!key?.startsWith('--') || !value || value.startsWith('--') || values.has(key)) {
      throw new Error('Argumentos invalidos ou duplicados.')
    }
    values.set(key, value)
  }
  const allowed = new Set(['--usuario-id', '--matricula', '--incident', '--operator',
    '--request-id', '--valid-hours', '--confirm'])
  if ([...values.keys()].some((key) => !allowed.has(key))) throw new Error('Argumento desconhecido.')
  const usuarioId = values.get('--usuario-id')
  const matricula = values.get('--matricula')
  const incident = values.get('--incident')
  const operator = values.get('--operator')
  const requestId = values.get('--request-id')
  const validHours = Number(values.get('--valid-hours') || 24)
  if (!UUID.test(usuarioId || '') || !UUID.test(requestId || '') ||
      !/^[0-9A-Z]{3,20}$/.test(matricula || '') ||
      !REFERENCE.test(incident || '') || !REFERENCE.test(operator || '')) {
    throw new Error('UUID, matricula, incidente ou operador invalidos.')
  }
  if (!Number.isInteger(validHours) || validHours < 1 || validHours > 72) {
    throw new Error('--valid-hours deve estar entre 1 e 72.')
  }
  if (values.get('--confirm') !== 'RECOVER-FIRST-ADMIN') {
    throw new Error('Confirmacao explicita ausente: use --confirm RECOVER-FIRST-ADMIN.')
  }
  return { usuarioId, matricula, incident, operator, requestId, validHours }
}
