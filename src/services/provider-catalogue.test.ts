import fs from 'node:fs';
import path from 'node:path';
import type { PSPConfig } from '../types';
import { PSPDetectorService } from './psp-detector';

const MERCHANT_URL = 'https://merchant.example/checkout';
const REALEX_NAME = 'Realex Gateway (Global Payments / Elavon)';
const DATATRANS_NAME = 'Datatrans';
const config = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../public/psps.json'), 'utf8'),
) as PSPConfig;

// Load the shipped catalogue so matcher changes are exercised by the actual detector.
const checkoutFixtures: [string, string][] = [
  ['Finix', 'https://js.finix.com/v/2/finix.js'],
  ['Mangopay', 'https://checkout.mangopay.com/sdk/checkout-sdk.min.js'],
  ['Revolut Merchant', 'https://checkout.revolut.com/payment-link/example'],
  ['Viva.com', 'https://www.vivapayments.com/web/checkout?ref=example'],
  ['Viva.com', 'https://demo.vivapayments.com/web/checkout?ref=example'],
  ['Ecommpay', 'https://paymentpage.ecommpay.com/payment?project_id=123'],
  ['DNA Payments', 'https://pay.dnapayments.com/checkout/payment-api.js'],
  ['DNA Payments', 'https://test-pay.dnapayments.com/checkout/payment-api.js'],
  ['PayMongo', 'https://checkout.paymongo.com/example'],
  [
    'PhonePe Payment Gateway',
    'https://mercury.phonepe.com/web/bundle/checkout.js',
  ],
  ['PayHere', 'https://www.payhere.lk/lib/payhere-2.0.js'],
  ['Payfast', 'https://www.payfast.co.za/onsite/engine.js'],
  ['Payfast', 'https://sandbox.payfast.co.za/onsite/engine.js'],
  ['PayGate by Network', 'https://secure.paygate.co.za/payhost/web-payment'],
  ['Payfast', 'https://www.payfast.co.za/eng/process'],
  ['Payfast', 'https://sandbox.payfast.co.za/eng/process'],
  ['PayGate by Network', 'https://secure.paygate.co.za/payweb3/process.trans'],
  ['PayHere', 'https://www.payhere.lk/pay/checkout'],
  ['PayHere', 'https://sandbox.payhere.lk/pay/checkout'],
  ['PAYCOMET', 'https://api.paycomet.com/gateway/paycomet.jetiframe.js'],
  ['PayTR', 'https://www.paytr.com/odeme/guvenli/example'],
  ['iugu', 'https://js.iugu.com/v2'],
  [
    'SecurePay (Fat Zebra)',
    'https://payments.auspost.net.au/v3/ui/client/securepay-ui.min.js',
  ],
  [
    'SecurePay (Fat Zebra)',
    'https://payments-stest.npe.auspost.zone/v3/ui/client/securepay-ui.min.js',
  ],
  ['Westpac PayWay', 'https://api.payway.com.au/rest/v1/payway.js'],
  ['payabl.', 'https://pay4.payabl.com/hpp/js/sdk/latest/payabl_sdk.js'],
  ['payabl.', 'https://pay4.sandbox.payabl.com/hpp/js/payabl_sdk.js'],
  ['Dodo Payments', 'https://checkout.dodopayments.com/session/example'],
  ['Dodo Payments', 'https://test.checkout.dodopayments.com/session/example'],
  ['Pagar.me', 'https://checkout.pagar.me/example'],
  ['Pagar.me', 'https://payment-link.pagar.me/example'],
  ['Payrails', 'https://assets.payrails.io/apps/secure-frame/index.html'],
  ['Payrails', 'https://assets.payrails.io/web-sdk/6.5.0/style.css'],
  ['Hyperswitch (Juspay)', 'https://beta.hyperswitch.io/v1/HyperLoader.js'],
  ['PortOne', 'https://static.portone.cloud/portone.js'],
  ['Solidgate', 'https://cdn.solidgate.com/js/solid-form.js'],
  [
    'PaymentsOS (PayU)',
    'https://js.paymentsos.com/v2/latest/secure-fields.min.js',
  ],
  ['Shift4', 'https://js.shift4.com/v1/shift4.js'],
  ['Shift4', 'https://js.dev.shift4.com/v1/shift4.js'],
  ['Mercado Pago', 'https://sdk.mercadopago.com/js/v2'],
  ['Authorize.net', 'https://accept.authorize.net/payment/payment'],
  ['Authorize.net', 'https://test.authorize.net/payment/payment'],
  ['Airwallex', 'https://static.airwallex.com/components/sdk/v1/index.js'],
  ['Tap Payments', 'https://tap-sdks.b-cdn.net/card/1.0.2/index.js'],
  [
    'Worldline',
    'https://sdk.tokenization.secure.payone.com/v1/hosted-tokenization-sdk.js',
  ],
  ['PayPal', 'https://www.paypal.com/sdk/js?client-id=example'],
  ['PayPal', 'https://www.paypal.com/web-sdk/v6/core'],
  ['PayPal', 'https://www.paypal.com/smart/card-fields'],
  ['Omise (formerly Opn Payments)', 'https://cdn.omise.co/omise.js'],
  [
    'NTT DATA Payment Services (iPay88 / ADAPTIS)',
    'https://securepay.e-ghl.com/IPG/payment.aspx',
  ],
  [
    'NTT DATA Payment Services (iPay88 / ADAPTIS)',
    'https://sandbox.ipay88.com.my/',
  ],
  ['CellPoint Digital', 'https://ehpp2.cellpoint.app/views/web.php'],
  [
    'CellPoint Digital',
    'https://cpd-demo.cellpoint.app/views/web.php?session=example',
  ],
  ['Gr4vy', 'https://embed.example.gr4vy.app/'],
  ['Gr4vy', 'https://embed.sandbox.example.gr4vy.app/'],
  ['Gr4vy', 'https://api.example.gr4vy.app/'],
  ['Gr4vy', 'https://api.sandbox.example.gr4vy.app/'],
  ['PCI Proxy', 'https://api.pci-proxy.com/v1/pull'],
  ['PCI Proxy', 'https://sandbox.pci-proxy.com/v1/push/example'],
  ['PCI Proxy', 'https://api.link.pci-proxy.com/example'],
  ['PCI Proxy', 'https://api.link.sandbox.pci-proxy.com/example'],
  ['PCI Proxy', 'https://api.vault.pci-proxy.com/example'],
  ['PCI Proxy', 'https://api.vault.sandbox.pci-proxy.com/example'],
  [
    DATATRANS_NAME,
    'https://pay.datatrans.com/upp/payment/js/secure-fields-2.0.0.min.js',
  ],
  [
    DATATRANS_NAME,
    'https://pay.sandbox.datatrans.com/upp/payment/js/secure-fields-2.0.0.js',
  ],
  [REALEX_NAME, 'https://pay.realexpayments.com/pay'],
  [REALEX_NAME, 'https://pay.sandbox.realexpayments.com/pay'],
  ['Global Payments', 'https://js.globalpay.com/v1/globalpayments.js'],
  ['Elavon', 'https://pay.elavonpaymentgateway.com/pay'],
  ['Sabre SynXis', 'https://be.synxis.com/?hotel=example'],
];

const unrelatedFixtures = [
  'https://developer.tingg.africa/',
  'https://www.cellpointdigital.com/assets/site.js',
  'https://www.cellpointdigital.com/sdk',
  'https://www.paydock.com/assets/site.js',
  'https://www.paydock.com/sdk',
  'https://merchant.example/rxp-js.js',
  'https://www.paypalobjects.com/webstatic/en_US/developer/docs/css/cardfields.css',
  'https://www.synxis.com/',
  'https://www.pci-proxy.com/',
  'https://developers.paymentsos.com/',
  'https://www.gr4vy.app/',
  'https://embed.example.gr4vy.app.attacker.example/',
  'https://fakeembed.example.gr4vy.app/',
  'https://ehpp2.cellpoint.app.attacker.example/views/web.php',
  'https://ehpp2.cellpoint.app/marketing',
  'https://assets.payrails.io/img/logos/stripe.svg',
  'https://static.airwallex.com/developer-tools/index.js',
  'https://www.paytr.com/js/iframeResizer.min.js',
  'https://fakecheckout.paymongo.com/example',
  'https://checkout.paymongo.com.attacker.example/',
  'https://pay.realexpayments.com.attacker.example/pay',
];

function detectNames(content: string, url = MERCHANT_URL): string[] {
  const detector = new PSPDetectorService();
  detector.initialize(config);
  detector.setExemptDomains([]);
  const result = detector.detectPSP(url, content);
  if (result.type === 'error') throw new Error('Catalogue detection failed');
  return result.type === 'detected'
    ? result.psps.map((match) => match.psp)
    : [];
}

describe('Shipped provider catalogue', () => {
  it.each(checkoutFixtures)(
    'detects only %s from %s in HTML and request signals',
    (name, url) => {
      expect(detectNames(`<iframe src="${url}"></iframe>`)).toEqual([name]);
      expect(detectNames(url)).toEqual([name]);
      expect(detectNames('', url)).toEqual([name]);
      expect(
        detectNames(`<script src="${url.replace('https:', '')}"></script>`),
      ).toEqual([name]);
      expect(detectNames(`${url}\n${url}`)).toEqual([name]);
    },
  );

  it.each(unrelatedFixtures)(
    'ignores non-payment or lookalike signal %s',
    (url) => {
      expect(detectNames(`<a href="${url}">Reference</a>`)).toEqual([]);
      expect(detectNames(url)).toEqual([]);
      expect(detectNames('', url)).toEqual([]);
    },
  );

  it('keeps separately visible PSP and orchestrator results in catalogue order', () => {
    expect(
      detectNames(
        'https://cdn.solidgate.com/js/solid-form.js\nhttps://js.finix.com/v/2/finix.js',
      ),
    ).toEqual(['Finix', 'Solidgate']);
  });
});
