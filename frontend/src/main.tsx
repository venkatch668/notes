import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Order matters: Bootstrap first, our retheme of its variables second, the
// OneNote-specific layer last so it always wins.
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/bootstrap-theme.css';
import './styles/app.css';

import { registerServiceWorker } from './pwa';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
