import React from 'react'

export function VisualizationTabs({ tabs, activeTabId, onChange }) {
  return (
    <div className="viz-tabs" role="tablist" aria-label="Entidades da Visualização">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeTabId}
          className={`viz-tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
