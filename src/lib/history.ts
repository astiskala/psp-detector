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

/**
 * Determine how a new entry relates to existing history.
 *
 * Invariant: history is sorted newest-first. We can break early once we
 * reach an entry older than the debounce lower bound.
 *
 * Returns:
 *   { kind: 'merge', index }  — same URL within HISTORY_ENTRY_MERGE_WINDOW_MS
 *   { kind: 'debounce' }      — same URL within HISTORY_ENTRY_DEBOUNCE_MS (but outside merge window)
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
    // history is newest-first; stop scanning once entries are older than debounce window
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
        // Should not happen given findEntryStatus returned a valid index, but guard for TS
        throw new Error('Unexpected undefined entry at merge index');
      }
      const existingNames = new Set(existing.psps.map((p) => p.name));
      const newPsps: HistoryPSPMatch[] = entry.psps.filter(
        (p) => !existingNames.has(p.name),
      );

      if (newPsps.length === 0) {
        logger.debug('Skipping merge: no new PSPs to add to existing entry');
        return;
      }

      const merged: HistoryEntry = {
        ...existing,
        psps: [...existing.psps, ...newPsps],
      };
      const updated = [
        ...history.slice(0, status.index),
        merged,
        ...history.slice(status.index + 1),
      ];
      await chrome.storage.local.set({ [STORAGE_KEYS.PSP_HISTORY]: updated });
      return;
    }

    if (status.kind === 'debounce') {
      logger.debug('Skipping repeated page visit within debounce window');
      return;
    }

    // status.kind === 'none': prepend new entry and cap at max
    const updated = [entry, ...history].slice(0, HISTORY_MAX_ENTRIES);
    await chrome.storage.local.set({ [STORAGE_KEYS.PSP_HISTORY]: updated });
  } catch (err) {
    logger.warn('History write failed, attempting eviction:', err);
    try {
      const history = await readHistory();
      const trimmed = history.slice(0, HISTORY_MAX_ENTRIES - 101);
      await chrome.storage.local.set({
        [STORAGE_KEYS.PSP_HISTORY]: [entry, ...trimmed],
      });
    } catch (retryErr) {
      logger.error('History write failed after eviction:', retryErr);
    }
  }
}

/**
 * Remove all persisted history entries.
 */
export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.PSP_HISTORY]: [] });
}
