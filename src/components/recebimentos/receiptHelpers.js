import { getResponsibleName } from '../../data.js'

export function displayResponsible(receipt) {
  return getResponsibleName(receipt) || 'Não informado'
}

export function getActorName(actor) {
  if (!actor) return 'Sistema'
  if (typeof actor === 'string') return actor
  return actor.nome || actor.name || 'Sistema'
}
