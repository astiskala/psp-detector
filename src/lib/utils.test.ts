import {
  debounce,
  createSafeUrl,
  safeCompileRegex,
  isUrlExempt,
  createContextError,
  logger,
  reportError,
  debouncedMutation,
  memoryUtils,
} from "./utils";

describe("utils", () => {
  it("debounce should delay execution", (done) => {
    let count = 0;
    const fn = debounce(() => {
      count++;
    }, 10);
    fn();
    fn();
    fn();
    setTimeout(() => {
      expect(count).toBe(1);
      done();
    }, 30);
  });

  it("createSafeUrl returns valid URL or #", () => {
    expect(createSafeUrl("https://example.com")).toBe("https://example.com/");
    expect(createSafeUrl("not a url")).toBe("#");
  });

  it("safeCompileRegex returns RegExp or null", () => {
    expect(safeCompileRegex("abc")).toBeInstanceOf(RegExp);
    expect(safeCompileRegex("[")).toBeNull();
  });

  it("isUrlExempt returns correct boolean", () => {
    const exemptDomains = ["example.com", "test.org"];
    expect(isUrlExempt("https://example.com/page", exemptDomains)).toBe(true);
    expect(isUrlExempt("https://test.org/path", exemptDomains)).toBe(true);
    expect(isUrlExempt("https://other.com", exemptDomains)).toBe(false);
    expect(isUrlExempt("https://different.net", exemptDomains)).toBe(false);
  });

  it("createContextError attaches context", () => {
    const context = {
      component: "test",
      action: "testing",
      extensionVersion: "1.0.0",
    };
    const err = createContextError("msg", context);
    expect(err).toBeInstanceOf(Error);
    expect(err.context).toEqual(
      expect.objectContaining({
        component: "test",
        action: "testing",
        extensionVersion: "1.0.0",
        timestamp: expect.any(Number),
      }),
    );
  });

  it("logger methods do not throw", () => {
    expect(() => logger.debug("debug")).not.toThrow();
    expect(() => logger.info("info")).not.toThrow();
    expect(() => logger.warn("warn")).not.toThrow();
    expect(() => logger.error("error")).not.toThrow();
  });

  it("reportError handles errors gracefully", () => {
    const error = new Error("test error");
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => reportError(error, { component: "test" })).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("debouncedMutation delays function calls", (done) => {
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

  it("memoryUtils.cleanup executes cleanup functions", () => {
    const cleanupFn1 = jest.fn();
    const cleanupFn2 = jest.fn();
    const cleanupFns = [cleanupFn1, cleanupFn2];

    memoryUtils.cleanup(cleanupFns);

    expect(cleanupFn1).toHaveBeenCalledTimes(1);
    expect(cleanupFn2).toHaveBeenCalledTimes(1);
  });

  it("memoryUtils.throttle limits function calls", (done) => {
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
