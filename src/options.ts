import type { PSPConfig } from './types';
import type { HistoryEntry } from './types/history';
import { clearHistory, readHistory } from './lib/history';
import { getAllProviders, logger } from './lib/utils';
import {
  buildCSV,
  filterEntries,
  formatDate,
  formatHistorySummary,
  getHistoryStats,
  getProviderTypeDistribution,
  getPspDistribution,
  getSourceTypeDistribution,
  getUniquePspNames,
  type DistributionSlice,
} from './options-core';

const DEFAULT_PSP_ICON_PATH = 'images/default_48.png';
const HISTORY_TABLE_ICON_SIZE = 16;
const SEARCH_DEBOUNCE_MS = 120;
let providerIconByName = new Map<string, string>();

type IdleScheduler = (
  callback: () => void,
  options?: { timeout?: number },
) => number;

function scheduleIdle(callback: () => void): void {
  const requestIdle = (globalThis as unknown as {
    requestIdleCallback?: IdleScheduler;
  }).requestIdleCallback;
  if (typeof requestIdle === 'function') {
    requestIdle(callback, { timeout: 200 });
    return;
  }

  setTimeout(callback, 0);
}

function setText(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

const CHART_COLORS = [
  '#2563eb',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#0ea5e9',
  '#84cc16',
  '#f97316',
  '#14b8a6',
  '#e11d48',
];

function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? '#2563eb';
}

function renderStats(history: HistoryEntry[]): void {
  const stats = getHistoryStats(history);
  setText('stats', formatHistorySummary(stats));
}

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function buildLegend(
  legendId: string,
  slices: DistributionSlice[],
  colors: string[],
): void {
  const legend = document.getElementById(legendId);
  if (!legend) {
    return;
  }

  while (legend.firstChild) {
    legend.firstChild.remove();
  }

  if (slices.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'chart-legend-item';
    empty.textContent = 'No data available yet.';
    legend.appendChild(empty);
    return;
  }

  for (const [index, slice] of slices.entries()) {
    const item = document.createElement('li');
    item.className = 'chart-legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = colors[index] ?? '#2563eb';

    const label = document.createElement('span');
    label.textContent =
      `${slice.label}: ${slice.percent.toFixed(1)}% (${slice.count})`;

    item.appendChild(swatch);
    item.appendChild(label);
    legend.appendChild(item);
  }
}

function drawPieChart(
  canvasId: string,
  legendId: string,
  slices: DistributionSlice[],
): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 12;
  const background = readCssVar('--surface', '#f9fafb');
  const border = readCssVar('--border', '#e5e7eb');
  const text = readCssVar('--text-secondary', '#6b7280');

  ctx.clearRect(0, 0, width, height);

  if (slices.length === 0) {
    ctx.fillStyle = background;
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', centerX, centerY);

    buildLegend(legendId, slices, []);
    return;
  }

  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const colors = slices.map(
    (_, index) => getChartColor(index),
  );
  let start = -Math.PI / 2;

  for (const [index, slice] of slices.entries()) {
    const sweep = (slice.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, start, start + sweep);
    ctx.closePath();
    ctx.fillStyle = colors[index] ?? '#2563eb';
    ctx.fill();
    start += sweep;
  }

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = readCssVar('--bg', '#ffffff');
  ctx.fill();

  buildLegend(legendId, slices, colors);
}

function renderCharts(history: HistoryEntry[]): void {
  drawPieChart('pspChart', 'pspChartLegend', getPspDistribution(history));
  drawPieChart(
    'sourceChart',
    'sourceChartLegend',
    getSourceTypeDistribution(history),
  );

  drawPieChart(
    'typeChart',
    'typeChartLegend',
    getProviderTypeDistribution(history),
  );
}

function appendCodeList(cell: HTMLTableCellElement, values: string[]): void {
  if (values.length === 0) {
    cell.textContent = '-';
    return;
  }

  for (const [index, value] of values.entries()) {
    const code = document.createElement('code');
    code.textContent = value;
    cell.appendChild(code);

    if (index < values.length - 1) {
      cell.appendChild(document.createElement('br'));
    }
  }
}

function normalizeProviderName(name: string): string {
  return name.trim().toLowerCase();
}

function buildProviderSlug(name: string): string {
  return normalizeProviderName(name)
    .replace(/\.com$/u, '')
    .replaceAll(/[^a-z0-9]/gu, '');
}

function getProviderIconPath(pspName: string): string {
  const mappedIconPath = providerIconByName.get(normalizeProviderName(pspName));
  if (mappedIconPath !== undefined) {
    return mappedIconPath;
  }

  const slug = buildProviderSlug(pspName);
  if (slug.length > 0) {
    return `images/${slug}_48.png`;
  }

  return DEFAULT_PSP_ICON_PATH;
}

function getHistoryEntryHostname(entry: HistoryEntry): string {
  const domain = entry.domain.trim();
  if (domain.length > 0 && !domain.includes('/')) {
    return domain;
  }

  try {
    return new globalThis.URL(entry.url).hostname || domain;
  } catch {
    return domain;
  }
}

function buildDomainFaviconUrl(entry: HistoryEntry): string | null {
  const url = entry.url.trim();
  if (!url) {
    return null;
  }

  const extensionId = (
    globalThis as typeof globalThis & { chrome?: typeof chrome }
  ).chrome?.runtime?.id;
  if (!extensionId) {
    return null;
  }

  return `chrome-extension://${extensionId}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
}

function createTableIcon(
  src: string,
  alt: string,
  className: string,
): HTMLImageElement {
  const icon = document.createElement('img');
  icon.className = className;
  icon.alt = alt;
  icon.src = src;
  icon.width = HISTORY_TABLE_ICON_SIZE;
  icon.height = HISTORY_TABLE_ICON_SIZE;
  icon.decoding = 'async';
  icon.loading = 'lazy';
  icon.addEventListener(
    'error',
    () => {
      icon.src = DEFAULT_PSP_ICON_PATH;
    },
    { once: true },
  );

  return icon;
}

function createLetterAvatar(domain: string): HTMLElement {
  const letter = domain.trim().charAt(0).toUpperCase() || '?';
  const avatar = document.createElement('div');
  avatar.className = 'table-icon domain-icon domain-letter-avatar';
  avatar.textContent = letter;
  avatar.style.width = `${HISTORY_TABLE_ICON_SIZE}px`;
  avatar.style.height = `${HISTORY_TABLE_ICON_SIZE}px`;
  avatar.style.lineHeight = `${HISTORY_TABLE_ICON_SIZE}px`;
  avatar.style.fontSize = '10px';
  avatar.style.textAlign = 'center';
  avatar.style.backgroundColor = 'var(--accent, #2563eb)';
  avatar.style.color = '#fff';
  avatar.style.borderRadius = '2px';
  avatar.style.flexShrink = '0';
  return avatar;
}

function appendDomainCellContent(
  cell: HTMLTableCellElement,
  entry: HistoryEntry,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'table-cell-with-icon';

  const hostname = getHistoryEntryHostname(entry);
  const faviconUrl = buildDomainFaviconUrl(entry);

  let iconElement: HTMLElement;
  if (faviconUrl !== null) {
    const img = document.createElement('img');
    img.className = 'table-icon domain-icon';
    img.alt = `${hostname || entry.domain} favicon`;
    img.src = faviconUrl;
    img.width = HISTORY_TABLE_ICON_SIZE;
    img.height = HISTORY_TABLE_ICON_SIZE;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.addEventListener(
      'error',
      () => {
        const avatar = createLetterAvatar(hostname || entry.domain);
        img.replaceWith(avatar);
      },
      { once: true },
    );

    iconElement = img;
  } else {
    iconElement = createLetterAvatar(hostname || entry.domain);
  }

  const text = document.createElement('span');
  text.className = 'cell-label';
  text.textContent = entry.domain;

  wrap.appendChild(iconElement);
  wrap.appendChild(text);
  cell.appendChild(wrap);
}

function appendPspCellContent(
  cell: HTMLTableCellElement,
  entry: HistoryEntry,
): void {
  if (entry.psps.length === 0) {
    cell.textContent = '-';
    return;
  }

  const list = document.createElement('div');
  list.className = 'psp-list';

  for (const psp of entry.psps) {
    const item = document.createElement('div');
    item.className = 'psp-item';

    const icon = createTableIcon(
      getProviderIconPath(psp.name),
      `${psp.name} icon`,
      'table-icon psp-icon',
    );

    const text = document.createElement('span');
    text.className = 'cell-label';
    text.textContent = psp.name;

    item.appendChild(icon);
    item.appendChild(text);
    list.appendChild(item);
  }

  cell.appendChild(list);
}

function isPspConfig(value: unknown): value is PSPConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Array.isArray((value as Partial<PSPConfig>).psps);
}

async function loadProviderIcons(): Promise<void> {
  providerIconByName = new Map<string, string>();

  try {
    const runtime = (
      globalThis as typeof globalThis & { chrome?: typeof chrome }
    ).chrome?.runtime;
    const configUrl = runtime?.getURL?.('psps.json') ?? 'psps.json';
    const response = await fetch(configUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch PSP config for icons: ${response.status}`,
      );
    }

    const json = (await response.json()) as unknown;
    if (!isPspConfig(json)) {
      throw new Error('Invalid PSP config shape while loading icon metadata');
    }

    for (const provider of getAllProviders(json)) {
      providerIconByName.set(
        normalizeProviderName(provider.name),
        `images/${provider.image}_48.png`,
      );
    }
  } catch (error) {
    logger.warn('Failed to load PSP icon metadata for history table', error);
  }
}

function populatePspFilter(history: HistoryEntry[]): void {
  const select = document.getElementById('pspFilter') as HTMLSelectElement | null;
  if (!select) return;

  for (const name of getUniquePspNames(history)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
}

function renderTable(entries: HistoryEntry[]): void {
  const body = document.getElementById('historyBody');
  const emptyState = document.getElementById('emptyState');
  if (!body || !emptyState) return;

  while (body.firstChild) {
    body.firstChild.remove();
  }

  if (entries.length === 0) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  for (const entry of entries) {
    const row = document.createElement('tr');

    const dateCell = document.createElement('td');
    dateCell.textContent = formatDate(entry.timestamp);

    const domainCell = document.createElement('td');
    appendDomainCellContent(domainCell, entry);

    const pspsCell = document.createElement('td');
    appendPspCellContent(pspsCell, entry);

    const typeCell = document.createElement('td');
    appendCodeList(typeCell, entry.psps.map((psp) => psp.type ?? 'PSP'));

    const sourceCell = document.createElement('td');
    appendCodeList(sourceCell, entry.psps.map((psp) => psp.sourceType));

    const signalCell = document.createElement('td');
    appendCodeList(
      signalCell,
      entry.psps.map((psp) => `${psp.method}: ${psp.value}`),
    );

    row.appendChild(dateCell);
    row.appendChild(domainCell);
    row.appendChild(pspsCell);
    row.appendChild(typeCell);
    row.appendChild(sourceCell);
    row.appendChild(signalCell);
    body.appendChild(row);
  }
}

interface HistoryRef {
  getHistory: () => HistoryEntry[];
  setHistory: (h: HistoryEntry[]) => void;
}

function bindControls(historyRef: HistoryRef): void {
  const search = document.getElementById('search') as HTMLInputElement | null;
  const pspFilter = document.getElementById('pspFilter') as HTMLSelectElement | null;
  let searchRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const getFilteredEntries = (): HistoryEntry[] =>
    filterEntries(
      historyRef.getHistory(),
      search?.value ?? '',
      pspFilter?.value ?? '',
    );

  const refresh = (deferCharts: boolean): void => {
    const filtered = getFilteredEntries();
    renderTable(filtered);

    if (deferCharts) {
      scheduleIdle(() => renderCharts(filtered));
      return;
    }

    renderCharts(filtered);
  };

  search?.addEventListener('input', () => {
    if (searchRefreshTimer !== null) {
      clearTimeout(searchRefreshTimer);
    }

    searchRefreshTimer = setTimeout(() => {
      refresh(true);
      searchRefreshTimer = null;
    }, SEARCH_DEBOUNCE_MS);
  });

  pspFilter?.addEventListener('change', () => refresh(true));

  document.getElementById('exportBtn')?.addEventListener('click', () => {
    const filtered = getFilteredEntries();
    const csv = buildCSV(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `psp-history-${new Date().toISOString().split('T')[0]}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('clearBtn')?.addEventListener('click', () => {
    if (!confirm('Clear all PSP detection history? This cannot be undone.')) {
      return;
    }

    clearHistory()
      .then(() => {
        historyRef.setHistory([]);
        renderStats([]);
        renderTable([]);
        scheduleIdle(() => renderCharts([]));
      })
      .catch((error) => {
        logger.error('Failed to clear history', error);
      });
  });
}

async function init(): Promise<void> {
  await loadProviderIcons();
  let allHistory = await readHistory();
  renderStats(allHistory);
  populatePspFilter(allHistory);
  renderTable(allHistory);
  renderCharts(allHistory);
  bindControls({
    getHistory: () => allHistory,
    setHistory: (h) => {
      allHistory = h;
    },
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    logger.error('Failed to initialize options page', error);
  });
});
