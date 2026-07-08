import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installOfflineFetchGuard } from './offline';

installOfflineFetchGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
