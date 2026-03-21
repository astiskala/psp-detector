import type { PSPName, URL } from './branded';

/**
 * Records which page surface produced the detection signal so downstream UI
 * and history views can explain why a provider matched.
 */
export type SourceType =
  | 'scriptSrc'
  | 'iframeSrc'
  | 'formAction'
  | 'linkHref'
  | 'networkRequest'
  | 'pageUrl';

/** One provider hit plus the signal that caused it. */
export interface PSPMatch {
  readonly psp: PSPName;
  readonly detectionInfo?: {
    readonly method: 'matchString' | 'regex';
    readonly value: string;
    readonly sourceType?: SourceType;
  };
}

/**
 * Structured result returned by the detector so callers can distinguish a real
 * match from exempt, empty, and operational-error states.
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

/** Constructors and guards for building `PSPDetectionResult` values. */
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
  ): result is {
    readonly type: 'detected';
    readonly psps: readonly PSPMatch[];
  } => result.type === 'detected',
};
