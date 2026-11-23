import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { logAppError } from './utils/errorLogger';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event.message) {
      logAppError('runtime', event.message, `${event.filename || ''}:${event.lineno || 0}`);
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason =
      event.reason instanceof Error
        ? event.reason.message
        : typeof event.reason === 'string'
        ? event.reason
        : 'Yakalanmayan Promise hatası';
    logAppError('runtime', reason);
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
