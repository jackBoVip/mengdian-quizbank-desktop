import type { ImportIssue, ImportIssueLevel, QuestionDraft, QuestionOption, QuestionType } from '@shared/types';

export const nowIso = (): string => new Date().toISOString();

export const randomId = (): string => crypto.randomUUID();

export const normalizeWhitespace = (value: string): string =>
  value
    .replace(/[\u200e\u200f\ufeff]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const normalizeLine = (value: string): string =>
  normalizeWhitespace(value)
    .replace(/\s*([，。；：,.!?])\s*/g, '$1')
    .replace(/\s*([()（）【】])\s*/g, '$1')
    .trim();

export const inferFormatByFileName = (filePath: string): 'docx' | 'txt' | 'xlsx' => {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext === 'docx') return 'docx';
  if (ext === 'txt') return 'txt';
  return 'xlsx';
};

export const mapHeadingToType = (heading: string): QuestionType | null => {
  if (heading.includes('单选题')) return 'single';
  if (heading.includes('多选题')) return 'multiple';
  if (heading.includes('填空题')) return 'fill_blank';
  if (heading.includes('判断题')) return 'true_false';
  return null;
};

export const getSectionLabel = (heading: string, type: QuestionType | null): string => {
  const normalized = heading.replace(/（.*?）|\(.*?\)/g, '').trim();
  if (normalized) {
    return normalized.replace(/^[一二三四五六七八九十]+、/, '').trim();
  }
  return type ? QUESTION_TYPE_TO_SECTION[type] : '未分组';
};

export const canonicalTrueFalse = (value: string): string | null => {
  const token = value.replace(/[（）()]/g, '').trim().toUpperCase();
  if (['√', 'TRUE', 'T', '正确', '对', 'YES', 'Y'].includes(token)) return '正确';
  if (['×', 'FALSE', 'F', '错误', '错', 'NO', 'N'].includes(token)) return '错误';
  return null;
};

export const canonicalChoiceKey = (value: string): string | null => {
  const token = value.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (token.length === 1 && token >= 'A' && token <= 'H') return token;
  return null;
};

export const normalizeAnswerToken = (type: QuestionType, value: string): string => {
  const trimmed = normalizeLine(value).replace(/[。；;，,]+$/g, '');
  if (type === 'true_false') {
    return canonicalTrueFalse(trimmed) ?? trimmed;
  }
  if (type === 'single' || type === 'multiple') {
    return canonicalChoiceKey(trimmed) ?? trimmed.toUpperCase();
  }
  return trimmed;
};

export const normalizeAnswerList = (type: QuestionType, values: string[]): string[] => {
  const normalized = values
    .map((value) => normalizeAnswerToken(type, value))
    .filter(Boolean);

  if (type === 'multiple') {
    return [...new Set(normalized)].sort();
  }

  if (type === 'single') {
    return normalized.slice(0, 1);
  }

  return normalized;
};

export const answersEqual = (type: QuestionType, left: string[], right: string[]): boolean => {
  const a = normalizeAnswerList(type, left);
  const b = normalizeAnswerList(type, right);
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
};

export const countBlanks = (stem: string): number => {
  const matches = stem.match(/（\s*）|\(\s*\)|_{2,}|﹍{2,}|_{1,}\s*_{1,}/g);
  return matches?.length ?? 0;
};

export const splitFillBlankAnswers = (value: string, expectedCount = 0): string[] => {
  const normalized = value
    .replace(/[\u200e\u200f\ufeff]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();

  const splitTokens = (source: string, pattern: RegExp): string[] =>
    source
      .split(pattern)
      .map((item) => normalizeLine(item).replace(/[。；;]+$/g, ''))
      .filter(Boolean);

  const explicit = splitTokens(normalized, /[；;、/／|\n]+/g);
  if (explicit.length > 1) {
    return explicit;
  }

  if (expectedCount > 1) {
    const byWhitespace = splitTokens(normalized, /\s+/g);
    if (byWhitespace.length > 1) {
      return byWhitespace;
    }
  }

  return explicit;
};

export const sortBySourceNo = <T extends { sourceNo: string }>(items: T[]): T[] =>
  [...items].sort((left, right) => {
    const leftNumber = Number.parseInt(left.sourceNo, 10);
    const rightNumber = Number.parseInt(right.sourceNo, 10);
    if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
      return left.sourceNo.localeCompare(right.sourceNo, 'zh-CN');
    }
    return leftNumber - rightNumber;
  });

export const createIssue = (level: ImportIssueLevel, code: string, message: string): ImportIssue => ({
  level,
  code,
  message
});

export const isChoiceQuestion = (type: QuestionType): boolean => type === 'single' || type === 'multiple';

export const defaultOptions = (entries: Array<[string, string]>): QuestionOption[] =>
  entries.reduce<QuestionOption[]>((acc, [key, text]) => {
    if (!text.trim().length) return acc;
    if (acc.some((option) => option.key === key)) return acc;
    acc.push({ key, text: normalizeLine(text) });
    return acc;
  }, []);

export const sanitizeDraft = (draft: QuestionDraft): QuestionDraft => ({
  ...draft,
  stem: normalizeLine(draft.stem),
  section: draft.section.trim() || '未分组',
  tags: [...new Set(draft.tags.map((tag) => normalizeLine(tag)).filter(Boolean))],
  options: draft.options?.map((option) => ({
    key: option.key,
    text: normalizeLine(option.text)
  })),
  answers: normalizeAnswerList(draft.type, draft.answers)
});

export const scoreDraftConfidence = (draft: QuestionDraft): number => {
  let score = 1;
  const errorCount = draft.issues.filter((issue) => issue.level === 'error').length;
  const warningCount = draft.issues.filter((issue) => issue.level === 'warning').length;
  score -= errorCount * 0.35;
  score -= warningCount * 0.12;
  if (!draft.stem) score -= 0.5;
  return Math.max(0.1, Math.min(1, Number(score.toFixed(2))));
};

export const QUESTION_TYPE_TO_SECTION: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  fill_blank: '填空题',
  true_false: '判断题'
};
