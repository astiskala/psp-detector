import { STORAGE_KEYS } from './storage-keys';
import { HISTORY_MAX_ENTRIES } from '../types/history';
import {
  HISTORY_ENTRY_DEBOUNCE_MS,
  writeHistoryEntry,
  readHistory,
  clearHistory,
} from './history';
import type { HistoryEntry } from '../types/history';

const storedData: Record<string, unknown> = {};

beforeEach(() => {
  storedData[STORAGE_KEYS.PSP_HISTORY] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: jest.fn(async(key: string) => ({
          [key]: storedData[key],
        })),
        set: jest.fn(async(data: Record<string, unknown>) => {
          Object.assign(storedData, data);
        }),
      },
    },
  };
});

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'tab1_1000',
  domain: 'example.com',
  url: 'https://example.com/checkout',
  timestamp: 1000,
  psps: [],
  ...overrides,
});

describe('readHistory', () => {
  it('returns empty array when nothing stored', async() => {
    expect(await readHistory()).toEqual([]);
  });
});

describe('writeHistoryEntry', () => {
  it('appends to history, newest first', async() => {
    await writeHistoryEntry(makeEntry({ id: 'a', timestamp: 1 }));
    await writeHistoryEntry(
      makeEntry({ id: 'b', timestamp: 2, domain: 'shop.example.com' }),
    );

    const history = await readHistory();
    expect(history[0]?.id).toBe('b');
    expect(history[1]?.id).toBe('a');
  });

  it('caps at HISTORY_MAX_ENTRIES and drops oldest', async() => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = Array.from(
      { length: HISTORY_MAX_ENTRIES },
      (_, i) =>
        makeEntry({
          id: `old_${i}`,
          timestamp: i,
          domain: `site-${i}.example.com`,
        }),
    );

    await writeHistoryEntry(makeEntry({ id: 'new', timestamp: 9999 }));
    const history = await readHistory();
    expect(history).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(history[0]?.id).toBe('new');
  });

  it('retries with eviction if first write fails', async() => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = Array.from(
      { length: HISTORY_MAX_ENTRIES },
      (_, i) =>
        makeEntry({
          id: `old_${i}`,
          timestamp: i,
          domain: `site-${i}.example.com`,
        }),
    );

    const setMock = (
      globalThis.chrome.storage.local.set as unknown as jest.Mock
    );
    setMock.mockImplementationOnce(async() => {
      throw new Error('Quota exceeded');
    });

    setMock.mockImplementationOnce(async(data: Record<string, unknown>) => {
      Object.assign(storedData, data);
    });

    await writeHistoryEntry(makeEntry({ id: 'retry', timestamp: 10_000 }));

    const history = await readHistory();
    expect(history[0]?.id).toBe('retry');
    expect(history.length).toBeLessThanOrEqual(HISTORY_MAX_ENTRIES);
    expect(setMock).toHaveBeenCalledTimes(2);
  });

  it('does not throw if retry also fails', async() => {
    const setMock = (
      globalThis.chrome.storage.local.set as unknown as jest.Mock
    );
    setMock.mockRejectedValue(new Error('Quota exceeded'));

    await expect(
      writeHistoryEntry(makeEntry({ id: 'drop', timestamp: 11_000 })),
    ).resolves.toBeUndefined();
  });

  it('debounces duplicate entries for the same detection in a short window', async() => {
    const baseline = makeEntry({ id: 'a', timestamp: 1_000 });
    await writeHistoryEntry(baseline);
    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        timestamp: baseline.timestamp + HISTORY_ENTRY_DEBOUNCE_MS - 1_000,
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe('a');
  });

  it('writes duplicate detections again after debounce window', async() => {
    const baseline = makeEntry({ id: 'a', timestamp: 1_000 });
    await writeHistoryEntry(baseline);
    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        timestamp: baseline.timestamp + HISTORY_ENTRY_DEBOUNCE_MS + 1_000,
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe('b');
    expect(history[1]?.id).toBe('a');
  });

  it('does not debounce when detection evidence changes', async() => {
    const baseline = makeEntry({ id: 'a', timestamp: 1_000 });
    await writeHistoryEntry(baseline);
    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        timestamp: baseline.timestamp + 2_000,
        psps: [
          {
            name: 'Adyen',
            method: 'regex',
            value: String.raw`checkoutshopper-live\.adyen\.com`,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe('b');
  });
});

describe('clearHistory', () => {
  it('empties the history', async() => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = [makeEntry()];
    await clearHistory();
    expect(await readHistory()).toEqual([]);
  });
});
