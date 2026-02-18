import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

console.log("AnatomyGuru Engine: Root Module Loaded.");

const rootElement = document.getElementById('root');

if (rootElement) {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (err) {
    console.error("React Mounting Error:", err);
  }
} else {
  console.error("Critical Error: Root element #root not found in the DOM.");
}
