import type { PSPConfig } from './types';
import { TypeConverters } from './types';
import type { HistoryEntry } from './types/history';
import { clearHistory, readHistory } from './lib/history';
import { logger } from './lib/utilities';
import {
  trackEvent,
  isTelemetryEnabled,
  setTelemetryEnabled,
  TELEMETRY_EVENTS,
} from './services/telemetry';

jest.mock('./lib/history', () => ({
  clearHistory: jest.fn(),
  readHistory: jest.fn(),
}));

jest.mock('./services/telemetry', () => {
  const actual = jest.requireActual('./services/telemetry');
  return {
    ...actual,
    trackEvent: jest.fn(),
    isTelemetryEnabled: jest.fn().mockResolvedValue(true),
    setTelemetryEnabled: jest.fn().mockResolvedValue(undefined),
  };
});

// jsdom (26.x) ships the <dialog> element but not showModal()/close(). Install a
// minimal polyfill on the element instance (closing over it, so no prototype
// mutation) so the open/close wiring can be exercised under unit tests.
function installDialogPolyfill(dialog: HTMLDialogElement): void {
  dialog.showModal = (): void => {
    dialog.open = true;
  };

  dialog.close = (): void => {
    dialog.open = false;
    dialog.dispatchEvent(new Event('close'));
  };
}

jest.mock('./lib/utilities', () => {
  const actual = jest.requireActual('./lib/utilities');
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
    <button id="exportBtn" type="button">Export</button>
    <button id="settingsBtn" type="button">Settings</button>
    <dialog id="settingsDialog">
      <button id="settingsCloseBtn" type="button" aria-label="Close settings">
        &times;
      </button>
      <label><input type="checkbox" id="telemetryToggle" /> Analytics</label>
      <button id="clearBtn" type="button">Clear History</button>
      <ul class="settings-links">
        <li><a id="suggestLink" href="mailto:psp-detector@adamstiskala.com">Suggest</a></li>
        <li><a id="privacyLink" href="https://astiskala.github.io/psp-detector/privacy-policy.html" target="_blank" rel="noopener">Privacy</a></li>
      </ul>
    </dialog>
    <input id="search" />
    <select id="pspFilter">
      <option value="">All PSPs</option>
    </select>
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

  if (stripeName === undefined || stripeUrl === undefined) {
    throw new Error('Failed to build test PSP config');
  }

  return {
    psps: [
      {
        name: stripeName,
        matchStrings: ['js.stripe.com'],
        image: 'stripe',
        summary: 'Stripe summary',
        url: stripeUrl,
      },
    ],
  };
}

function createHistoryEntries(): HistoryEntry[] {
  const parsedDate = new Date('2026-02-22T18:00:00Z');
  const timestamp = parsedDate.getTime();
  return [
    {
      id: 'entry-1',
      domain: 'checkout.example.com',
      url: 'https://checkout.example.com/pay',
      timestamp,
      psps: [
        {
          name: 'Stripe',
          type: 'PSP',
          method: 'matchString',
          value: 'js.stripe.com',
          sourceType: 'scriptSrc',
        },
      ],
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
          name: ' '.repeat(3),
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
  const element = document.querySelector<T>(`#${id}`);
  if (element === null) {
    throw new Error(`Missing #${id} element`);
  }

  return element;
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
    json: async () => createProviderConfig(),
  });
  globalThis.fetch = fetchMock;

  const readHistoryMock = jest
    .mocked(readHistory)
    .mockResolvedValue(createHistoryEntries());
  const clearHistoryMock = jest
    .mocked(clearHistory)
    .mockResolvedValue(undefined);
  const loggerMock = getLoggerMock();

  const createObjectURL = jest.fn(() => 'blob:test-download');
  const revokeObjectURL = jest.fn();
  Object.defineProperties(URL, {
    createObjectURL: {
      value: createObjectURL,
      configurable: true,
      writable: true,
    },
    revokeObjectURL: {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    },
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
    installDialogPolyfill(
      getRequiredElementById<HTMLDialogElement>('settingsDialog'),
    );
    setupCanvasContextMock();
    setupChromeRuntimeMock();

    jest.mocked(readHistory).mockReset();
    jest.mocked(clearHistory).mockReset();
    jest.mocked(trackEvent).mockReset();
    jest.mocked(isTelemetryEnabled).mockReset().mockResolvedValue(true);
    jest.mocked(setTelemetryEnabled).mockReset().mockResolvedValue(undefined);

    const loggerMock = getLoggerMock();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
  });

  it('renders history, handles icons, and supports filtering', async () => {
    setupSuccessMocks();
    await initializeOptionsPage();

    const stats = getRequiredElementById<HTMLElement>('stats');
    expect(stats.textContent).toContain('sites scanned');

    const pspFilter = getRequiredElementById<HTMLSelectElement>('pspFilter');
    expect(pspFilter.options.length).toBeGreaterThan(1);

    const historyBody =
      getRequiredElementById<HTMLTableSectionElement>('historyBody');
    expect(historyBody.querySelectorAll(':scope tr').length).toBe(3);

    const firstDomainIcon =
      getRequiredElement<HTMLImageElement>('.domain-icon');
    firstDomainIcon.dispatchEvent(new Event('error'));
    expect(firstDomainIcon.isConnected).toBe(false);

    const firstPspIcon = getRequiredElement<HTMLImageElement>('.psp-icon');
    firstPspIcon.dispatchEvent(new Event('error'));
    expect(firstPspIcon.src).toContain('images/default_48.png');

    const search = getRequiredElementById<HTMLInputElement>('search');

    search.value = 'does-not-exist';
    search.dispatchEvent(new Event('input'));
    await flushAsync(160);
    expect(historyBody.querySelectorAll(':scope tr').length).toBe(0);

    const emptyState = getRequiredElementById<HTMLElement>('emptyState');
    expect(emptyState.hidden).toBe(false);

    search.value = '';
    search.dispatchEvent(new Event('input'));
    await flushAsync(160);

    pspFilter.value = 'Stripe';
    pspFilter.dispatchEvent(new Event('change'));
    await flushAsync();
    expect(historyBody.querySelectorAll(':scope tr').length).toBe(1);
  });

  it('exports history and applies clear confirmation behavior', async () => {
    const {
      clearHistoryMock,
      confirmSpy,
      createObjectURL,
      revokeObjectURL,
      anchorClickSpy,
      loggerMock,
    } = setupSuccessMocks();
    await initializeOptionsPage();

    const historyBody =
      getRequiredElementById<HTMLTableSectionElement>('historyBody');

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
    expect(historyBody.querySelectorAll(':scope tr').length).toBe(0);

    confirmSpy.mockReturnValueOnce(true);
    clearHistoryMock.mockRejectedValueOnce(new Error('Clear failed'));
    getRequiredElementById<HTMLButtonElement>('clearBtn').click();
    await flushAsync();
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to clear history',
      expect.any(Error),
    );
  });

  it('logs initialization errors when metadata or history loading fails', async () => {
    const { fetchMock, readHistoryMock, loggerMock } = setupSuccessMocks();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: true }),
    });

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

  it('opens the settings dialog and reports the open', async () => {
    setupSuccessMocks();
    await initializeOptionsPage();

    const dialog = getRequiredElementById<HTMLDialogElement>('settingsDialog');
    expect(dialog.open).toBe(false);

    getRequiredElementById<HTMLButtonElement>('settingsBtn').click();

    expect(dialog.open).toBe(true);
    expect(jest.mocked(trackEvent)).toHaveBeenCalledWith(
      TELEMETRY_EVENTS.SETTINGS_OPENED,
    );
  });

  it('closes the settings dialog via the close button', async () => {
    setupSuccessMocks();
    await initializeOptionsPage();

    const dialog = getRequiredElementById<HTMLDialogElement>('settingsDialog');
    getRequiredElementById<HTMLButtonElement>('settingsBtn').click();
    expect(dialog.open).toBe(true);

    getRequiredElementById<HTMLButtonElement>('settingsCloseBtn').click();
    expect(dialog.open).toBe(false);
  });

  it('closes the settings dialog when the backdrop is clicked', async () => {
    setupSuccessMocks();
    await initializeOptionsPage();

    const dialog = getRequiredElementById<HTMLDialogElement>('settingsDialog');
    getRequiredElementById<HTMLButtonElement>('settingsBtn').click();
    expect(dialog.open).toBe(true);

    // A click whose target is the dialog itself represents the backdrop.
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(false);
  });

  it('keeps the dialog open when its content is clicked', async () => {
    setupSuccessMocks();
    await initializeOptionsPage();

    const dialog = getRequiredElementById<HTMLDialogElement>('settingsDialog');
    getRequiredElementById<HTMLButtonElement>('settingsBtn').click();

    // A click bubbling up from a child keeps target !== dialog, so it stays open.
    getRequiredElementById<HTMLInputElement>('telemetryToggle').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(dialog.open).toBe(true);
  });

  it('reflects the stored analytics setting on load', async () => {
    setupSuccessMocks();
    jest.mocked(isTelemetryEnabled).mockResolvedValue(false);
    await initializeOptionsPage();

    expect(
      getRequiredElementById<HTMLInputElement>('telemetryToggle').checked,
    ).toBe(false);
  });

  it('persists and reports turning analytics off then on', async () => {
    setupSuccessMocks();
    await initializeOptionsPage();

    const toggle = getRequiredElementById<HTMLInputElement>('telemetryToggle');
    expect(toggle.checked).toBe(true);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await flushAsync();
    expect(jest.mocked(setTelemetryEnabled)).toHaveBeenLastCalledWith(false);
    expect(jest.mocked(trackEvent)).toHaveBeenCalledWith(
      TELEMETRY_EVENTS.TELEMETRY_CHANGED,
      { enabled: false },
    );

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await flushAsync();
    expect(jest.mocked(setTelemetryEnabled)).toHaveBeenLastCalledWith(true);
    expect(jest.mocked(trackEvent)).toHaveBeenCalledWith(
      TELEMETRY_EVENTS.TELEMETRY_CHANGED,
      { enabled: true },
    );
  });

  it('logs an error when persisting the analytics setting fails', async () => {
    const { loggerMock } = setupSuccessMocks();
    await initializeOptionsPage();

    jest
      .mocked(setTelemetryEnabled)
      .mockRejectedValueOnce(new Error('storage failed'));

    const toggle = getRequiredElementById<HTMLInputElement>('telemetryToggle');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await flushAsync();

    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to update telemetry setting',
      expect.any(Error),
    );
  });

  it('exposes the privacy policy and feedback links', async () => {
    setupSuccessMocks();
    await initializeOptionsPage();

    const privacy = getRequiredElementById<HTMLAnchorElement>('privacyLink');
    expect(privacy.getAttribute('href')).toContain('privacy-policy');
    expect(privacy.target).toBe('_blank');
    expect(privacy.rel).toContain('noopener');

    const suggest = getRequiredElementById<HTMLAnchorElement>('suggestLink');
    expect(suggest.getAttribute('href')).toBe(
      'mailto:psp-detector@adamstiskala.com',
    );
  });
});
