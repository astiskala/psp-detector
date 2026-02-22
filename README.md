# PSP Detector

Curious about which Payment Service Provider (PSP) is used on a webpage? PSP Detector is a straightforward extension that helps you identify the payment gateway powering any site you visit.

With PSP Detector, you can quickly find out which PSP is handling payments on a specific website. The extension displays the PSP’s logo, offers a brief description, and provides a link to its official website for more information.

## Why Install PSP Detector?

- Quick Identification: Easily see which payment service provider is used on any site without needing to dig through code.
- Wide Coverage: Supports various PSPs, making it easier to learn about the payment technology in use across different websites.
- Useful Insights: Whether you’re a business owner looking to compare payment options or just curious about the payment providers in use, this tool can offer you valuable insights.

## Key Features:

- Real-Time Detection: Identify PSPs, orchestrators, and TSPs on the active tab.
- History Dashboard: Track detections over time, filter/search, and export CSV.
- Direct Links: Quickly navigate to provider websites or suggest coverage
  improvements.

## How to Use:

Just install the PSP Detector extension (available in the Chrome Web Store at https://chromewebstore.google.com/detail/iblfofcbjioicompkmafdehbdakdbjle), visit any website, navigate to the checkout page, and click on the extension icon to see the payment provider in use. It’s that simple!

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
- BillDesk
- BlueSnap
- Cardknox
- Cashfree Payments
- Cellulant
- Chase Payment Solutions
- Checkout.com
- Cielo
- Codapay
- Conekta
- CSG Forte
- CX Pay
- Cybersource
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
- Fiserv
- Fiuu
- Flutterwave
- Flywire
- Geidea
- Global Payments
- GMO Payment Gateway
- Helcim
- Judopay
- KG Inicis
- KSNET
- Kushki
- LianLian
- Linkly
- Mastercard Gateway (MPGS)
- Maya
- MercadoPago
- Mollie
- MONEI
- Moneris
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
- Opn Payments
- Paddle
- PagBrasil
- PagSeguro
- PayGent
- PayJunction
- PayKings
- Payletter
- Paymentwall
- PayMob
- Payoneer
- PayPal
- PayPal Enterprise Payments
- Paysafe
- Paysbuy
- Paysera
- Paystack
- PayTabs
- Paytm
- PayU
- Peach Payments
- Pine Labs
- Plastiq
- Plug'n Pay
- Quickpay
- Rapyd
- Razorpay
- Red Dot Payment
- SB Payment Service
- senangPay
- Shift4
- Shopify Payments
- Skrill
- Sony Payment Services
- Square
- Stripe
- SumUp
- Tap Payments
- Telr
- Tilled
- Trust Payments
- Tyro
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
- Gr4vy
- IXOPAY
- Juspay
- Paydock
- Paytiko
- PCI Proxy
- PCI Vault
- Praxis Tech
- Primer
- ProcessOut
- Rebilly
- Spreedly
- Tranzzo
- VGS (Very Good Security)
- Yuno

## Supported third-party service providers (TSPs)

- Amadeus Hospitality (TravelClick)
- Cloudbeds
- Sabre SynXis
- SiteMinder

## Development

### Setup

```bash
npm install
```

### Building

```bash
npm run build          # Production build
npm run build:debug    # Development build with debug info
```

### Loading In Chrome

1. Run `npm run build`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder (not `assets/`).
4. After rebuilding, click **Reload** on the extension.

### Testing

```bash
npm test                 # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage.   # Run Jest coverage report
npm run test:integration # Run Playwright integration/E2E tests
```

### Linting

```bash
npm run lint          # TypeScript/JavaScript linting with ESLint
npm run lint:fix      # Auto-fix TypeScript/JavaScript issues
npm run lint:deps     # dependency-cruiser architectural boundary checks
npm run lint:html     # HTML linting with webhint
npm run lint:manifest # Chrome extension manifest linting
npm run lint:web      # Combined HTML and manifest linting
npm run knip          # Unused files/dependencies/exports checks
```

ESLint includes SonarJS quality rules plus JSDoc enforcement for public APIs.

### Quality Assurance

```bash
npm run typecheck     # TypeScript type checking
npm run ci            # Full CI pipeline (lint + typecheck + test)
npm run validate      # Complete validation (fix + lint + typecheck + knip + dep checks + build + tests + web lint)
```

### Chrome Web Store Screenshots

```bash
npm run screenshots:store
```

Generated assets are saved to `docs/store-assets/`.

### Available Scripts

- `build` - Build the extension for production
- `build:debug` - Build with debug information
- `test` - Run Jest tests
- `test:watch` - Run tests in watch mode
- `lint` - Run ESLint on TypeScript files
- `lint:fix` - Auto-fix ESLint issues
- `lint:deps` - Run dependency-cruiser rules on `src/`
- `lint:html` - Lint HTML files with webhint
- `lint:manifest` - Lint Chrome extension manifest
- `lint:web` - Run both HTML and manifest linting
- `knip` - Find unused files, dependencies, and exports
- `test:integration` - Run Playwright integration/E2E tests
- `screenshots:store` - Generate Chrome Web Store screenshot assets
- `typecheck` - Run TypeScript compiler checks
- `ci` - Complete CI pipeline
- `validate` - Full validation before commit
- `clean` - Clean build artifacts
