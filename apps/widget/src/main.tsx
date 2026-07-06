import React from 'react';
import { createRoot } from 'react-dom/client';
import { Widget } from './components/Widget';

/**
 * Self-initializing widget.
 *
 * Usage on any website:
 *   <div id="estimator-widget" data-key="YOUR_PUBLIC_KEY"></div>
 *   <script src="https://cdn.example.com/widget.iife.js"></script>
 *
 * Or via script tag with auto-init:
 *   <script
 *     src="https://cdn.example.com/widget.iife.js"
 *     data-estimator-key="YOUR_PUBLIC_KEY"
 *     data-container="estimator-widget"
 *   ></script>
 */
function init() {
  // Find container
  const script = document.currentScript as HTMLScriptElement | null;
  const containerId = script?.dataset.container ?? 'estimator-widget';
  const container = document.getElementById(containerId);

  if (!container) {
    console.warn(`[EstimatorWidget] Container #${containerId} not found.`);
    return;
  }

  const publicKey = container.dataset.key ?? script?.dataset.estimatorKey ?? '';
  if (!publicKey) {
    console.warn('[EstimatorWidget] No public key provided. Set data-key on the container element.');
    return;
  }

  const apiUrl = container.dataset.apiUrl ?? script?.dataset.apiUrl ?? 'https://api.example.com/api/v1';

  const root = createRoot(container);
  root.render(<Widget publicKey={publicKey} apiUrl={apiUrl} />);
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
