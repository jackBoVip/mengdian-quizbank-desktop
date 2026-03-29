export interface OcrTextLine {
  text: string;
  score: number;
  frame: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

export interface OcrCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrPointer {
  x: number;
  y: number;
}

export interface OcrSelection {
  rawText: string | null;
  selectedText: string | null;
  candidates: string[];
  lines: OcrTextLine[];
}

const DIAGNOSTIC_LINE_PATTERN =
  /(?:最近识别文本|最佳候选|第二候选|运行诊断|当前运行包|权限主体|权限来源|主程序路径|Helper\s+路径|Helper\s+Bundle|MengdianAssistantHelper|Codex|标准答案|匹配置信度)/i;
const PATH_LINE_PATTERN = /(?:\/[^/\s]+){2,}|\.app\/Contents\//i;
const OPTION_LINE_PATTERN = /^[A-H][.、．]\s*/;
const QUESTION_LINE_PATTERN = /^(?:\d+\s*[.、．)]|[（(]?\d+[）)])\s*/;
const ANSWER_LINE_PATTERN = /^答案\b|^答案[:：]|^标准答案\b|^标准答案[:：]/;

const compact = (value: string): string => value.replace(/\s+/g, '');

const unique = <T,>(items: T[]): T[] => [...new Set(items)];

const joinLines = (lines: OcrTextLine[]): string =>
  lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const sanitizeLine = (text: string): string | null => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (DIAGNOSTIC_LINE_PATTERN.test(normalized)) return null;
  if (PATH_LINE_PATTERN.test(normalized)) return null;
  if (ANSWER_LINE_PATTERN.test(normalized)) return null;
  return normalized;
};

export const normalizeOcrLines = (lines: OcrTextLine[]): OcrTextLine[] =>
  lines
    .map((line) => ({
      ...line,
      text: sanitizeLine(line.text) ?? ''
    }))
    .filter((line) => line.text && line.score >= 0.35)
    .sort((left, right) => {
      if (Math.abs(left.frame.top - right.frame.top) > 8) {
        return left.frame.top - right.frame.top;
      }
      return left.frame.left - right.frame.left;
    });

const verticalDistance = (line: OcrTextLine, pointerY: number): number => {
  const top = line.frame.top;
  const bottom = line.frame.top + line.frame.height;
  if (pointerY >= top - 6 && pointerY <= bottom + 6) {
    return 0;
  }
  return Math.min(Math.abs(pointerY - top), Math.abs(pointerY - bottom));
};

const horizontalDistance = (line: OcrTextLine, pointerX: number): number => {
  const left = line.frame.left;
  const right = line.frame.left + line.frame.width;
  const centerX = left + line.frame.width / 2;
  if (pointerX >= left - 18 && pointerX <= right + 18) {
    return 0;
  }
  return Math.min(Math.abs(pointerX - left), Math.abs(pointerX - right), Math.abs(pointerX - centerX));
};

const lineWeight = (line: OcrTextLine, pointerX: number, pointerY: number): number => {
  const v = verticalDistance(line, pointerY) / Math.max(line.frame.height, 20);
  const h = horizontalDistance(line, pointerX) / Math.max(line.frame.width, 80);
  const optionPenalty = OPTION_LINE_PATTERN.test(line.text) ? 0.18 : 0;
  const confidenceBonus = 1 - Math.min(1, line.score);
  return Number((v * 1.6 + h * 0.4 + optionPenalty + confidenceBonus * 0.08).toFixed(4));
};

const findAnchorIndex = (lines: OcrTextLine[], pointerX: number, pointerY: number): number => {
  let bestIndex = 0;
  let bestWeight = Number.POSITIVE_INFINITY;
  lines.forEach((line, index) => {
    const weight = lineWeight(line, pointerX, pointerY);
    if (weight < bestWeight) {
      bestWeight = weight;
      bestIndex = index;
    }
  });
  return bestIndex;
};

const deriveStemBlock = (lines: OcrTextLine[], anchorIndex: number): OcrTextLine[] => {
  const start = Math.max(0, anchorIndex - 4);
  const end = Math.min(lines.length, anchorIndex + 5);
  const window = lines.slice(start, end);
  const localAnchor = Math.max(0, anchorIndex - start);
  const optionIndex = window.findIndex((line) => OPTION_LINE_PATTERN.test(line.text));
  const stemEnd = optionIndex >= 0 ? optionIndex : window.length;

  let stemStart = 0;
  for (let index = 0; index < Math.min(stemEnd, window.length); index += 1) {
    if (QUESTION_LINE_PATTERN.test(window[index].text)) {
      stemStart = index;
    }
  }

  if (stemEnd > stemStart) {
    return window.slice(stemStart, stemEnd);
  }

  return localAnchor > 0 ? window.slice(Math.max(0, localAnchor - 1), localAnchor + 1) : window.slice(0, 1);
};

const candidateVariants = (lines: OcrTextLine[], anchorIndex: number): string[] => {
  const variants: string[] = [];
  const stemBlock = deriveStemBlock(lines, anchorIndex);
  const anchor = lines[anchorIndex];
  const previous = lines[anchorIndex - 1];
  const next = lines[anchorIndex + 1];

  variants.push(joinLines(stemBlock));
  variants.push(anchor?.text ?? '');
  variants.push(joinLines([previous, anchor].filter(Boolean) as OcrTextLine[]));
  variants.push(joinLines([anchor, next].filter(Boolean) as OcrTextLine[]));
  variants.push(joinLines([previous, anchor, next].filter(Boolean) as OcrTextLine[]));

  return unique(
    variants
      .map((value) => value.trim())
      .filter((value) => compact(value).length >= 8)
  );
};

export const selectOcrText = (lines: OcrTextLine[], point: OcrPointer, captureRect: OcrCaptureRect): OcrSelection => {
  const normalizedLines = normalizeOcrLines(lines);
  const rawText = joinLines(normalizedLines) || null;

  if (!normalizedLines.length) {
    return {
      rawText,
      selectedText: null,
      candidates: [],
      lines: normalizedLines
    };
  }

  const pointerX = Math.max(0, Math.min(captureRect.width, point.x - captureRect.x));
  const pointerY = Math.max(0, Math.min(captureRect.height, point.y - captureRect.y));
  const anchorIndex = findAnchorIndex(normalizedLines, pointerX, pointerY);
  const candidates = candidateVariants(normalizedLines, anchorIndex);

  return {
    rawText,
    selectedText: candidates[0] ?? rawText,
    candidates,
    lines: normalizedLines
  };
};

export const findOcrAnchorIndex = (lines: OcrTextLine[], point: OcrPointer, captureRect: OcrCaptureRect): number => {
  const normalizedLines = normalizeOcrLines(lines);
  if (!normalizedLines.length) {
    return -1;
  }

  const pointerX = Math.max(0, Math.min(captureRect.width, point.x - captureRect.x));
  const pointerY = Math.max(0, Math.min(captureRect.height, point.y - captureRect.y));
  return findAnchorIndex(normalizedLines, pointerX, pointerY);
};
