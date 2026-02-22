import { PopupManager } from './services/popup-manager';
import { logger } from './lib/utils';

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  const popup = new PopupManager();

  // Bind one-time actions before initialize() so they are never registered
  // more than once, even when initialize() is re-called after permission grant.
  popup.bindHistoryAction();

  // Add cleanup on window unload
  window.addEventListener('beforeunload', () => {
    popup.cleanup();
  });

  popup.initialize().catch((error) => {
    logger.error('Popup initialization failed:', error);
  });
});
