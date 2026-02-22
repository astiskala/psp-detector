# History, Export & Detection Depth — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent history + CSV export, multi-PSP detection with source evidence, and network request scanning—all local, no server.

**Architecture:** Detection happens in the content script (`ContentScript` class), which sends results to the background service worker (`BackgroundService`) via `chrome.runtime.sendMessage`. Background stores per-tab state, writes history, and the new options page reads history from `chrome.storage.local`. Network scanning uses `chrome.webRequest` (optional permission) in the background service worker.

**Tech Stack:** TypeScript (strict MV3), esbuild, Jest + ts-jest, Playwright, ESLint flat config (eslint.config.mjs), gts, chrome.storage.local/session

---

## How to run things

```bash
npm run build          # production build → dist/
npm run build:debug    # dev build with sourcemaps
npm run test           # Jest unit tests
npm run test:watch     # Jest watch mode
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run validate       # lint + typecheck + build + test
```

Load the extension in Chrome: open `chrome://extensions`, enable Developer mode, click "Load unpacked", select `dist/`.

---

## Phase 1 — Types & Storage Foundation

### Task 1: Add `SourceType` and update `PSPDetectionResult` for multi-PSP

**Files:**
- Modify: `src/types/detection.ts`

The `detected` variant currently holds a single PSP. Change it to hold an array of matches. Other variants (`exempt`, `none`, `error`) are unchanged.

**Step 1: Write the failing test**

Add to `src/services/psp-detector.test.ts` (or create `src/types/detection.test.ts`):

```typescript
import { PSPDetectionResult } from '../types/detection';

describe('PSPDetectionResult multi-PSP', () => {
  it('detected factory accepts array of psps', () => {
    const result = PSPDetectionResult.detected([
      {
        psp: 'Stripe' as any,
        detectionInfo: {
          method: 'matchString' as const,
          value: 'js.stripe.com',
          sourceType: 'scriptSrc' as const,
        },
      },
    ]);
    expect(result.type).toBe('detected');
    expect(result.psps).toHaveLength(1);
    expect(result.psps[0]?.psp).toBe('Stripe');
    expect(result.psps[0]?.detectionInfo?.sourceType).toBe('scriptSrc');
  });

  it('none and error factories are unchanged', () => {
    expect(PSPDetectionResult.none(42).type).toBe('none');
    expect(PSPDetectionResult.error(new Error('x')).type).toBe('error');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="detection"
```

Expected: FAIL — `psps` is not a property on detected result.

**Step 3: Implement changes to `src/types/detection.ts`**

Replace the full file:

```typescript
/**
 * Union types
 */
import type { PSPName, URL } from './branded';

/**
 * Source type that triggered a PSP match
 */
export type SourceType =
  | 'scriptSrc'
  | 'iframeSrc'
  | 'formAction'
  | 'linkHref'
  | 'networkRequest'
  | 'pageUrl';

/**
 * A single PSP match within a multi-match detected result
 */
export interface PSPMatch {
  readonly psp: PSPName;
  readonly detectionInfo?: {
    readonly method: 'matchString' | 'regex';
    readonly value: string;
    readonly sourceType?: SourceType;
  };
}

/**
 * PSP detection result union type
 * Provides structured results for different detection scenarios
 */
export type PSPDetectionResult =
  | {
      readonly type: 'detected';
      readonly psps: readonly PSPMatch[];
    }
  | { readonly type: 'exempt'; readonly reason: string; readonly url: URL }
  | { readonly type: 'none'; readonly scannedPatterns: number }
  | {
      readonly type: 'error';
      readonly error: Error;
      readonly context?: string;
    };

/**
 * Detection result factory and utility functions
 */
export const PSPDetectionResult = {
  detected: (psps: PSPMatch[]): PSPDetectionResult => ({
    type: 'detected',
    psps,
  }),

  exempt: (reason: string, url: URL): PSPDetectionResult => ({
    type: 'exempt',
    reason,
    url,
  }),

  none: (scannedPatterns: number): PSPDetectionResult => ({
    type: 'none',
    scannedPatterns,
  }),

  error: (error: Error, context?: string): PSPDetectionResult => ({
    type: 'error',
    error,
    ...(context !== undefined && { context }),
  }),

  isDetected: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: 'detected' }> =>
    result.type === 'detected',

  isExempt: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: 'exempt' }> =>
    result.type === 'exempt',

  isNone: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: 'none' }> =>
    result.type === 'none',

  isError: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: 'error' }> =>
    result.type === 'error',
};
```

**Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern="detection"
```

Expected: PASS

**Step 5: Run full test suite to check for breakage**

```bash
npm test
```

Expected: failures in psp-detector.test.ts and others — that's fine, we'll fix them task by task.

**Step 6: Commit**

```bash
git add src/types/detection.ts src/types/detection.test.ts
git commit -m "feat(types): add SourceType and multi-PSP detected variant"
```

---

### Task 2: Add `PSP_HISTORY` storage key and `HistoryEntry` type

**Files:**
- Modify: `src/lib/storage-keys.ts`
- Create: `src/types/history.ts`

**Step 1: Add storage key**

In `src/lib/storage-keys.ts`, add `PSP_HISTORY` to the `STORAGE_KEYS` object:

```typescript
export const STORAGE_KEYS = {
  DETECTED_PSP: 'detectedPsp',
  TAB_PSPS: 'tabPsps',
  EXEMPT_DOMAINS: 'exemptDomains',
  CACHED_PSP_CONFIG: 'cachedPspConfig',
  CURRENT_TAB_ID: 'currentTabId',
  POPUP_PSP_CONFIG_CACHE: 'popup_psp_config_cache',
  PSP_HISTORY: 'psp_history',
} as const;
```

**Step 2: Create `src/types/history.ts`**

```typescript
import type { SourceType } from './detection';

/**
 * A single PSP match recorded in a history entry
 */
export interface HistoryPSPMatch {
  readonly name: string;
  readonly method: 'matchString' | 'regex';
  readonly value: string;
  readonly sourceType: SourceType;
}

/**
 * One history entry per page detection
 */
export interface HistoryEntry {
  readonly id: string;        // `${tabId}_${timestamp}`
  readonly domain: string;    // hostname only, e.g. "stripe.com"
  readonly url: string;       // full page URL at time of detection
  readonly timestamp: number; // unix ms
  readonly psps: readonly HistoryPSPMatch[];
}

/** Maximum number of history entries to retain */
export const HISTORY_MAX_ENTRIES = 1000;
```

**Step 3: Export from `src/types/index.ts`**

Check which types are re-exported from `src/types/index.ts` (or `src/types.ts`) and add:

```typescript
export type { HistoryEntry, HistoryPSPMatch } from './history';
export { HISTORY_MAX_ENTRIES } from './history';
export type { SourceType, PSPMatch } from './detection';
```

**Step 4: Typecheck**

```bash
npm run typecheck
```

Fix any import errors that surface.

**Step 5: Commit**

```bash
git add src/lib/storage-keys.ts src/types/history.ts src/types/index.ts
git commit -m "feat(types): add HistoryEntry type and PSP_HISTORY storage key"
```

---

## Phase 2 — Refactor PSPDetectorService for Multi-Match

### Task 3: Refactor `detectPSP()` to collect all matches

**Files:**
- Modify: `src/services/psp-detector.ts`
- Modify: `src/services/psp-detector.test.ts`

The service currently returns on the first match. We change it to collect all matching providers.

**Step 1: Update existing tests first**

In `src/services/psp-detector.test.ts`, find tests that use `result.psp` (single PSP name) and update them to use `result.psps[0]?.psp`. Also add multi-match tests:

```typescript
it('returns all matching PSPs when multiple providers match', () => {
  const multiConfig = {
    psps: [
      {
        name: 'Stripe',
        matchStrings: ['js.stripe.com'],
        regex: null,
        image: 'stripe',
        summary: 'Stripe',
        url: 'https://stripe.com',
      },
      {
        name: 'Adyen',
        matchStrings: ['checkoutshopper-live.adyen.com'],
        regex: null,
        image: 'adyen',
        summary: 'Adyen',
        url: 'https://adyen.com',
      },
    ],
    orchestrators: { notice: '', list: [] },
    tsps: { notice: '', list: [] },
  };
  detector.initialize(multiConfig as any);

  const result = detector.detectPSP(
    'https://example.com',
    'js.stripe.com\ncheckoutshopper-live.adyen.com',
  );

  expect(result.type).toBe('detected');
  if (result.type === 'detected') {
    expect(result.psps).toHaveLength(2);
    expect(result.psps[0]?.psp).toBe('Stripe');
    expect(result.psps[1]?.psp).toBe('Adyen');
  }
});

it('deduplicates: same PSP via matchString and regex only appears once', () => {
  const dedupConfig = {
    psps: [{
      name: 'Stripe',
      matchStrings: ['js.stripe.com'],
      regex: 'stripe\\.com',
      image: 'stripe',
      summary: 'Stripe',
      url: 'https://stripe.com',
    }],
    orchestrators: { notice: '', list: [] },
    tsps: { notice: '', list: [] },
  };
  detector.initialize(dedupConfig as any);

  const result = detector.detectPSP(
    'https://example.com',
    'js.stripe.com',
  );

  expect(result.type).toBe('detected');
  if (result.type === 'detected') {
    expect(result.psps).toHaveLength(1); // not 2
  }
});
```

Update existing single-PSP assertions:

```typescript
// Before:
expect(result.psp).toBe('Stripe');
// After:
if (result.type === 'detected') {
  expect(result.psps[0]?.psp).toBe('Stripe');
}
```

**Step 2: Run tests to see them fail**

```bash
npm test -- --testPathPattern="psp-detector"
```

**Step 3: Rewrite detection in `src/services/psp-detector.ts`**

Replace `detectPSP`, `detectByMatchStrings`, and `detectByRegex` with:

```typescript
public detectPSP(url: string, content: string): PSPDetectionResult {
  const initializedError = this.ensureInitialized();
  if (initializedError) return initializedError;

  const inputError = this.validateInputs(url, content);
  if (inputError) return inputError;

  const brandedURL = TypeConverters.toURL(url);
  if (!brandedURL) {
    return PSPDetectionResult.error(
      new Error(`Invalid URL format: ${url}`),
      'url_validation',
    );
  }

  const urlToCheck = this.getUrlToCheck(url);
  const exemptResult = this.checkExempt(urlToCheck, brandedURL);
  if (exemptResult) return exemptResult;

  try {
    const truncatedContent = this.buildTruncatedContent(url, content);
    const providers = this.providerCache ?? getAllProviders(this.pspConfig!);

    if (providers.length === 0) {
      logger.warn('No PSP providers available for detection');
      return PSPDetectionResult.error(
        new Error('No PSP providers configured'),
        'config_validation',
      );
    }

    const matches = this.collectAllMatches(providers, truncatedContent);

    if (matches.length === 0) {
      return PSPDetectionResult.none(providers.length);
    }

    logger.info(`Detected ${matches.length} PSP(s):`, matches.map(m => m.psp));
    return PSPDetectionResult.detected(matches);
  } catch (error) {
    logger.error('Error during PSP detection:', error);
    return PSPDetectionResult.error(
      error instanceof Error ? error : new Error('Unknown detection error'),
      'detection_process',
    );
  }
}

private collectAllMatches(
  providers: ReturnType<typeof getAllProviders>,
  content: string,
): PSPMatch[] {
  const matched = new Set<string>();
  const results: PSPMatch[] = [];

  // Phase 1: matchStrings (provider order preserved)
  for (const psp of providers) {
    if (matched.has(psp.name) || !psp.matchStrings?.length) continue;
    for (const matchString of psp.matchStrings) {
      if (content.includes(matchString)) {
        results.push({
          psp: psp.name,
          detectionInfo: { method: 'matchString', value: matchString },
        });
        matched.add(psp.name);
        break;
      }
    }
  }

  // Phase 2: regex (only for PSPs not already matched)
  for (const psp of providers) {
    if (matched.has(psp.name)) continue;
    try {
      if (psp.compiledRegex?.test(content)) {
        results.push({
          psp: psp.name,
          detectionInfo: {
            method: 'regex',
            value: psp.regex ?? 'unknown',
          },
        });
        matched.add(psp.name);
      }
    } catch (regexError) {
      logger.warn(`Regex test failed for PSP ${psp.name}:`, regexError);
    }
  }

  return results;
}
```

Remove the old `detectByMatchStrings` and `detectByRegex` methods.

**Step 4: Run tests**

```bash
npm test -- --testPathPattern="psp-detector"
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/psp-detector.ts src/services/psp-detector.test.ts
git commit -m "feat(detector): collect all matching PSPs instead of first-match-wins"
```

---

## Phase 3 — Content Script: Source Tagging + Multi-PSP Reporting

### Task 4: Refactor `collectScanSources()` and add source type tagging

**Files:**
- Modify: `src/content.ts`

**Step 1: Define `ScanSources` type locally in content.ts**

At the top of `src/content.ts`, add:

```typescript
interface ScanSources {
  scriptSrcs: string[];
  iframeSrcs: string[];
  formActions: string[];
  linkHrefs: string[];
}
```

**Step 2: Replace `collectScanSources()` implementation**

```typescript
private collectScanSources(): ScanSources {
  const scriptSrcs: string[] = [];
  const iframeSrcs: string[] = [];
  const formActions: string[] = [];
  const linkHrefs: string[] = [];

  document.querySelectorAll(
    'script[src], iframe[src], form[action], link[href]',
  ).forEach((element) => {
    switch (element.tagName) {
    case 'SCRIPT': {
      const src = (element as HTMLScriptElement).src;
      if (src) scriptSrcs.push(src);
      break;
    }
    case 'IFRAME': {
      const src = (element as HTMLIFrameElement).src;
      if (src) iframeSrcs.push(src);
      break;
    }
    case 'FORM': {
      const action = (element as HTMLFormElement).action;
      if (action) formActions.push(action);
      break;
    }
    case 'LINK': {
      const href = (element as HTMLLinkElement).href;
      if (href) linkHrefs.push(href);
      break;
    }
    default:
      break;
    }
  });

  return { scriptSrcs, iframeSrcs, formActions, linkHrefs };
}
```

**Step 3: Add `determineSourceType()` helper**

```typescript
private determineSourceType(
  value: string,
  sources: ScanSources,
): import('./types').SourceType {
  if (sources.scriptSrcs.some(s => s.includes(value))) return 'scriptSrc';
  if (sources.iframeSrcs.some(s => s.includes(value))) return 'iframeSrc';
  if (sources.formActions.some(s => s.includes(value))) return 'formAction';
  if (sources.linkHrefs.some(s => s.includes(value))) return 'linkHref';
  return 'pageUrl';
}
```

**Step 4: Update `detectPSP()` in ContentScript**

```typescript
private async detectPSP(): Promise<void> {
  const now = Date.now();
  if (now - this.lastDetectionTime < this.detectionCooldown) {
    logger.debug('Detection skipped - cooldown active');
    return;
  }
  this.lastDetectionTime = now;

  if (this.pspDetected || !this.pspDetector.isInitialized()) return;

  const url = TypeConverters.toURL(document.URL);
  if (!url) {
    logger.warn('Invalid URL for PSP detection:', document.URL);
    return;
  }

  const sources = this.collectScanSources();
  const iframeContent = await this.getIframeContent();

  const scanContent = [
    document.URL,
    ...sources.scriptSrcs,
    ...sources.iframeSrcs,
    ...sources.formActions,
    ...sources.linkHrefs,
    ...iframeContent,
  ].join('\n');

  const result = this.pspDetector.detectPSP(url, scanContent);

  switch (result.type) {
  case 'detected':
    for (const match of result.psps) {
      const sourceType = match.detectionInfo
        ? this.determineSourceType(match.detectionInfo.value, sources)
        : 'pageUrl';
      const taggedMatch = {
        ...match,
        detectionInfo: match.detectionInfo
          ? { ...match.detectionInfo, sourceType }
          : undefined,
      };
      await this.handlePSPMatch(taggedMatch);
    }
    break;
  case 'exempt':
    await this.handlePSPDetection(result);
    break;
  case 'none':
    break;
  case 'error':
    logger.error('PSP detection error:', result.error);
    break;
  }
}
```

**Step 5: Add `handlePSPMatch()` for individual PSP matches**

```typescript
private async handlePSPMatch(
  match: import('./types').PSPMatch,
): Promise<void> {
  if (this.reportedPSPs.has(match.psp)) {
    logger.debug(`PSP ${match.psp} already reported, skipping`);
    return;
  }
  this.reportedPSPs.add(match.psp);

  const tabId = await this.getActiveTabId();
  if (tabId) {
    await this.reportDetectionToBackground(tabId, match.psp, match);
  }

  this.pspDetected = true;
  this.domObserver.stopObserving();
}
```

**Step 6: Update `reportDetectionToBackground()`**

```typescript
private async reportDetectionToBackground(
  tabId: ReturnType<typeof TypeConverters.toTabId>,
  pspName: string,
  match: import('./types').PSPMatch,
): Promise<void> {
  logger.debug(`Content: Sending PSP detection - PSP: ${pspName}`);
  await this.sendMessage({
    action: MessageAction.DETECT_PSP,
    data: {
      psp: TypeConverters.toPSPName(pspName),
      tabId,
      detectionInfo: match.detectionInfo,
      url: undefined,
    },
  });
}
```

**Step 7: Typecheck**

```bash
npm run typecheck
```

Fix any type errors.

**Step 8: Commit**

```bash
git add src/content.ts
git commit -m "feat(content): structured scan sources and source type tagging"
```

---

## Phase 4 — Background: Multi-PSP Storage + History Writing

### Task 5: Update background to store multiple PSPs per tab

**Files:**
- Modify: `src/types/messages.ts`
- Modify: `src/background.ts`

**Step 1: Update `PSPDetectionData` to include sourceType**

In `src/types/messages.ts`:

```typescript
export interface PSPDetectionData {
  psp?: PSPName;
  tabId?: TabId;
  detectionInfo?: {
    method: 'matchString' | 'regex';
    value: string;
    sourceType?: import('./detection').SourceType;
  };
  url?: string;
}
```

**Step 2: Add `StoredTabPsp` interface near the top of `src/background.ts`**

```typescript
interface StoredTabPsp {
  psp: string;
  detectionInfo?: {
    method: 'matchString' | 'regex';
    value: string;
    sourceType?: string;
  };
}
```

**Step 3: Switch `TAB_PSPS` to `chrome.storage.session`**

Tab PSP state is session-scoped (cleared on browser close). History is local (persists). Update all `TAB_PSPS` reads/writes from `storage.local` to `storage.session`.

**Step 4: Update `handleDetectPsp()` to append per-tab PSPs without overwriting**

Find the existing `handleDetectPsp` (or equivalent) in `src/background.ts` and replace the single-PSP storage logic:

```typescript
private async handleDetectPsp(
  data: PSPDetectionData,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = data.tabId ?? sender.tab?.id;
  if (!tabId || !data.psp) return;

  const stored = await chrome.storage.session.get(STORAGE_KEYS.TAB_PSPS);
  const tabPsps: Record<number, StoredTabPsp[]> =
    (stored[STORAGE_KEYS.TAB_PSPS] as Record<number, StoredTabPsp[]> | undefined) ?? {};

  const existing: StoredTabPsp[] = tabPsps[tabId] ?? [];
  if (existing.some(p => p.psp === data.psp)) return; // deduplicate

  const entry: StoredTabPsp = {
    psp: data.psp,
    ...(data.detectionInfo !== undefined && { detectionInfo: data.detectionInfo }),
  };

  tabPsps[tabId] = [...existing, entry];
  await chrome.storage.session.set({ [STORAGE_KEYS.TAB_PSPS]: tabPsps });
  await this.updateTabIcon(tabId, data.psp);
}
```

**Step 5: Typecheck + build**

```bash
npm run typecheck && npm run build
```

**Step 6: Commit**

```bash
git add src/types/messages.ts src/background.ts
git commit -m "feat(background): store multiple PSPs per tab using storage.session"
```

---

### Task 6: Write history entries to `chrome.storage.local`

**Files:**
- Create: `src/lib/history.ts`
- Create: `src/lib/history.test.ts`
- Modify: `src/background.ts`

**Step 1: Write the unit tests**

Create `src/lib/history.test.ts`:

```typescript
import { STORAGE_KEYS } from './storage-keys';
import { HISTORY_MAX_ENTRIES } from '../types/history';

const storedData: Record<string, unknown> = {};

beforeEach(() => {
  storedData[STORAGE_KEYS.PSP_HISTORY] = [];
});

// Mock chrome.storage.local before importing the module
jest.mock('../lib/history', () => {
  // Actual implementation is tested here by providing chrome mock in setup
});

// Instead, mock chrome globally:
(globalThis as any).chrome = {
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

import { writeHistoryEntry, readHistory, clearHistory } from './history';
import type { HistoryEntry } from '../types/history';

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'tab1_1000',
  domain: 'example.com',
  url: 'https://example.com/checkout',
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
    await writeHistoryEntry(makeEntry({ id: 'b', timestamp: 2 }));
    const h = await readHistory();
    expect(h[0]?.id).toBe('b');
    expect(h[1]?.id).toBe('a');
  });

  it('caps at HISTORY_MAX_ENTRIES and drops oldest', async () => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = Array.from(
      { length: HISTORY_MAX_ENTRIES },
      (_, i) => makeEntry({ id: `old_${i}`, timestamp: i }),
    );
    await writeHistoryEntry(makeEntry({ id: 'new', timestamp: 9999 }));
    const h = await readHistory();
    expect(h).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(h[0]?.id).toBe('new');
  });
});

describe('clearHistory', () => {
  it('empties the history', async () => {
    storedData[STORAGE_KEYS.PSP_HISTORY] = [makeEntry()];
    await clearHistory();
    expect(await readHistory()).toEqual([]);
  });
});
```

**Step 2: Run tests to see them fail**

```bash
npm test -- --testPathPattern="history"
```

**Step 3: Create `src/lib/history.ts`**

```typescript
import type { HistoryEntry } from '../types/history';
import { HISTORY_MAX_ENTRIES } from '../types/history';
import { STORAGE_KEYS } from './storage-keys';
import { logger } from './utils';

export async function readHistory(): Promise<HistoryEntry[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PSP_HISTORY);
  const raw = data[STORAGE_KEYS.PSP_HISTORY];
  return Array.isArray(raw) ? (raw as HistoryEntry[]) : [];
}

export async function writeHistoryEntry(
  entry: HistoryEntry,
): Promise<void> {
  try {
    const history = await readHistory();
    const updated = [entry, ...history].slice(0, HISTORY_MAX_ENTRIES);
    await chrome.storage.local.set({
      [STORAGE_KEYS.PSP_HISTORY]: updated,
    });
  } catch (err) {
    logger.warn('History write failed, attempting eviction:', err);
    try {
      const history = await readHistory();
      const trimmed = history.slice(0, HISTORY_MAX_ENTRIES - 101);
      await chrome.storage.local.set({
        [STORAGE_KEYS.PSP_HISTORY]: [entry, ...trimmed],
      });
    } catch (retryErr) {
      logger.error('History write failed after eviction:', retryErr);
    }
  }
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.PSP_HISTORY]: [] });
}
```

**Step 4: Wire `writeHistoryEntry` into `handleDetectPsp()` in background**

```typescript
import { writeHistoryEntry } from './lib/history';
import type { HistoryEntry } from './types/history';

// After tabPsps update in handleDetectPsp():
if (data.psp && data.psp !== PSP_DETECTION_EXEMPT && data.detectionInfo) {
  const domain = this.getDomainFromSender(sender);
  const historyEntry: HistoryEntry = {
    id: `${tabId}_${Date.now()}`,
    domain,
    url: sender.tab?.url ?? '',
    timestamp: Date.now(),
    psps: [{
      name: data.psp,
      method: data.detectionInfo.method,
      value: data.detectionInfo.value,
      sourceType: data.detectionInfo.sourceType ?? 'pageUrl',
    }],
  };
  await writeHistoryEntry(historyEntry);
}

private getDomainFromSender(
  sender: chrome.runtime.MessageSender,
): string {
  try {
    return new URL(sender.tab?.url ?? '').hostname;
  } catch {
    return sender.tab?.url ?? 'unknown';
  }
}
```

**Step 5: Run tests**

```bash
npm test -- --testPathPattern="history"
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/history.ts src/lib/history.test.ts src/background.ts
git commit -m "feat(history): persist detection history to chrome.storage.local"
```

---

### Task 7: Add optional `webRequest` network scanning

**Files:**
- Modify: `assets/manifest.json`
- Modify: `src/background.ts`

**Step 1: Add optional permission to manifest**

In `assets/manifest.json`, add:

```json
"optional_permissions": ["webRequest"]
```

The existing `host_permissions: ["https://*/*"]` already covers the hosts needed — no change required there.

**Step 2: Add `setupWebRequestListener()` to BackgroundService**

```typescript
private setupWebRequestListener(): void {
  if (!chrome.webRequest?.onBeforeRequest) return;

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      this.handleNetworkRequest(details).catch((err) => {
        logger.warn('webRequest handler error:', err);
      });
    },
    { urls: ['https://*/*'] },
  );
  logger.info('webRequest listener registered');
}

private async handleNetworkRequest(
  details: chrome.webRequest.WebRequestBodyDetails,
): Promise<void> {
  const { tabId, url } = details;
  if (tabId < 0) return; // ignore background requests

  const config = this.inMemoryPspConfig;
  if (!config) return;

  const allProviders = getAllProviders(config);
  for (const psp of allProviders) {
    if (!psp.matchStrings?.length) continue;
    for (const matchString of psp.matchStrings) {
      if (url.includes(matchString)) {
        logger.info(`Network request matched ${psp.name}: ${url}`);
        await this.handleDetectPsp(
          {
            psp: psp.name as any,
            tabId: tabId as any,
            detectionInfo: {
              method: 'matchString',
              value: matchString,
              sourceType: 'networkRequest',
            },
          },
          { tab: { id: tabId, url } } as any,
        );
        return; // one match per request is sufficient
      }
    }
  }
}
```

**Step 3: Register the listener conditionally in `initializeServiceWorker()`**

```typescript
const perms = await chrome.permissions.getAll();
if (perms.permissions?.includes('webRequest')) {
  this.setupWebRequestListener();
}

chrome.permissions.onAdded?.addListener((permissions) => {
  if (permissions.permissions?.includes('webRequest')) {
    this.setupWebRequestListener();
  }
});
```

**Step 4: Build and verify**

```bash
npm run build
```

Load in Chrome → visit a Stripe page → verify existing DOM detection still works.

**Step 5: Commit**

```bash
git add assets/manifest.json src/background.ts
git commit -m "feat(network): optional webRequest listener for dynamic PSP detection"
```

---

## Phase 5 — Popup: Display Multiple PSPs + Evidence

### Task 8: Update popup to render all detected PSPs

**Files:**
- Modify: `src/background.ts` (GET_PSP handler)
- Modify: `src/types/messages.ts`
- Modify: `src/popup.ts`
- Modify: `src/services/ui.ts`
- Modify: `public/popup.html`

**Step 1: Update `GET_PSP` handler in background to return all tab PSPs**

```typescript
case MessageAction.GET_PSP: {
  const stored = await chrome.storage.session.get(STORAGE_KEYS.TAB_PSPS);
  const tabPsps: Record<number, StoredTabPsp[]> =
    (stored[STORAGE_KEYS.TAB_PSPS] as Record<number, StoredTabPsp[]> | undefined) ?? {};
  const tabId = await this.getActiveTabId();
  const psps: StoredTabPsp[] = tabId !== null ? (tabPsps[tabId] ?? []) : [];
  sendResponse({ psps });
  break;
}
```

**Step 2: Update `PSPResponse` in `src/types/messages.ts`**

```typescript
export interface PSPResponse {
  psps: StoredTabPsp[];
}
```

**Step 3: Add evidence section to `public/popup.html`**

Within the existing PSP info section, add after the PSP name element:

```html
<p id="detectionEvidence" class="detection-evidence"></p>
```

Add CSS:

```css
.detection-evidence {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: monospace;
  margin: 4px 0 0;
}
.psp-list { display: flex; flex-direction: column; gap: 12px; }
```

**Step 4: Update `src/services/ui.ts` to render multiple PSPs**

Add a method that creates one info card per PSP using safe DOM methods (no innerHTML with user data):

```typescript
public renderMultiplePSPs(
  psps: StoredTabPsp[],
  config: PSPConfig,
): void {
  const container = this.elements.pspInfo; // existing container element
  if (!container) return;

  // Clear existing content safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (psps.length === 0) {
    this.showNoPspState();
    return;
  }

  const list = document.createElement('div');
  list.className = 'psp-list';

  for (const storedPsp of psps) {
    const pspConfig = this.findPspConfig(storedPsp.psp, config);
    const card = this.buildPspCard(storedPsp, pspConfig);
    list.appendChild(card);
  }

  container.appendChild(list);
  this.showDetectedState();
}

private buildPspCard(
  stored: StoredTabPsp,
  config: PSP | undefined,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'psp-card';

  if (config?.image) {
    const img = document.createElement('img');
    img.src = `images/${config.image}_48.png`;
    img.alt = stored.psp;
    img.className = 'psp-logo';
    card.appendChild(img);
  }

  const name = document.createElement('p');
  name.className = 'psp-name';
  name.textContent = stored.psp; // textContent is safe
  card.appendChild(name);

  if (stored.detectionInfo) {
    const evidence = document.createElement('p');
    evidence.className = 'detection-evidence';
    // All values here are from our own detection engine, not from the page
    const { value, sourceType } = stored.detectionInfo;
    evidence.textContent = `${value} · ${sourceType ?? 'unknown'}`;
    card.appendChild(evidence);
  }

  return card;
}
```

**Step 5: Update `src/popup.ts` to use `renderMultiplePSPs`**

Replace the existing single-PSP render call with:

```typescript
const response = await chrome.runtime.sendMessage({ action: MessageAction.GET_PSP });
const { psps } = response as PSPResponse;

if (psps.length > 0) {
  uiService.renderMultiplePSPs(psps, pspConfig);
} else {
  uiService.showNoPspState();
}
```

**Step 6: Typecheck + build**

```bash
npm run typecheck && npm run build
```

**Step 7: Commit**

```bash
git add src/popup.ts src/services/ui.ts public/popup.html src/types/messages.ts src/background.ts
git commit -m "feat(popup): display all detected PSPs with source evidence"
```

---

## Phase 6 — Options Page: History UI

### Task 9: Create `public/options.html`

**Files:**
- Create: `public/options.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PSP Detector — History</title>
    <style>
      :root {
        --bg: #ffffff;
        --surface: #f9fafb;
        --border: #e5e7eb;
        --text: #111827;
        --text-secondary: #6b7280;
        --accent: #2563eb;
        --danger: #dc2626;
        font-family: system-ui, -apple-system, sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #111827;
          --surface: #1f2937;
          --border: #374151;
          --text: #f9fafb;
          --text-secondary: #9ca3af;
          --accent: #60a5fa;
          --danger: #f87171;
        }
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        background: var(--bg);
        color: var(--text);
        padding: 24px;
        min-height: 100vh;
      }
      h1 { font-size: 20px; font-weight: 600; margin-bottom: 16px; }
      .stats {
        font-size: 13px;
        color: var(--text-secondary);
        margin-bottom: 20px;
      }
      .controls {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      input[type="search"] {
        flex: 1;
        min-width: 200px;
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--surface);
        color: var(--text);
        font-size: 13px;
      }
      select {
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--surface);
        color: var(--text);
        font-size: 13px;
      }
      button {
        padding: 6px 14px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--surface);
        color: var(--text);
        font-size: 13px;
        cursor: pointer;
      }
      button:hover { background: var(--border); }
      button.danger { color: var(--danger); border-color: var(--danger); }
      .table-wrap { overflow-x: auto; }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th {
        text-align: left;
        padding: 8px 12px;
        border-bottom: 2px solid var(--border);
        color: var(--text-secondary);
        font-weight: 600;
        white-space: nowrap;
      }
      td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--border);
        vertical-align: top;
      }
      tr:hover td { background: var(--surface); }
      code {
        font-size: 11px;
        color: var(--text-secondary);
      }
      .empty {
        text-align: center;
        color: var(--text-secondary);
        padding: 48px;
      }
      .actions {
        display: flex;
        gap: 8px;
        margin-top: 20px;
        justify-content: flex-end;
      }
    </style>
  </head>
  <body>
    <h1>PSP Detector — History</h1>
    <p class="stats" id="stats">Loading…</p>

    <div class="controls">
      <input
        type="search"
        id="search"
        placeholder="Search domains or PSPs…"
        autocomplete="off"
      />
      <select id="pspFilter">
        <option value="">All PSPs</option>
      </select>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date / Time</th>
            <th>Domain</th>
            <th>PSP(s)</th>
            <th>Via</th>
          </tr>
        </thead>
        <tbody id="historyBody"></tbody>
      </table>
      <p class="empty" id="emptyState" hidden>No history yet.</p>
    </div>

    <div class="actions">
      <button id="exportBtn">Export CSV</button>
      <button class="danger" id="clearBtn">Clear History</button>
    </div>

    <script src="options.js"></script>
  </body>
</html>
```

**Step 2: Commit**

```bash
git add public/options.html
git commit -m "feat(options): add history page HTML"
```

---

### Task 10: Create `src/options.ts`

**Files:**
- Create: `src/options.ts`
- Create: `src/options.test.ts`

**Step 1: Write tests for the pure functions**

Create `src/options.test.ts`:

```typescript
import {
  formatDate,
  buildCSV,
  filterEntries,
} from './options';
import type { HistoryEntry } from './types/history';

const entry: HistoryEntry = {
  id: 'tab1_1000',
  domain: 'example.com',
  url: 'https://example.com/checkout',
  timestamp: new Date('2026-02-22T10:30:00Z').getTime(),
  psps: [
    {
      name: 'Stripe',
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
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Date');
    expect(lines[0]).toContain('Domain');
    expect(lines[1]).toContain('example.com');
    expect(lines[1]).toContain('Stripe');
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
    expect(csv.split('\n')).toHaveLength(1);
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
});
```

**Step 2: Run to see them fail**

```bash
npm test -- --testPathPattern="options"
```

**Step 3: Implement `src/options.ts`**

All DOM manipulation uses `textContent` and `createElement` — never `innerHTML` with user-supplied data:

```typescript
import type { HistoryEntry } from './types/history';
import { clearHistory, readHistory } from './lib/history';

// ── Pure helpers (exported for testing) ──────────────────────────────

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildCSV(entries: HistoryEntry[]): string {
  const escape = (v: string): string => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const header = 'Date,Domain,URL,PSP Names,Source Types,Detection Values';
  if (entries.length === 0) return header;

  const rows = entries.map((e) => {
    const names = e.psps.map(p => p.name).join('; ');
    const sources = e.psps.map(p => p.sourceType).join('; ');
    const values = e.psps.map(p => p.value).join('; ');
    return [
      escape(new Date(e.timestamp).toISOString()),
      escape(e.domain),
      escape(e.url),
      escape(names),
      escape(sources),
      escape(values),
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

export function filterEntries(
  entries: HistoryEntry[],
  query: string,
  pspFilter: string,
): HistoryEntry[] {
  const q = query.toLowerCase();
  return entries.filter((entry) => {
    const pspNames = entry.psps.map(p => p.name);
    if (pspFilter && !pspNames.includes(pspFilter)) return false;
    if (!q) return true;
    if (entry.domain.toLowerCase().includes(q)) return true;
    if (pspNames.some(n => n.toLowerCase().includes(q))) return true;
    return false;
  });
}

// ── DOM helpers ───────────────────────────────────────────────────────

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ── Rendering ─────────────────────────────────────────────────────────

function renderStats(history: HistoryEntry[]): void {
  const uniqueDomains = new Set(history.map(e => e.domain)).size;
  const pspCounts = new Map<string, number>();
  for (const entry of history) {
    for (const psp of entry.psps) {
      pspCounts.set(psp.name, (pspCounts.get(psp.name) ?? 0) + 1);
    }
  }
  const topPsp = [...pspCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const summary =
    `${uniqueDomains} sites scanned · ` +
    `${pspCounts.size} unique PSPs` +
    (topPsp !== undefined ? ` · Top: ${topPsp[0]}` : '');
  setText('stats', summary);
}

function populatePspFilter(history: HistoryEntry[]): void {
  const select = document.getElementById('pspFilter') as HTMLSelectElement | null;
  if (!select) return;
  const names = [...new Set(history.flatMap(e => e.psps.map(p => p.name)))].sort();
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name; // textContent is safe
    select.appendChild(opt);
  }
}

function renderTable(entries: HistoryEntry[]): void {
  const tbody = document.getElementById('historyBody');
  const emptyState = document.getElementById('emptyState');
  if (!tbody || !emptyState) return;

  // Clear safely
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  if (entries.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  for (const entry of entries) {
    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = formatDate(entry.timestamp);

    const tdDomain = document.createElement('td');
    tdDomain.textContent = entry.domain; // textContent is safe

    const tdPsps = document.createElement('td');
    tdPsps.textContent = entry.psps.map(p => p.name).join(', ');

    const tdVia = document.createElement('td');
    for (const [i, psp] of entry.psps.entries()) {
      if (i > 0) tdVia.appendChild(document.createTextNode(', '));
      const code = document.createElement('code');
      code.textContent = psp.sourceType; // SourceType is an enum, safe
      tdVia.appendChild(code);
    }

    tr.appendChild(tdDate);
    tr.appendChild(tdDomain);
    tr.appendChild(tdPsps);
    tr.appendChild(tdVia);
    tbody.appendChild(tr);
  }
}

// ── Event bindings ────────────────────────────────────────────────────

function bindControls(allHistory: HistoryEntry[]): void {
  const search = document.getElementById('search') as HTMLInputElement | null;
  const pspFilter = document.getElementById('pspFilter') as HTMLSelectElement | null;

  const refresh = (): void => {
    const filtered = filterEntries(
      allHistory,
      search?.value ?? '',
      pspFilter?.value ?? '',
    );
    renderTable(filtered);
  };

  search?.addEventListener('input', refresh);
  pspFilter?.addEventListener('change', refresh);

  document.getElementById('exportBtn')?.addEventListener('click', () => {
    const filtered = filterEntries(
      allHistory,
      search?.value ?? '',
      pspFilter?.value ?? '',
    );
    const csv = buildCSV(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psp-history-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('clearBtn')?.addEventListener('click', () => {
    if (!confirm('Clear all PSP detection history? This cannot be undone.')) return;
    clearHistory()
      .then(() => {
        allHistory.length = 0;
        renderStats([]);
        renderTable([]);
      })
      .catch(console.error);
  });
}

// ── Init ──────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const history = await readHistory();
  renderStats(history);
  populatePspFilter(history);
  renderTable(history);
  bindControls(history);
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
});
```

**Step 4: Run tests**

```bash
npm test -- --testPathPattern="options"
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/options.ts src/options.test.ts
git commit -m "feat(options): history table with search, filter, CSV export, and clear"
```

---

### Task 11: Wire options page into manifest and build

**Files:**
- Modify: `assets/manifest.json`
- Modify: `build.mjs`

**Step 1: Add `options_page` to manifest**

```json
"options_page": "options.html"
```

**Step 2: Add `options.ts` entry point to `build.mjs`**

Find the `mainEntryPoints` array and add:

```javascript
'src/options.ts',
```

Verify the existing `public/` copy step also copies `options.html` to `dist/` (it should — check that the copy glob covers all HTML files in `public/`).

**Step 3: Build and verify**

```bash
npm run build
ls dist/options.*
```

Expected: `dist/options.html` and `dist/options.js` both present.

**Step 4: Test manually**

Load extension → right-click icon → "Options" → history page loads.

**Step 5: Commit**

```bash
git add assets/manifest.json build.mjs
git commit -m "feat(options): wire options page into manifest and build"
```

---

## Phase 7 — Quality Gates

### Task 12: TypeScript strictness + ESLint rules

**Files:**
- Modify: `tsconfig.json`
- Modify: `eslint.config.mjs`

**Step 1: Check existing tsconfig flags**

```bash
grep -E "noUncheckedIndexedAccess|exactOptionalPropertyTypes" tsconfig.json
```

If missing, add to `compilerOptions`:

```json
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true
```

**Step 2: Run typecheck to surface new errors**

```bash
npm run typecheck
```

Common fixes with `noUncheckedIndexedAccess`:
- `array[0]` → `array[0] ?? fallback` or add a null check
- `map.get(key)!` → `map.get(key) ?? defaultValue`

Fix all new errors in new files. For existing files, fix or suppress with an explanatory comment.

**Step 3: Add ESLint rules to `eslint.config.mjs`**

In the TypeScript rules object, add:

```javascript
'@typescript-eslint/no-explicit-any': 'error',
'@typescript-eslint/consistent-type-imports': [
  'error',
  { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
],
'@typescript-eslint/switch-exhaustiveness-check': 'error',
```

**Step 4: Run lint and fix**

```bash
npm run lint:fix
npm run lint
```

**Step 5: Commit**

```bash
git add tsconfig.json eslint.config.mjs src/
git commit -m "chore(quality): stricter TypeScript flags and ESLint rules"
```

---

### Task 13: Jest coverage thresholds + Knip

**Files:**
- Modify: `jest.config.js`
- Modify: `package.json`
- Create: `knip.json`

**Step 1: Add coverage thresholds to `jest.config.js`**

```javascript
coverageThreshold: {
  './src/lib/history.ts': { lines: 80, functions: 80, branches: 70 },
  './src/options.ts': { lines: 80, functions: 80 },
  './src/services/psp-detector.ts': { lines: 80, functions: 80 },
},
```

**Step 2: Add coverage script to `package.json`**

```json
"test:coverage": "jest --coverage"
```

**Step 3: Run and verify thresholds**

```bash
npm run test:coverage
```

Fix any files below threshold by adding missing test cases.

**Step 4: Create `knip.json`**

```json
{
  "$schema": "https://unpkg.com/knip@latest/schema.json",
  "entry": [
    "src/background.ts",
    "src/content.ts",
    "src/popup.ts",
    "src/options.ts",
    "build.mjs"
  ],
  "project": ["src/**/*.ts", "build.mjs"],
  "ignore": ["src/**/*.test.ts", "tests/**"]
}
```

**Step 5: Run Knip and triage**

```bash
npx knip
```

Add false-positive paths to `ignore`. Fix genuine unused exports.

**Step 6: Commit**

```bash
git add jest.config.js package.json knip.json
git commit -m "chore(quality): Jest coverage thresholds and Knip dead-code detection"
```

---

### Task 14: Add Semgrep + OSV-Scanner + permissions-audit to CI

**Files:**
- Modify: `.github/workflows/` (existing PR workflow)
- Create: `.github/workflows/osv-scanner.yml`

**Step 1: Run Semgrep locally first**

```bash
pip install semgrep
semgrep scan --config=p/javascript --config=p/security-audit .
```

Review findings. Fix real issues (especially any postMessage origin validation). Add `# nosemgrep: rule-id` for confirmed false positives with a comment.

**Step 2: Add Semgrep step to the existing PR validation workflow**

```yaml
- name: Semgrep
  run: |
    pip install semgrep --quiet
    semgrep scan \
      --config=p/javascript \
      --config=p/security-audit \
      --error \
      --quiet
```

**Step 3: Create `.github/workflows/osv-scanner.yml`**

```yaml
name: OSV-Scanner

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 9 * * 1'  # 09:00 UTC every Monday
  workflow_dispatch:

permissions:
  security-events: write
  contents: read

jobs:
  osv-scan:
    uses: >-
      google/osv-scanner-action/.github/workflows/
      osv-scanner-scheduled-scan.yml@v2.3.3
    with:
      scan-args: |-
        --lockfile=package-lock.json
    permissions:
      security-events: write
      contents: read
```

**Step 4: Add permissions-audit step to PR workflow**

```yaml
- name: Permissions audit
  run: |
    node --input-type=module <<'EOF'
    import { readFileSync } from 'fs';
    const manifest = JSON.parse(
      readFileSync('assets/manifest.json', 'utf8')
    );
    const perms = [
      ...(manifest.permissions ?? []),
      ...(manifest.host_permissions ?? []),
    ];
    const broad = perms.filter(
      p => p === '<all_urls>' || p === '*://*/*'
    );
    if (broad.length > 0) {
      console.error('Broad permissions detected:', broad);
      process.exit(1);
    }
    console.log('Permissions OK:', perms.join(', '));
    EOF
```

**Step 5: Run full validation**

```bash
npm run validate
```

All checks must pass.

**Step 6: Final commit**

```bash
git add .github/workflows/
git commit -m "chore(ci): Semgrep, OSV-Scanner, and permissions audit"
```

---

## Final Validation Checklist

Before calling this complete:

- [ ] `npm run validate` passes (lint + typecheck + build + test)
- [ ] `npm run test:coverage` meets all thresholds
- [ ] `npx knip` shows no unexpected unused exports
- [ ] Extension loads in Chrome from `dist/` with no console errors
- [ ] Visit a Stripe page → popup shows "Stripe · matched js.stripe.com · scriptSrc"
- [ ] Visit a page with two payment providers → popup shows both
- [ ] Open options page → history table shows past detections
- [ ] Export CSV → file downloads with correct RFC 4180 content
- [ ] Clear history → table empties immediately
- [ ] Search "stripe" → table filters correctly
- [ ] Filter dropdown shows all detected PSP names
- [ ] Grant `webRequest` optional permission → dynamic PSP script load is detected
- [ ] Dark mode: options page and popup respect `prefers-color-scheme`
- [ ] CI workflow passes on a clean branch
