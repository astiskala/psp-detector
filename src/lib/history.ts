import type { HistoryEntry } from '../types/history';
import { HISTORY_MAX_ENTRIES } from '../types/history';
import { STORAGE_KEYS } from './storage-keys';
import { logger } from './utils';

export const HISTORY_ENTRY_DEBOUNCE_MS = 5 * 60_000;

function buildEntrySignature(entry: HistoryEntry): string {
  return JSON.stringify({
    domain: entry.domain,
    url: entry.url,
    psps: entry.psps.map((psp) => ({
      name: psp.name,
      type: psp.type ?? 'PSP',
      method: psp.method,
      value: psp.value,
      sourceType: psp.sourceType,
    })),
  });
}

function isDebouncedDuplicate(
  entry: HistoryEntry,
  history: HistoryEntry[],
): boolean {
  const signature = buildEntrySignature(entry);
  const lowerBound = entry.timestamp - HISTORY_ENTRY_DEBOUNCE_MS;

  for (const existing of history) {
    if (existing.timestamp < lowerBound) {
      break;
    }

    if (buildEntrySignature(existing) === signature) {
      return true;
    }
  }

  return false;
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
 * Insert a new history entry with quota-safe writes and duplicate debouncing.
 */
export async function writeHistoryEntry(entry: HistoryEntry): Promise<void> {
  try {
    const history = await readHistory();
    if (isDebouncedDuplicate(entry, history)) {
      logger.debug('Skipping duplicate history entry during debounce window');
      return;
    }

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
