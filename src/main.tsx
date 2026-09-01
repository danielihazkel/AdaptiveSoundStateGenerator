import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { installGlobalErrorHandlers } from './app/appErrors';
import { markUpdateReady, setUpdateHandler } from './app/swUpdate';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './index.css';

// Background failures (rejected promises, audio callbacks) become a notice
// instead of vanishing into the console.
installGlobalErrorHandlers();

// Installable / offline app shell. A new build waits (registerType 'prompt')
// until the user taps Update in the toast; the reload then runs only while
// nothing would be lost — never mid-session or mid-export (see reloadGate).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: markUpdateReady,
});
setUpdateHandler(() => void updateSW(true));

// Root fallback is deliberately static: if the whole tree died, hooks and
// stores below it can't be trusted either.
const ROOT_FALLBACK = (
  <main className="app">
    <h1>Resonance</h1>
    <div className="notice warning" role="alert">
      <span>Resonance hit an error it couldn't recover from. Reload the page to continue.</span>
      <button type="button" className="chip" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  </main>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={() => ROOT_FALLBACK}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
