import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// O script no index.html já aplica o valor antes da primeira pintura. Esta
// leitura mantém o atributo correto também em ambientes sem localStorage.
if (!document.documentElement.dataset.theme) {
  document.documentElement.dataset.theme = 'light'
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
