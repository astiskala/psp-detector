import {
  createSafeUrl,
  safeCompileRegex,
  logger,
  debouncedMutation,
  memoryUtils,
  normalizeStringArray,
  fetchWithTimeout,
  performanceUtils,
  errorUtils,
  getAllProviders,
} from './utils';
import { TypeConverters } from '../types';
import type { PSPConfig } from '../types';

describe('utils', () => {

  describe('URL utilities', () => {
    it('should create safe URL for valid URLs', () => {
      // Arrange
      const validUrl = 'https://example.com';

      // Act
      const result = createSafeUrl(validUrl);

      // Assert
      expect(result).toBe('https://example.com/');
    });

    it('should return hash fallback for invalid URLs', () => {
      // Arrange
      const invalidUrl = 'not a url';

      // Act
      const result = createSafeUrl(invalidUrl);

      // Assert
      expect(result).toBe('#');
    });

    it('should block unsupported URL protocols', () => {
      // Arrange
      // Build dynamically to avoid an executable URL literal.
      const unsafeUrl = ['javascript', ':alert(1)'].join('');

      // Act
      const result = createSafeUrl(unsafeUrl);

      // Assert
      expect(result).toBe('#');
    });

    it('should allow mailto URLs', () => {
      // Arrange
      const mailtoUrl = 'mailto:psp-detector@adamstiskala.com';

      // Act
      const result = createSafeUrl(mailtoUrl);

      // Assert
      expect(result).toBe('mailto:psp-detector@adamstiskala.com');
    });
  });

  describe('regex utilities', () => {
    it('should compile valid regex patterns', () => {
      // Arrange
      const validPattern = 'abc';

      // Act
      const result = safeCompileRegex(validPattern);

      // Assert
      expect(result).toBeInstanceOf(RegExp);
    });

    it('should return null for invalid regex patterns', () => {
      // Arrange
      const invalidPattern = '[';

      // Act
      const result = safeCompileRegex(invalidPattern);

      // Assert
      expect(result).toBeNull();
    });
  });

  it('logger methods do not throw', () => {
    expect(() => logger.debug('debug')).not.toThrow();
    expect(() => logger.info('info')).not.toThrow();
    expect(() => logger.warn('warn')).not.toThrow();
    expect(() => logger.error('error')).not.toThrow();
  });

  it('logger.info is disabled in production unless runtime debug flag is set', () => {
    const originalEnv = process.env['NODE_ENV'];
    const runtimeWindow = globalThis as typeof globalThis & {
      __PSP_DETECTOR_DEBUG__?: boolean;
    };
    const originalDebugFlag = runtimeWindow.__PSP_DETECTOR_DEBUG__;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {
      // No-op for testing
    });

    process.env['NODE_ENV'] = 'production';
    delete runtimeWindow.__PSP_DETECTOR_DEBUG__;

    logger.info('should-not-log');
    expect(logSpy).not.toHaveBeenCalled();

    runtimeWindow.__PSP_DETECTOR_DEBUG__ = true;
    logger.info('should-log');
    expect(logSpy).toHaveBeenCalledWith('[PSP Detector] should-log');

    logSpy.mockRestore();
    process.env['NODE_ENV'] = originalEnv;
    if (originalDebugFlag === undefined) {
      delete runtimeWindow.__PSP_DETECTOR_DEBUG__;
    } else {
      runtimeWindow.__PSP_DETECTOR_DEBUG__ = originalDebugFlag;
    }
  });

  it('debouncedMutation delays function calls', (done) => {
    const mockFn = jest.fn();
    const debouncedFn = debouncedMutation(mockFn, 50);

    debouncedFn();
    debouncedFn();
    debouncedFn();

    expect(mockFn).not.toHaveBeenCalled();

    setTimeout(() => {
      expect(mockFn).toHaveBeenCalledTimes(1);
      done();
    }, 100);
  });

  it('memoryUtils.cleanup executes cleanup functions', () => {
    const cleanupFn1 = jest.fn();
    const cleanupFn2 = jest.fn();
    const cleanupFns = [cleanupFn1, cleanupFn2];

    memoryUtils.cleanup(cleanupFns);

    expect(cleanupFn1).toHaveBeenCalledTimes(1);
    expect(cleanupFn2).toHaveBeenCalledTimes(1);
  });

  it('memoryUtils.cleanup handles errors in cleanup functions gracefully', () => {
    const throwingFn = jest.fn(() => {
      throw new Error('Cleanup error');
    });
    const normalFn = jest.fn();
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {
        // No-op for testing
      });

    expect(() => memoryUtils.cleanup([throwingFn, normalFn])).not.toThrow();
    expect(throwingFn).toHaveBeenCalledTimes(1);
    expect(normalFn).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('logger.time and logger.timeEnd work in development mode', () => {
    const originalEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';

    const timeSpy = jest
      .spyOn(console, 'time')
      .mockImplementation(() => {
        // No-op for testing
      });
    const timeEndSpy = jest
      .spyOn(console, 'timeEnd')
      .mockImplementation(() => {
        // No-op for testing
      });

    logger.time('test-timer');
    logger.timeEnd('test-timer');

    expect(timeSpy).toHaveBeenCalledWith('[PSP Detector] test-timer');
    expect(timeEndSpy).toHaveBeenCalledWith('[PSP Detector] test-timer');

    timeSpy.mockRestore();
    timeEndSpy.mockRestore();
    process.env['NODE_ENV'] = originalEnv;
  });

  describe('array normalization utilities', () => {
    it('normalizes, lowercases, and deduplicates while preserving order', () => {
      const values = ['  Stripe.com ', 'PAYPAL', 'stripe.com', ' ', 'PayPal'];
      expect(normalizeStringArray(values)).toEqual(['stripe.com', 'paypal']);
    });
  });

  describe('fetchWithTimeout', () => {
    it('forwards request init and returns fetch response', async() => {
      const originalFetch = globalThis.fetch;
      const response = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async() => ({}),
      } as unknown as Response;
      const fetchMock = jest.fn().mockResolvedValue(response);
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const result = await fetchWithTimeout('https://example.com', 100, {
          method: 'POST',
          headers: { 'x-test': '1' },
        });

        expect(result).toBe(response);
        expect(fetchMock).toHaveBeenCalledWith(
          'https://example.com',
          expect.objectContaining({
            method: 'POST',
            headers: { 'x-test': '1' },
            signal: expect.any(AbortSignal),
          }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('aborts when timeout elapses', async() => {
      jest.useFakeTimers();
      const originalFetch = globalThis.fetch;
      const fetchMock = jest.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        });
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const requestPromise = fetchWithTimeout('https://example.com', 5);
        jest.advanceTimersByTime(10);
        await expect(requestPromise).rejects.toMatchObject({
          name: 'AbortError',
        });
      } finally {
        globalThis.fetch = originalFetch;
        jest.useRealTimers();
      }
    });

    it('propagates parent abort signal to the request signal', async() => {
      const originalFetch = globalThis.fetch;
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        json: async() => ({}),
      } as unknown as Response);
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const controller = new AbortController();
      controller.abort();

      try {
        await fetchWithTimeout('https://example.com', 1000, {
          signal: controller.signal,
        });

        const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        expect(init?.signal?.aborted).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('memory utilities', () => {
    it('checkMemoryUsage warns when heap usage is high', () => {
      const performanceLike = window.performance as unknown as {
        memory?: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      };
      const originalMemory = performanceLike.memory;
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
        // No-op for testing
      });

      Object.defineProperty(performanceLike, 'memory', {
        configurable: true,
        value: {
          usedJSHeapSize: 900,
          totalJSHeapSize: 1000,
          jsHeapSizeLimit: 1000,
        },
      });

      memoryUtils.checkMemoryUsage('utils-test');
      expect(warnSpy).toHaveBeenCalled();

      if (originalMemory === undefined) {
        delete performanceLike.memory;
      } else {
        Object.defineProperty(performanceLike, 'memory', {
          configurable: true,
          value: originalMemory,
        });
      }

      warnSpy.mockRestore();
    });

    it('cleanup manager executes all resources once and clears state', () => {
      const manager = memoryUtils.createCleanupManager();
      const first = jest.fn();
      const second = jest.fn();

      manager.add(first);
      manager.add(second);

      manager.cleanup();
      manager.cleanup();

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe('performance utilities', () => {
    it('measure returns function result and wraps timer calls', () => {
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';
      const timeSpy = jest.spyOn(console, 'time').mockImplementation(() => {
        // No-op for testing
      });
      const timeEndSpy = jest
        .spyOn(console, 'timeEnd')
        .mockImplementation(() => {
          // No-op for testing
        });

      const value = performanceUtils.measure(() => 'ok', 'sync-measure');
      expect(value).toBe('ok');
      expect(timeSpy).toHaveBeenCalledWith('[PSP Detector] sync-measure');
      expect(timeEndSpy).toHaveBeenCalledWith('[PSP Detector] sync-measure');

      timeSpy.mockRestore();
      timeEndSpy.mockRestore();
      process.env['NODE_ENV'] = originalEnv;
    });

    it('measureAsync calls timeEnd even when function rejects', async() => {
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';
      const timeSpy = jest.spyOn(console, 'time').mockImplementation(() => {
        // No-op for testing
      });
      const timeEndSpy = jest
        .spyOn(console, 'timeEnd')
        .mockImplementation(() => {
          // No-op for testing
        });

      await expect(
        performanceUtils.measureAsync(async() => {
          throw new Error('boom');
        }, 'async-measure'),
      ).rejects.toThrow('boom');

      expect(timeSpy).toHaveBeenCalledWith('[PSP Detector] async-measure');
      expect(timeEndSpy).toHaveBeenCalledWith('[PSP Detector] async-measure');

      timeSpy.mockRestore();
      timeEndSpy.mockRestore();
      process.env['NODE_ENV'] = originalEnv;
    });

    it('throttle executes once per interval', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const throttled = performanceUtils.throttle(fn, 50);

      throttled('first');
      throttled('second');
      expect(fn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(60);
      throttled('third');
      expect(fn).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe('error utilities', () => {
    it('safeExecute returns fallback when function throws', () => {
      expect(errorUtils.safeExecute(() => {
        throw new Error('oops');
      }, 'safe execute', 'fallback')).toBe('fallback');
    });

    it('safeExecuteAsync returns fallback when async function throws', async() => {
      await expect(errorUtils.safeExecuteAsync(async() => {
        throw new Error('oops');
      }, 'safe execute async', 'fallback')).resolves.toBe('fallback');
    });

    it('withRetry retries and resolves on a later success', async() => {
      const fn = jest
        .fn<Promise<string>, []>()
        .mockRejectedValueOnce('temporary failure')
        .mockResolvedValueOnce('ok');
      const retry = errorUtils.withRetry(fn, 2, 0);

      await expect(retry()).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('withRetry enforces at least one attempt and rethrows final error', async() => {
      const fn = jest.fn<Promise<string>, []>().mockRejectedValue('fatal');
      const retry = errorUtils.withRetry(fn, 0, 0);

      await expect(retry()).rejects.toBeInstanceOf(Error);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('provider utilities', () => {
    it('getAllProviders returns PSPs, orchestrators, and TSPs in order', () => {
      const config: PSPConfig = {
        psps: [{
          name: TypeConverters.toPSPName('Stripe')!,
          url: TypeConverters.toURL('https://stripe.com')!,
          image: 'stripe',
          summary: 'Stripe',
        }],
        orchestrators: {
          notice: 'orchestrators',
          list: [{
            name: TypeConverters.toPSPName('Primer')!,
            url: TypeConverters.toURL('https://primer.io')!,
            image: 'primer',
            summary: 'Primer',
          }],
        },
        tsps: {
          notice: 'tsps',
          list: [{
            name: TypeConverters.toPSPName('VGS')!,
            url: TypeConverters.toURL('https://vgs.io')!,
            image: 'vgs',
            summary: 'VGS',
          }],
        },
      };

      expect(getAllProviders(config).map((provider) => provider.name)).toEqual([
        'Stripe',
        'Primer',
        'VGS',
      ]);
    });
  });

});
