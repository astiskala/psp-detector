# PSP Test/Demo Sites

These demos from various payment providers can be used to test this extension.

The Playwright integration suite (`npm run test:integration`) covers a subset
of these URLs as automated regression checks and also exercises the popup and
options-page extension flows.

## Verified Working (covered by integration tests)

- Adyen: https://www.mystoredemo.io
- BlueSnap: https://checkout.bluesnapdemo.com
- Cashfree Payments: https://www.cashfree.com/devstudio/preview/pg/web/inlineCheckout
- Chargebee: https://cbcheckoutapp.herokuapp.com
- Checkout.com: https://flow-demo.sandbox.checkout.com
- FastSpring: https://fs-react-devrels.vercel.app
- Global Payments: https://demo.globalpay.com/merchants/dropin-ui
- HiPay: https://demo.hipay.com/
- Midtrans: https://demo.midtrans.com
- Nuvei: https://demos.nuvei.com/intdemo-ecom/checkout/
- PayU: https://widget.payu.in/demo
- Razorpay: https://razorpay.com/demo/
- Shift4: https://dev.shift4.com/examples/checkout
- Skrill: https://pay.skrill.com/assets/skrill-demo/ecommerce.html
- Square: https://square.github.io/web-payments-showcase/
- Stripe: https://checkout.stripe.dev/checkout
- Unzer: https://demo.unzer.com/demo/resources/paypage_manual.html
- Worldline (Saferpay): https://test.saferpay.com/DemoShop

## Additional Demo Sites (not in integration suite)

These are real interactive demos that load the PSP's runtime SDK. They can be
used for manual validation but are not yet covered by automated tests.

- Airwallex: https://demo-pacheckoutdemo.airwallex.com/
- Braintree (PayPal Enterprise): https://braintree.github.io/braintree-web-drop-in/ (loads local SDK copy, not from braintreegateway.com)
- Easebuzz: https://easebuzz.in/demo/
- Helcim: https://demo.helcim.com/demo/cme1wnrhz0fz2h3py4j9402s5
- MONEI: https://payments-demo.monei.com/checkout
- Nexi Group (Nets): https://shop.easy.nets.eu/ (match string is inside env.js content, not in HTML or URLs)
- Oceanpayment: https://demoshop.oceanpayment.com.cn/checkout.html
- PayPal: https://demo.paypal.com/us/paypal/v5/physical-goods/checkout
- PayMob: https://om.paymob.com/en/checkout.html
- Paysafe: https://checkout.paysafe.com/payments-api/checkout/ecommerce/index.html
- Paysera: https://demo.paysera.tech/
- Paystack: https://paystack.com/demo/checkout
- Tap Payments: https://demo.tap.company/v2/sdk/checkout
- Worldpay: https://demo.globalpay.com/worldpay-demo
- Xsolla Pay: https://webshop-external-demo.xsolla.site/
