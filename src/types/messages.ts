/**
 * Message types for Chrome extension communication
 */
import type {PSPName, TabId} from './branded';
import type {PSPConfig} from './psp';
import type {MessageAction} from './core';

/**
 * Chrome runtime message structure
 */
export interface ChromeMessage {
  action: MessageAction;
  data?: unknown;
}

/**
 * Response structure for PSP detection
 */
export interface PSPDetectionResponse {
  psp: PSPName | null;
  tabId?: TabId;
}

/**
 * PSP detection message data
 */
export interface PSPDetectionData {
  psp?: PSPName;
  tabId?: TabId;
}

/**
 * PSP config response
 */
export interface PSPConfigResponse {
  config: PSPConfig;
}

/**
 * PSP response
 */
export interface PSPResponse {
  psp: PSPName | null;
}
