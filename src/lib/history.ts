import type { HistoryEntry, HistoryPSPMatch } from '../types/history';
import { HISTORY_MAX_ENTRIES } from '../types/history';
import { STORAGE_KEYS } from './storage-keys';
import { logger } from './utils';

export const HISTORY_ENTRY_DEBOUNCE_MS = 5 * 60_000;
export const HISTORY_ENTRY_MERGE_WINDOW_MS = 30_000;

type EntryStatus =
  | { kind: 'merge'; index: number }
  | { kind: 'debounce' }
  | { kind: 'none' };

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function getSortedUniquePspNames(entry: HistoryEntry): string[] {
  return [...new Set(entry.psps.map((psp) => psp.name))]
    .sort((a, b) => a.localeCompare(b));
}

function hasSameDomainAndPspCombination(
  left: HistoryEntry,
  right: HistoryEntry,
): boolean {
  if (normalizeDomain(left.domain) !== normalizeDomain(right.domain)) {
    return false;
  }

  const leftNames = getSortedUniquePspNames(left);
  const rightNames = getSortedUniquePspNames(right);

  if (
    leftNames.length === 0 ||
    rightNames.length === 0 ||
    leftNames.length !== rightNames.length
  ) {
    return false;
  }

  return leftNames.every((name, index) => name === rightNames[index]);
}

function sourcePriority(sourceType: string | undefined): number {
  switch (sourceType) {
  case undefined:
    return -1;
  case 'networkRequest':
    return 0;
  case 'pageUrl':
    return 1;
  case 'linkHref':
    return 2;
  case 'formAction':
    return 3;
  case 'iframeSrc':
    return 4;
  case 'scriptSrc':
    return 5;
  default:
    return -1;
  }
}

function shouldReplaceMatch(
  existing: HistoryPSPMatch,
  incoming: HistoryPSPMatch,
): boolean {
  return sourcePriority(incoming.sourceType) >
    sourcePriority(existing.sourceType);
}

function mergeHistoryPsps(
  existing: readonly HistoryPSPMatch[],
  incoming: readonly HistoryPSPMatch[],
): HistoryPSPMatch[] | null {
  const mergedPsps = [...existing];
  let hasChanges = false;
  for (const incomingMatch of incoming) {
    const existingIndex = mergedPsps.findIndex(
      (match) => match.name === incomingMatch.name,
    );
    if (existingIndex === -1) {
      mergedPsps.push(incomingMatch);
      hasChanges = true;
      continue;
    }

    const existingMatch = mergedPsps[existingIndex];
    if (existingMatch === undefined) {
      continue;
    }

    if (shouldReplaceMatch(existingMatch, incomingMatch)) {
      mergedPsps[existingIndex] = incomingMatch;
      hasChanges = true;
    }
  }

  return hasChanges ? mergedPsps : null;
}

/**
 * Determine how a new entry relates to existing history.
 *
 * Invariant: `history` MUST be sorted newest-first. This function relies on
 * that ordering to break the scan early once entries fall outside the debounce
 * window. The invariant is maintained by the caller (`writeHistoryEntry`),
 * which always prepends new entries rather than appending them.
 *
 * Returns:
 *   { kind: 'merge', index }  — same URL within HISTORY_ENTRY_MERGE_WINDOW_MS
 *   { kind: 'debounce' }      — same URL within HISTORY_ENTRY_DEBOUNCE_MS
 *                               (but outside merge window), or most-recent
 *                               entry has same domain + PSP combination
 *   { kind: 'none' }          — outside all windows, write a new entry
 */
function findEntryStatus(
  entry: HistoryEntry,
  history: HistoryEntry[],
): EntryStatus {
  const lowerBound = entry.timestamp - HISTORY_ENTRY_DEBOUNCE_MS;
  const mergeThreshold = entry.timestamp - HISTORY_ENTRY_MERGE_WINDOW_MS;

  for (let i = 0; i < history.length; i++) {
    const existing = history[i];

    // history is newest-first; stop once entries are older than debounce window
    if (existing === undefined || existing.timestamp < lowerBound) {
      break;
    }

    if (existing.url === entry.url) {
      if (existing.timestamp >= mergeThreshold) {
        return { kind: 'merge', index: i };
      }

      return { kind: 'debounce' };
    }
  }

  const newest = history[0];
  if (
    newest !== undefined &&
    newest.timestamp >= lowerBound &&
    hasSameDomainAndPspCombination(newest, entry)
  ) {
    return { kind: 'debounce' };
  }

  return { kind: 'none' };
}

/**
 * Read persisted detection history from local extension storage.
 */
export async function readHistory(): Promise<HistoryEntry[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PSP_HISTORY);
  const raw = data[STORAGE_KEYS.PSP_HISTORY];
  return Array.isArray(raw) ? (raw as HistoryEntry[]) : [];
}

/**
 * Insert a new history entry with quota-safe writes, PSP-merge coalescing,
 * and duplicate debouncing.
 *
 * History is kept newest-first (sort invariant required by findEntryStatus).
 */
export async function writeHistoryEntry(entry: HistoryEntry): Promise<void> {
  try {
    const history = await readHistory();
    const status = findEntryStatus(entry, history);

    if (status.kind === 'merge') {
      const existing = history[status.index];
      if (existing === undefined) {
        logger.error('Unexpected undefined entry at merge index; skipping merge');
        return;
      }

      const mergedPsps = mergeHistoryPsps(existing.psps, entry.psps);
      if (mergedPsps === null) {
        logger.debug('Skipping merge: no new or higher-priority PSP matches');
        return;
      }

      const merged: HistoryEntry = {
        ...existing,
        timestamp: entry.timestamp, // update to most recent detection time
        psps: mergedPsps,
      };

      // Remove old entry and prepend merged entry at position 0
      // to preserve the newest-first invariant.
      const updated = [
        merged,
        ...history.slice(0, status.index),
        ...history.slice(status.index + 1),
      ];
      await chrome.storage.local.set({ [STORAGE_KEYS.PSP_HISTORY]: updated });
      return;
    }

    if (status.kind === 'debounce') {
      logger.debug('Skipping repeated detection within debounce window');
      return;
    }

    // status.kind === 'none': prepend new entry and cap at max
    const updated = [entry, ...history].slice(0, HISTORY_MAX_ENTRIES);
    await chrome.storage.local.set({ [STORAGE_KEYS.PSP_HISTORY]: updated });
  } catch (err) {
    logger.warn('History write failed, attempting eviction:', err);

    // Note: the eviction retry path bypasses merge/debounce logic to avoid
    // further async complexity. This could theoretically produce a duplicate
    // on transient (non-quota) failures, but is acceptable given the rarity
    // of quota errors in practice.
    try {
      const history = await readHistory();
      const trimmed = history.slice(0, HISTORY_MAX_ENTRIES - 101);
      await chrome.storage.local.set({
        [STORAGE_KEYS.PSP_HISTORY]: [entry, ...trimmed],
      });
    } catch (error_) {
      logger.error('History write failed after eviction:', error_);
    }
  }
}

/**
 * Remove all persisted history entries.
 */
export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.PSP_HISTORY]: [] });
}
