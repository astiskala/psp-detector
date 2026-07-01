/**
 * Privacy-preserving telemetry service built on the GA4 Measurement Protocol.
 *
 * It reports aggregate feature usage and detection outcomes without ever
 * transmitting merchant browsing data: no page URLs, domains, titles, HTML,
 * network request URLs, or payment data are sent. Only the small, explicitly
 * constructed parameter sets passed by callers are forwarded, after
 * sanitisation, and PSP-owned evidence is reduced to a hostname.
 *
 * GA credentials are injected at build time (see `build.mjs`). When they are
 * absent — local/dev builds — telemetry is a safe no-op. Every code path here
 * swallows its own failures so telemetry can never affect extension behaviour.
 */
import { logger } from '../lib/utilities';
import { STORAGE_KEYS } from '../lib/storage-keys';

const GA_COLLECT_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const GA_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';
const CLOUDFLARE_TRACE_ENDPOINT = 'https://www.cloudflare.com/cdn-cgi/trace';

/** Session is considered expired after this much inactivity (30 minutes). */
const SESSION_EXPIRY_MS = 30 * 60_000;
const MAX_PARAM_STRING_LENGTH = 100;
const MAX_PARAM_NAME_LENGTH = 40;
const MAX_PARAMS_PER_EVENT = 25;
const DEFAULT_ENGAGEMENT_TIME_MSEC = 100;
const EVENT_SOURCE = 'chrome_extension';
const UNKNOWN_VERSION = 'unknown';

/**
Centralised, validated telemetry event names. `trackEvent` ignores any name
not present here, so call sites should always reference these constants.
 */
export const TELEMETRY_EVENTS = {
  EXTENSION_INSTALLED: 'extension_installed',
  EXTENSION_UPDATED: 'extension_updated',
  POPUP_OPENED: 'popup_opened',
  SCAN_REQUESTED: 'scan_requested',
  SCAN_SKIPPED: 'scan_skipped',
  PSP_DETECTED: 'psp_detected',
  PSP_NOT_DETECTED: 'psp_not_detected',
  SCAN_ERROR: 'scan_error',
  HISTORY_OPENED: 'history_opened',
  HISTORY_EXPORTED: 'history_exported',
  SETTINGS_OPENED: 'settings_opened',
  TELEMETRY_CHANGED: 'telemetry_changed',
} as const;

/** Centralised `entry_point` dimension values shared across call sites. */
export const TELEMETRY_ENTRY_POINTS = {
  TAB_UPDATE: 'tab_update',
  TAB_ACTIVATION: 'tab_activation',
  REDETECT: 'redetect',
  POPUP: 'popup',
} as const;

type TelemetryEventName =
  (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS];

const VALID_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(TELEMETRY_EVENTS),
);

type TelemetryParameterValue = string | number | boolean;
type TelemetryParameters = Record<string, unknown>;

interface GaConfig {
  measurementId: string;
  apiSecret: string;
}

interface TelemetrySession {
  id: string;
  lastActivity: number;
}

const TELEMETRY_COUNTRY_CODE_KEY = STORAGE_KEYS.TELEMETRY_COUNTRY_CODE;

/**
Reads GA credentials. esbuild replaces these `process.env` reads with string
literals at build time; in tests they fall back to the Node environment.
 */
function getGaConfig(): GaConfig {
  return {
    measurementId: process.env['GA_MEASUREMENT_ID'] ?? '',
    apiSecret: process.env['GA_API_SECRET'] ?? '',
  };
}

function isGaConfigured(config: GaConfig): boolean {
  return config.measurementId.length > 0 && config.apiSecret.length > 0;
}

function isDebugBuild(): boolean {
  return process.env['NODE_ENV'] === 'development';
}

/** Returns whether the user has telemetry enabled. Defaults to enabled. */
export async function isTelemetryEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(
      STORAGE_KEYS.TELEMETRY_ENABLED,
    );
    // Default ON when unset; only an explicit `false` disables telemetry.
    return result[STORAGE_KEYS.TELEMETRY_ENABLED] !== false;
  } catch (error) {
    logger.debug('Failed to read telemetry setting', error);
    return false;
  }
}

/** Persists the user's telemetry preference. */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.TELEMETRY_ENABLED]: enabled,
  });
}

function generateRandomToken(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    // Fallback for the rare runtime without randomUUID — still sourced from the
    // cryptographic RNG rather than a pseudo-random one.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // crypto is unavailable only in stripped-down test shims; a timestamp-derived
  // token keeps client-id generation working without a pseudo-random source.
  return `t_${Date.now().toString(36)}`;
}

async function getClientId(): Promise<string> {
  const result = await chrome.storage.local.get(
    STORAGE_KEYS.TELEMETRY_CLIENT_ID,
  );
  const existing = result[STORAGE_KEYS.TELEMETRY_CLIENT_ID];
  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }

  const clientId = `${generateRandomToken()}.${Math.floor(Date.now() / 1000)}`;
  await chrome.storage.local.set({
    [STORAGE_KEYS.TELEMETRY_CLIENT_ID]: clientId,
  });
  return clientId;
}

function isTelemetrySession(value: unknown): value is TelemetrySession {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as TelemetrySession).id === 'string' &&
    typeof (value as TelemetrySession).lastActivity === 'number'
  );
}

/**
Returns a short-lived session id stored in session storage, rotating it once
the inactivity window elapses and refreshing the activity timestamp.
 */
async function getSessionId(): Promise<string> {
  const now = Date.now();
  let session: TelemetrySession | undefined;

  try {
    const result = await chrome.storage.session.get(
      STORAGE_KEYS.TELEMETRY_SESSION,
    );
    const stored = result[STORAGE_KEYS.TELEMETRY_SESSION];
    if (
      isTelemetrySession(stored) &&
      now - stored.lastActivity < SESSION_EXPIRY_MS
    ) {
      session = { id: stored.id, lastActivity: now };
    }
  } catch (error) {
    logger.debug('Failed to read telemetry session', error);
  }

  // A random id (rather than a timestamp) guarantees a fresh session id even
  // when rotation happens within the same second.
  session ??= { id: generateRandomToken(), lastActivity: now };

  try {
    await chrome.storage.session.set({
      [STORAGE_KEYS.TELEMETRY_SESSION]: session,
    });
  } catch (error) {
    logger.debug('Failed to persist telemetry session', error);
  }

  return session.id;
}

function getExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version || UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

/** Coerces a param name into a GA-safe identifier (`[a-z][a-z0-9_]*`). */
function normalizeParameterName(name: string): string {
  let normalized = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]/gu, '_');
  if (!/^[a-z]/u.test(normalized)) {
    normalized = `p_${normalized}`;
  }

  return normalized.slice(0, MAX_PARAM_NAME_LENGTH);
}

/** Allows only strings, numbers, and booleans; truncates long strings. */
function sanitizeParameterValue(
  value: unknown,
): TelemetryParameterValue | undefined {
  if (typeof value === 'string') {
    return value.slice(0, MAX_PARAM_STRING_LENGTH);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function sanitizeParameters(
  parameters: TelemetryParameters,
): Record<string, TelemetryParameterValue> {
  const sanitized: Record<string, TelemetryParameterValue> = {};
  let count = 0;

  for (const [rawName, rawValue] of Object.entries(parameters)) {
    if (count >= MAX_PARAMS_PER_EVENT) {
      break;
    }

    const value = sanitizeParameterValue(rawValue);
    if (value === undefined) {
      continue;
    }

    const name = normalizeParameterName(rawName);
    if (name.length === 0) {
      continue;
    }

    sanitized[name] = value;
    count += 1;
  }

  return sanitized;
}

/**
Reduces a PSP-owned evidence URL or domain token to a bare hostname so no
path, query, fragment, or non-host token is ever transmitted. Returns
undefined for anything that is not a dotted hostname.
 */
export function toEvidenceHostname(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const candidate = /^https?:\/\//iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    // Require a dotted hostname so bare match tokens (e.g. "adyen-checkout")
    // and regex patterns are dropped rather than sent as pseudo-domains.
    return hostname.includes('.') ? hostname : undefined;
  } catch {
    return undefined;
  }
}

/** Returns the IANA timezone (e.g. `Asia/Singapore`) if the runtime exposes it. */
function getTimezone(): string | undefined {
  try {
    const formatter = new Intl.DateTimeFormat();
    return formatter.resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Returns the browser UI language (e.g. `en-GB`), falling back to navigator. */
function getUiLanguage(): string | undefined {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    // chrome.i18n is unavailable outside the extension runtime; fall back.
  }

  try {
    return navigator.language;
  } catch {
    return undefined;
  }
}

/** Returns the OS platform (`mac`/`win`/`linux`/…) if the runtime exposes it. */
async function getOsPlatform(): Promise<string | undefined> {
  try {
    const info = await chrome.runtime.getPlatformInfo();
    return info.os;
  } catch {
    return undefined;
  }
}

function isIsoCountryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{2}$/u.test(value);
}

/** Parses the country code from Cloudflare's trace response (`loc=US`). */
function parseCountryFromCloudflareTrace(payload: string): string | undefined {
  const match = /^loc=([A-Z]{2})$/mu.exec(payload);
  return match?.[1];
}

/**
Returns an ISO-2 country code from Cloudflare trace and caches only that code
in session storage. Raw IP values in the trace payload are never persisted.
 */
async function getCountryCode(): Promise<string | undefined> {
  try {
    const cached = await chrome.storage.session.get(TELEMETRY_COUNTRY_CODE_KEY);
    const value = cached[TELEMETRY_COUNTRY_CODE_KEY];
    if (isIsoCountryCode(value)) {
      return value;
    }
  } catch {
    // Best-effort cache read.
  }

  let countryCode: string | undefined;
  try {
    const response = await fetch(CLOUDFLARE_TRACE_ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
    });
    if (response.ok) {
      countryCode = parseCountryFromCloudflareTrace(await response.text());
    }
  } catch {
    // Best-effort country lookup.
  }

  if (countryCode !== undefined) {
    try {
      await chrome.storage.session.set({
        [TELEMETRY_COUNTRY_CODE_KEY]: countryCode,
      });
    } catch {
      // Best-effort cache write.
    }
  }

  return countryCode;
}

/**
Gathers privacy-preserving user context attached to every event: country,
timezone, OS platform, and UI language. Only values that are actually
resolved are returned, so absent signals are never sent.
 */
async function getUserContext(): Promise<Record<string, string>> {
  const country = await getCountryCode();
  const timezone = getTimezone();
  const os = await getOsPlatform();
  const language = getUiLanguage();

  const context: Record<string, string> = {};
  if (country !== undefined) {
    context['user_country'] = country;
  }
  if (timezone !== undefined) {
    context['user_timezone'] = timezone;
  }
  if (os !== undefined) {
    context['user_os'] = os;
  }
  if (language !== undefined) {
    context['ui_language'] = language;
  }

  return context;
}

async function sendEvent(
  name: TelemetryEventName,
  parameters: TelemetryParameters,
): Promise<void> {
  const config = getGaConfig();
  if (!isGaConfigured(config)) {
    return;
  }

  if (!(await isTelemetryEnabled())) {
    return;
  }

  const [clientId, sessionId, userContext] = await Promise.all([
    getClientId(),
    getSessionId(),
    getUserContext(),
  ]);

  const eventParameters = {
    ...sanitizeParameters(parameters),
    ...userContext,
    event_source: EVENT_SOURCE,
    extension_version: getExtensionVersion(),
    session_id: sessionId,
    engagement_time_msec: DEFAULT_ENGAGEMENT_TIME_MSEC,
  };

  const endpoint = isDebugBuild() ? GA_DEBUG_ENDPOINT : GA_COLLECT_ENDPOINT;
  const url =
    `${endpoint}?measurement_id=${encodeURIComponent(config.measurementId)}` +
    `&api_secret=${encodeURIComponent(config.apiSecret)}`;

  await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      events: [{ name, params: eventParameters }],
    }),
    keepalive: true,
  });
}

/**
 * Sends a telemetry event via the GA4 Measurement Protocol.
 *
 * Fire-and-forget by design: it never throws and never blocks extension
 * behaviour. Unknown event names, missing GA credentials, and a disabled
 * telemetry setting all result in no network request.
 */
export async function trackEvent(
  name: string,
  parameters: TelemetryParameters = {},
): Promise<void> {
  if (!VALID_EVENT_NAMES.has(name)) {
    logger.debug(`Ignoring unknown telemetry event: ${name}`);
    return;
  }

  try {
    await sendEvent(name as TelemetryEventName, parameters);
  } catch (error) {
    logger.debug('Telemetry event failed', error);
  }
}
