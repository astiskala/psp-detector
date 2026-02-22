/**
 * Union types
 */
import type { PSPName, URL } from './branded';

/**
 * Source type that triggered a PSP match
 */
export type SourceType =
  | 'scriptSrc'
  | 'iframeSrc'
  | 'formAction'
  | 'linkHref'
  | 'networkRequest'
  | 'pageUrl';

/**
 * A single PSP match within a multi-match detected result
 */
export interface PSPMatch {
  readonly psp: PSPName;
  readonly detectionInfo?: {
    readonly method: 'matchString' | 'regex';
    readonly value: string;
    readonly sourceType?: SourceType;
  };
}

/**
 * PSP detection result union type
 * Provides structured results for different detection scenarios
 */
export type PSPDetectionResult =
  | {
      readonly type: 'detected';
      readonly psps: readonly PSPMatch[];
    }
  | { readonly type: 'exempt'; readonly reason: string; readonly url: URL }
  | { readonly type: 'none'; readonly scannedPatterns: number }
  | {
      readonly type: 'error';
      readonly error: Error;
      readonly context?: string;
    };

/**
 * Detection result factory and utility functions
 */
export const PSPDetectionResult = {
  detected: (psps: PSPMatch[]): PSPDetectionResult => ({
    type: 'detected',
    psps,
  }),

  exempt: (reason: string, url: URL): PSPDetectionResult => ({
    type: 'exempt',
    reason,
    url,
  }),

  none: (scannedPatterns: number): PSPDetectionResult => ({
    type: 'none',
    scannedPatterns,
  }),

  error: (error: Error, context?: string): PSPDetectionResult => ({
    type: 'error',
    error,
    ...(context !== undefined && { context }),
  }),

  isDetected: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: 'detected' }> =>
    result.type === 'detected',

  isExempt: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: 'exempt' }> =>
    result.type === 'exempt',

  isNone: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: 'none' }> =>
    result.type === 'none',

  isError: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: 'error' }> =>
    result.type === 'error',
};
