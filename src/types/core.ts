/** Sentinel value stored when a tab is exempt from detection entirely. */
export const PSP_DETECTION_EXEMPT = '__PSP_DETECTION_EXEMPT__';

/**
 * Message names exchanged between the popup, background service, and content
 * scripts.
 */
export enum MessageAction {
  GET_PSP_CONFIG = 'getPspConfig',
  DETECT_PSP = 'detectPsp',
  GET_PSP = 'getPsp',
  GET_TAB_ID = 'getTabId',
  GET_EXEMPT_DOMAINS = 'getExemptDomains',
  CHECK_TAB_STATE = 'checkTabState',
  REDETECT_CURRENT_TAB = 'redetectCurrentTab',
}
