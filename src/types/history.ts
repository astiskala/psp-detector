import type { SourceType } from './detection';

export type ProviderType = 'PSP' | 'Orchestrator' | 'TSP';

/**
 * A single PSP match recorded in a history entry
 */
export interface HistoryPSPMatch {
  readonly name: string;
  readonly type?: ProviderType;
  readonly method: 'matchString' | 'regex';
  readonly value: string;
  readonly sourceType: SourceType;
  readonly firstDetectedAt?: number;
}

/**
 * One history entry per page detection
 */
export interface HistoryEntry {
  readonly id: string;
  readonly domain: string;
  readonly url: string;
  readonly timestamp: number;
  readonly psps: readonly HistoryPSPMatch[];
}

/** Maximum number of history entries to retain */
export const HISTORY_MAX_ENTRIES = 1000;
