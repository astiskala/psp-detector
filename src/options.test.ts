import {
  formatDate,
  buildCSV,
  filterEntries,
  getProviderTypeDistribution,
  getPspDistribution,
  getSourceTypeDistribution,
  getHistoryStats,
  formatHistorySummary,
  getUniquePspNames,
} from './options-core';
import type { HistoryEntry } from './types/history';

const entry: HistoryEntry = {
  id: 'tab1_1000',
  domain: 'example.com',
  url: 'https://example.com/checkout',
  timestamp: new Date('2026-02-22T10:30:00Z').getTime(),
  psps: [
    {
      name: 'Stripe',
      type: 'PSP',
      method: 'matchString',
      value: 'js.stripe.com',
      sourceType: 'scriptSrc',
    },
  ],
};

describe('formatDate', () => {
  it('returns a non-empty string', () => {
    expect(typeof formatDate(entry.timestamp)).toBe('string');
    expect(formatDate(entry.timestamp).length).toBeGreaterThan(0);
  });
});

describe('buildCSV', () => {
  it('includes headers and one data row', () => {
    const csv = buildCSV([entry]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Date');
    expect(lines[0]).toContain('Domain');
    expect(lines[0]).toContain('Types');
    expect(lines[1]).toContain('example.com');
    expect(lines[1]).toContain('Stripe');
    expect(lines[1]).toContain('PSP');
  });

  it('RFC 4180: escapes commas in field values', () => {
    const tricky: HistoryEntry = { ...entry, domain: 'a,b.com' };
    expect(buildCSV([tricky])).toContain('"a,b.com"');
  });

  it('RFC 4180: escapes double-quotes in field values', () => {
    const tricky: HistoryEntry = {
      ...entry,
      psps: [{ ...entry.psps[0]!, name: 'Pay"Co' }],
    };
    expect(buildCSV([tricky])).toContain('"Pay""Co"');
  });

  it('returns only headers for empty input', () => {
    const csv = buildCSV([]);
    expect(csv.split('\r\n')).toHaveLength(1);
  });
});

describe('filterEntries', () => {
  it('matches by domain', () => {
    expect(filterEntries([entry], 'example', '')).toHaveLength(1);
  });

  it('matches by PSP name', () => {
    expect(filterEntries([entry], 'stripe', '')).toHaveLength(1);
  });

  it('returns empty when query does not match', () => {
    expect(filterEntries([entry], 'adyen', '')).toHaveLength(0);
  });

  it('filters by exact PSP when pspFilter set', () => {
    expect(filterEntries([entry], '', 'Adyen')).toHaveLength(0);
    expect(filterEntries([entry], '', 'Stripe')).toHaveLength(1);
  });

  it('matches by detection signal value', () => {
    expect(filterEntries([entry], 'js.stripe.com', '')).toHaveLength(1);
  });

  it('matches by detection source type', () => {
    expect(filterEntries([entry], 'scriptsrc', '')).toHaveLength(1);
  });
});

describe('getHistoryStats + summary', () => {
  it('returns expected stats and summary text', () => {
    const stats = getHistoryStats([
      entry,
      {
        ...entry,
        id: 'tab2_1001',
        domain: 'shop.example.com',
        psps: [
          {
            name: 'Adyen',
            type: 'PSP',
            method: 'matchString',
            value: 'checkoutshopper-live.adyen.com',
            sourceType: 'scriptSrc',
          },
        ],
      },
    ]);

    expect(stats.uniqueDomains).toBe(2);
    expect(stats.uniquePsps).toBe(2);
    expect(stats.topPsp).toBe('Stripe');

    const summary = formatHistorySummary(stats);
    expect(summary).toContain('2 sites scanned');
    expect(summary).toContain('2 unique PSPs');
    expect(summary).toContain('Top: Stripe');
  });
});

describe('getUniquePspNames', () => {
  it('returns sorted unique list', () => {
    const names = getUniquePspNames([
      entry,
      {
        ...entry,
        id: 'tab2_1002',
        psps: [
          {
            name: 'Adyen',
            type: 'PSP',
            method: 'matchString',
            value: 'checkoutshopper-live.adyen.com',
            sourceType: 'scriptSrc',
          },
          {
            name: 'Stripe',
            type: 'PSP',
            method: 'matchString',
            value: 'js.stripe.com',
            sourceType: 'scriptSrc',
          },
        ],
      },
    ]);
    expect(names).toEqual(['Adyen', 'Stripe']);
  });
});

describe('distribution helpers', () => {
  it('computes PSP distribution with percentages', () => {
    const slices = getPspDistribution([
      entry,
      {
        ...entry,
        id: 'tab2_1003',
        psps: [
          {
            name: 'Stripe',
            type: 'PSP',
            method: 'matchString',
            value: 'js.stripe.com',
            sourceType: 'scriptSrc',
          },
          {
            name: 'Adyen',
            type: 'PSP',
            method: 'matchString',
            value: 'checkoutshopper-live.adyen.com',
            sourceType: 'networkRequest',
          },
        ],
      },
    ]);

    expect(slices).toEqual([
      { label: 'Stripe', count: 2, percent: 66.7 },
      { label: 'Adyen', count: 1, percent: 33.3 },
    ]);
  });

  it('computes source type distribution', () => {
    const slices = getSourceTypeDistribution([
      entry,
      {
        ...entry,
        id: 'tab2_1004',
        psps: [
          {
            name: 'Adyen',
            type: 'Orchestrator',
            method: 'regex',
            value: 'adyen',
            sourceType: 'networkRequest',
          },
        ],
      },
    ]);

    expect(slices).toEqual([
      { label: 'scriptSrc', count: 1, percent: 50 },
      { label: 'networkRequest', count: 1, percent: 50 },
    ]);
  });

  it('computes provider type distribution', () => {
    const slices = getProviderTypeDistribution([
      entry,
      {
        ...entry,
        id: 'tab2_1005',
        psps: [
          {
            name: 'Adyen',
            type: 'Orchestrator',
            method: 'regex',
            value: 'adyen',
            sourceType: 'networkRequest',
          },
        ],
      },
    ]);

    expect(slices).toEqual([
      { label: 'PSP', count: 1, percent: 50 },
      { label: 'Orchestrator', count: 1, percent: 50 },
    ]);
  });

  it('returns empty slices for no history', () => {
    expect(getPspDistribution([])).toEqual([]);
    expect(getSourceTypeDistribution([])).toEqual([]);
    expect(getProviderTypeDistribution([])).toEqual([]);
  });
});
