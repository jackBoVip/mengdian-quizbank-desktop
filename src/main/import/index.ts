import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import iconv from 'iconv-lite';
import jschardet from 'jschardet';
import * as XLSX from 'xlsx';
import type { ImportBatchAnalysis, ImportFormat, ImportIssue, ImportSummary, QuestionDraft, QuestionOption, QuestionType } from '../../shared/types';
import {
  canonicalChoiceKey,
  canonicalTrueFalse,
  countBlanks,
  createIssue,
  defaultOptions,
  getSectionLabel,
  inferFormatByFileName,
  isChoiceQuestion,
  mapHeadingToType,
  normalizeAnswerList,
  normalizeLine,
  normalizeWhitespace,
  nowIso,
  randomId,
  sanitizeDraft,
  scoreDraftConfidence,
  splitFillBlankAnswers,
  sortBySourceNo
} from '../domain/question-utils';

interface ParsedQuestionContent {
  sourceNo: string;
  type: QuestionType;
  stem: string;
  options?: QuestionOption[];
  answers: string[];
  section: string;
  tags: string[];
  issues: ImportIssue[];
}

const QUESTION_START_PATTERN = /^\d+(?:\s*[.、．]|(?=[\u4e00-\u9fa5A-Za-z（(]))/;
const SECTION_PATTERN = /^[一二三四五六七八九十]+、.*?(单选题|多选题|填空题|判断题)/;
const OPTION_LINE_PATTERN = /^[A-HＡ-Ｈ][.、．:：]/;

const SOURCE_NO_PATTERN = /^(\d+)(?:\s*[.、．]|(?=[\u4e00-\u9fa5A-Za-z（(]))/;

const buildSummary = (
  drafts: QuestionDraft[],
  format: ImportFormat,
  sourceName: string,
  notes: string[]
): ImportSummary => {
  const byType: ImportSummary['byType'] = {
    single: 0,
    multiple: 0,
    fill_blank: 0,
    true_false: 0
  };
  const issueCounts: ImportSummary['issueCounts'] = {
    info: 0,
    warning: 0,
    error: 0
  };

  const sections = new Set<string>();
  const tags = new Set<string>();
  let lowConfidenceCount = 0;

  for (const draft of drafts) {
    byType[draft.type] += 1;
    sections.add(draft.section);
    draft.tags.forEach((tag) => tags.add(tag));
    if (draft.confidence < 0.7) lowConfidenceCount += 1;
    draft.issues.forEach((issue) => {
      issueCounts[issue.level] += 1;
    });
  }

  return {
    totalQuestions: drafts.length,
    byType,
    issueCounts,
    lowConfidenceCount,
    sections: [...sections],
    tags: [...tags],
    sourceName,
    format,
    notes
  };
};

const extractAnswerFromLines = (lines: string[]): { contentLines: string[]; answerText: string } => {
  const content: string[] = [];
  let answerText = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^答案\s*[:：]?\s*(.*)$/);
    if (!match) {
      content.push(line);
      continue;
    }

    const inlineAnswer = match[1]?.trim();
    if (inlineAnswer) {
      answerText = inlineAnswer;
    } else if (lines[index + 1]) {
      answerText = normalizeLine(lines[index + 1]);
      index += 1;
    }
  }

  return { contentLines: content, answerText };
};

const parseChoiceSegments = (input: string): { stem: string; options: QuestionOption[] } => {
  const normalized = input.replace(/\s+/g, ' ').trim();
  const matches = [...normalized.matchAll(/(?:^|\s)([A-H])[.、．]\s*/g)];
  if (matches.length === 0) {
    return { stem: normalized, options: [] };
  }

  const first = matches[0];
  const stem = normalized.slice(0, first.index).trim();
  const segments: Array<[string, string]> = [];

  matches.forEach((match, index) => {
    const key = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? normalized.length : normalized.length;
    const text = normalized.slice(start, end).trim();
    segments.push([key, text]);
  });

  return {
    stem,
    options: defaultOptions(segments)
  };
};

const normalizeAnswerText = (type: QuestionType, answerText: string, options: QuestionOption[], expectedFillBlankCount = 0): string[] => {
  const cleaned = normalizeWhitespace(answerText);
  if (type === 'true_false') {
    const truthy = canonicalTrueFalse(cleaned);
    return truthy ? [truthy] : [];
  }

  if (type === 'fill_blank') {
    return splitFillBlankAnswers(answerText, expectedFillBlankCount);
  }

  const compact = cleaned.replace(/\s+/g, '').toUpperCase();
  const letters = compact
    .split('')
    .map((char) => canonicalChoiceKey(char))
    .filter((item): item is string => Boolean(item));

  if (letters.length > 0) {
    return normalizeAnswerList(type, letters);
  }

  const bySeparator = cleaned
    .split(/[；;、,， ]+/)
    .map((token) => canonicalChoiceKey(token))
    .filter((item): item is string => Boolean(item));

  if (bySeparator.length > 0) {
    return normalizeAnswerList(type, bySeparator);
  }

  const optionValue = options.find((option) => option.text === cleaned);
  if (optionValue) {
    return [optionValue.key];
  }

  return [];
};

const parseTrueFalseQuestion = (sourceNo: string, raw: string, section: string): ParsedQuestionContent => {
  const issues: ImportIssue[] = [];
  const stemWithTail = raw.replace(/^\d+(?:\s*[.、．]|(?=[\u4e00-\u9fa5A-Za-z（(]))\s*/, '').trim();
  const tailMatch = stemWithTail.match(/(?:（|\()(√|×|正确|错误|对|错)(?:）|\))\s*$/);
  const answer = tailMatch ? canonicalTrueFalse(tailMatch[1]) : null;
  const stem = tailMatch ? stemWithTail.slice(0, tailMatch.index).trim() : stemWithTail;

  if (!answer) {
    issues.push(createIssue('error', 'missing_answer', '判断题未识别到题干末尾答案标记'));
  }

  return {
    sourceNo,
    type: 'true_false',
    stem,
    answers: answer ? [answer] : [],
    section,
    tags: [],
    issues
  };
};

const parseBlock = (lines: string[], type: QuestionType, section: string): QuestionDraft => {
  const sourceNoMatch = lines[0]?.match(SOURCE_NO_PATTERN);
  const sourceNo = sourceNoMatch?.[1] ?? randomId();
  const issues: ImportIssue[] = [];

  if (type === 'true_false') {
    const parsed = parseTrueFalseQuestion(sourceNo, lines.join(' '), section);
    const draft = sanitizeDraft({
      tempId: randomId(),
      sourceNo: parsed.sourceNo,
      type,
      stem: parsed.stem,
      answers: parsed.answers,
      section,
      tags: parsed.tags,
      confidence: 1,
      issues: parsed.issues
    });
    draft.confidence = scoreDraftConfidence(draft);
    return draft;
  }

  const { contentLines, answerText } = extractAnswerFromLines(lines.map((line) => normalizeLine(line)));
  const body = contentLines.join(' ').replace(/^\d+(?:\s*[.、．]|(?=[\u4e00-\u9fa5A-Za-z（(]))\s*/, '').trim();

  let stem = body;
  let options: QuestionOption[] | undefined;
  let answers: string[] = [];
  const blankCount = type === 'fill_blank' ? countBlanks(body) : 0;

  if (isChoiceQuestion(type)) {
    const parsed = parseChoiceSegments(body);
    stem = parsed.stem;
    options = parsed.options;
    answers = normalizeAnswerText(type, answerText, options);

    if (!options.length) {
      issues.push(createIssue('error', 'missing_options', '选项题未识别到有效选项'));
    }

    if (!answers.length) {
      issues.push(createIssue('error', 'missing_answer', '选项题未识别到答案'));
    } else {
      const optionKeys = new Set(options.map((option) => option.key));
      const invalidAnswers = answers.filter((answer) => !optionKeys.has(answer));
      if (invalidAnswers.length > 0) {
        issues.push(createIssue('warning', 'answer_option_mismatch', '答案与选项键不匹配，建议人工校对'));
      }
    }
  } else {
    answers = normalizeAnswerText(type, answerText, [], blankCount);
    if (!answers.length) {
      issues.push(createIssue('error', 'missing_answer', '填空题未识别到答案'));
    }
    if (blankCount > 0 && blankCount !== answers.length) {
      issues.push(createIssue('warning', 'blank_count_mismatch', `题干空位数 ${blankCount} 与答案数 ${answers.length} 不一致`));
    }
  }

  if (!stem) {
    issues.push(createIssue('error', 'missing_stem', '题干为空'));
  }

  const draft = sanitizeDraft({
    tempId: randomId(),
    sourceNo,
    type,
    stem,
    options,
    answers,
    section,
    tags: [],
    confidence: 1,
    issues
  });
  draft.confidence = scoreDraftConfidence(draft);
  return draft;
};

const parseRawTextQuestionBank = (content: string, sourceName: string, format: ImportFormat): ImportBatchAnalysis => {
  const rawLines = normalizeWhitespace(content)
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter(Boolean);
  const lines = rawLines.reduce<string[]>((acc, line) => {
    const previous = acc[acc.length - 1];
    if (previous && /^\d+$/.test(previous) && /^[.、．]/.test(line)) {
      acc[acc.length - 1] = `${previous}${line}`;
      return acc;
    }
    acc.push(line);
    return acc;
  }, []);

  const drafts: QuestionDraft[] = [];
  const notes: string[] = [];

  let currentType: QuestionType | null = null;
  let currentSection = '未分组';
  let currentLines: string[] = [];
  let lastSourceNo: number | null = null;
  const looksLikeImplicitStem = (line: string): boolean =>
    !OPTION_LINE_PATTERN.test(line) && !/^答案/.test(line) && /[（(].*[）)]/.test(line);

  const flushBlock = (): void => {
    if (!currentType || currentLines.length === 0) return;
    const parsed = parseBlock(currentLines, currentType, currentSection);
    drafts.push(parsed);
    const sourceNo = Number.parseInt(parsed.sourceNo, 10);
    lastSourceNo = Number.isNaN(sourceNo) ? lastSourceNo : sourceNo;
    currentLines = [];
  };

  for (const line of lines) {
    if (SECTION_PATTERN.test(line)) {
      flushBlock();
      currentType = mapHeadingToType(line);
      currentSection = getSectionLabel(line, currentType);
      continue;
    }

    if (!currentType) {
      continue;
    }

    if (QUESTION_START_PATTERN.test(line)) {
      flushBlock();
      currentLines = [line];
      continue;
    }

    if (currentLines.length > 0 && currentLines.some((item) => /^答案/.test(item)) && lastSourceNo !== null && looksLikeImplicitStem(line)) {
      flushBlock();
      const cleanedStem = line.replace(/^[•·▪●]\s*/, '').trim();
      currentLines = [`${lastSourceNo + 1}. ${cleanedStem}`];
      continue;
    }

    if (
      currentLines.length === 0 &&
      lastSourceNo !== null &&
      looksLikeImplicitStem(line)
    ) {
      const cleanedStem = line.replace(/^[•·▪●]\s*/, '').trim();
      currentLines = [`${lastSourceNo + 1}. ${cleanedStem}`];
      continue;
    }

    if (currentLines.length > 0) {
      currentLines.push(line);
    }
  }

  flushBlock();

  if (!drafts.length) {
    notes.push('未从文本中识别到标准题目结构');
  }

  const orderedDrafts = sortBySourceNo(drafts);
  return {
    batchId: randomId(),
    status: 'draft',
    drafts: orderedDrafts,
    summary: buildSummary(orderedDrafts, format, sourceName, notes),
    sourceName,
    format,
    createdAt: nowIso()
  };
};

const readDocxText = async (filePath: string): Promise<string> => {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
};

const readTxtText = async (filePath: string): Promise<string> => {
  const uintBuffer = await readFile(filePath);
  const detection = jschardet.detect(uintBuffer);
  const encoding = detection.encoding ? detection.encoding.toLowerCase() : 'utf-8';
  return iconv.decode(uintBuffer, encoding === 'ascii' ? 'utf-8' : encoding);
};

const inferTypeFromStructuredRow = (rawType: string, answers: string[], options: QuestionOption[], stem: string): QuestionType => {
  const normalized = rawType.toLowerCase();
  if (normalized.includes('单选')) return 'single';
  if (normalized.includes('多选')) return 'multiple';
  if (normalized.includes('填空')) return 'fill_blank';
  if (normalized.includes('判断')) return 'true_false';
  if (canonicalTrueFalse(answers[0] ?? '') || /(?:（|\()(√|×|正确|错误|对|错)(?:）|\))\s*$/.test(stem)) return 'true_false';
  if (options.length > 0) return answers.length > 1 ? 'multiple' : 'single';
  return 'fill_blank';
};

const normalizeHeader = (header: string): string => header.replace(/[\s_\-().（）【】[\]]+/g, '').toLowerCase();

const detectStructuredColumns = (headers: string[]): Record<string, string> | null => {
  const mapping: Record<string, string> = {};
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));

  const lookup = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const found = normalized.get(key);
      if (found) return found;
    }
    return undefined;
  };

  mapping.sourceNo = lookup('题号', '序号', '编号', 'id', 'no') ?? '';
  mapping.type = lookup('题型', 'type') ?? '';
  mapping.section = lookup('章节', '分类', 'section') ?? '';
  mapping.stem = lookup('题目', '题干', '问题', 'question', 'stem') ?? '';
  mapping.answer = lookup('答案', '正确答案', 'answer') ?? '';
  mapping.explanation = lookup('解析', '讲解', '说明', 'analysis', 'explanation') ?? '';
  mapping.tags = lookup('标签', '知识点', 'tag', 'tags') ?? '';

  for (const optionKey of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const header = lookup(`选项${optionKey}`, `option${optionKey}`, optionKey);
    if (header) mapping[`option_${optionKey.toUpperCase()}`] = header;
  }

  if (!mapping.stem || !mapping.answer) {
    return null;
  }

  return mapping;
};

const parseStructuredSheet = (rows: Array<Record<string, unknown>>, sourceName: string): QuestionDraft[] => {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const columns = detectStructuredColumns(headers);
  if (!columns) return [];

  return rows
    .filter((row) => String(row[columns.stem] ?? '').trim().length > 0)
    .map((row, index) => {
      const rawOptions: Array<[string, string]> = [];
      for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
        const header = columns[`option_${key}`];
        if (!header) continue;
        rawOptions.push([key, String(row[header] ?? '')]);
      }

      const options = defaultOptions(rawOptions);
      const rawAnswers = String(row[columns.answer] ?? '').trim();
      const stem = String(row[columns.stem] ?? '');
      const blankCount = countBlanks(stem);
      const type = inferTypeFromStructuredRow(String(row[columns.type] ?? ''), splitFillBlankAnswers(rawAnswers, blankCount), options, stem);
      const answers = type === 'fill_blank' ? splitFillBlankAnswers(rawAnswers, blankCount) : normalizeAnswerText(type, rawAnswers, options);
      const tags = String(row[columns.tags] ?? '')
        .split(/[;,，、]/)
        .map((item) => item.trim())
        .filter(Boolean);

      const issues: ImportIssue[] = [];
      if (!answers.length) {
        issues.push(createIssue('error', 'missing_answer', '结构化表格中答案为空'));
      }
      if (isChoiceQuestion(type) && options.length === 0) {
        issues.push(createIssue('error', 'missing_options', '结构化表格中缺少选项列'));
      }
      if (type === 'fill_blank') {
        if (blankCount > 0 && blankCount !== answers.length) {
          issues.push(createIssue('warning', 'blank_count_mismatch', '结构化表格中的空位数量与答案数量不一致'));
        }
      }

      const draft = sanitizeDraft({
        tempId: randomId(),
        sourceNo: String(row[columns.sourceNo] ?? index + 1),
        type,
        stem,
        options,
        answers,
        section: String(row[columns.section] ?? '') || `${sourceName} 导入`,
        tags,
        confidence: 1,
        issues,
        explanation: String(row[columns.explanation] ?? '').trim()
      });
      draft.confidence = scoreDraftConfidence(draft);
      return draft;
    });
};

const readXlsxQuestions = async (filePath: string): Promise<{ drafts: QuestionDraft[]; notes: string[] }> => {
  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const sourceName = basename(filePath);
  const notes: string[] = [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const structured = parseStructuredSheet(rows, sourceName);

  if (structured.length > 0) {
    notes.push('使用结构化列映射解析 XLSX 题库');
    return { drafts: sortBySourceNo(structured), notes };
  }

  notes.push('未识别到结构化列，已退回文本规则解析');
  const fallbackText = XLSX.utils.sheet_to_csv(sheet, { FS: ' ', RS: '\n' });
  const analysis = parseRawTextQuestionBank(fallbackText, sourceName, 'xlsx');
  return { drafts: analysis.drafts, notes: [...analysis.summary.notes, ...notes] };
};

export const analyzeQuestionFile = async (filePath: string): Promise<ImportBatchAnalysis> => {
  const format = inferFormatByFileName(filePath);
  const sourceName = basename(filePath);

  if (format === 'docx') {
    const text = await readDocxText(filePath);
    return parseRawTextQuestionBank(text, sourceName, format);
  }

  if (format === 'txt') {
    const text = await readTxtText(filePath);
    return parseRawTextQuestionBank(text, sourceName, format);
  }

  const { drafts, notes } = await readXlsxQuestions(filePath);
  return {
    batchId: randomId(),
    status: 'draft',
    drafts,
    summary: buildSummary(drafts, 'xlsx', sourceName, notes),
    sourceName,
    format: 'xlsx',
    createdAt: nowIso()
  };
};
