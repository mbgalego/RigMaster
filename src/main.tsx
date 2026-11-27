import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

(window as unknown as { __rigAppMounted?: boolean }).__rigAppMounted = true;

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
