import React from 'react'

/**
 * Colunas por mês (série de buildMonthlySeries). Altura proporcional ao maior
 * mês; mês com zero aparece como coluna vazia — é contagem real, não falta de
 * dado. As colunas são decorativas para leitor de tela: a tabela visualmente
 * oculta logo abaixo traz os mesmos números.
 */
export function MonthlyChart({ months, caption }) {
  const max = Math.max(0, ...months.map((month) => month.total))
  return (
    <figure className="monthly-chart">
      <div className="monthly-chart-plot" aria-hidden="true" style={{ '--monthly-columns': months.length }}>
        {months.map((month, index) => {
          const showYear = index === 0 || month.key.endsWith('-01')
          return (
            <div className="monthly-chart-col" key={month.key}>
              <span className="monthly-chart-value">{month.total}</span>
              <span className="monthly-chart-bar-area">
                <span className={`monthly-chart-bar ${month.total ? '' : 'is-zero'}`} style={{ height: `${max ? (month.total / max) * 100 : 0}%` }} />
              </span>
              <span className="monthly-chart-label">
                {month.label.slice(0, 3)}
                <span className={showYear ? 'monthly-chart-year' : 'monthly-chart-year is-repeat'}>/{month.key.slice(2, 4)}</span>
              </span>
            </div>
          )
        })}
      </div>
      {/* A tabela fica dentro de um bloco oculto: uma <table> ignora width: 1px e criaria rolagem horizontal. */}
      <div className="chart-sr-only">
        <table>
          <caption>{caption}</caption>
          <thead><tr><th scope="col">Mês</th><th scope="col">Recebimentos</th></tr></thead>
          <tbody>
            {months.map((month) => <tr key={month.key}><th scope="row">{month.label}</th><td>{month.total}</td></tr>)}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
