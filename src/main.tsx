import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { requestReload } from './app/reloadGate';
import './index.css';

// Installable / offline app shell. A new build waits (registerType 'prompt')
// and is applied with a reload only while nothing would be lost — never
// mid-session or mid-export (see reloadGate).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => requestReload(() => void updateSW(true)),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
