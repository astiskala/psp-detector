import { PopupManager } from './services/popup-manager';
import { logger } from './lib/utilities';
import { trackEvent, TELEMETRY_EVENTS } from './services/telemetry';

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  void trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);

  const popup = new PopupManager();

  // Bind one-time actions before initialize() so they are never registered
  // more than once, even when initialize() is re-called after permission grant.
  popup.bindHistoryAction();

  try {
    await popup.initialize();
  } catch (error) {
    logger.error('Popup initialization failed:', error);
  }
});
