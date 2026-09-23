import React, { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export const THEME_STORAGE_KEY = 'alm-theme'

function getStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1020' : '#14224d')
}

export function useTheme() {
  const [theme, setTheme] = useState(getStoredTheme)

  useEffect(() => {
    applyTheme(theme)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // O tema continua funcional mesmo quando o armazenamento local não está disponível.
    }
  }, [theme])

  return { theme, toggleTheme: () => setTheme((current) => current === 'dark' ? 'light' : 'dark') }
}

export function ThemeToggle({ theme, onToggle, compact = false }) {
  const isDark = theme === 'dark'
  const label = isDark ? 'Ativar tema claro' : 'Ativar tema escuro'

  return (
    <button
      className={`theme-toggle ${compact ? 'theme-toggle-compact' : ''}`}
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
    >
      <Sun size={16} aria-hidden="true" />
      <span className="theme-toggle-track" aria-hidden="true"><span className="theme-toggle-thumb" /></span>
      <Moon size={16} aria-hidden="true" />
      {!compact ? <span className="theme-toggle-label">{isDark ? 'Escuro' : 'Claro'}</span> : null}
    </button>
  )
}
