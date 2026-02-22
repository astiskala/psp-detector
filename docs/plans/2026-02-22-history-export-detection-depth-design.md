# Design: History & Export + Detection Depth

**Date:** 2026-02-22
**Status:** Approved
**Audience:** Payment consultants / analysts (primary), developers / engineers (secondary)

---

## Overview

Two parallel tracks of improvement:

- **Track A — History & Export:** Give the extension memory. Persist every detection to local storage, surface it in a searchable/filterable options page, and allow one-click CSV export for offline analysis.
- **Track B — Detection Depth:** Make detection smarter. Collect all matching providers per page (not just the first), show what signal triggered each match, and add network request scanning for SPAs and dynamically loaded payment SDKs.

Everything is local. No server, no remote calls, no telemetry.

---

## Goals

- Turn the extension from a one-shot lookup tool into a research asset that compounds value over time
- Surface multi-PSP co-existence (common with orchestrators layered over PSPs)
- Give analysts and developers the evidence behind each detection, not just the result
- Catch PSPs that load dynamically via XHR/fetch (SPAs, lazy-loaded checkouts)
- Ship zero new installation warnings (all broad permissions are optional)
- Work across all Chromium-based browsers: Chrome, Edge, Brave, Opera

---

## Non-Goals

- No server-side component of any kind
- No confidence scoring
- No bulk URL scanner (future track)
- No side panel (future track)
- No Firefox support
- No migration to WXT or Plasmo

---

## Architecture

### Overview

```
Track B (detection layer)         Track A (history + UI layer)
──────────────────────────        ──────────────────────────────────
psp-detector.ts                   background.ts
  · collect ALL matches             · write HistoryEntry on detection
  · return PSPDetectionResult[]     · enforce 1,000-entry cap (LRU)
  · tag sourceType per match        · chrome.storage.local for persistence
                                    · chrome.storage.session for hot cache
chrome.webRequest (optional)
  · non-blocking URL observation    options.ts + options.html
  · optional_permission             · searchable/filterable history table
  · catches dynamically-loaded        · stats strip
    payment SDKs                    · CSV export via Blob URL
                                    · clear history
```

### Communication

The existing `chrome.runtime.sendMessage` / `chrome.runtime.onMessage` pattern is retained. The background service worker returns `PSPDetectionResult[]` (JSON array) — well within the 64 MiB message size cap. The popup receives the array and renders all detected providers.

Long-lived `chrome.runtime.connect()` ports are not needed for this feature set; single-shot messaging is sufficient.

### Service Worker State

The service worker can be killed after 30 seconds of inactivity. All state is treated as volatile:

- **`chrome.storage.session`** — hot cache for active-session data (e.g. which tabs have been scanned). Survives SW restarts within a browser session. 10 MB limit.
- **`chrome.storage.local`** — persistent history store. Survives browser restarts. 10 MB limit.

Globals are never used for state. The SW re-initialises from storage on every cold start via an `ensureInit()` guard.

---

## Track B: Detection Changes

### Multi-PSP Detection

`detectPSP()` in `src/services/psp-detector.ts` currently returns on first match. It will be changed to collect **all** matches across all providers, returning `PSPDetectionResult[]`.

Ordering is preserved: matches earlier in `psps.json` rank first (existing priority semantics unchanged). Deduplication: if the same provider matches via multiple source types, it appears once with the first match's evidence.

### Detection Evidence

Each result already carries `detectionMethod` (`matchString` | `regex`) and `detectionValue` (the matched string or pattern). A new field `sourceType` is added:

```typescript
type SourceType =
  | 'scriptSrc'
  | 'iframeSrc'
  | 'formAction'
  | 'linkHref'
  | 'networkRequest'
  | 'pageUrl';
```

The popup surfaces this as e.g. *"matched `js.stripe.com` in script src"*.

### Network Request Scanning

Implemented via `chrome.webRequest` (non-blocking observation) in the background service worker — **not** via main-world fetch/XHR patching. Rationale:

- `webRequest` runs outside the page context and cannot be subverted by the page
- We only need request URLs, not response bodies — `webRequest` covers this fully
- Avoids the `window.postMessage` attack surface entirely (the Spaceraccoon 2024 research demonstrated real-world exploitation of page→content-script postMessage chains)

`webRequest` is declared as an `optional_permission`. Users grant it when they enable network scanning. This keeps the default install warning-free.

If main-world injection is ever needed in future, use `files: ['injected/scanner.js']` (a bundled file), never an inline `func` — pages with strict `script-src 'self'` CSP will block inline injection.

### Permissions (Revised)

```json
{
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": [],
  "optional_host_permissions": ["https://*/*"],
  "optional_permissions": ["webRequest"]
}
```

Default install: no warnings. `webRequest` + broad host permissions are requested at runtime only when the user enables network scanning.

---

## Track A: History Store

### Schema

```typescript
interface HistoryEntry {
  id: string;       // `${tabId}_${timestamp}`
  domain: string;   // hostname (e.g. "stripe.com")
  url: string;      // full page URL at time of detection
  timestamp: number; // unix ms
  psps: Array<{
    name: string;
    method: 'matchString' | 'regex';
    value: string;  // matched string or pattern
    sourceType: SourceType;
  }>;
}
```

### Storage

- Key: `psp_history` in `chrome.storage.local`
- Value: `HistoryEntry[]`, newest first
- Cap: 1,000 entries. On overflow, drop the oldest (LRU).
- Estimated max size: ~300 bytes × 1,000 = ~300 KB — well within the 10 MB quota
- Written by the background service worker immediately after each detection
- User preferences (sort order, active filter) stored in `chrome.storage.sync` to roam across Chrome profiles

### Quota Handling

All writes are wrapped in try/catch for `QUOTA_BYTES_PER_ITEM` errors. On quota error, the oldest 100 entries are evicted and the write is retried once. If it still fails, the entry is silently dropped and a console warning is emitted.

---

## Track A: Options Page

### Entry Point

`open_in_tab: true` — the history table warrants a full viewport. Accessible via:
- Extension right-click context menu → "History"
- `chrome.runtime.openOptionsPage()` programmatically

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  PSP Detector — History                                  │
│                                                          │
│  312 sites scanned · 43 unique PSPs · Top: Stripe        │
│                                                          │
│  [Search domains or PSPs...]  [Filter: All PSPs ▾]       │
│                                                          │
│  Date/Time           Domain            PSP(s)    Via     │
│  ──────────────────────────────────────────────────────  │
│  2026-02-22 10:30    checkout.co.uk    Stripe    script  │
│  2026-02-22 10:28    acme.com          Adyen     form    │
│  ...                                                     │
│                                                          │
│  [Export CSV]                          [Clear History]   │
└──────────────────────────────────────────────────────────┘
```

### Native Feel

- Font: `system-ui, -apple-system, sans-serif`
- Theme: `prefers-color-scheme` media query for dark/light
- Elements: standard `<table>`, `<input>`, `<button>`, `<select>` — no custom component library, no framework
- Style: minimal CSS that matches the existing popup aesthetic

### CSV Export

Generated entirely client-side via `Blob` + object URL. No server involved.

```
Date,Domain,URL,PSP Names,Source Types,Detection Values
2026-02-22T10:30:00Z,checkout.co.uk,https://checkout.co.uk/pay,Stripe,scriptSrc,js.stripe.com
```

Special characters in fields (commas, quotes, newlines) are RFC 4180 escaped.

### Clear History

Triggers `window.confirm()` before wiping `psp_history` from `chrome.storage.local`. UI refreshes immediately after.

---

## Quality & Testing

### TypeScript

Add to `tsconfig.json`:
```json
{
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true
}
```

These catch the additional class of bugs that multi-PSP arrays and optional history fields would otherwise hide.

### ESLint

Add rules:
- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/consistent-type-imports`
- `@typescript-eslint/switch-exhaustiveness-check` — critical for expanded discriminated union types

### Jest (Unit Tests)

New coverage required for all new code:

- `psp-detector.ts` — multi-match scenarios, deduplication (same PSP via multiple source types), ordering (earlier in `psps.json` ranks first)
- `background.ts` — history write/read/eviction at 1,000-entry cap, cold-start rehydration from `storage.session`, quota error handling
- `options.ts` — CSV generation correctness (RFC 4180 escaping), filter/search logic, sort stability

Coverage threshold: 80% line coverage enforced on all new files via Jest `coverageThreshold` config.

### Playwright (Integration Tests)

New scenarios:
- Options page renders correctly with pre-populated history
- Export CSV triggers a download with correct content and escaping
- Clear history wipes storage and updates the UI
- Multi-PSP page shows all detected providers in popup
- Detection evidence text renders correctly
- `webRequest` network detection fires when a PSP script loads dynamically

### Additional Static Analysis

| Tool | Purpose | Integration |
|---|---|---|
| **Knip** | Unused exports, dead files, dependency drift | CI step after options page is wired up; configure `entry` manually (no Chrome Extension plugin exists) |
| **Semgrep** | `postMessage` origin validation, `eval`, DOM XSS | One-time audit now + CI step (`p/javascript`, `p/security-audit` rule packs; free for open source) |
| **OSV-Scanner** | CVE scanning from broader database than `npm audit` | Scheduled weekly GitHub Actions workflow (Google reusable workflow, no sign-up) |

### CI Additions

- `coverage` step: fails build if Jest thresholds not met
- `permissions-audit` step: diffs `manifest.json` permissions between PRs; fails if new permissions are added without an explanatory comment
- `semgrep` step: `semgrep scan --config=p/javascript --config=p/security-audit --error`
- `osv-scanner` workflow: scheduled weekly scan, results in GitHub Security > Code Scanning

### Cross-Browser Compatibility

All APIs used are available across Chrome, Edge, Brave, and Opera:
- `chrome.storage.local` / `chrome.storage.session` ✓
- `chrome.webRequest` (non-blocking) ✓
- `chrome.scripting` ✓
- `chrome.runtime.sendMessage` ✓
- `chrome.action` (MV3) ✓

`chrome.sidePanel` is explicitly avoided (Chrome-only).

---

## Files Changed (Expected)

| File | Change |
|---|---|
| `src/services/psp-detector.ts` | Return `PSPDetectionResult[]`; add `sourceType` field |
| `src/types/detection.ts` | Add `SourceType` type; update result types for array |
| `src/background.ts` | Multi-result handling; history write/eviction; `webRequest` listener (optional) |
| `src/popup.ts` | Render multiple PSPs; show detection evidence |
| `src/options.ts` | New file — history page logic |
| `public/popup.html` | Multi-PSP display |
| `public/options.html` | New file — history page markup |
| `assets/manifest.json` | Add `options_page`; add `optional_permissions`; add `optional_host_permissions` |
| `tsconfig.json` | Add `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| `.eslintrc` / `eslint.config.*` | Add new rules |
| `jest.config.*` | Add `coverageThreshold` |
| `knip.json` | New file — entry point config |
| `.github/workflows/` | Add coverage, permissions-audit, semgrep, osv-scanner steps |
| `src/services/psp-detector.test.ts` | Multi-match, deduplication, ordering tests |
| `src/options.test.ts` | New file — unit tests |
| `tests/` | New Playwright scenarios |
