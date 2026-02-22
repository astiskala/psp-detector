import type { PSPConfig } from './types';
import { TypeConverters } from './types';
import type { HistoryEntry } from './types/history';
import { clearHistory, readHistory } from './lib/history';
import { logger } from './lib/utils';

jest.mock('./lib/history', () => ({
  clearHistory: jest.fn(),
  readHistory: jest.fn(),
}));

jest.mock('./lib/utils', () => {
  const actual = jest.requireActual('./lib/utils');
  return {
    ...actual,
    logger: {
      ...actual.logger,
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

interface LoggerMock {
  warn: jest.Mock<void, [string, ...unknown[]]>;
  error: jest.Mock<void, [string, ...unknown[]]>;
}

function setupOptionsDOM(): void {
  document.body.innerHTML = `
    <div id="stats"></div>
    <input id="search" />
    <select id="pspFilter">
      <option value="">All PSPs</option>
    </select>
    <button id="exportBtn" type="button">Export</button>
    <button id="clearBtn" type="button">Clear</button>
    <table><tbody id="historyBody"></tbody></table>
    <div id="emptyState" hidden>No history</div>
    <canvas id="pspChart" width="240" height="240"></canvas>
    <ul id="pspChartLegend"></ul>
    <canvas id="sourceChart" width="240" height="240"></canvas>
    <ul id="sourceChartLegend"></ul>
    <canvas id="typeChart" width="240" height="240"></canvas>
    <ul id="typeChartLegend"></ul>
  `;
}

function setupCanvasContextMock(): void {
  const context = {
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    fillText: jest.fn(),
    moveTo: jest.fn(),
    closePath: jest.fn(),
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '12px',
    textAlign: 'center',
    textBaseline: 'middle',
  } as unknown as CanvasRenderingContext2D;

  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context);
}

function setupChromeRuntimeMock(): void {
  globalThis.chrome = {
    runtime: {
      id: 'test-extension-id',
      getURL: jest.fn(
        (path: string) => `chrome-extension://test-extension-id/${path}`,
      ),
    },
  } as unknown as typeof chrome;
}

function createProviderConfig(): PSPConfig {
  const stripeName = TypeConverters.toPSPName('Stripe');
  const stripeUrl = TypeConverters.toURL('https://stripe.com');

  if (stripeName === null || stripeUrl === null) {
    throw new Error('Failed to build test PSP config');
  }

  return {
    psps: [{
      name: stripeName,
      matchStrings: ['js.stripe.com'],
      image: 'stripe',
      summary: 'Stripe summary',
      url: stripeUrl,
    }],
  };
}

function createHistoryEntries(): HistoryEntry[] {
  const timestamp = new Date('2026-02-22T18:00:00Z').getTime();
  return [
    {
      id: 'entry-1',
      domain: 'checkout.example.com',
      url: 'https://checkout.example.com/pay',
      timestamp,
      psps: [{
        name: 'Stripe',
        type: 'PSP',
        method: 'matchString',
        value: 'js.stripe.com',
        sourceType: 'scriptSrc',
      }],
    },
    {
      id: 'entry-2',
      domain: 'shop.example.com/cart',
      url: 'https://shop.example.com/cart',
      timestamp: timestamp - 10_000,
      psps: [
        {
          name: 'Acme Pay',
          method: 'regex',
          value: 'acme-pay',
          sourceType: 'networkRequest',
        },
        {
          name: '   ',
          method: 'matchString',
          value: 'unknown-provider',
          sourceType: 'pageUrl',
        },
      ],
    },
    {
      id: 'entry-3',
      domain: 'no-url.example.com',
      url: '',
      timestamp: timestamp - 20_000,
      psps: [],
    },
  ];
}

async function flushAsync(waitMs = 0): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, waitMs);
  });

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function getRequiredElementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing #${id} element`);
  }

  return element as T;
}

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`Missing ${selector} element`);
  }

  return element as T;
}

interface OptionsPageSuccessMocks {
  fetchMock: jest.Mock;
  readHistoryMock: jest.MockedFunction<typeof readHistory>;
  clearHistoryMock: jest.MockedFunction<typeof clearHistory>;
  loggerMock: LoggerMock;
  createObjectURL: jest.Mock<string, []>;
  revokeObjectURL: jest.Mock<void, []>;
  anchorClickSpy: jest.SpyInstance<void, [], HTMLAnchorElement>;
  confirmSpy: jest.SpyInstance<
    boolean,
    [message?: string | undefined],
    typeof globalThis
  >;
}

function getLoggerMock(): LoggerMock {
  return logger as unknown as LoggerMock;
}

function setupSuccessMocks(): OptionsPageSuccessMocks {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async() => createProviderConfig(),
  } as unknown as Response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const readHistoryMock = jest
    .mocked(readHistory)
    .mockResolvedValue(createHistoryEntries());
  const clearHistoryMock = jest
    .mocked(clearHistory)
    .mockResolvedValue(undefined);
  const loggerMock = getLoggerMock();

  const createObjectURL = jest.fn(() => 'blob:test-download');
  const revokeObjectURL = jest.fn();
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    value: revokeObjectURL,
    configurable: true,
    writable: true,
  });

  const anchorClickSpy = jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation((): void => {
      return;
    });
  const confirmSpy = jest.spyOn(globalThis, 'confirm').mockReturnValue(false);

  return {
    fetchMock,
    readHistoryMock,
    clearHistoryMock,
    loggerMock,
    createObjectURL,
    revokeObjectURL,
    anchorClickSpy,
    confirmSpy,
  };
}

async function initializeOptionsPage(waitMs = 0): Promise<void> {
  await import('./options');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await flushAsync(waitMs);
}

describe('options page wiring', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    setupOptionsDOM();
    setupCanvasContextMock();
    setupChromeRuntimeMock();

    jest.mocked(readHistory).mockReset();
    jest.mocked(clearHistory).mockReset();

    const loggerMock = getLoggerMock();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
  });

  it('renders history, handles icons, and supports filtering', async() => {
    setupSuccessMocks();
    await initializeOptionsPage();

    const stats = getRequiredElementById<HTMLElement>('stats');
    expect(stats.textContent).toContain('sites scanned');

    const pspFilter = getRequiredElementById<HTMLSelectElement>('pspFilter');
    expect(pspFilter.options.length).toBeGreaterThan(1);

    const historyBody = getRequiredElementById<HTMLTableSectionElement>(
      'historyBody',
    );
    expect(historyBody.querySelectorAll('tr').length).toBe(3);

    const firstDomainIcon = getRequiredElement<HTMLImageElement>('.domain-icon');
    firstDomainIcon.dispatchEvent(new Event('error'));
    expect(document.querySelector('.domain-letter-avatar')).not.toBeNull();

    const firstPspIcon = getRequiredElement<HTMLImageElement>('.psp-icon');
    firstPspIcon.dispatchEvent(new Event('error'));
    expect(firstPspIcon.src).toContain('images/default_48.png');

    const search = getRequiredElementById<HTMLInputElement>('search');

    search.value = 'does-not-exist';
    search.dispatchEvent(new Event('input'));
    await flushAsync(160);
    expect(historyBody.querySelectorAll('tr').length).toBe(0);

    const emptyState = getRequiredElementById<HTMLElement>('emptyState');
    expect(emptyState.hidden).toBe(false);

    search.value = '';
    search.dispatchEvent(new Event('input'));
    await flushAsync(160);

    pspFilter.value = 'Stripe';
    pspFilter.dispatchEvent(new Event('change'));
    await flushAsync();
    expect(historyBody.querySelectorAll('tr').length).toBe(1);
  });

  it('exports history and applies clear confirmation behavior', async() => {
    const {
      clearHistoryMock,
      confirmSpy,
      createObjectURL,
      revokeObjectURL,
      anchorClickSpy,
      loggerMock,
    } = setupSuccessMocks();
    await initializeOptionsPage();

    const historyBody = getRequiredElementById<HTMLTableSectionElement>(
      'historyBody',
    );

    getRequiredElementById<HTMLButtonElement>('exportBtn').click();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    confirmSpy.mockReturnValueOnce(false);
    getRequiredElementById<HTMLButtonElement>('clearBtn').click();
    await flushAsync();
    expect(clearHistoryMock).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    clearHistoryMock.mockResolvedValueOnce(undefined);
    getRequiredElementById<HTMLButtonElement>('clearBtn').click();
    await flushAsync();
    expect(clearHistoryMock).toHaveBeenCalledTimes(1);
    expect(historyBody.querySelectorAll('tr').length).toBe(0);

    confirmSpy.mockReturnValueOnce(true);
    clearHistoryMock.mockRejectedValueOnce(new Error('Clear failed'));
    getRequiredElementById<HTMLButtonElement>('clearBtn').click();
    await flushAsync();
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to clear history',
      expect.any(Error),
    );
  });

  it('logs initialization errors when metadata or history loading fails', async() => {
    const { fetchMock, readHistoryMock, loggerMock } = setupSuccessMocks();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async() => ({ error: true }),
    } as unknown as Response);

    readHistoryMock.mockRejectedValueOnce(new Error('Read failed'));
    await initializeOptionsPage();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Failed to load PSP icon metadata for history table',
      expect.any(Error),
    );

    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to initialize options page',
      expect.any(Error),
    );
  });
});
