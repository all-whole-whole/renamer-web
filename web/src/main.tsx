import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@ui/styles/tokens.css';
import '@ui/styles/base.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
