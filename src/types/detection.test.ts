import { PSPDetectionResult } from '../types/detection';
import { TypeConverters } from '../types/branded';

describe('PSPDetectionResult multi-PSP', () => {
  it('detected factory accepts array of psps', () => {
    const result = PSPDetectionResult.detected([
      {
        psp: TypeConverters.toPSPName('Stripe')!,
        detectionInfo: {
          method: 'matchString' as const,
          value: 'js.stripe.com',
          sourceType: 'scriptSrc' as const,
        },
      },
    ]);
    expect(result.type).toBe('detected');
    if (result.type === 'detected') {
      expect(result.psps).toHaveLength(1);
      expect(result.psps[0]?.psp).toBe('Stripe');
      expect(result.psps[0]?.detectionInfo?.sourceType).toBe('scriptSrc');
    }
  });

  it('none and error factories are unchanged', () => {
    expect(PSPDetectionResult.none(42).type).toBe('none');
    expect(PSPDetectionResult.error(new Error('x')).type).toBe('error');
  });

  it('builds exempt and contextual error results', () => {
    const url = TypeConverters.toURL('https://example.com')!;
    expect(PSPDetectionResult.exempt('disabled', url)).toEqual({
      type: 'exempt',
      reason: 'disabled',
      url,
    });

    const error = new Error('failed');
    expect(PSPDetectionResult.error(error, 'scan')).toEqual({
      type: 'error',
      error,
      context: 'scan',
    });
  });

  it('identifies only detected results', () => {
    const detected = PSPDetectionResult.detected([]);
    expect(PSPDetectionResult.isDetected(detected)).toBe(true);
    expect(PSPDetectionResult.isDetected(PSPDetectionResult.none(0))).toBe(
      false,
    );
  });
});

describe('TypeConverters', () => {
  it('rejects empty names, unsafe tab ids, malformed URLs, and invalid regexes', () => {
    expect(TypeConverters.toPSPName(' '.repeat(3))).toBeUndefined();
    expect(TypeConverters.toTabId(-1)).toBeUndefined();
    expect(TypeConverters.toTabId(1.5)).toBeUndefined();
    expect(TypeConverters.toURL('not a url')).toBeUndefined();
    expect(TypeConverters.toRegexPattern('[')).toBeUndefined();
  });

  it('brands valid tab ids and regex patterns', () => {
    expect(TypeConverters.toTabId(0)).toBe(0);
    expect(TypeConverters.toRegexPattern(String.raw`stripe\.com`)).toBe(
      String.raw`stripe\.com`,
    );
  });
});
