# PSP Detector

Curious about which Payment Service Provider (PSP) is used on a webpage? PSP Detector is a straightforward extension that helps you identify the payment gateway powering any site you visit.

With PSP Detector, you can quickly find out which PSP is handling payments on a specific website. The extension displays the PSP's logo, offers a brief description, and provides a link to its official website for more information.

## Why Install PSP Detector?

- Quick Identification: Easily see which payment service provider is used on any site without needing to dig through code.
- Wide Coverage: Supports 160+ PSPs, making it easier to learn about the payment technology in use across different websites.
- Useful Insights: Whether you're a business owner looking to compare payment options or just curious about the payment providers in use, this tool can offer you valuable insights.

## Key Features:

- Real-Time Detection: Identify PSPs, orchestrators, and TSPs on the active tab.
- History Dashboard: Track detections over time, filter/search, and export CSV.
- Direct Links: Quickly navigate to provider websites or suggest coverage improvements.

## How to Use:

Just install the PSP Detector extension (available in the Chrome Web Store at https://chromewebstore.google.com/detail/iblfofcbjioicompkmafdehbdakdbjle), visit any website, navigate to the checkout page, and click on the extension icon to see the payment provider in use. It's that simple!

## Supported PSPs:

- 2C2P
- 2Checkout (Verifone)
- Adyen
- Airwallex
- Alipay
- Allinpay International
- Amazon Payment Services (PayFort)
- AsiaBill
- AsiaPay
- Authorize.net
- Barclaycard ePDQ
- BillDesk
- BlueSnap
- Buckaroo
- Cardknox
- Cashfree Payments
- CCAvenue
- CCBill
- Cellulant
- Chase Payment Solutions
- Checkout.com
- Cielo
- Codapay
- Computop
- Conekta
- CSG Forte
- Culqi
- CX Pay
- Cybersource
- Datatrans
- Debia
- DG Financial Technology
- dLocal
- DPO Group
- Easebuzz
- Easy Pay Direct
- EBANX
- Elavon
- EVO Payments
- Eway
- Eximbay
- FastSpring
- Fat Zebra
- Fawry
- Fiserv
- Fiuu
- Flutterwave
- Flywire
- Geidea
- Global Payments
- GMO Payment Gateway
- Helcim
- HiPay
- HitPay
- Iyzico
- Judopay
- KG Inicis
- KOMOJU
- KSNET
- Kushki
- Lemon Squeezy
- LianLian
- Linkly
- Lyra
- Mastercard Gateway (MPGS)
- Maya
- MercadoPago
- Midtrans
- Mollie
- MONEI
- Moneris
- MultiSafepay
- MyFatoorah
- NETbilling
- Network International
- Nexi Group (Nets)
- NHN KCP
- NICE Payments
- NMI
- NTT DATA
- Nuvei
- Oceanpayment
- Openpay
- Opn Payments
- Paddle
- PagBrasil
- PagSeguro
- Pay.
- PayGent
- PayJunction
- PayKings
- Payletter
- Paymentwall
- PayMob
- Payoneer
- PayPal
- PayPal Enterprise Payments
- PayPlug
- Paysafe
- Paysbuy
- Paysera
- Paystack
- PayTabs
- Paytm
- Paytrail
- PayU
- Peach Payments
- Pine Labs
- Plastiq
- Plug'n Pay
- Polar
- PPRO
- Przelewy24
- Quickpay
- Rapyd
- Razorpay
- Red Dot Payment
- Redsys
- SB Payment Service
- senangPay
- Shift4
- Shopify Payments
- Skrill
- Sony Payment Services
- Square
- Stripe
- Suby
- SumUp
- Swedbank Pay
- Tap Payments
- Telr
- Tilled
- Toss Payments
- Tpay
- Trust Payments
- Tyro
- Unzer
- WePay
- Windcave
- Worldline
- Worldpay
- Xendit
- Xsolla Pay
- Yoco
- Zai

## Supported orchestrators / proxies

- ACI Worldwide
- Akurateco
- APEXX
- Basis Theory
- BR-DGE
- BridgerPay
- CellPoint Digital
- Chargebee
- Corefy
- DEUNA
- Gr4vy
- IXOPAY
- Juspay
- Pay2B
- Paydock
- Paytiko
- PCI Proxy
- PCI Vault
- Praxis Tech
- Primer
- ProcessOut
- Rebilly
- Recurly
- Spreedly
- Tranzzo
- VGS (Very Good Security)
- Yuno

## Supported third-party service providers (TSPs)

- Amadeus Hospitality (TravelClick)
- Cloudbeds
- Sabre SynXis
- SiteMinder

## Privacy & Telemetry

PSP Detector includes optional, privacy-preserving usage analytics sent via the
[GA4 Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4).
There is no custom backend and no remote analytics JavaScript (e.g. `gtag.js`)
is loaded. Telemetry is sent only from the extension's own contexts
(service worker, popup, options page) — never from the content script running on
merchant pages.

For the full event catalog, the GA4 custom dimensions that make event
parameters reportable, and the usage dashboard, see
[docs/analytics.md](docs/analytics.md).

### What is collected

Aggregate feature usage and detection outcomes only:

- Lifecycle/feature events: install/update, popup opened, scans requested,
  scans skipped, history opened/exported, settings opened, telemetry toggled.
- For detections: the PSP/provider **name**, **slug**, **type**
  (PSP/Orchestrator/TSP), the **match type** (`matchString`/`regex`), and a
  PSP-owned **evidence hostname** (e.g. `checkoutshopper-live.adyen.com`).
- A random `client_id` (stored in `chrome.storage.local`) and a short-lived
  `session_id` (stored in `chrome.storage.session`, 30-minute inactivity
  expiry), the extension version, and `engagement_time_msec`.
- For exports: the format (`csv`) and a coarse **row-count bucket** (e.g.
  `11-50`) — never the exported rows.
- Coarse environment context on every event: **country** (`user_country`,
  ISO-2), **timezone** (`user_timezone`), **OS** (`user_os`), and **UI
  language** (`ui_language`). Country is resolved via Cloudflare trace and only
  the two-letter country code is retained/sent; raw IP is never stored.

### What is NOT collected

The merchant page domain, full URLs, page titles, HTML content, raw network
request URLs, checkout paths, query strings, fragments, form data, payment
data, request payloads, and stack traces are **never** sent. Evidence values
are reduced to a bare hostname before sending, and only PSP-owned hostnames are
included.

### Configuring GA credentials (build time)

Credentials are injected at build time and embedded in the packaged extension
(acceptable here because there is no backend). Set them as environment
variables for the build:

```bash
GA_MEASUREMENT_ID="G-XXXXXXX" GA_API_SECRET="your_api_secret" pnpm run build
```

If either variable is missing — as in local/dev builds and CI — telemetry is a
safe no-op and **no** network requests are made. Do not commit real
credentials to source.

### Disabling telemetry

Telemetry is enabled by default for the safe aggregate data described above.
Users can turn it off any time from the extension's **Options → Settings →
"Share anonymous usage analytics"** toggle (stored in `chrome.storage.local`).
Local/dev builds without GA credentials never send telemetry regardless of the
setting.

## Development

### Setup

```bash
pnpm install
```

The project CI workflows use Node.js 22. Matching that locally avoids tooling drift.

### Building

```bash
pnpm run build          # Production build
pnpm run build:debug    # Development build with debug info
```

### Loading In Chrome

1. Run `pnpm run build`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder (not `assets/`).
4. After rebuilding, click **Reload** on the extension.

### Testing

```bash
pnpm test                 # Run all tests
pnpm run test:watch       # Run tests in watch mode
pnpm run test:coverage    # Run Jest coverage report
pnpm run test:integration # Run Playwright integration/E2E tests
```

### Linting

```bash
pnpm run lint          # TypeScript/JavaScript linting with ESLint
pnpm run lint:scripts  # Lint repository JS/MJS/CJS tooling files
pnpm run lint:deps     # dependency-cruiser architectural boundary checks
pnpm run lint:html     # HTML structure/safety checks via tools/lint-web.mjs
pnpm run lint:manifest # Chrome extension manifest checks via tools/lint-web.mjs
pnpm run lint:web      # Combined HTML and manifest linting
pnpm run fix           # Auto-fix TypeScript/JavaScript issues
pnpm run knip          # Unused files/dependencies/exports checks
```

ESLint includes SonarJS quality rules plus unicorn and JSDoc enforcement for public APIs.

### Quality Assurance

```bash
pnpm run typecheck     # TypeScript type checking
pnpm run ci            # Core CI script (lint + typecheck + unit tests + web/dependency checks)
pnpm run validate      # Local validation (fix + lint + typecheck + knip + dep checks + build + unit tests + web lint)
```

`pnpm run validate` does not include Playwright. The GitHub Actions workflows run
`pnpm run validate` first, then run integration and E2E tests separately.

### Versioning

Extension versions are generated by `build.mjs` in the format
`3.YYYY.MMDD.HHMM`. Do not edit the `package.json` version manually.

### Publishing to the Chrome Web Store

Every push to `main` builds the extension and creates a GitHub Release
(the **Build and Release Extension** workflow), but it does **not** publish
to the Chrome Web Store. Publishing is **manual / on-demand** via the
**Publish to Chrome Web Store** workflow. This avoids piling up failed
submissions: the Web Store rejects a new submission while a previous one is
still in review.

To publish a build to Trusted Testers:

- **GitHub UI:** Actions → **Publish to Chrome Web Store** → **Run workflow**.
  Leave the `tag` field blank to publish the latest release, or enter a
  specific release tag (e.g. `3.2026.617.721`).
- **GitHub CLI:**

  ```bash
  # Publish the latest release
  gh workflow run "Publish to Chrome Web Store"

  # Publish a specific release tag
  gh workflow run "Publish to Chrome Web Store" -f tag=3.2026.617.721
  ```

Notes:

- The workflow uploads and publishes to **Trusted Testers**. Promote a build
  to all users from the
  [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
- If a previous submission is still **in review**, publishing a new version
  fails. Either wait for the review to finish, or cancel the pending review in
  the Developer Dashboard (which reverts it to draft) and then re-run this
  workflow to submit the newer version.

### Script Reference

- `build` — Production build
- `build:debug` — Build with debug information
- `check` — Run the default GTS checks
- `fix` — Auto-fix TypeScript and JavaScript issues
- `test` — Run Jest tests
- `test:watch` — Run tests in watch mode
- `test:coverage` — Run Jest with coverage output
- `lint` — Run ESLint on TypeScript files
- `lint:scripts` — Lint repository JavaScript tooling files
- `lint:deps` — Run dependency-cruiser rules on `src/`
- `lint:html` — Run HTML checks with `tools/lint-web.mjs`
- `lint:manifest` — Run manifest checks with `tools/lint-web.mjs`
- `lint:web` — Run both HTML and manifest linting
- `knip` — Find unused files, dependencies, and exports
- `test:integration` — Run Playwright integration/E2E tests
- `typecheck` — Run TypeScript compiler checks
- `ci` — Run the repository's core CI script
- `validate` — Full validation before commit
- `clean` — Clean build artifacts
