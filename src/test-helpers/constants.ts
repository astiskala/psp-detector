/**
 * Shared test constants and configuration
 */

import type { PSPConfig } from '../types';
import { TypeConverters } from '../types';

// Test timing constants
export const TEST_TIMEOUTS = {
  DEBOUNCE_SHORT: 10,
  DEBOUNCE_MEDIUM: 50,
  DEBOUNCE_LONG: 100,
  DOM_MUTATION_DELAY: 50,
  ASYNC_OPERATION: 100,
} as const;

// Common test PSP configurations
export const TEST_PSP_CONFIGS = {
  MINIMAL: {
    psps: [
      {
        name: TypeConverters.toPSPName('Stripe')!,
        regex: TypeConverters.toRegexPattern('stripe\\.com')!,
        url: TypeConverters.toURL('https://stripe.com')!,
        image: 'stripe',
        summary: 'Stripe payment processing',
      },
    ],
  } as PSPConfig,

  WITH_MATCH_STRINGS: {
    psps: [
      {
        name: TypeConverters.toPSPName('Stripe')!,
        matchStrings: ['js.stripe.com', 'checkout.stripe.com'],
        url: TypeConverters.toURL('https://stripe.com')!,
        image: 'stripe',
        summary: 'Stripe summary',
      },
    ],
  } as PSPConfig,

  MULTI_PSP: {
    psps: [
      {
        name: TypeConverters.toPSPName('Stripe')!,
        regex: TypeConverters.toRegexPattern('stripe\\.com')!,
        url: TypeConverters.toURL('https://stripe.com')!,
        image: 'stripe',
        summary: 'Stripe payment processing',
      },
      {
        name: TypeConverters.toPSPName('PayPal')!,
        regex: TypeConverters.toRegexPattern('paypal\\.com')!,
        url: TypeConverters.toURL('https://paypal.com')!,
        image: 'paypal',
        summary: 'PayPal payment processing',
      },
      {
        name: TypeConverters.toPSPName('Adyen')!,
        matchStrings: ['adyen.com', 'adyen-checkout'],
        url: TypeConverters.toURL('https://adyen.com')!,
        image: 'adyen',
        summary: 'Adyen payment processing',
      },
    ],
  } as PSPConfig,
} as const;

// Test URLs
export const TEST_URLS = {
  VALID: {
    HTTPS: 'https://example.com',
    HTTP: 'http://example.com',
    WITH_PATH: 'https://example.com/checkout',
    WITH_QUERY: 'https://example.com?param=value',
  },
  INVALID: {
    MALFORMED: 'not a url',
    EMPTY: '',
    PROTOCOL_ONLY: 'https://',
  },
  STRIPE: {
    MAIN: 'https://stripe.com',
    CHECKOUT: 'https://checkout.stripe.com',
    JS: 'https://js.stripe.com/v3/',
  },
} as const;

// Test content strings
export const TEST_CONTENT = {
  EMPTY: '',
  PLAIN_TEXT: 'This is plain text content',
  HTML: {
    STRIPE_SCRIPT: '<script src="https://js.stripe.com/v3/"></script>',
    STRIPE_IFRAME: '<iframe src="https://checkout.stripe.com/sessions/pay_123"></iframe>',
    STRIPE_FORM: '<form action="https://checkout.stripe.com/submit" method="post"></form>',
    PAYPAL_SCRIPT: '<script src="https://www.paypalobjects.com/api/checkout.js"></script>',
  },
} as const;

// Test exempt domains
export const TEST_EXEMPT_DOMAINS = ['example.com', 'localhost', 'test.com'] as const;

// Error messages for testing
export const TEST_ERROR_MESSAGES = {
  INVALID_URL: 'Invalid URL provided',
  REGEX_COMPILATION: 'Invalid regex pattern',
  INITIALIZATION: 'Service not properly initialized',
  DOM_ACCESS: 'Cross-origin access denied',
} as const;
