/**
 * Core constants and enums for PSP Detector
 * Contains fundamental values that don't require branded types
 */

/**
 * Special return values for PSP detection
 */
export const PSP_DETECTION_EXEMPT = '__PSP_DETECTION_EXEMPT__';

/**
 * Message actions for communication between extension components
 */
export enum MessageAction {
  GET_PSP_CONFIG = 'getPspConfig',
  DETECT_PSP = 'detectPsp',
  GET_PSP = 'getPsp',
  GET_TAB_ID = 'getTabId',
  GET_EXEMPT_DOMAINS = 'getExemptDomains',
}
