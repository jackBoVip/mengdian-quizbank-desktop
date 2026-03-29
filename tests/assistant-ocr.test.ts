import { describe, expect, it } from 'vitest';
import { findOcrAnchorIndex, normalizeOcrLines, selectOcrText, type OcrTextLine } from '@main/assistant/ocr';

const createLine = (text: string, top: number, left = 420, width = 520, height = 32, score = 0.92): OcrTextLine => ({
  text,
  score,
  frame: {
    top,
    left,
    width,
    height
  }
});

describe('assistant OCR selection', () => {
  it('filters diagnostic and path noise before composing text', () => {
    const lines = normalizeOcrLines([
      createLine('最近识别文本', 12, 24, 180),
      createLine('/Applications/蒙电题库通.app/Contents/Resources/assistant-helper', 42, 12, 620),
      createLine('标准答案', 58, 24, 120),
      createLine('10.在电气设备上工作，保证安全的技术措施由（ ）执行。', 76),
      createLine('匹配置信度 100.0%', 104, 24, 220),
      createLine('A.设备管理人员', 126),
      createLine('B.检修人员', 164)
    ]);

    expect(lines.map((line) => line.text)).toEqual(['10.在电气设备上工作，保证安全的技术措施由（ ）执行。', 'A.设备管理人员', 'B.检修人员']);
  });

  it('prefers the nearby question stem block over option text when building OCR candidates', () => {
    const selection = selectOcrText(
      [
        createLine('10.在电气设备上工作，保证安全的技术措施由（ ）执行。', 72),
        createLine('A.设备管理人员', 118),
        createLine('B.检修人员', 154),
        createLine('C.运维人员', 190)
      ],
      { x: 720, y: 160 },
      { x: 0, y: 0, width: 960, height: 320 }
    );

    expect(selection.selectedText).toBe('10.在电气设备上工作，保证安全的技术措施由（ ）执行。');
    expect(selection.candidates[0]).toContain('技术措施由');
    expect(selection.rawText).not.toContain('最近识别文本');
  });

  it('chooses the line nearest the cursor instead of drifting toward the capture center', () => {
    const lines = [
      createLine('10.上方题干内容', 10, 240, 320, 28),
      createLine('A.上方选项', 48, 240, 220, 28),
      createLine('11.下方题干内容', 82, 240, 320, 28)
    ];

    const anchorIndex = findOcrAnchorIndex(lines, { x: 360, y: 14 }, { x: 0, y: 0, width: 860, height: 140 });

    expect(anchorIndex).toBe(0);
  });
});
