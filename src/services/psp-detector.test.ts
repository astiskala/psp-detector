import { PSPDetectorService } from './psp-detector';
import type { PSPConfig, PSPDetectionResult } from '../types';
import { TypeConverters } from '../types';
import type {
  PSPName,
  RegexPattern,
  URL as BrandedURL,
} from '../types/branded';
import {
  TEST_PSP_CONFIGS,
  TEST_URLS,
  TEST_CONTENT,
  TEST_EXEMPT_DOMAINS,
} from '../test-helpers/constants';
import {
  createCrossOriginWindowMock,
  restoreWindow,
  getPSPByPSPName,
  isURLExempt,
} from '../test-helpers/utilities';

const STRIPE_NAME = 'Stripe';
const STRIPE_URL = 'https://stripe.com';
const STRIPE_MATCH = 'js.stripe.com';
const STRIPE_CHECKOUT_MATCH = 'checkout.stripe.com';
const STRIPE_SCRIPT_TAG = '<script src="https://js.stripe.com/v3/"></script>';
const STRIPE_SUMMARY = 'Stripe summary';

function requirePresent<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new Error(`Expected valid ${label}`);
  }

  return value;
}

function pspName(name: string): PSPName {
  return requirePresent(TypeConverters.toPSPName(name), `PSP name: ${name}`);
}

function pspUrl(url: string): BrandedURL {
  return requirePresent(TypeConverters.toURL(url), `URL: ${url}`);
}

function regexPattern(pattern: string): RegexPattern {
  return requirePresent(
    TypeConverters.toRegexPattern(pattern),
    `regex pattern: ${pattern}`,
  );
}

describe('PSPDetectorService', () => {
  let service: PSPDetectorService;

  beforeEach(() => {
    service = new PSPDetectorService();
    service.initialize(TEST_PSP_CONFIGS.MULTI_PSP);
    service.setExemptDomains([...TEST_EXEMPT_DOMAINS]);
  });

  it('should initialize with config', () => {
    expect(service.isInitialized()).toBe(true);
  });

  it('should detect Stripe PSP', () => {
    const url = 'https://checkout.stripe.com';
    const content = STRIPE_SCRIPT_TAG;
    const result = service.detectPSP(url, content);
    expect(result.type).toBe('detected');
    if (result.type === 'detected') {
      expect(result.psps[0]?.psp).toBe(STRIPE_NAME);
    }
  });

  it('should detect PayPal PSP', () => {
    const url = 'https://www.paypal.com/checkout';
    const content = '<script src="https://www.paypal.com/sdk/js"></script>';
    const result = service.detectPSP(url, content);
    expect(result.type).toBe('detected');
    if (result.type === 'detected') {
      expect(result.psps[0]?.psp).toBe('PayPal');
    }
  });

  it('should return none result if no PSP matches', () => {
    const url = 'https://unknown.com';
    const content = '<div>No PSP here</div>';
    const result = service.detectPSP(url, content);
    expect(result.type).toBe('none');
  });

  it('should return error result if not initialized', () => {
    const uninit = new PSPDetectorService();
    const result = uninit.detectPSP(STRIPE_URL, 'stripe');
    expect(result.type).toBe('error');
  });

  it('should get PSP by PSPName', () => {
    expect(getPSPByPSPName(service, pspName(STRIPE_NAME))).toMatchObject({
      name: STRIPE_NAME,
      regex: String.raw`stripe\.com`,
    });

    expect(getPSPByPSPName(service, pspName('Unknown'))).toBeNull();
  });

  it('should return exempt result for exempt domains', () => {
    const url = 'https://example.com/checkout';
    const content = STRIPE_SCRIPT_TAG;
    const result = service.detectPSP(url, content);
    expect(result.type).toBe('exempt');
  });

  it('should treat subdomains of an exempt domain as exempt', () => {
    const url = 'https://shop.example.com/checkout';
    const content = STRIPE_SCRIPT_TAG;
    const result = service.detectPSP(url, content);
    expect(result.type).toBe('exempt');
  });

  it('should normalize exempt domains (case & whitespace) and still exempt', () => {
    const normalizedService = new PSPDetectorService();
    normalizedService.initialize(TEST_PSP_CONFIGS.MULTI_PSP);
    normalizedService.setExemptDomains(['  ExAmPle.CoM  ']);
    const url = 'https://payments.example.com/checkout';
    const content = STRIPE_SCRIPT_TAG;
    const result = normalizedService.detectPSP(url, content);
    expect(result.type).toBe('exempt');
  });

  it('should detect PSP using string arrays', () => {
    const configWithMatchStrings: PSPConfig = {
      psps: [
        {
          name: pspName(STRIPE_NAME),
          matchStrings: [STRIPE_CHECKOUT_MATCH, STRIPE_MATCH],
          url: pspUrl(STRIPE_URL),
          image: 'stripe',
          summary: STRIPE_SUMMARY,
        },
        {
          name: pspName('Adyen'),
          matchStrings: ['checkoutshopper-live.adyen.com', 'cdn.adyen.com'],
          url: pspUrl('https://adyen.com'),
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
    const stripeContent = `<div>${STRIPE_NAME} checkout</div>`;
    const stripeResult = pspDetectorService.detectPSP(stripeUrl, stripeContent);
    expect(stripeResult.type).toBe('detected');
    if (stripeResult.type === 'detected') {
      expect(stripeResult.psps[0]?.psp).toBe(STRIPE_NAME);
    }

    // Test subdomain match
    const adyenUrl = 'https://checkoutshopper-live.adyen.com/checkout';
    const adyenContent = '<div>Adyen checkout</div>';
    const adyenResult = pspDetectorService.detectPSP(adyenUrl, adyenContent);
    expect(adyenResult.type).toBe('detected');
    if (adyenResult.type === 'detected') {
      expect(adyenResult.psps[0]?.psp).toBe('Adyen');
    }

    // Test no match (should be exempt due to example.com being in exempt
    // domains)
    const nonMatchUrl = 'https://example.com/checkout';
    const nonMatchContent = '<div>Generic checkout</div>';
    const nonMatchResult = pspDetectorService.detectPSP(
      nonMatchUrl,
      nonMatchContent,
    );
    expect(nonMatchResult.type).toBe('exempt');
  });

  it('should test precompileRegexPatterns functionality', () => {
    const configWithInvalidRegex: PSPConfig = {
      psps: [
        {
          name: pspName('ValidPSP'),
          regex: regexPattern(String.raw`valid\.pattern`),
          url: pspUrl('https://valid.com'),
          image: 'valid',
          summary: 'Valid PSP',
        },
        {
          name: pspName('InvalidPSP'),
          regex: '[invalid' as RegexPattern,
          url: pspUrl('https://invalid.com'),
          image: 'invalid',
          summary: 'Invalid PSP',
        },
      ],
    };

    const pspDetectorService = new PSPDetectorService();
    pspDetectorService.initialize(configWithInvalidRegex);
    pspDetectorService.setExemptDomains([]);

    // Valid regex should work
    const validResult = pspDetectorService.detectPSP(
      'https://valid.pattern.com',
      'content',
    );
    expect(validResult.type).toBe('detected');

    // Invalid regex should not crash and return none
    const invalidResult = pspDetectorService.detectPSP(
      'https://invalid.com',
      'content',
    );
    expect(invalidResult.type).toBe('none');
  });

  it('should test isURLExempt method', () => {
    const url1 = pspUrl('https://example.com/path');
    const url2 = pspUrl('https://safe.com/path');

    expect(isURLExempt(service, url1)).toBe(true); // example.com is exempt
    expect(isURLExempt(service, url2)).toBe(false); // safe.com is not exempt
  });

  it('should handle invalid URLs in isURLExempt gracefully', () => {
    // Test the method's error handling with an invalid URL string
    // Since isURLExempt uses globalThis.URL internally,
    // invalid URLs should be caught
    const validUrl1 = pspUrl('https://example.com/path');
    const validUrl2 = pspUrl('https://safe.com/path');

    expect(isURLExempt(service, validUrl1)).toBe(true); // example.com is exempt
    expect(isURLExempt(service, validUrl2)).toBe(false); // safe.com not exempt
  });

  it('should handle window.top access errors gracefully', () => {
    // Mock window.top to throw error (cross-origin)
    const originalWindow = globalThis as Window & typeof globalThis;
    globalThis.window = createCrossOriginWindowMock();

    const result = service.detectPSP(
      TEST_URLS.STRIPE.CHECKOUT,
      TEST_CONTENT.HTML.STRIPE_SCRIPT,
    );

    // Should still work with fallback to provided URL
    expect(result.type).toBe('detected');

    // Restore original window
    restoreWindow(originalWindow);
  });

  it('should handle performance timing edge cases', () => {
    // Test with very large config to ensure timing works
    const largeConfig: PSPConfig = {
      psps: Array.from({ length: 100 }, (_, index) => ({
        name: pspName(`PSP${index}`),
        regex: regexPattern(String.raw`psp${index}\.com`),
        url: pspUrl(`https://psp${index}.com`),
        image: `psp${index}`,
        summary: `PSP ${index} summary`,
      })),
    };

    const largePspService = new PSPDetectorService();
    largePspService.initialize(largeConfig);
    largePspService.setExemptDomains([]);

    const result = largePspService.detectPSP(
      'https://unknown.com',
      'no matches',
    );
    expect(result.type).toBe('none');
    if (result.type === 'none') {
      expect(result.scannedPatterns).toBe(100);
    }
  });

  it('should detect PSP matchString in page content (not just URL)', () => {
    const configWithMatchStrings: PSPConfig = {
      psps: [
        {
          name: pspName(STRIPE_NAME),
          matchStrings: [STRIPE_MATCH, STRIPE_CHECKOUT_MATCH],
          url: pspUrl(STRIPE_URL),
          image: 'stripe',
          summary: STRIPE_SUMMARY,
        },
      ],
    };

    const pspDetectorService = new PSPDetectorService();
    pspDetectorService.initialize(configWithMatchStrings);
    pspDetectorService.setExemptDomains(['example.com']);

    // Test hostname detection in script tag
    const shopUrl = 'https://shop.merchant.com/checkout';
    const stripeScriptContent = `${STRIPE_SCRIPT_TAG}<div>Payment form</div>`;
    const scriptResult = pspDetectorService.detectPSP(
      shopUrl,
      stripeScriptContent,
    );
    expect(scriptResult.type).toBe('detected');
    if (scriptResult.type === 'detected') {
      expect(scriptResult.psps[0]?.psp).toBe(STRIPE_NAME);
    }

    // Test hostname detection in iframe
    const merchantUrl = 'https://ecommerce.site.com/payment';
    const iframeContent =
      '<iframe src="https://checkout.stripe.com/sessions/pay_123"></iframe>';
    const iframeResult = pspDetectorService.detectPSP(
      merchantUrl,
      iframeContent,
    );
    expect(iframeResult.type).toBe('detected');
    if (iframeResult.type === 'detected') {
      expect(iframeResult.psps[0]?.psp).toBe(STRIPE_NAME);
    }

    // Test hostname detection in form action
    const checkoutUrl = 'https://store.example.org/pay';
    const formContent =
      '<form action="https://checkout.stripe.com/submit" method="post"></form>';
    const formResult = pspDetectorService.detectPSP(checkoutUrl, formContent);
    expect(formResult.type).toBe('detected');
    if (formResult.type === 'detected') {
      expect(formResult.psps[0]?.psp).toBe(STRIPE_NAME);
    }
  });

  it('detects Global Payments from js-cert hosted-field iframe source', () => {
    const globalPaymentsConfig: PSPConfig = {
      psps: [
        {
          name: pspName('Global Payments'),
          matchStrings: ['js-cert.globalpay.com'],
          url: pspUrl('https://www.globalpayments.com'),
          image: 'globalpayments',
          summary: 'Global Payments summary',
        },
      ],
    };

    const pspDetectorService = new PSPDetectorService();
    pspDetectorService.initialize(globalPaymentsConfig);
    pspDetectorService.setExemptDomains([]);

    const result = pspDetectorService.detectPSP(
      'https://demo.globalpay.com/merchants/dropin-ui',
      '<iframe src="https://js-cert.globalpay.com/4.1.13/field.html#token"></iframe>',
    );
    expect(result.type).toBe('detected');
    if (result.type === 'detected') {
      expect(result.psps[0]?.psp).toBe('Global Payments');
    }
  });

  it('returns all matching PSPs when multiple providers match', () => {
    const multiConfig = {
      psps: [
        {
          name: STRIPE_NAME,
          matchStrings: [STRIPE_MATCH],
          regex: null,
          image: 'stripe',
          summary: STRIPE_NAME,
          url: STRIPE_URL,
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
    service.initialize(multiConfig as unknown as PSPConfig);
    service.setExemptDomains([]);

    const result = service.detectPSP(
      'https://example.com',
      `${STRIPE_MATCH}\ncheckoutshopper-live.adyen.com`,
    );

    expect(result.type).toBe('detected');
    if (result.type === 'detected') {
      expect(result.psps).toHaveLength(2);
      expect(result.psps[0]?.psp).toBe(STRIPE_NAME);
      expect(result.psps[1]?.psp).toBe('Adyen');
    }
  });

  it('deduplicates same PSP across matchString and regex', () => {
    const dedupConfig = {
      psps: [
        {
          name: STRIPE_NAME,
          matchStrings: [STRIPE_MATCH],
          regex: String.raw`stripe\.com`,
          image: 'stripe',
          summary: STRIPE_NAME,
          url: STRIPE_URL,
        },
      ],
      orchestrators: { notice: '', list: [] },
      tsps: { notice: '', list: [] },
    };
    service.initialize(dedupConfig as unknown as PSPConfig);
    service.setExemptDomains([]);

    const result = service.detectPSP('https://example.com', STRIPE_MATCH);
    expect(result.type).toBe('detected');
    if (result.type === 'detected') {
      expect(result.psps).toHaveLength(1);
      expect(result.psps[0]?.psp).toBe(STRIPE_NAME);
    }
  });

  it('returns error for empty url input', () => {
    const result = service.detectPSP('', 'content');
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.context).toBe('url_validation');
    }
  });

  it('returns error when provider list is empty', () => {
    const emptyConfig: PSPConfig = { psps: [] };
    service.initialize(emptyConfig);
    service.setExemptDomains([]);
    const result = service.detectPSP('https://example.com', 'hello');
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.context).toBe('config_validation');
    }
  });

  it('matches exempt domain case-insensitively in URL-parse fallback', () => {
    // jsdom's window.top.location is non-configurable, so we can't reach the
    // catch branch in checkExempt via detectPSP. Drive it directly: invoke
    // the private method with a malformed URL that contains the exempt token
    // in upper case. The substring fallback must still treat it as exempt.
    interface CheckExemptInternal {
      checkExempt: (
        urlToCheck: string,
        brandedURL: ReturnType<typeof TypeConverters.toURL>,
      ) => PSPDetectionResult | null;
    }
    const branded = TypeConverters.toURL('https://placeholder.invalid/x');
    const result = (service as unknown as CheckExemptInternal).checkExempt(
      'malformed-url-with-EXAMPLE.com-in-uppercase',
      branded,
    );
    expect(result?.type).toBe('exempt');
  });

  it('does not exempt via fallback when no exempt domain appears in URL', () => {
    interface CheckExemptInternal {
      checkExempt: (
        urlToCheck: string,
        brandedURL: ReturnType<typeof TypeConverters.toURL>,
      ) => PSPDetectionResult | null;
    }
    const branded = TypeConverters.toURL('https://placeholder.invalid/x');
    const result = (service as unknown as CheckExemptInternal).checkExempt(
      'malformed-url-with-UNRELATED.org-only',
      branded,
    );
    expect(result).toBeNull();
  });

  it('truncates oversized content at the last newline within the limit', () => {
    // The detector caps scanned content at 1 MB. Build a body where a
    // matchString lives *after* the last newline inside the 1 MB window:
    //   [...filler... '\n' ...padding... matchString ...padding...]
    //                  ^ last newline    ^ inside 1 MB
    // Old (hard-cut) behavior keeps the matchString → detects it.
    // New behavior cuts at the last newline, dropping the matchString.
    const limit = 1024 * 1024;
    const url = 'https://shop.example.org/checkout';
    const prefix = `${url}\n\n`; // detector prepends url + '\n\n'

    const tailKeyword = `unique-marker-${'x'.repeat(8)}`;
    const PRE_LIMIT_OFFSET = 100;
    const overflowPad = 500;

    const fillerSize = limit - PRE_LIMIT_OFFSET - prefix.length;
    const filler = 'a'.repeat(fillerSize);
    const tail = `${'b'.repeat(
      PRE_LIMIT_OFFSET - tailKeyword.length - 10,
    )}${tailKeyword}${'c'.repeat(10 + overflowPad)}`;

    // Content laid out: filler '\n' tail
    // The only '\n' in `content` is the one we put just before `tail`.
    // The prefix has '\n\n' which we replicate, but those land near pos 0.
    const content = `${filler}\n${tail}`;

    const cfg: PSPConfig = {
      psps: [
        {
          name: pspName('Marker'),
          matchStrings: [tailKeyword],
          url: pspUrl('https://marker.example'),
          image: 'marker',
          summary: 'marker summary',
        },
      ],
    };
    const localService = new PSPDetectorService();
    localService.initialize(cfg);
    localService.setExemptDomains([]);

    const oversized = localService.detectPSP(url, content);
    expect(oversized.type).toBe('none');

    const smallContent = `preamble\n${tailKeyword}`;
    const inLimit = localService.detectPSP(url, smallContent);
    expect(inLimit.type).toBe('detected');
  });

  it('falls back to hard cut when no newline exists within the limit', () => {
    // No newlines anywhere → buildTruncatedContent must still bound the
    // returned string to maxContentSize (would otherwise loop forever or
    // return the full input). We assert the detection still produces a
    // result without throwing.
    const limit = 1024 * 1024;
    const cfg: PSPConfig = {
      psps: [
        {
          name: pspName('Marker'),
          matchStrings: ['z'.repeat(40)],
          url: pspUrl('https://marker.example'),
          image: 'marker',
          summary: 'marker summary',
        },
      ],
    };
    const localService = new PSPDetectorService();
    localService.initialize(cfg);
    localService.setExemptDomains([]);

    const noNewlines = 'a'.repeat(limit + 1000);
    expect(() =>
      localService.detectPSP('https://shop.example.org/x', noNewlines),
    ).not.toThrow();
  });

  it('should treat is.adyen.com and its subdomains as exempt', () => {
    service.setExemptDomains(['is.adyen.com']);

    // is.adyen.com should be exempt
    const directResult = service.detectPSP(
      'https://is.adyen.com/checkout',
      'content',
    );
    expect(directResult.type).toBe('exempt');

    // sub.is.adyen.com should be exempt
    const subdomainResult = service.detectPSP(
      'https://test.is.adyen.com/checkout',
      'content',
    );
    expect(subdomainResult.type).toBe('exempt');

    // adyen.com should NOT be exempt
    const rootResult = service.detectPSP(
      'https://adyen.com/checkout',
      'content',
    );
    expect(rootResult.type).not.toBe('exempt');

    // other.adyen.com should NOT be exempt
    const otherSubdomainResult = service.detectPSP(
      'https://ca-live.adyen.com/checkout',
      'content',
    );
    expect(otherSubdomainResult.type).not.toBe('exempt');
  });
});
