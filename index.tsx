import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

console.info("AnatomyGuru Audit Engine: Initializing Application...");

const rootElement = document.getElementById('root');

if (rootElement) {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.info("AnatomyGuru Audit Engine: Render successful.");
  } catch (err) {
    console.error("Critical: Failed to mount React application:", err);
    rootElement.innerHTML = `<div style="padding:20px; color:red; font-family:sans-serif;">Mount Error: ${err instanceof Error ? err.message : String(err)}</div>`;
  }
} else {
  console.error("Fatal: DOM node #root was not found.");
}
