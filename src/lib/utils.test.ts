import {
  createSafeUrl,
  safeCompileRegex,
  logger,
  debouncedMutation,
  memoryUtils,
} from './utils';

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

});
