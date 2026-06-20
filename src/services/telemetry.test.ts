import {
  trackEvent,
  isTelemetryEnabled,
  setTelemetryEnabled,
  toEvidenceHostname,
  TELEMETRY_EVENTS,
} from './telemetry';
import { STORAGE_KEYS } from '../lib/storage-keys';

const GA_MEASUREMENT_ID = 'G-TEST123';
const GA_API_SECRET = 'secret-abc';
const COLLECT_URL = 'https://www.google-analytics.com/mp/collect';
const PROVIDER_SLUG = 'provider_slug';
const EVIDENCE_DOMAIN = 'evidence_domain';
const ADYEN_EVIDENCE_HOST = 'checkoutshopper-live.adyen.com';
const MERCHANT_HOST = 'secret-merchant-shop.example';

interface StorageArea {
  store: Map<string, unknown>;
  get: jest.Mock;
  set: jest.Mock;
}

interface GaEvent {
  name: string;
  params: Record<string, unknown>;
}

interface GaPayload {
  client_id: string;
  events: GaEvent[];
}

function createStorageArea(): StorageArea {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn((key: string) => Promise.resolve({ [key]: store.get(key) })),
    set: jest.fn((items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }

      return Promise.resolve();
    }),
  };
}

let localArea: StorageArea;
let sessionArea: StorageArea;
let fetchMock: jest.Mock;

function setupChromeMock(): void {
  localArea = createStorageArea();
  sessionArea = createStorageArea();
  globalThis.chrome = {
    runtime: {
      getManifest: jest.fn(() => ({ version: '3.2026.1.1' })),
    },
    storage: {
      local: localArea,
      session: sessionArea,
    },
  } as unknown as typeof chrome;
}

function lastFetchBody(): GaPayload {
  const calls = fetchMock.mock.calls;
  const lastCall = calls.at(-1);
  if (lastCall === undefined) {
    throw new Error('Expected fetch to have been called');
  }

  const init = lastCall[1] as { body?: string };
  return JSON.parse(init.body ?? '') as GaPayload;
}

function lastFetchUrl(): string {
  const lastCall = fetchMock.mock.calls.at(-1);
  if (lastCall === undefined) {
    throw new Error('Expected fetch to have been called');
  }

  return String(lastCall[0]);
}

function lastFetchRaw(): string {
  return `${lastFetchUrl()} ${JSON.stringify(lastFetchBody())}`;
}

beforeEach(() => {
  setupChromeMock();
  fetchMock = jest.fn(() => Promise.resolve({ ok: true } as Response));
  globalThis.fetch = fetchMock;
  process.env['GA_MEASUREMENT_ID'] = GA_MEASUREMENT_ID;
  process.env['GA_API_SECRET'] = GA_API_SECRET;
});

afterEach(() => {
  delete process.env['GA_MEASUREMENT_ID'];
  delete process.env['GA_API_SECRET'];
});

describe('trackEvent gating', () => {
  it('sends nothing for an unknown event name', async () => {
    await trackEvent('not_a_real_event', { foo: 'bar' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when GA config is missing', async () => {
    delete process.env['GA_MEASUREMENT_ID'];
    delete process.env['GA_API_SECRET'];
    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when only the api secret is missing', async () => {
    delete process.env['GA_API_SECRET'];
    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when telemetry is disabled', async () => {
    localArea.store.set(STORAGE_KEYS.TELEMETRY_ENABLED, false);
    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends when telemetry setting is unset (default enabled)', async () => {
    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('trackEvent payload', () => {
  it('posts a Measurement Protocol payload to the collect endpoint', async () => {
    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);

    const url = lastFetchUrl();
    expect(url.startsWith(COLLECT_URL)).toBe(true);
    expect(url).toContain(`measurement_id=${GA_MEASUREMENT_ID}`);
    expect(url).toContain(`api_secret=${GA_API_SECRET}`);

    const lastCall = fetchMock.mock.calls.at(-1);
    expect((lastCall?.[1] as RequestInit).method).toBe('POST');

    const payload = lastFetchBody();
    expect(typeof payload.client_id).toBe('string');
    expect(payload.client_id.length).toBeGreaterThan(0);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]?.name).toBe('popup_opened');
  });

  it('includes the common params on every event', async () => {
    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    const parameters = lastFetchBody().events[0]?.params ?? {};
    expect(parameters['event_source']).toBe('chrome_extension');
    expect(parameters['extension_version']).toBe('3.2026.1.1');
    expect(typeof parameters['session_id']).toBe('string');
    expect(typeof parameters['engagement_time_msec']).toBe('number');
  });

  it('swallows fetch failures without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(
      trackEvent(TELEMETRY_EVENTS.POPUP_OPENED),
    ).resolves.toBeUndefined();
  });
});

describe('param sanitisation', () => {
  it('keeps strings, numbers, and booleans and drops everything else', async () => {
    await trackEvent(TELEMETRY_EVENTS.SCAN_ERROR, {
      error_code: 'injection_failed',
      component: 'background',
      count: 3,
      flag: true,
      missing: undefined,
      // eslint-disable-next-line unicorn/no-null -- deliberately testing null is dropped
      empty: null,
      nested: { secret: 'do-not-send' },
      list: ['a', 'b'],
    });

    const parameters = lastFetchBody().events[0]?.params ?? {};
    expect(parameters['error_code']).toBe('injection_failed');
    expect(parameters['component']).toBe('background');
    expect(parameters['count']).toBe(3);
    expect(parameters['flag']).toBe(true);
    expect('missing' in parameters).toBe(false);
    expect('empty' in parameters).toBe(false);
    expect('nested' in parameters).toBe(false);
    expect('list' in parameters).toBe(false);
  });

  it('truncates long string values to a safe length', async () => {
    const longValue = 'x'.repeat(500);
    await trackEvent(TELEMETRY_EVENTS.SCAN_ERROR, { error_code: longValue });
    const value = lastFetchBody().events[0]?.params?.['error_code'];
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeLessThanOrEqual(100);
  });

  it('normalises param names to GA-safe identifiers', async () => {
    await trackEvent(TELEMETRY_EVENTS.SCAN_ERROR, {
      'Weird Name!': 'value',
      '123leading': 'value',
    });
    const parameters = lastFetchBody().events[0]?.params ?? {};
    expect(parameters['weird_name_']).toBe('value');
    expect(parameters['p_123leading']).toBe('value');
  });
});

describe('toEvidenceHostname', () => {
  it('reduces a full evidence URL to its hostname only', () => {
    const result = toEvidenceHostname(
      `https://${ADYEN_EVIDENCE_HOST}/checkout/v3/payments?merchant=${MERCHANT_HOST}#frag`,
    );
    expect(result).toBe(ADYEN_EVIDENCE_HOST);
  });

  it('passes through a bare hostname token', () => {
    expect(toEvidenceHostname('js.stripe.com')).toBe('js.stripe.com');
  });

  it('drops non-hostname tokens', () => {
    expect(toEvidenceHostname('adyen-checkout')).toBeUndefined();
    expect(toEvidenceHostname(String.raw`stripe\.com`)).toBeUndefined();
  });

  it('drops empty or undefined input', () => {
    expect(toEvidenceHostname('')).toBeUndefined();
    expect(toEvidenceHostname(' '.repeat(3))).toBeUndefined();
    expect(toEvidenceHostname(undefined)).toBeUndefined();
  });
});

describe('privacy boundary', () => {
  it('psp_detected sends provider fields and evidence hostname only', async () => {
    await trackEvent(TELEMETRY_EVENTS.PSP_DETECTED, {
      [PROVIDER_SLUG]: 'adyen',
      provider_name: 'Adyen',
      provider_type: 'Orchestrator',
      [EVIDENCE_DOMAIN]: toEvidenceHostname(
        `https://${ADYEN_EVIDENCE_HOST}/v1/sessions?merchant=${MERCHANT_HOST}`,
      ),
      match_type: 'matchString',
    });

    const parameters = lastFetchBody().events[0]?.params ?? {};
    expect(parameters[PROVIDER_SLUG]).toBe('adyen');
    expect(parameters['provider_name']).toBe('Adyen');
    expect(parameters['provider_type']).toBe('Orchestrator');
    expect(parameters[EVIDENCE_DOMAIN]).toBe(ADYEN_EVIDENCE_HOST);
    expect(parameters['match_type']).toBe('matchString');

    const raw = lastFetchRaw();
    expect(raw).not.toContain(MERCHANT_HOST);
    expect(raw).not.toContain('/v1/sessions');
  });

  it('scan_skipped sends the skip reason but never a merchant domain', async () => {
    await trackEvent(TELEMETRY_EVENTS.SCAN_SKIPPED, {
      skip_reason: 'exempt_domain',
      entry_point: 'tab_update',
    });
    const parameters = lastFetchBody().events[0]?.params ?? {};
    expect(parameters['skip_reason']).toBe('exempt_domain');
    expect(parameters['entry_point']).toBe('tab_update');
    expect(lastFetchRaw()).not.toContain(MERCHANT_HOST);
  });

  it('history_exported sends format and a row-count bucket, not history rows', async () => {
    await trackEvent(TELEMETRY_EVENTS.HISTORY_EXPORTED, {
      format: 'csv',
      row_count_bucket: '11-50',
    });
    const parameters = lastFetchBody().events[0]?.params ?? {};
    expect(parameters['format']).toBe('csv');
    expect(parameters['row_count_bucket']).toBe('11-50');
    expect(lastFetchRaw()).not.toContain(MERCHANT_HOST);
  });
});

describe('client id and session id', () => {
  it('generates a client id, persists it, and reuses it', async () => {
    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    const firstId = lastFetchBody().client_id;
    expect(localArea.store.get(STORAGE_KEYS.TELEMETRY_CLIENT_ID)).toBe(firstId);

    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    expect(lastFetchBody().client_id).toBe(firstId);
  });

  it('stores the session id in session storage and reuses it within the window', async () => {
    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    const firstSession = lastFetchBody().events[0]?.params?.['session_id'];
    expect(typeof firstSession).toBe('string');
    expect(sessionArea.set).toHaveBeenCalled();

    await trackEvent(TELEMETRY_EVENTS.SCAN_REQUESTED, { entry_point: 'popup' });
    expect(lastFetchBody().events[0]?.params?.['session_id']).toBe(
      firstSession,
    );
  });

  it('starts a new session after the inactivity window expires', async () => {
    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    const firstSession = lastFetchBody().events[0]?.params?.['session_id'];

    const stored = sessionArea.store.get(STORAGE_KEYS.TELEMETRY_SESSION) as {
      id: string;
      lastActivity: number;
    };
    sessionArea.store.set(STORAGE_KEYS.TELEMETRY_SESSION, {
      id: stored.id,
      lastActivity: stored.lastActivity - 31 * 60_000,
    });

    await trackEvent(TELEMETRY_EVENTS.POPUP_OPENED);
    expect(lastFetchBody().events[0]?.params?.['session_id']).not.toBe(
      firstSession,
    );
  });
});

describe('telemetry setting', () => {
  it('defaults to enabled when unset', async () => {
    await expect(isTelemetryEnabled()).resolves.toBe(true);
  });

  it('reflects a stored disabled value', async () => {
    localArea.store.set(STORAGE_KEYS.TELEMETRY_ENABLED, false);
    await expect(isTelemetryEnabled()).resolves.toBe(false);
  });

  it('persists a changed value', async () => {
    await setTelemetryEnabled(false);
    expect(localArea.store.get(STORAGE_KEYS.TELEMETRY_ENABLED)).toBe(false);
    await expect(isTelemetryEnabled()).resolves.toBe(false);
  });
});
