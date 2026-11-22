import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import 'misans/lib/Normal/MiSansVF.min.css'
import './styles/global.css'
import './styles/mica.css'
import './styles/launch.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
