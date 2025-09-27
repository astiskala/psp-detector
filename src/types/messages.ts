/**
 * Message types for Chrome extension communication
 */
import type { PSPName, TabId, URL } from './branded';
import type { PSPConfig } from './psp';
import type { MessageAction } from './core';
import type { PSPDetectionResult } from './detection';

/**
 * Chrome runtime message structure
 */
export interface ChromeMessage {
  action: MessageAction;
  data?: unknown;
}

/**
 * PSP detection message data
 */
export interface PSPDetectionData {
  psp?: PSPName;
  tabId?: TabId;
  detectionInfo?: {
    method: 'matchString' | 'regex';
    value: string;
  };
  url?: URL; // URL for exempt domains
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
  psp: PSPDetectionResult | null;
}
