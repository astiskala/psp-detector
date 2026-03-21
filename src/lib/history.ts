import type { HistoryEntry, HistoryPSPMatch } from '../types/history';
import { HISTORY_MAX_ENTRIES } from '../types/history';
import { STORAGE_KEYS } from './storage-keys';
import { logger } from './utils';

export const HISTORY_ENTRY_DEBOUNCE_MS = 15 * 60_000;
export const HISTORY_ENTRY_MERGE_WINDOW_MS = 30_000;

type EntryStatus =
  | { kind: 'merge'; index: number }
  | { kind: 'debounce' }
  | { kind: 'none' };

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function normalizeHistoryMatch(
  match: HistoryPSPMatch,
  fallbackTimestamp: number,
): HistoryPSPMatch {
  return {
    ...match,
    firstDetectedAt: match.firstDetectedAt ?? fallbackTimestamp,
  };
}

function normalizeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    psps: entry.psps.map((match) =>
      normalizeHistoryMatch(match, entry.timestamp)),
  };
}

function matchesDetectionSignature(
  left: HistoryPSPMatch,
  right: HistoryPSPMatch,
): boolean {
  return left.name === right.name &&
    left.sourceType === right.sourceType &&
    left.value === right.value;
}

function getMatchingFirstDetectedAt(
  existing: HistoryEntry,
  incoming: HistoryEntry,
): number | null {
  if (normalizeDomain(existing.domain) !== normalizeDomain(incoming.domain)) {
    return null;
  }

  if (incoming.psps.length === 0) {
    return null;
  }

  let firstDetectedAt = Number.POSITIVE_INFINITY;
  for (const incomingMatch of incoming.psps) {
    const matching = existing.psps.find((existingMatch) =>
      matchesDetectionSignature(existingMatch, incomingMatch));
    if (matching === undefined) {
      return null;
    }

    firstDetectedAt = Math.min(
      firstDetectedAt,
      matching.firstDetectedAt ?? existing.timestamp,
    );
  }

  return Number.isFinite(firstDetectedAt) ? firstDetectedAt : null;
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
 * Invariant: `history` MUST be sorted newest-first. The invariant is
 * maintained by the caller (`writeHistoryEntry`), which always prepends new
 * entries rather than appending them.
 *
 * Returns:
 *   { kind: 'merge', index }  — same URL within HISTORY_ENTRY_MERGE_WINDOW_MS
 *   { kind: 'debounce' }      — same domain + PSP + source/signal and either
 *                               within HISTORY_ENTRY_DEBOUNCE_MS of the first
 *                               detection, or no other detection happened
 *                               since that prior detection
 *   { kind: 'none' }          — outside all windows, write a new entry
 */
function findEntryStatus(
  entry: HistoryEntry,
  history: HistoryEntry[],
): EntryStatus {
  const normalizedEntry = normalizeHistoryEntry(entry);
  const mergeThreshold =
    normalizedEntry.timestamp - HISTORY_ENTRY_MERGE_WINDOW_MS;
  let matchingIndex: number | null = null;
  let firstDetectedAt: number | null = null;

  for (let i = 0; i < history.length; i++) {
    const existing = history[i];
    if (existing === undefined) {
      continue;
    }

    if (
      existing.url === normalizedEntry.url &&
      existing.timestamp >= mergeThreshold
    ) {
      return { kind: 'merge', index: i };
    }

    if (matchingIndex !== null) {
      continue;
    }

    const matchedFirstDetectedAt = getMatchingFirstDetectedAt(
      existing,
      normalizedEntry,
    );
    if (matchedFirstDetectedAt === null) {
      continue;
    }

    matchingIndex = i;
    firstDetectedAt = matchedFirstDetectedAt;
  }

  if (matchingIndex === null || firstDetectedAt === null) {
    return { kind: 'none' };
  }

  if (matchingIndex === 0) {
    return { kind: 'debounce' };
  }

  if (normalizedEntry.timestamp - firstDetectedAt < HISTORY_ENTRY_DEBOUNCE_MS) {
    return { kind: 'debounce' };
  }

  return { kind: 'none' };
}

/** Reads and normalizes persisted detection history from local storage. */
export async function readHistory(): Promise<HistoryEntry[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PSP_HISTORY);
  const raw = data[STORAGE_KEYS.PSP_HISTORY];
  return Array.isArray(raw)
    ? (raw as HistoryEntry[]).map((entry) => normalizeHistoryEntry(entry))
    : [];
}

/**
 * Writes a detection to history while preserving newest-first ordering,
 * merging near-duplicate page events, and debouncing repeated scans.
 */
export async function writeHistoryEntry(entry: HistoryEntry): Promise<void> {
  const normalizedEntry = normalizeHistoryEntry(entry);

  try {
    const history = await readHistory();
    const status = findEntryStatus(normalizedEntry, history);

    if (status.kind === 'merge') {
      const existing = history[status.index];
      if (existing === undefined) {
        logger.error('Unexpected undefined entry at merge index; skipping merge');
        return;
      }

      const mergedPsps = mergeHistoryPsps(existing.psps, normalizedEntry.psps);
      if (mergedPsps === null) {
        logger.debug('Skipping merge: no new or higher-priority PSP matches');
        return;
      }

      const merged: HistoryEntry = {
        ...existing,

        // Update to the most recent detection time for the merged page entry.
        timestamp: normalizedEntry.timestamp,
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
      logger.debug('Skipping repeated detection due to history debounce');
      return;
    }

    // status.kind === 'none': prepend new entry and cap at max
    const updated = [normalizedEntry, ...history].slice(0, HISTORY_MAX_ENTRIES);
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
        [STORAGE_KEYS.PSP_HISTORY]: [normalizedEntry, ...trimmed],
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
