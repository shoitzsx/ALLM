import React, { useEffect } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileClock,
  X,
} from 'lucide-react'

export const STATUS_META = {
  DRAFT: {
    label: 'Em digitação',
    shortLabel: 'Digitação',
    className: 'status-draft',
    icon: CircleDashed,
  },
  AWAITING_DOCUMENTATION: {
    label: 'Aguardando documentação',
    shortLabel: 'Docs. pendentes',
    className: 'status-docs',
    icon: FileClock,
  },
  IN_REVIEW: {
    label: 'Em conferência',
    shortLabel: 'Conferência',
    className: 'status-review',
    icon: Clock3,
  },
  DIVERGENCE: {
    label: 'Divergência identificada',
    shortLabel: 'Divergência',
    className: 'status-divergence',
    icon: AlertTriangle,
  },
  FINALIZED: {
    label: 'Conferido / Finalizado',
    shortLabel: 'Finalizado',
    className: 'status-finalized',
    icon: CheckCircle2,
  },
}

const STATUS_ALIASES = {
  'Em digitação': 'DRAFT',
  'Aguardando documentação': 'AWAITING_DOCUMENTATION',
  'Em conferência': 'IN_REVIEW',
  'Divergência identificada': 'DIVERGENCE',
  'Conferido/Finalizado': 'FINALIZED',
  'Conferido / Finalizado': 'FINALIZED',
}

export function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META[STATUS_ALIASES[status]] || STATUS_META.DRAFT
}

export function StatusBadge({ status, compact = false }) {
  const meta = getStatusMeta(status)
  const Icon = meta.icon
  return (
    <span className={`status-badge ${meta.className}`}>
      <Icon size={13} strokeWidth={2.4} aria-hidden="true" />
      {compact ? meta.shortLabel : meta.label}
    </span>
  )
}

export function Avatar({ name = 'Usuário', size = 'md' }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials}
    </span>
  )
}

export function Modal({ open, title, description, onClose, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.classList.add('modal-open')
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('modal-open')
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal-card modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar janela">
            <X size={20} />
          </button>
        </header>
        <div className="modal-content">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  )
}

export function ToastHost({ toasts, onDismiss }) {
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.type || 'success'}`} key={toast.id}>
          <span className="toast-icon">
            {toast.type === 'error' ? <AlertTriangle size={18} /> : <Check size={18} />}
          </span>
          <div>
            <strong>{toast.title}</strong>
            {toast.message ? <p>{toast.message}</p> : null}
          </div>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dispensar aviso">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="empty-state">
      {Icon ? (
        <span className="empty-icon">
          <Icon size={25} />
        </span>
      ) : null}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function FieldError({ children }) {
  if (!children) return null
  return <span className="field-error">{children}</span>
}

export function formatDate(value, options = {}) {
  if (!value) return '—'
  const parsed = value.includes?.('T') ? new Date(value) : new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: options.month || 'short',
    year: options.year || 'numeric',
    ...options,
  }).format(parsed)
}

export function formatDateTime(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

export function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
