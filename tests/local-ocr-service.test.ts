import { describe, expect, it } from 'vitest';
import { normalizeRuntimeLine } from '@main/assistant/LocalOcrService';

describe('local OCR runtime normalization', () => {
  it('maps guten OCR box and mean fields into the internal frame and score shape', () => {
    const line = normalizeRuntimeLine({
      text: '10.在电气设备上工作，保证安全的技术措施由（ ）执行。',
      mean: 0.93,
      box: [
        [12, 24],
        [252, 24],
        [252, 56],
        [12, 56]
      ]
    });

    expect(line).toEqual({
      text: '10.在电气设备上工作，保证安全的技术措施由（ ）执行。',
      score: 0.93,
      frame: {
        left: 12,
        top: 24,
        width: 240,
        height: 32
      }
    });
  });

  it('drops invalid OCR lines that have no usable frame information', () => {
    const line = normalizeRuntimeLine({
      text: 'A.设备管理人员',
      mean: 0.88
    });

    expect(line).toBeNull();
  });
});
