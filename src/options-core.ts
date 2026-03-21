import type { HistoryEntry } from './types/history';

export interface HistoryStats {
  readonly uniqueDomains: number;
  readonly uniquePsps: number;
  readonly topPsp: string | null;
}

export interface DistributionSlice {
  readonly label: string;
  readonly count: number;
  readonly percent: number;
}

/** Formats stored timestamps for the options-page history table. */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Serializes history entries into an RFC 4180-compatible CSV download. */
export function buildCSV(entries: HistoryEntry[]): string {
  const escape = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replaceAll('"', '""')}"`;
    }

    return value;
  };

  const header =
    'Date,Domain,URL,PSP Names,Types,Detection Sources,Detection Signals';
  if (entries.length === 0) return header;

  const rows = entries.map((entry) => {
    const names = entry.psps.map((p) => p.name).join('; ');
    const types = entry.psps.map((p) => p.type ?? 'PSP').join('; ');
    const sources = entry.psps.map((p) => p.sourceType).join('; ');
    const values = entry.psps.map((p) => p.value).join('; ');
    return [
      escape(new Date(entry.timestamp).toISOString()),
      escape(entry.domain),
      escape(entry.url),
      escape(names),
      escape(types),
      escape(sources),
      escape(values),
    ].join(',');
  });

  return [header, ...rows].join('\r\n');
}

/**
 * Applies the options-page search query and exact PSP filter against domains,
 * provider names, source types, and detection signals.
 */
export function filterEntries(
  entries: HistoryEntry[],
  query: string,
  pspFilter: string,
): HistoryEntry[] {
  const lowerQuery = query.toLowerCase();
  return entries.filter((entry) => {
    const pspNames = entry.psps.map((p) => p.name);
    if (pspFilter && !pspNames.includes(pspFilter)) return false;
    if (!lowerQuery) return true;
    if (entry.domain.toLowerCase().includes(lowerQuery)) return true;
    if (pspNames.some((name) => name.toLowerCase().includes(lowerQuery))) {
      return true;
    }

    return entry.psps.some(
      (psp) =>
        psp.value.toLowerCase().includes(lowerQuery) ||
        psp.sourceType.toLowerCase().includes(lowerQuery) ||
        (psp.type ?? 'PSP').toLowerCase().includes(lowerQuery),
    );
  });
}

/** Aggregates the summary metrics shown above the history table. */
export function getHistoryStats(history: HistoryEntry[]): HistoryStats {
  const uniqueDomains = new Set(history.map((entry) => entry.domain)).size;
  const pspCounts = new Map<string, number>();
  let topPsp: string | null = null;
  let topCount = 0;

  for (const entry of history) {
    for (const psp of entry.psps) {
      const nextCount = (pspCounts.get(psp.name) ?? 0) + 1;
      pspCounts.set(psp.name, nextCount);

      if (nextCount > topCount) {
        topCount = nextCount;
        topPsp = psp.name;
      }
    }
  }

  return {
    uniqueDomains,
    uniquePsps: pspCounts.size,
    topPsp,
  };
}

/** Converts computed history stats into the compact header sentence. */
export function formatHistorySummary(stats: HistoryStats): string {
  const topPspSummary = stats.topPsp === null ? '' : ` · Top: ${stats.topPsp}`;
  return (
    `${stats.uniqueDomains} sites scanned · ` +
    `${stats.uniquePsps} unique PSPs${topPspSummary}`
  );
}

/** Returns stable, alphabetized PSP names for the history filter UI. */
export function getUniquePspNames(history: HistoryEntry[]): string[] {
  return [
    ...new Set(history.flatMap((entry) => entry.psps.map((psp) => psp.name))),
  ].sort((a, b) => a.localeCompare(b));
}

function buildDistribution(
  history: HistoryEntry[],
  getLabel: (entry: HistoryEntry['psps'][number]) => string,
): DistributionSlice[] {
  const counts = new Map<string, number>();

  for (const entry of history) {
    for (const psp of entry.psps) {
      const label = getLabel(psp);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return [];
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / total) * 1000) / 10,
    }));
}

/** Computes provider-share slices for the PSP distribution chart. */
export function getPspDistribution(
  history: HistoryEntry[],
): DistributionSlice[] {
  return buildDistribution(history, (psp) => psp.name);
}

/** Computes source-share slices for the detection-surface chart. */
export function getSourceTypeDistribution(
  history: HistoryEntry[],
): DistributionSlice[] {
  return buildDistribution(history, (psp) => psp.sourceType);
}

/** Computes provider-type slices for the options-page summary chart. */
export function getProviderTypeDistribution(
  history: HistoryEntry[],
): DistributionSlice[] {
  return buildDistribution(history, (psp) => psp.type ?? 'PSP');
}
