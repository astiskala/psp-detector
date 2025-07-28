import { debounce, createSafeUrl, safeCompileRegex, isUrlExempt, createContextError, logger } from './utils';

describe('utils', () => {
    it('debounce should delay execution', done => {
        let count = 0;
        const fn = debounce(() => { count++; }, 10);
        fn(); fn(); fn();
        setTimeout(() => {
            expect(count).toBe(1);
            done();
        }, 30);
    });

    it('createSafeUrl returns valid URL or #', () => {
        expect(createSafeUrl('https://example.com')).toBe('https://example.com/');
        expect(createSafeUrl('not a url')).toBe('#');
    });

    it('safeCompileRegex returns RegExp or null', () => {
        expect(safeCompileRegex('abc')).toBeInstanceOf(RegExp);
        expect(safeCompileRegex('[')).toBeNull();
    });

    it('isUrlExempt returns correct boolean', () => {
        const pattern = /example/;
        expect(isUrlExempt('https://example.com', pattern)).toBe(false);
        expect(isUrlExempt('https://test.com', pattern)).toBe(true);
    });

    it('createContextError attaches context', () => {
        const err = createContextError('msg', { foo: 1 });
        expect(err).toBeInstanceOf(Error);
        expect((err as any).context).toEqual({ foo: 1 });
    });

    it('logger methods do not throw', () => {
        expect(() => logger.debug('debug')).not.toThrow();
        expect(() => logger.info('info')).not.toThrow();
        expect(() => logger.warn('warn')).not.toThrow();
        expect(() => logger.error('error')).not.toThrow();
    });
});
