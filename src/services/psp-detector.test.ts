import { PSPDetectorService } from './psp-detector';
import type { PSPConfig } from '../types';
import { TypeConverters, PSPDetectionResult } from '../types';

describe('PSPDetectorService', () => {
  const config: PSPConfig = {
    psps: [
      {
        name: TypeConverters.toPSPName('Stripe')!,
        regex: TypeConverters.toRegexPattern('stripe\\.com')!,
        url: TypeConverters.toURL('https://stripe.com')!,
        image: 'stripe',
        summary: 'Stripe summary',
      },
      {
        name: TypeConverters.toPSPName('PayPal')!,
        regex: TypeConverters.toRegexPattern('paypal\\.com')!,
        url: TypeConverters.toURL('https://paypal.com')!,
        image: 'paypal',
        summary: 'PayPal summary',
      },
      {
        name: TypeConverters.toPSPName('Adyen')!,
        regex: TypeConverters.toRegexPattern('adyen\\.com')!,
        url: TypeConverters.toURL('https://adyen.com')!,
        image: 'adyen',
        summary: 'Adyen summary',
      },
    ],
  };

  let service: PSPDetectorService;

  beforeEach(() => {
    service = new PSPDetectorService();
    service.initialize(config);
    service.setExemptDomains(['example.com', 'test.org']);
  });

  it('should initialize with config', () => {
    expect(service.isInitialized()).toBe(true);
  });

  it('should detect Stripe PSP', () => {
    const url = 'https://checkout.stripe.com';
    const content = '<script src="https://js.stripe.com/v3/"></script>';
    const result = service.detectPSP(url, content);
    expect(PSPDetectionResult.isDetected(result)).toBe(true);
    if (PSPDetectionResult.isDetected(result)) {
      expect(result.psp).toBe('Stripe');
    }
  });

  it('should detect PayPal PSP', () => {
    const url = 'https://www.paypal.com/checkout';
    const content = '<script src="https://www.paypal.com/sdk/js"></script>';
    const result = service.detectPSP(url, content);
    expect(PSPDetectionResult.isDetected(result)).toBe(true);
    if (PSPDetectionResult.isDetected(result)) {
      expect(result.psp).toBe('PayPal');
    }
  });

  it('should return none result if no PSP matches', () => {
    const url = 'https://unknown.com';
    const content = '<div>No PSP here</div>';
    const result = service.detectPSP(url, content);
    expect(PSPDetectionResult.isNone(result)).toBe(true);
  });

  it('should return error result if not initialized', () => {
    const uninit = new PSPDetectorService();
    const result = uninit.detectPSP('https://stripe.com', 'stripe');
    expect(PSPDetectionResult.isError(result)).toBe(true);
  });

  it('should get PSP by PSPName', () => {
    expect(
      service.getPSPByPSPName(TypeConverters.toPSPName('Stripe')!),
    ).toMatchObject({
      name: 'Stripe',
      regex: 'stripe\\.com',
    });

    expect(
      service.getPSPByPSPName(TypeConverters.toPSPName('Unknown')!),
    ).toBeNull();
  });

  it('should return exempt result for exempt domains', () => {
    const url = 'https://example.com/checkout';
    const content = '<script src="https://js.stripe.com/v3/"></script>';
    const result = service.detectPSP(url, content);
    expect(PSPDetectionResult.isExempt(result)).toBe(true);
  });

  it('should detect PSP using string arrays', () => {
    const configWithMatchStrings: PSPConfig = {
      psps: [
        {
          name: TypeConverters.toPSPName('Stripe')!,
          matchStrings: ['checkout.stripe.com', 'js.stripe.com'],
          url: TypeConverters.toURL('https://stripe.com')!,
          image: 'stripe',
          summary: 'Stripe summary',
        },
        {
          name: TypeConverters.toPSPName('Adyen')!,
          matchStrings: ['checkoutshopper-live.adyen.com', 'cdn.adyen.com'],
          url: TypeConverters.toURL('https://adyen.com')!,
          image: 'adyen',
          summary: 'Adyen summary',
        },
      ],
    };

    const pspDetectorService = new PSPDetectorService();
    pspDetectorService.initialize(configWithMatchStrings);

    // Set exempt domains
    pspDetectorService.setExemptDomains(['example.com', 'google.com']);

    // Test direct hostname match
    const stripeUrl = 'https://checkout.stripe.com/session/pay_123';
    const stripeContent = '<div>Stripe checkout</div>';
    const stripeResult = pspDetectorService.detectPSP(stripeUrl, stripeContent);
    expect(PSPDetectionResult.isDetected(stripeResult)).toBe(true);
    if (PSPDetectionResult.isDetected(stripeResult)) {
      expect(stripeResult.psp).toBe('Stripe');
    }

    // Test subdomain match
    const adyenUrl = 'https://checkoutshopper-live.adyen.com/checkout';
    const adyenContent = '<div>Adyen checkout</div>';
    const adyenResult = pspDetectorService.detectPSP(adyenUrl, adyenContent);
    expect(PSPDetectionResult.isDetected(adyenResult)).toBe(true);
    if (PSPDetectionResult.isDetected(adyenResult)) {
      expect(adyenResult.psp).toBe('Adyen');
    }

    // Test no match (should be exempt due to example.com being in exempt
    // domains)
    const nonMatchUrl = 'https://example.com/checkout';
    const nonMatchContent = '<div>Generic checkout</div>';
    const nonMatchResult = pspDetectorService.detectPSP(
      nonMatchUrl,
      nonMatchContent,
    );
    expect(PSPDetectionResult.isExempt(nonMatchResult)).toBe(true);
  });

  it('should detect PSP matchString in page content (not just URL)', () => {
    const configWithMatchStrings: PSPConfig = {
      psps: [
        {
          name: TypeConverters.toPSPName('Stripe')!,
          matchStrings: ['js.stripe.com', 'checkout.stripe.com'],
          url: TypeConverters.toURL('https://stripe.com')!,
          image: 'stripe',
          summary: 'Stripe summary',
        },
      ],
    };

    const pspDetectorService = new PSPDetectorService();
    pspDetectorService.initialize(configWithMatchStrings);
    pspDetectorService.setExemptDomains(['example.com']);

    // Test hostname detection in script tag
    const shopUrl = 'https://shop.merchant.com/checkout';
    const stripeScriptContent =
      '<script src="https://js.stripe.com/v3/"></script><div>Payment form</div>';
    const scriptResult = pspDetectorService.detectPSP(
      shopUrl,
      stripeScriptContent,
    );
    expect(PSPDetectionResult.isDetected(scriptResult)).toBe(true);
    if (PSPDetectionResult.isDetected(scriptResult)) {
      expect(scriptResult.psp).toBe('Stripe');
    }

    // Test hostname detection in iframe
    const merchantUrl = 'https://ecommerce.site.com/payment';
    const iframeContent =
      '<iframe src="https://checkout.stripe.com/sessions/pay_123"></iframe>';
    const iframeResult = pspDetectorService.detectPSP(
      merchantUrl,
      iframeContent,
    );
    expect(PSPDetectionResult.isDetected(iframeResult)).toBe(true);
    if (PSPDetectionResult.isDetected(iframeResult)) {
      expect(iframeResult.psp).toBe('Stripe');
    }

    // Test hostname detection in form action
    const checkoutUrl = 'https://store.example.org/pay';
    const formContent =
      '<form action="https://checkout.stripe.com/submit" method="post"></form>';
    const formResult = pspDetectorService.detectPSP(checkoutUrl, formContent);
    expect(PSPDetectionResult.isDetected(formResult)).toBe(true);
    if (PSPDetectionResult.isDetected(formResult)) {
      expect(formResult.psp).toBe('Stripe');
    }
  });
});
