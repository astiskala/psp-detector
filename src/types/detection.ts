/**
 * Union types
 */
import type { PSPName, URL } from "./branded";

/**
 * PSP detection result union type
 * Provides structured results for different detection scenarios
 */
export type PSPDetectionResult =
  | {
      readonly type: "detected";
      readonly psp: PSPName;
      readonly confidence: number;
    }
  | { readonly type: "exempt"; readonly reason: string; readonly url: URL }
  | { readonly type: "none"; readonly scannedPatterns: number }
  | {
      readonly type: "error";
      readonly error: Error;
      readonly context?: string;
    };

/**
 * Detection result factory and utility functions
 */
export const PSPDetectionResult = {
  /**
   * Create a detected result
   */
  detected: (psp: PSPName, confidence: number = 1.0): PSPDetectionResult => ({
    type: "detected",
    psp,
    confidence: Math.max(0, Math.min(1, confidence)),
  }),

  /**
   * Create an exempt result
   */
  exempt: (reason: string, url: URL): PSPDetectionResult => ({
    type: "exempt",
    reason,
    url,
  }),

  /**
   * Create a none result
   */
  none: (scannedPatterns: number): PSPDetectionResult => ({
    type: "none",
    scannedPatterns,
  }),

  /**
   * Create an error result
   */
  error: (error: Error, context?: string): PSPDetectionResult => ({
    type: "error",
    error,
    context,
  }),

  /**
   * Type guards for result types
   */
  isDetected: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: "detected" }> => {
    return result.type === "detected";
  },

  isExempt: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: "exempt" }> => {
    return result.type === "exempt";
  },

  isNone: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: "none" }> => {
    return result.type === "none";
  },

  isError: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: "error" }> => {
    return result.type === "error";
  },
};
