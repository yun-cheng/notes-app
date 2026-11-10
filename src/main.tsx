import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { isNativeShell } from './auth/shell';
import { App } from './ui/App';
import './ui/styles.css';

// Notes the native shell before the router sees its ?shell=native start URL.
isNativeShell();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
