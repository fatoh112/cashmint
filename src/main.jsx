import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerPosServiceWorker } from './utils/pwaIpadUtils'

// Register Service Worker for POS mode only
if (import.meta.env.MODE === 'pos') {
  registerPosServiceWorker();
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
