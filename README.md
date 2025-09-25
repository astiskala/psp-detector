# PSP Detector

Curious about which Payment Service Provider (PSP) is used on a webpage? PSP Detector is a straightforward extension that helps you identify the payment gateway powering any site you visit.

With PSP Detector, you can quickly find out which PSP is handling payments on a specific website. The extension displays the PSP’s logo, offers a brief description, and provides a link to its official website for more information.

## Why Install PSP Detector?

- Quick Identification: Easily see which payment service provider is used on any site without needing to dig through code.
- Wide Coverage: Supports various PSPs, making it easier to learn about the payment technology in use across different websites.
- Useful Insights: Whether you’re a business owner looking to compare payment options or just curious about the payment providers in use, this tool can offer you valuable insights.

## Key Features:

- Real-Time Detection: Identify the PSP used on any webpage with a simple click.
- Logo & Description: View the provider’s logo alongside a brief overview of its services.
- Direct Links: Quickly navigate to the PSP’s website for further exploration.

## How to Use:

Just install the PSP Detector extension (available in the Chrome Web Store at https://chromewebstore.google.com/detail/iblfofcbjioicompkmafdehbdakdbjle), visit any website, navigate to the checkout page, and click on the extension icon to see the payment provider in use. It’s that simple!

## Supported PSPs:

- 2C2P
- 2Checkout (Verifone)
- Adyen
- Airwallex
- Alipay
- Allinpay
- Amazon Payment Services (PayFort)
- AsiaPay
- Authorize.ne
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
- Global Payments
- GMO Payment Gateway
- Helcim
- Inicis
- Judopay
- KSNET
- LianLian
- Linkly
- Mastercard Gateway (MPGS)
- Maya
- MercadoPago
- Mollie
- Moneris
- MyFatoorah
- Network International
- Nexi Group (Nets)
- NHN KCP
- NICE Payments
- NMI
- NTT DATA
- Nuvei
- Oceanpayment
- Opn Payments (Omise)
- Paddle
- PagBrasil
- PagSeguro
- PayGent
- PayKings
- Payletter
- Paymentwall
- Payoneer
- PayPal
- PayPal Enterprise Payments
- Paysafe
- Paysera
- Paystack
- PayTabs
- Paytm
- PayU
- Plastiq
- Rapyd
- Razorpay
- Red Dot Payment
- SB Payment Service
- Shift4
- Shopify Payments
- Skrill
- Sony Payment Services
- Square
- Stripe
- SumUp
- Tap Payments
- Tipalti
- Trust Payments
- Tyro
- WePay
- Windcave
- Worldline
- Worldpay
- Xendit
- Xsolla Pay
- Yoco
- Zai (Assembly Payments)

## Supported orchestrators / proxies

- ACI Worldwide
- Akurateco
- APEXX
- Basis Theory
- BR-DGE
- CellPoint Digital
- Chargebee
- Gr4vy
- IXOPAY
- Juspay
- Paydock
- PCI Proxy
- PCI Vault
- Praxis Tech
- Primer
- ProcessOut
- Spreedly
- Tranzzo
- VGS (Very Good Security)
- Yuno

## Supported third-party service providers (TSPs)

- Amadeus Hospitality (TravelClick)
- Sabre SynXis

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

### Testing

```bash
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
```

### Linting

```bash
npm run lint          # TypeScript/JavaScript linting with ESLint
npm run lint:fix      # Auto-fix TypeScript/JavaScript issues
npm run lint:html     # HTML linting with webhint
npm run lint:manifest # Chrome extension manifest linting
npm run lint:web      # Combined HTML and manifest linting
```

### Quality Assurance

```bash
npm run typecheck     # TypeScript type checking
npm run ci            # Full CI pipeline (lint + typecheck + test)
npm run validate      # Complete validation (fix + typecheck + build + test)
```

### Available Scripts

- `build` - Build the extension for production
- `build:debug` - Build with debug information
- `test` - Run Jest tests
- `test:watch` - Run tests in watch mode
- `lint` - Run ESLint on TypeScript files
- `lint:fix` - Auto-fix ESLint issues
- `lint:html` - Lint HTML files with webhint
- `lint:manifest` - Lint Chrome extension manifest
- `lint:web` - Run both HTML and manifest linting
- `typecheck` - Run TypeScript compiler checks
- `ci` - Complete CI pipeline
- `validate` - Full validation before commit
- `clean` - Clean build artifacts
