/**
 * Type definitions index - exports all types for the PSP Detector
 */

// Core enums and constants
export { MessageAction, PSP_DETECTION_EXEMPT } from "./core";

// Branded types and converters - primary types for type safety
export * from "./branded";

// Core PSP types using branded types
export type { PSP, PSPConfig } from "./psp";

// Union types for detection results
export * from "./detection";

// Message and communication types
export * from "./messages";

// Background service types
export * from "./background";

// Chrome API type extensions
/// <reference path="./external/chrome.d.ts" />
