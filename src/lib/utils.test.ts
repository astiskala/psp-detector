import {
  debounce,
  createSafeUrl,
  safeCompileRegex,
  createContextError,
  logger,
  reportError,
  debouncedMutation,
  memoryUtils,
} from './utils';

describe('utils', () => {
  describe('debounce', () => {
    it('should delay function execution until after wait period', (done) => {
      // Arrange
      let count = 0;
      const fn = debounce(() => {
        count++;
      }, 10);

      // Act
      fn();
      fn();
      fn();

      // Assert
      setTimeout(() => {
        expect(count).toBe(1);
        done();
      }, 30);
    });

    it('should handle boundary values correctly with zero delay', (done) => {
      // Arrange
      let callCount = 0;
      const fn = debounce(() => callCount++, 0); // Zero delay

      // Act
      fn();
      fn();

      // Assert - With zero delay, should still debounce properly
      setTimeout(() => {
        expect(callCount).toBe(1);
        done();
      }, 10);
    });
  });

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

  it('createContextError attaches context', () => {
    const context = {
      component: 'test',
      action: 'testing',
      extensionVersion: '1.0.0',
    };
    const err = createContextError('msg', context);
    expect(err).toBeInstanceOf(Error);
    expect(err.context).toEqual(
      expect.objectContaining({
        component: 'test',
        action: 'testing',
        extensionVersion: '1.0.0',
        timestamp: expect.any(Number),
      }),
    );
  });

  it('logger methods do not throw', () => {
    expect(() => logger.debug('debug')).not.toThrow();
    expect(() => logger.info('info')).not.toThrow();
    expect(() => logger.warn('warn')).not.toThrow();
    expect(() => logger.error('error')).not.toThrow();
  });

  it('reportError handles errors gracefully', () => {
    const error = new Error('test error');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      // No-op for testing
    });

    expect(() => reportError(error, { component: 'test' })).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
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

  it('memoryUtils.createEventCleanup removes event listeners', () => {
    const element = document.createElement('div');
    const listener1 = jest.fn();
    const listener2 = jest.fn();
    const eventMap = new Map([
      ['click', listener1],
      ['scroll', listener2],
    ]);

    // Add event listeners
    eventMap.forEach((listener, event) => {
      element.addEventListener(event, listener);
    });

    // Create and execute cleanup
    const cleanup = memoryUtils.createEventCleanup(element, eventMap);
    cleanup();

    // Verify listeners are removed by checking map is cleared
    expect(eventMap.size).toBe(0);
  });

  it('memoryUtils.throttle limits function execution rate', (done) => {
    const mockFn = jest.fn();
    const throttledFn = memoryUtils.throttle(mockFn, 50);

    // Call multiple times rapidly
    throttledFn();
    throttledFn();
    throttledFn();

    // Should only execute once immediately
    expect(mockFn).toHaveBeenCalledTimes(1);

    // Wait for throttle period to pass
    setTimeout(() => {
      throttledFn();
      expect(mockFn).toHaveBeenCalledTimes(2);
      done();
    }, 60);
  });

  it('logger.time and logger.timeEnd work in development mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

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
    process.env.NODE_ENV = originalEnv;
  });

  it('createContextError handles invalid context gracefully', () => {
    const context = {
      component: 'test',
    };

    const err = createContextError('test message', context);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('test message');
    expect(err.context).toEqual(
      expect.objectContaining({
        component: 'test',

        // Should always have a valid timestamp
        timestamp: expect.any(Number),
      }),
    );
  });

  it('memoryUtils.throttle limits function calls', (done) => {
    const mockFn = jest.fn();
    const throttledFn = memoryUtils.throttle(mockFn, 50);

    throttledFn();
    throttledFn();
    throttledFn();

    expect(mockFn).toHaveBeenCalledTimes(1);

    setTimeout(() => {
      throttledFn();
      expect(mockFn).toHaveBeenCalledTimes(2);
      done();
    }, 100);
  });
});
