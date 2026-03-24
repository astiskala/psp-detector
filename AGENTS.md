## AI coding agent instructions: PSP Detector

Focused guidance for AI coding agents working in this repository. Keep answers concrete, reflect existing patterns, and prefer small, verifiable changes.

### 1. Purpose & Architecture

- Chrome MV3 extension that detects the Payment Service Provider (PSP) / Orchestrator / TSP on an e‑commerce page.
- Core detection surface = current page URL + full HTML + observed network request URLs.
- Detection logic: `src/services/psp-detector.ts` over merged provider list (PSPs + orchestrators + TSPs) from `public/psps.json`.
- Build (`build.mjs`) bundles `content.ts`, `background.ts`, `popup.ts` via esbuild, copies `public/` → `dist/`, injects version into `manifest.json` & `package.json`, resizes PNG logos to `_48` / `_128` with `sharp`.
- Provider metadata is data‑driven (no hardcoded providers in logic). Source images: `assets/images/*.png`.

### 2. Detection Model

- Two‑phase scan:
  1. `matchStrings` substring scan (first hit wins) over `${url}\n\n${content}`.
  2. Regex fallback (`regex` compiled once in `initialize`).
- Result = `PSPDetectionResult` variant (detected / none / exempt / error). No throws for normal flow.
- Exempt domains via `setExemptDomains` (empty in tests).

### 3. Key Files

- `src/services/psp-detector.ts` – core service (keep public API stable).
- `public/psps.json` – provider definitions. Order matters for precedence; don’t mass re‑sort.
- `build.mjs` – versioning + asset pipeline; add new steps after manifest processing.
- `tests/integration/demo-sites.spec.ts` – Playwright real‑site checks (one test per site; structured diagnostics on failure).

### 4. Commands / Workflows

- Full local check: `npm run validate` (format:check → lint → typecheck → build → unit tests → web lint).
- Unit tests: `npm test` (Jest, jsdom).
- Integration: `npm run test:integration` (Playwright real-site checks; installs Chromium).
- E2E: `npm run test:e2e` (Playwright popup, options, history, and export flows in loaded extension).
- Format: `npm run format` (write) / `npm run format:check` (verify).
- CI: `.github/workflows/release.yml` runs validate + Playwright on pushes affecting relevant paths.
- Pre-commit hooks: Husky runs lint-staged on commit, typecheck + build + test on push, commitlint on commit-msg.

### 5. Conventions

- Use `logger.*` (avoid raw console.\* outside utils/tests).
- Provider order = precedence; place more specific host strings earlier.
- Regex: always compile with `safeCompileRegex`; never throw on invalid.
- Images: commit only original base PNG (128px). Build generates `_48` + `_128`.
- Version: never hand‑edit `package.json` version (auto `3.YYYY.MMDD.HHMM`).

### 6. Adding a Provider (Example)

1. Add `assets/images/newpsp.png` (square/transparent 128px) Attempt to find a favicon or the logo used on social media for the company (LinkedIn, X, Facebook).
2. Append to `public/psps.json`:
   `{ "name": "NewPSP", "matchStrings": ["cdn.newpsp.com"], "image": "newpsp", "summary": "…", "url": "https://www.newpsp.com" }`
3. `npm run build` (verifies image resizing & version bump).
4. Add to README

### 7. Pitfalls

- Do NOT globally alphabetize `psps.json` – breaks precedence.
- Avoid overly generic `matchStrings` (e.g. the root domain of the PSP).
- Keep detection O(N) passes; no nested scans.
- Integration tests must instantiate a fresh service each test.

### 8. Modifying Detection Logic

- Ensure deterministic ordering when multiple candidates match.

### 9. Performance / Footprint

- Target `esnext`; favor modern syntax (no legacy polyfills).
- Runtime dependencies minimal—avoid adding heavy libs to extension bundle.

### 10. Clarification Policy

- If a requirement is ambiguous, propose minimal, data‑driven change + rationale instead of blocking.

---

Assume the project is using version control, no need to comment out new code, leave in place "legacy support", or call out when you've made changes.

Always produce diffs only for changed files and run `npm run validate` before concluding substantial edits.
