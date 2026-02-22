/**
 * Type definitions index - exports all types for the PSP Detector
 */

// Core enums and constants
export { MessageAction, PSP_DETECTION_EXEMPT } from './core';

// Branded types and converters - primary types for type safety
export type { PSPName, URL, RegexPattern } from './branded';
export { TypeConverters } from './branded';

// Core PSP types using branded types
export type { PSP, PSPConfig } from './psp';

// Union types for detection results
export * from './detection';

// History types
export type { HistoryEntry, HistoryPSPMatch, ProviderType } from './history';
export { HISTORY_MAX_ENTRIES } from './history';

// Message and communication types
export * from './messages';
