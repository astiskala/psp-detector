/**
 * Message types for Chrome extension communication
 */
import type { PSPName, TabId } from './branded';
import type { PSPConfig } from './psp';
import type { MessageAction } from './core';
import type { SourceType } from './detection';

/**
 * Chrome runtime message structure
 */
export interface ChromeMessage {
  action: MessageAction;
  data?: unknown;
}

export interface StoredTabPsp {
  psp: string;
  detectionInfo?: {
    method: 'matchString' | 'regex';
    value: string;
    sourceType?: SourceType;
  };
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
    sourceType?: SourceType;
  };
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
  psps: StoredTabPsp[];
}
