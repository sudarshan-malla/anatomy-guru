import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

console.log("AnatomyGuru Engine: Initializing runtime...");

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error("FATAL: Root element (#root) missing in HTML.");
} else {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("AnatomyGuru Engine: Root render successful.");
  } catch (err) {
    console.error("AnatomyGuru Engine: Critical initialization error:", err);
    rootElement.innerHTML = `
      <div style="padding: 40px; font-family: sans-serif; text-align: center;">
        <h1 style="color: #e11d48; font-weight: 900;">Startup Error</h1>
        <p style="color: #475569;">The application failed to initialize.</p>
        <div style="background: #f1f5f9; padding: 20px; border-radius: 12px; display: inline-block; text-align: left; margin-top: 20px; border: 1px solid #e2e8f0;">
          <code style="font-size: 12px; color: #1e293b;">${err instanceof Error ? err.stack || err.message : String(err)}</code>
        </div>
      </div>
    `;
  }
}