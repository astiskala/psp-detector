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
});
