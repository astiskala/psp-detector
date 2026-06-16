import type { PSPConfig } from './types';
import type { HistoryEntry } from './types/history';
import { clearHistory, readHistory } from './lib/history';
import { createSafeUrl, getAllProviders, logger } from './lib/utilities';
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
let providerUrlByName = new Map<string, string>();
let providerSummaryByName = new Map<string, string>();

function scheduleIdle(callback: () => void): void {
  // globalThis. is necessary here — requestIdleCallback may not exist in all environments,
  // and a bare identifier would throw ReferenceError rather than returning undefined.
  // eslint-disable-next-line unicorn/no-unnecessary-global-this
  if (typeof globalThis.requestIdleCallback === 'function') {
    // eslint-disable-next-line unicorn/no-unnecessary-global-this
    globalThis.requestIdleCallback(callback, { timeout: 200 });
    return;
  }

  setTimeout(callback, 0);
}

function setText(id: string, text: string): void {
  const element = document.querySelector(`#${id}`);
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

function readCssVariable(name: string, fallback: string): string {
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
  const legend = document.querySelector<HTMLElement>(`#${legendId}`);
  if (!legend) {
    return;
  }

  legend.replaceChildren();

  if (slices.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'chart-legend-item';
    empty.textContent = 'No data available yet.';
    legend.append(empty);
    return;
  }

  for (const [index, slice] of slices.entries()) {
    const item = document.createElement('li');
    item.className = 'chart-legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = colors[index] ?? '#2563eb';

    const label = document.createElement('span');
    label.textContent = `${slice.label}: ${slice.percent.toFixed(1)}% (${slice.count})`;

    item.append(swatch);
    item.append(label);
    legend.append(item);
  }
}

interface PieChartContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  radius: number;
}

function getPieChartContext(canvasId: string): PieChartContext | undefined {
  const canvas = document.querySelector<HTMLCanvasElement>(`#${canvasId}`);
  if (!canvas) {
    return undefined;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }

  const width = canvas.width;
  const height = canvas.height;
  return {
    ctx: context,
    width,
    height,
    centerX: width / 2,
    centerY: height / 2,
    radius: Math.min(width, height) / 2 - 12,
  };
}

function drawEmptyPieChart(
  chart: PieChartContext,
  legendId: string,
  slices: DistributionSlice[],
): void {
  const background = readCssVariable('--surface', '#f9fafb');
  const border = readCssVariable('--border', '#e5e7eb');
  const text = readCssVariable('--text-secondary', '#6b7280');

  chart.ctx.fillStyle = background;
  chart.ctx.strokeStyle = border;
  chart.ctx.lineWidth = 2;
  chart.ctx.beginPath();
  chart.ctx.arc(chart.centerX, chart.centerY, chart.radius, 0, Math.PI * 2);
  chart.ctx.fill();
  chart.ctx.stroke();
  chart.ctx.fillStyle = text;
  chart.ctx.font = '12px system-ui, -apple-system, sans-serif';
  chart.ctx.textAlign = 'center';
  chart.ctx.textBaseline = 'middle';
  chart.ctx.fillText('No data', chart.centerX, chart.centerY);

  buildLegend(legendId, slices, []);
}

function drawPieSlices(
  chart: PieChartContext,
  slices: DistributionSlice[],
  colors: string[],
): void {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  let start = -Math.PI / 2;

  for (const [index, slice] of slices.entries()) {
    const sweep = (slice.count / total) * Math.PI * 2;
    chart.ctx.beginPath();
    chart.ctx.moveTo(chart.centerX, chart.centerY);
    chart.ctx.arc(
      chart.centerX,
      chart.centerY,
      chart.radius,
      start,
      start + sweep,
    );

    chart.ctx.closePath();
    chart.ctx.fillStyle = colors[index] ?? '#2563eb';
    chart.ctx.fill();
    start += sweep;
  }
}

function drawPieChartCenterHole(chart: PieChartContext): void {
  chart.ctx.beginPath();
  chart.ctx.arc(
    chart.centerX,
    chart.centerY,
    chart.radius * 0.46,
    0,
    Math.PI * 2,
  );

  chart.ctx.fillStyle = readCssVariable('--bg', '#ffffff');
  chart.ctx.fill();
}

function drawPieChart(
  canvasId: string,
  legendId: string,
  slices: DistributionSlice[],
): void {
  const chart = getPieChartContext(canvasId);
  if (!chart) {
    return;
  }

  chart.ctx.clearRect(0, 0, chart.width, chart.height);

  if (slices.length === 0) {
    drawEmptyPieChart(chart, legendId, slices);
    return;
  }

  const colors = slices.map((_, index) => getChartColor(index));
  drawPieSlices(chart, slices, colors);
  drawPieChartCenterHole(chart);
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
    cell.append(code);

    if (index < values.length - 1) {
      cell.append(document.createElement('br'));
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
    const parsedUrl = new URL(entry.url);
    return parsedUrl.hostname || domain;
  } catch {
    return domain;
  }
}

function buildDomainFaviconUrl(entry: HistoryEntry): string | undefined {
  const url = entry.url.trim();
  if (!url) {
    return undefined;
  }

  const extensionId = (
    globalThis as typeof globalThis & { chrome?: typeof chrome }
  ).chrome?.runtime?.id;
  if (!extensionId) {
    return undefined;
  }

  return `chrome-extension://${extensionId}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
}

function createTableIcon(
  source: string,
  alt: string,
  className: string,
): HTMLImageElement {
  const icon = document.createElement('img');
  icon.className = className;
  icon.alt = alt;
  icon.src = source;
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

function getMerchantHostname(entry: HistoryEntry): string | undefined {
  const origin = entry.merchantOrigin?.trim();
  if (origin === undefined || origin.length === 0) {
    return undefined;
  }

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.hostname || undefined;
  } catch {
    return undefined;
  }
}

function appendDomainCellContent(
  cell: HTMLTableCellElement,
  entry: HistoryEntry,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'table-cell-with-icon';

  const hostname = getHistoryEntryHostname(entry);
  const faviconUrl = buildDomainFaviconUrl(entry);

  if (faviconUrl !== undefined) {
    const img = document.createElement('img');
    img.className = 'table-icon domain-icon';
    img.alt = `${hostname || entry.domain} favicon`;
    img.src = faviconUrl;
    img.width = HISTORY_TABLE_ICON_SIZE;
    img.height = HISTORY_TABLE_ICON_SIZE;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove(), { once: true });
    wrap.append(img);
  }

  const labels = document.createElement('div');
  labels.className = 'domain-cell-labels';

  const text = document.createElement('span');
  text.className = 'cell-label';
  text.textContent = entry.domain;
  labels.append(text);

  const merchantHostname = getMerchantHostname(entry);
  if (merchantHostname !== undefined && merchantHostname !== entry.domain) {
    const merchant = document.createElement('span');
    merchant.className = 'cell-sublabel merchant-origin';
    merchant.textContent = `via ${merchantHostname}`;
    merchant.title = `Redirected from ${entry.merchantOrigin}`;
    labels.append(merchant);
  }

  wrap.append(labels);
  cell.append(wrap);
}

function createPspTextElement(
  name: string,
  providerUrl: string | undefined,
  providerSummary: string | undefined,
): HTMLElement {
  if (providerUrl !== undefined && providerUrl !== '') {
    const anchor = document.createElement('a');
    anchor.className = 'cell-label';
    // Route through createSafeUrl so unsupported protocols (e.g. JavaScript:)
    // are stripped, matching the popup's hardening in UIService.
    anchor.href = createSafeUrl(providerUrl);
    anchor.textContent = name;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    if (providerSummary !== undefined && providerSummary !== '') {
      anchor.title = providerSummary;
    }

    return anchor;
  }

  const span = document.createElement('span');
  span.className = 'cell-label';
  span.textContent = name;
  if (providerSummary !== undefined && providerSummary !== '') {
    span.title = providerSummary;
  }

  return span;
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

    const key = normalizeProviderName(psp.name);
    const textElement = createPspTextElement(
      psp.name,
      providerUrlByName.get(key),
      providerSummaryByName.get(key),
    );

    item.append(icon);
    item.append(textElement);
    list.append(item);
  }

  cell.append(list);
}

function isPspConfig(value: unknown): value is PSPConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Array.isArray((value as Partial<PSPConfig>).psps);
}

async function loadProviderIcons(): Promise<void> {
  providerIconByName = new Map<string, string>();
  providerUrlByName = new Map<string, string>();
  providerSummaryByName = new Map<string, string>();

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
      const key = normalizeProviderName(provider.name);
      providerIconByName.set(key, `images/${provider.image}_48.png`);
      providerUrlByName.set(key, String(provider.url));
      providerSummaryByName.set(key, provider.summary);
    }
  } catch (error) {
    logger.warn('Failed to load PSP icon metadata for history table', error);
  }
}

function populatePspFilter(history: HistoryEntry[]): void {
  const select = document.querySelector<HTMLSelectElement>('#pspFilter');
  if (!select) return;

  // Preserve the first "All PSPs" placeholder option from the markup and
  // drop everything we previously appended so a re-populate (after clear or
  // re-init) doesn't leave stale provider names in the dropdown.
  while (select.options.length > 1) {
    select.remove(1);
  }

  for (const name of getUniquePspNames(history)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
}

function renderTable(entries: HistoryEntry[]): void {
  const body = document.querySelector('#historyBody');
  const emptyState = document.querySelector<HTMLElement>('#emptyState');
  if (!body || !emptyState) return;

  body.replaceChildren();

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
    appendCodeList(
      typeCell,
      entry.psps.map((psp) => psp.type ?? 'PSP'),
    );

    const sourceCell = document.createElement('td');
    appendCodeList(
      sourceCell,
      entry.psps.map((psp) => psp.sourceType),
    );

    const signalCell = document.createElement('td');
    appendCodeList(
      signalCell,
      entry.psps.map((psp) => `${psp.method}: ${psp.value}`),
    );

    row.append(dateCell);
    row.append(domainCell);
    row.append(pspsCell);
    row.append(typeCell);
    row.append(sourceCell);
    row.append(signalCell);
    body.append(row);
  }
}

interface HistoryReference {
  getHistory: () => HistoryEntry[];
  setHistory: (h: HistoryEntry[]) => void;
}

function bindControls(historyReference: HistoryReference): void {
  const search = document.querySelector<HTMLInputElement>('#search');
  const pspFilter = document.querySelector<HTMLSelectElement>('#pspFilter');
  let searchRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  const getFilteredEntries = (): HistoryEntry[] =>
    filterEntries(
      historyReference.getHistory(),
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
    if (searchRefreshTimer !== undefined) {
      clearTimeout(searchRefreshTimer);
    }

    searchRefreshTimer = setTimeout(() => {
      refresh(true);
      searchRefreshTimer = undefined;
    }, SEARCH_DEBOUNCE_MS);
  });

  pspFilter?.addEventListener('change', () => refresh(true));

  document.querySelector('#exportBtn')?.addEventListener('click', () => {
    const filtered = getFilteredEntries();
    const csv = buildCSV(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const now = new Date();
    anchor.download = `psp-history-${now.toISOString().split('T', 1)[0]}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector('#clearBtn')?.addEventListener('click', async () => {
    if (!confirm('Clear all PSP detection history? This cannot be undone.')) {
      return;
    }

    try {
      await clearHistory();
      historyReference.setHistory([]);
      // Reset the dropdown and search to match the now-empty history so
      // the user isn't filtering against PSP names that no longer exist.
      const searchInput = document.querySelector<HTMLInputElement>('#search');
      if (searchInput) searchInput.value = '';
      const pspFilterSelect =
        document.querySelector<HTMLSelectElement>('#pspFilter');
      if (pspFilterSelect) pspFilterSelect.value = '';
      populatePspFilter([]);
      renderStats([]);
      renderTable([]);
      scheduleIdle(() => renderCharts([]));
    } catch (error) {
      logger.error('Failed to clear history', error);
    }
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

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await init();
  } catch (error) {
    logger.error('Failed to initialize options page', error);
  }
});
