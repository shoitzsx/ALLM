import { createContext } from 'react'

// Fica em arquivo próprio para o Provider e o Viewport poderem importá-lo sem
// importarem um ao outro (o Provider renderiza o Viewport).
export const NotificationsContext = createContext(null)
