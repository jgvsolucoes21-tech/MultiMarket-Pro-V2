import React from 'react';
import ReactDOM from 'react-dom/client';
// El componente 'App' exportado desde OrderFulfillmentDashboard.jsx
import App from './OrderFulfillmentDashboard.jsx'; 

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
