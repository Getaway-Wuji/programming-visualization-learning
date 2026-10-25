import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './appearance/themes.css';
import './appearance/block-skins.css';
import './workbench/workbench.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing application root.');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
