import type { SourceType } from './detection';

export type ProviderType = 'PSP' | 'Orchestrator' | 'TSP';

/** A provider match persisted as part of the options-page history log. */
export interface HistoryPSPMatch {
  readonly name: string;
  readonly type?: ProviderType;
  readonly method: 'matchString' | 'regex';
  readonly value: string;
  readonly sourceType: SourceType;
  readonly firstDetectedAt?: number;
}

/** One stored page-level detection record in newest-first history order. */
export interface HistoryEntry {
  readonly id: string;
  readonly domain: string;
  readonly url: string;
  readonly timestamp: number;
  readonly psps: readonly HistoryPSPMatch[];
}

/** Hard cap used to stay within extension storage limits. */
export const HISTORY_MAX_ENTRIES = 1000;
