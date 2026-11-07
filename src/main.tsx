import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './ui/AppErrorBoundary';
import { installGlobalErrorHandlers } from './util/globalErrors';
import { installOfflineFetchGuard } from './offline';
import { installStaleBuildRecovery } from './util/staleBuild';
import { applyDesign, initialDesign } from './design/designMode';

installOfflineFetchGuard();
installGlobalErrorHandlers();
installStaleBuildRecovery();
applyDesign(initialDesign());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
