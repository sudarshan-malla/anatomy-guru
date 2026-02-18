import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error("FATAL: Root element not found");
} else {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (err) {
    console.error("Mounting Error:", err);
    rootElement.innerHTML = `
      <div style="padding: 2rem; font-family: sans-serif; text-align: center;">
        <h1 style="color: #ef4444;">Application Failed to Start</h1>
        <p>A runtime error occurred during initialization.</p>
        <pre style="background: #f1f5f9; padding: 1rem; border-radius: 8px; display: inline-block; text-align: left;">${err instanceof Error ? err.message : String(err)}</pre>
      </div>
    `;
  }
}