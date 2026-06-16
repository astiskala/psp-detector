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
const DEFAULT_CHECKOUT_URL = 'https://example.com/checkout';
const STRIPE_NETWORK_SIGNAL = 'js.stripe.com';
const STRIPE_SCRIPT_SIGNAL = 'js.stripe.com/v3';
const PAYPAL_SCRIPT_SIGNAL = 'paypal.com/sdk/js';
const ADYEN_NETWORK_SIGNAL = 'checkoutshopper-live.adyen.com';
const SHOP_DOMAIN = 'shop.example.com';
const SHOP_CHECKOUT_URL = 'https://shop.example.com/checkout';
const SHOP_PAY_URL = 'https://shop.example.com/pay';
const CHECKOUT_DOMAIN = 'checkout.example.com';
const CHECKOUT_START_URL = 'https://checkout.example.com/start';
const CHECKOUT_REVIEW_URL = 'https://checkout.example.com/review';

beforeEach(() => {
  storedData[STORAGE_KEYS.PSP_HISTORY] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: jest.fn(async (key: string) => ({
          [key]: storedData[key],
        })),
        set: jest.fn(async (data: Record<string, unknown>) => {
          Object.assign(storedData, data);
        }),
      },
    },
  };
});

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'tab1_1000',
  domain: 'example.com',
  url: DEFAULT_CHECKOUT_URL,
  timestamp: 1000,
  psps: [],
  ...overrides,
});

describe('readHistory', () => {
  it('returns empty array when nothing stored', async () => {
    expect(await readHistory()).toEqual([]);
  });
});

describe('writeHistoryEntry', () => {
  it('appends to history, newest first', async () => {
    await writeHistoryEntry(makeEntry({ id: 'a', timestamp: 1 }));
    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        timestamp: 2,
        domain: SHOP_DOMAIN,
        url: SHOP_CHECKOUT_URL,
      }),
    );

    const history = await readHistory();
    expect(history[0]?.id).toBe('b');
    expect(history[1]?.id).toBe('a');
  });

  it('caps at HISTORY_MAX_ENTRIES and drops oldest', async () => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = Array.from(
      { length: HISTORY_MAX_ENTRIES },
      (_, index) =>
        makeEntry({
          id: `old_${index}`,
          timestamp: index,
          domain: `site-${index}.example.com`,
          url: `https://site-${index}.example.com/checkout`,
        }),
    );

    await writeHistoryEntry(
      makeEntry({ id: 'new', timestamp: 9999, url: 'https://example.com/new' }),
    );
    const history = await readHistory();
    expect(history).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(history[0]?.id).toBe('new');
  });

  it('retries with eviction if first write fails', async () => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = Array.from(
      { length: HISTORY_MAX_ENTRIES },
      (_, index) =>
        makeEntry({
          id: `old_${index}`,
          timestamp: index,
          domain: `site-${index}.example.com`,
          url: `https://site-${index}.example.com/checkout`,
        }),
    );

    const setMock = chrome.storage.local.set as unknown as jest.Mock;
    setMock.mockImplementationOnce(async () => {
      throw new Error('Quota exceeded');
    });

    setMock.mockImplementationOnce(async (data: Record<string, unknown>) => {
      Object.assign(storedData, data);
    });

    await writeHistoryEntry(
      makeEntry({
        id: 'retry',
        timestamp: 10_000,
        url: 'https://example.com/retry',
      }),
    );

    const history = await readHistory();
    expect(history[0]?.id).toBe('retry');
    expect(history.length).toBeLessThanOrEqual(HISTORY_MAX_ENTRIES);
    expect(setMock).toHaveBeenCalledTimes(2);
  });

  it('does not throw if retry also fails', async () => {
    const setMock = chrome.storage.local.set as unknown as jest.Mock;
    setMock.mockRejectedValue(new Error('Quota exceeded'));

    await expect(
      writeHistoryEntry(makeEntry({ id: 'drop', timestamp: 11_000 })),
    ).resolves.toBeUndefined();
  });

  it('serializes concurrent writes so neither caller clobbers the other', async () => {
    // Slow each storage.set so a naive read-modify-write would race: both
    // calls would read the empty starting history and write back arrays
    // containing only their own entry. The serialization chain in
    // writeHistoryEntry must order them, producing a final history with
    // BOTH entries.
    const realSet = chrome.storage.local.set as unknown as jest.Mock;
    const slowSet = jest.fn(async (data: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      Object.assign(storedData, data);
    });
    (chrome.storage.local as unknown as { set: jest.Mock }).set = slowSet;

    try {
      await Promise.all([
        writeHistoryEntry(
          makeEntry({
            id: 'concurrent-a',
            timestamp: 20_000,
            domain: SHOP_DOMAIN,
            url: SHOP_PAY_URL,
            psps: [
              {
                name: 'Stripe',
                method: 'matchString',
                value: STRIPE_NETWORK_SIGNAL,
                sourceType: 'networkRequest',
              },
            ],
          }),
        ),
        writeHistoryEntry(
          makeEntry({
            id: 'concurrent-b',
            timestamp: 20_500,
            domain: CHECKOUT_DOMAIN,
            url: CHECKOUT_START_URL,
            psps: [
              {
                name: 'Adyen',
                method: 'matchString',
                value: ADYEN_NETWORK_SIGNAL,
                sourceType: 'networkRequest',
              },
            ],
          }),
        ),
      ]);

      const history = await readHistory();
      const ids = history.map((entry) => entry.id);
      expect(ids).toContain('concurrent-a');
      expect(ids).toContain('concurrent-b');
    } finally {
      (chrome.storage.local as unknown as { set: jest.Mock }).set = realSet;
    }
  });

  it('halves retain count repeatedly until storage.set succeeds', async () => {
    // Seed near-cap history; multiple successive set() calls fail before the
    // retain count shrinks enough to succeed. Verifies the iterative halving
    // path (not just a single retry).
    storedData[STORAGE_KEYS.PSP_HISTORY] = Array.from(
      { length: HISTORY_MAX_ENTRIES },
      (_, index) =>
        makeEntry({
          id: `old_${index}`,
          timestamp: index,
          domain: `site-${index}.example.com`,
          url: `https://site-${index}.example.com/checkout`,
        }),
    );

    const setMock = chrome.storage.local.set as unknown as jest.Mock;
    let failsRemaining = 3;
    setMock.mockImplementation(async (data: Record<string, unknown>) => {
      if (failsRemaining > 0) {
        failsRemaining -= 1;
        throw new Error('Quota exceeded');
      }

      Object.assign(storedData, data);
    });

    await writeHistoryEntry(
      makeEntry({
        id: 'survivor',
        timestamp: 50_000,
        url: 'https://example.com/survive',
      }),
    );

    const history = await readHistory();
    expect(history[0]?.id).toBe('survivor');
    // The new entry plus a strictly-smaller tail than HISTORY_MAX_ENTRIES.
    expect(history.length).toBeLessThan(HISTORY_MAX_ENTRIES);
    expect(setMock).toHaveBeenCalledTimes(4); // 1 initial + 3 halving retries
  });

  it('stops halving at retain=0 and persists only the new entry', async () => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = Array.from(
      { length: HISTORY_MAX_ENTRIES },
      (_, index) =>
        makeEntry({
          id: `old_${index}`,
          timestamp: index,
          domain: `site-${index}.example.com`,
          url: `https://site-${index}.example.com/checkout`,
        }),
    );

    const setMock = chrome.storage.local.set as unknown as jest.Mock;
    const acceptedCalls: { entryCount: number }[] = [];
    setMock.mockImplementation(async (data: Record<string, unknown>) => {
      const entries = data[STORAGE_KEYS.PSP_HISTORY] as HistoryEntry[];
      if (entries.length > 1) {
        throw new Error('Quota exceeded');
      }

      acceptedCalls.push({ entryCount: entries.length });
      Object.assign(storedData, data);
    });

    await writeHistoryEntry(
      makeEntry({
        id: 'lonely-survivor',
        timestamp: 60_000,
        url: 'https://example.com/lonely',
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe('lonely-survivor');
    expect(acceptedCalls).toEqual([{ entryCount: 1 }]);
  });

  // --- Debounce window (Tier 2: exact signal duplicates) ---

  it('debounces repeated detections with the same domain, PSP, and signal within 15 minutes', async () => {
    const baseline = makeEntry({
      id: 'a',
      domain: CHECKOUT_DOMAIN,
      url: CHECKOUT_START_URL,
      timestamp: 1000,
      psps: [
        {
          name: 'Stripe',
          method: 'matchString',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });
    await writeHistoryEntry(baseline);

    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        domain: CHECKOUT_DOMAIN,
        url: CHECKOUT_REVIEW_URL,
        timestamp: baseline.timestamp + HISTORY_ENTRY_MERGE_WINDOW_MS + 1000,
        psps: [
          {
            name: 'Stripe',
            method: 'matchString',
            value: STRIPE_NETWORK_SIGNAL,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe('a');
  });

  it('continues to debounce consecutive identical detections after 15 minutes', async () => {
    const baseline = makeEntry({
      id: 'a',
      domain: CHECKOUT_DOMAIN,
      url: CHECKOUT_START_URL,
      timestamp: 1000,
      psps: [
        {
          name: 'Stripe',
          method: 'matchString',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });
    await writeHistoryEntry(baseline);

    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        domain: CHECKOUT_DOMAIN,
        url: CHECKOUT_REVIEW_URL,
        timestamp: baseline.timestamp + HISTORY_ENTRY_DEBOUNCE_MS + 1000,
        psps: [
          {
            name: 'Stripe',
            method: 'matchString',
            value: STRIPE_NETWORK_SIGNAL,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe('a');
  });

  it('debounces identical detections even when another detection intervenes within 15 minutes', async () => {
    const baseline = makeEntry({
      id: 'a',
      domain: CHECKOUT_DOMAIN,
      url: CHECKOUT_START_URL,
      timestamp: 1000,
      psps: [
        {
          name: 'Stripe',
          method: 'matchString',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });
    await writeHistoryEntry(baseline);
    await writeHistoryEntry(
      makeEntry({
        id: 'middle',
        domain: SHOP_DOMAIN,
        url: SHOP_PAY_URL,
        timestamp: baseline.timestamp + 60_000,
        psps: [
          {
            name: 'PayPal',
            method: 'matchString',
            value: PAYPAL_SCRIPT_SIGNAL,
            sourceType: 'scriptSrc',
          },
        ],
      }),
    );

    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        domain: CHECKOUT_DOMAIN,
        url: CHECKOUT_REVIEW_URL,
        timestamp: baseline.timestamp + 10 * 60_000,
        psps: [
          {
            name: 'Stripe',
            method: 'matchString',
            value: STRIPE_NETWORK_SIGNAL,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe('middle');
    expect(history[1]?.id).toBe('a');
  });

  it('writes a new entry for the same signal after 15 minutes when another detection intervened', async () => {
    const baseline = makeEntry({
      id: 'a',
      domain: CHECKOUT_DOMAIN,
      url: CHECKOUT_START_URL,
      timestamp: 1000,
      psps: [
        {
          name: 'Stripe',
          method: 'matchString',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });
    await writeHistoryEntry(baseline);
    await writeHistoryEntry(
      makeEntry({
        id: 'middle',
        domain: SHOP_DOMAIN,
        url: SHOP_PAY_URL,
        timestamp: baseline.timestamp + 60_000,
        psps: [
          {
            name: 'PayPal',
            method: 'matchString',
            value: PAYPAL_SCRIPT_SIGNAL,
            sourceType: 'scriptSrc',
          },
        ],
      }),
    );

    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        domain: CHECKOUT_DOMAIN,
        url: CHECKOUT_REVIEW_URL,
        timestamp: baseline.timestamp + HISTORY_ENTRY_DEBOUNCE_MS + 1000,
        psps: [
          {
            name: 'Stripe',
            method: 'matchString',
            value: STRIPE_NETWORK_SIGNAL,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(3);
    expect(history[0]?.id).toBe('b');
    expect(history[1]?.id).toBe('middle');
    expect(history[2]?.id).toBe('a');
  });

  it('writes a new entry when the PSP matches but the detection signal changes', async () => {
    const baseline = makeEntry({
      id: 'a',
      domain: CHECKOUT_DOMAIN,
      url: CHECKOUT_START_URL,
      timestamp: 1000,
      psps: [
        {
          name: 'Stripe',
          method: 'matchString',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });
    await writeHistoryEntry(baseline);

    await writeHistoryEntry(
      makeEntry({
        id: 'b',
        domain: CHECKOUT_DOMAIN,
        url: CHECKOUT_REVIEW_URL,
        timestamp: baseline.timestamp + HISTORY_ENTRY_MERGE_WINDOW_MS + 1000,
        psps: [
          {
            name: 'Stripe',
            method: 'matchString',
            value: STRIPE_SCRIPT_SIGNAL,
            sourceType: 'scriptSrc',
          },
        ],
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe('b');
    expect(history[1]?.id).toBe('a');
  });

  // --- Merge window (Tier 1: within 30s, same URL → merge PSPs) ---

  it('merges two PSPs arriving within the merge window into one entry', async () => {
    const BASE_TS = 100_000;
    const stripeEntry = makeEntry({
      id: 'tab1_stripe',
      timestamp: BASE_TS,
      psps: [
        {
          name: 'Stripe',
          method: 'regex',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });
    const adyenEntry = makeEntry({
      id: 'tab1_adyen',
      timestamp: BASE_TS + 5000, // 5s later, within 30s merge window
      psps: [
        {
          name: 'Adyen',
          method: 'regex',
          value: ADYEN_NETWORK_SIGNAL,
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

  it('does not duplicate a PSP already in the merged entry', async () => {
    const BASE_TS = 100_000;
    const stripe1 = makeEntry({
      id: 'tab1_stripe1',
      timestamp: BASE_TS,
      psps: [
        {
          name: 'Stripe',
          method: 'regex',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });
    const stripe2 = makeEntry({
      id: 'tab1_stripe2',
      timestamp: BASE_TS + 3000, // same PSP arriving again within merge window
      psps: [
        {
          name: 'Stripe',
          method: 'regex',
          value: STRIPE_NETWORK_SIGNAL,
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

  it('replaces a network-only match when a higher-priority source arrives', async () => {
    const BASE_TS = 100_000;
    const networkStripe = makeEntry({
      id: 'tab1_stripe_network',
      timestamp: BASE_TS,
      psps: [
        {
          name: 'Stripe',
          method: 'matchString',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });
    const scriptStripe = makeEntry({
      id: 'tab1_stripe_script',
      timestamp: BASE_TS + 2000,
      psps: [
        {
          name: 'Stripe',
          method: 'matchString',
          value: STRIPE_SCRIPT_SIGNAL,
          sourceType: 'scriptSrc',
        },
      ],
    });

    await writeHistoryEntry(networkStripe);
    await writeHistoryEntry(scriptStripe);

    const history = await readHistory();
    expect(history).toHaveLength(1);
    const stripe = history[0]?.psps.find((p) => p.name === 'Stripe');
    expect(stripe?.sourceType).toBe('scriptSrc');
    expect(stripe?.value).toBe(STRIPE_SCRIPT_SIGNAL);
  });

  it('keeps existing high-priority source when a lower-priority match arrives', async () => {
    const BASE_TS = 100_000;
    const scriptStripe = makeEntry({
      id: 'tab1_stripe_script',
      timestamp: BASE_TS,
      psps: [
        {
          name: 'Stripe',
          method: 'matchString',
          value: STRIPE_SCRIPT_SIGNAL,
          sourceType: 'scriptSrc',
        },
      ],
    });
    const networkStripe = makeEntry({
      id: 'tab1_stripe_network',
      timestamp: BASE_TS + 2000,
      psps: [
        {
          name: 'Stripe',
          method: 'matchString',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });

    await writeHistoryEntry(scriptStripe);
    await writeHistoryEntry(networkStripe);

    const history = await readHistory();
    expect(history).toHaveLength(1);
    const stripe = history[0]?.psps.find((p) => p.name === 'Stripe');
    expect(stripe?.sourceType).toBe('scriptSrc');
    expect(stripe?.value).toBe(STRIPE_SCRIPT_SIGNAL);
  });

  it('moves merged entry to position 0 when interleaved with a different URL', async () => {
    const BASE_TS = 100_000;

    // First: Stripe detected on checkout page
    await writeHistoryEntry(
      makeEntry({
        id: 'tab1_stripe',
        timestamp: BASE_TS,
        url: DEFAULT_CHECKOUT_URL,
        psps: [
          {
            name: 'Stripe',
            method: 'regex',
            value: STRIPE_NETWORK_SIGNAL,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    // Second: different URL navigated to (ends up at position 0)
    await writeHistoryEntry(
      makeEntry({
        id: 'tab2_other',
        timestamp: BASE_TS + 2000,
        url: SHOP_PAY_URL,
        domain: SHOP_DOMAIN,
        psps: [
          {
            name: 'PayPal',
            method: 'regex',
            value: 'paypal.com',
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    // Third: Adyen detected on same checkout page as first entry (within 30s)
    await writeHistoryEntry(
      makeEntry({
        id: 'tab1_adyen',
        timestamp: BASE_TS + 5000,
        url: DEFAULT_CHECKOUT_URL,
        psps: [
          {
            name: 'Adyen',
            method: 'regex',
            value: ADYEN_NETWORK_SIGNAL,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    const history = await readHistory();

    // Two distinct URLs → two entries total
    expect(history).toHaveLength(2);

    // The merged checkout entry (Stripe+Adyen) must be at position 0
    expect(history[0]?.url).toBe(DEFAULT_CHECKOUT_URL);
    const pspNames = history[0]?.psps.map((p) => p.name);
    expect(pspNames).toContain('Stripe');
    expect(pspNames).toContain('Adyen');

    // Its timestamp reflects the most recent detection
    expect(history[0]?.timestamp).toBe(BASE_TS + 5000);

    // The other URL entry is behind it
    expect(history[1]?.url).toBe(SHOP_PAY_URL);
  });

  it('keeps the first-seen timestamp when merge updates refresh the entry timestamp', async () => {
    const BASE_TS = 100_000;

    await writeHistoryEntry(
      makeEntry({
        id: 'tab1_stripe',
        timestamp: BASE_TS,
        domain: CHECKOUT_DOMAIN,
        url: DEFAULT_CHECKOUT_URL,
        psps: [
          {
            name: 'Stripe',
            method: 'regex',
            value: STRIPE_NETWORK_SIGNAL,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    await writeHistoryEntry(
      makeEntry({
        id: 'tab1_adyen',
        timestamp: BASE_TS + 5000,
        domain: CHECKOUT_DOMAIN,
        url: DEFAULT_CHECKOUT_URL,
        psps: [
          {
            name: 'Adyen',
            method: 'regex',
            value: ADYEN_NETWORK_SIGNAL,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    await writeHistoryEntry(
      makeEntry({
        id: 'other',
        timestamp: BASE_TS + 10_000,
        domain: SHOP_DOMAIN,
        url: SHOP_PAY_URL,
        psps: [
          {
            name: 'PayPal',
            method: 'regex',
            value: 'paypal.com',
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    await writeHistoryEntry(
      makeEntry({
        id: 'tab1_stripe_again',
        timestamp: BASE_TS + HISTORY_ENTRY_DEBOUNCE_MS + 1000,
        domain: CHECKOUT_DOMAIN,
        url: CHECKOUT_REVIEW_URL,
        psps: [
          {
            name: 'Stripe',
            method: 'regex',
            value: STRIPE_NETWORK_SIGNAL,
            sourceType: 'networkRequest',
          },
        ],
      }),
    );

    const history = await readHistory();
    expect(history).toHaveLength(3);
    expect(history[0]?.id).toBe('tab1_stripe_again');
    expect(history[1]?.id).toBe('other');
    expect(
      history[2]?.psps.find((psp) => psp.name === 'Stripe')?.firstDetectedAt,
    ).toBe(BASE_TS);
  });

  it('creates separate entries for different URLs within the merge window', async () => {
    const BASE_TS = 100_000;
    const entryA = makeEntry({
      id: 'tab1_a',
      timestamp: BASE_TS,
      url: DEFAULT_CHECKOUT_URL,
      psps: [
        {
          name: 'Stripe',
          method: 'regex',
          value: STRIPE_NETWORK_SIGNAL,
          sourceType: 'networkRequest',
        },
      ],
    });
    const entryB = makeEntry({
      id: 'tab2_b',
      timestamp: BASE_TS + 5000, // within 30s but different URL
      url: SHOP_PAY_URL,
      domain: SHOP_DOMAIN,
      psps: [
        {
          name: 'Adyen',
          method: 'regex',
          value: ADYEN_NETWORK_SIGNAL,
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
  it('empties the history', async () => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = [makeEntry()];
    await clearHistory();
    expect(await readHistory()).toEqual([]);
  });
});
