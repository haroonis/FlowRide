import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Offline support + "Add to Home Screen" (PWA). Skipped inside the native app.
if ('serviceWorker' in navigator && import.meta.env.PROD && !(window as any).Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
