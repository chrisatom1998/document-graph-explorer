import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './ui/AppErrorBoundary';
import { installGlobalErrorHandlers } from './util/globalErrors';
import { installOfflineFetchGuard } from './offline';

installOfflineFetchGuard();
installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
