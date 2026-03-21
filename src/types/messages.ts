import type { PSPName, TabId } from './branded';
import type { PSPConfig } from './psp';
import type { MessageAction } from './core';
import type { SourceType } from './detection';

/** Base runtime message envelope shared across extension components. */
export interface ChromeMessage {
  action: MessageAction;
  data?: unknown;
}

/** Popup/background representation of detected providers for a single tab. */
export interface StoredTabPsp {
  psp: string;
  detectionInfo?: {
    method: 'matchString' | 'regex';
    value: string;
    sourceType?: SourceType;
  };
}

/** Payload sent from the content script when it reports a detected provider. */
export interface PSPDetectionData {
  psp?: PSPName;
  tabId?: TabId;
  detectionInfo?: {
    method: 'matchString' | 'regex';
    value: string;
    sourceType?: SourceType;
  };
}

/** Response shape for the bundled provider dataset. */
export interface PSPConfigResponse {
  config: PSPConfig;
}

/** Response shape for the current tab's stored detections. */
export interface PSPResponse {
  psps: StoredTabPsp[];
}
