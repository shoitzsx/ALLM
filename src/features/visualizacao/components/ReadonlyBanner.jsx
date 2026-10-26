import React from 'react'
import { Lock } from 'lucide-react'

export function ReadonlyBanner() {
  return (
    <div className="info-strip viz-readonly-banner">
      <Lock size={15} />
      <span>
        <strong>Somente leitura.</strong> Os dados desta área não podem ser editados diretamente.
      </span>
    </div>
  )
}
