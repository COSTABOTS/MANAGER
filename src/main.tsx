import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

const shouldResetLocalSession = new URLSearchParams(window.location.search).has('reset');

if (shouldResetLocalSession) {
  sessionStorage.removeItem('costabots_logged_in');
  sessionStorage.removeItem('costabots_client_config');
  localStorage.removeItem('manager_settings');
  localStorage.removeItem('manager_date_booking_status');
  window.history.replaceState({}, document.title, window.location.pathname);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.info('[Safari Manager] Service worker registration skipped:', error);
    });
  });
}

if ('serviceWorker' in navigator && import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });

    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  });
}
