import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ServicesProvider } from './lib/repo';
import { createDexieRepository } from './data/dexie/dexieRepository';
import { webPlatform } from './platform/web';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesProvider repo={createDexieRepository()} platform={webPlatform}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
