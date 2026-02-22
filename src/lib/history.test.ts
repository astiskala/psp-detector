import { STORAGE_KEYS } from './storage-keys';
import { HISTORY_MAX_ENTRIES } from '../types/history';
import {
  HISTORY_ENTRY_DEBOUNCE_MS,
  HISTORY_ENTRY_MERGE_WINDOW_MS,
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
      makeEntry({ id: 'b', timestamp: 2, domain: 'shop.example.com', url: 'https://shop.example.com/checkout' }),
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
          url: `https://site-${i}.example.com/checkout`,
        }),
    );

    await writeHistoryEntry(makeEntry({ id: 'new', timestamp: 9999, url: 'https://example.com/new' }));
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
          url: `https://site-${i}.example.com/checkout`,
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

    await writeHistoryEntry(makeEntry({ id: 'retry', timestamp: 10_000, url: 'https://example.com/retry' }));

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

  // --- Debounce window (Tier 2: 30s–5min same URL → skip) ---

  it('debounces repeated visits to the same URL within the debounce window', async() => {
    const baseline = makeEntry({ id: 'a', timestamp: 1_000 });
    await writeHistoryEntry(baseline);
    // More than 30s after baseline but within 5 min — should debounce
    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        timestamp: baseline.timestamp + HISTORY_ENTRY_MERGE_WINDOW_MS + 1_000,
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe('a');
  });

  it('writes a new entry for the same URL after the debounce window expires', async() => {
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

  // --- Merge window (Tier 1: within 30s, same URL → merge PSPs) ---

  it('merges two PSPs arriving within the merge window into one entry', async() => {
    const BASE_TS = 100_000;
    const stripeEntry = makeEntry({
      id: 'tab1_stripe',
      timestamp: BASE_TS,
      psps: [
        {
          name: 'Stripe',
          method: 'regex',
          value: 'js.stripe.com',
          sourceType: 'networkRequest',
        },
      ],
    });
    const adyenEntry = makeEntry({
      id: 'tab1_adyen',
      timestamp: BASE_TS + 5_000, // 5s later, within 30s merge window
      psps: [
        {
          name: 'Adyen',
          method: 'regex',
          value: 'checkoutshopper-live.adyen.com',
          sourceType: 'networkRequest',
        },
      ],
    });

    await writeHistoryEntry(stripeEntry);
    await writeHistoryEntry(adyenEntry);

    const history = await readHistory();
    expect(history).toHaveLength(1);
    const pspNames = history[0]?.psps.map((p) => p.name);
    expect(pspNames).toContain('Stripe');
    expect(pspNames).toContain('Adyen');
  });

  it('does not duplicate a PSP already in the merged entry', async() => {
    const BASE_TS = 100_000;
    const stripe1 = makeEntry({
      id: 'tab1_stripe1',
      timestamp: BASE_TS,
      psps: [
        {
          name: 'Stripe',
          method: 'regex',
          value: 'js.stripe.com',
          sourceType: 'networkRequest',
        },
      ],
    });
    const stripe2 = makeEntry({
      id: 'tab1_stripe2',
      timestamp: BASE_TS + 3_000, // same PSP arriving again within merge window
      psps: [
        {
          name: 'Stripe',
          method: 'regex',
          value: 'js.stripe.com',
          sourceType: 'networkRequest',
        },
      ],
    });

    await writeHistoryEntry(stripe1);
    await writeHistoryEntry(stripe2);

    const history = await readHistory();
    // Still one entry
    expect(history).toHaveLength(1);
    // Only one Stripe entry in psps
    const stripeMatches = history[0]?.psps.filter((p) => p.name === 'Stripe');
    expect(stripeMatches).toHaveLength(1);
  });

  it('moves merged entry to position 0 when interleaved with a different URL', async() => {
    const BASE_TS = 100_000;
    // First: Stripe detected on checkout page
    await writeHistoryEntry(makeEntry({
      id: 'tab1_stripe',
      timestamp: BASE_TS,
      url: 'https://example.com/checkout',
      psps: [{ name: 'Stripe', method: 'regex', value: 'js.stripe.com', sourceType: 'networkRequest' }],
    }));
    // Second: different URL navigated to (ends up at position 0)
    await writeHistoryEntry(makeEntry({
      id: 'tab2_other',
      timestamp: BASE_TS + 2_000,
      url: 'https://shop.example.com/pay',
      domain: 'shop.example.com',
      psps: [{ name: 'PayPal', method: 'regex', value: 'paypal.com', sourceType: 'networkRequest' }],
    }));
    // Third: Adyen detected on the same checkout page as the first entry (within 30s)
    await writeHistoryEntry(makeEntry({
      id: 'tab1_adyen',
      timestamp: BASE_TS + 5_000,
      url: 'https://example.com/checkout',
      psps: [{ name: 'Adyen', method: 'regex', value: 'checkoutshopper-live.adyen.com', sourceType: 'networkRequest' }],
    }));

    const history = await readHistory();
    // Two distinct URLs → two entries total
    expect(history).toHaveLength(2);
    // The merged checkout entry (Stripe+Adyen) must be at position 0 (newest-first)
    expect(history[0]?.url).toBe('https://example.com/checkout');
    const pspNames = history[0]?.psps.map((p) => p.name);
    expect(pspNames).toContain('Stripe');
    expect(pspNames).toContain('Adyen');
    // Its timestamp reflects the most recent detection
    expect(history[0]?.timestamp).toBe(BASE_TS + 5_000);
    // The other URL entry is behind it
    expect(history[1]?.url).toBe('https://shop.example.com/pay');
  });

  it('creates separate entries for different URLs within the merge window', async() => {
    const BASE_TS = 100_000;
    const entryA = makeEntry({
      id: 'tab1_a',
      timestamp: BASE_TS,
      url: 'https://example.com/checkout',
      psps: [
        {
          name: 'Stripe',
          method: 'regex',
          value: 'js.stripe.com',
          sourceType: 'networkRequest',
        },
      ],
    });
    const entryB = makeEntry({
      id: 'tab2_b',
      timestamp: BASE_TS + 5_000, // within 30s but different URL
      url: 'https://shop.example.com/pay',
      domain: 'shop.example.com',
      psps: [
        {
          name: 'Adyen',
          method: 'regex',
          value: 'checkoutshopper-live.adyen.com',
          sourceType: 'networkRequest',
        },
      ],
    });

    await writeHistoryEntry(entryA);
    await writeHistoryEntry(entryB);

    const history = await readHistory();
    expect(history).toHaveLength(2);
  });
});

describe('clearHistory', () => {
  it('empties the history', async() => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = [makeEntry()];
    await clearHistory();
    expect(await readHistory()).toEqual([]);
  });
});
