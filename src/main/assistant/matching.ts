import type { AssistantMatchResult, AssistantPreviewPayload, AssistantTextSource, Question } from '@shared/types';
import { normalizeWhitespace } from '@main/domain/question-utils';

const fullWidthToHalfWidth = (value: string): string =>
  value.replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');

const compact = (value: string): string => value.replace(/\s+/g, '');

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

const unique = <T,>(items: T[]): T[] => [...new Set(items)];

const createNgrams = (value: string, size = 2): string[] => {
  if (value.length <= size) {
    return value ? [value] : [];
  }

  const grams: string[] = [];
  for (let index = 0; index <= value.length - size; index += 1) {
    grams.push(value.slice(index, index + size));
  }
  return unique(grams);
};

const jaccard = (left: string[], right: string[]): number => {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = left.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
};

const keywordCoverage = (query: string, candidate: string): number => {
  const tokens = unique(query.split(/\s+/).map((item) => item.trim()).filter((item) => item.length >= 2));
  if (!tokens.length) return 0;
  const matched = tokens.filter((token) => candidate.includes(token)).length;
  return matched / tokens.length;
};

export const normalizeAssistantText = (value: string): string =>
  normalizeWhitespace(fullWidthToHalfWidth(value))
    .replace(/^\d+(?:\s*[.、．]|(?=[A-Za-z\u4e00-\u9fa5]))\s*/, '')
    .replace(/[“”"'"`]/g, '')
    .replace(/[（）()【】[\]《》<>]/g, ' ')
    .replace(/[，,。.!！？?；;：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const buildAssistantSearchTerms = (text: string): { ftsQuery: string; likeTerms: string[] } => {
  const normalized = normalizeAssistantText(text);
  const plain = compact(normalized);
  const spaced = normalized.split(/\s+/).filter((item) => item.length >= 2);
  const likeTerms = unique(
    [plain.slice(0, 18), plain.slice(0, 12), plain.slice(Math.max(0, Math.floor(plain.length / 3)), Math.max(0, Math.floor(plain.length / 3)) + 12)]
      .map((item) => item.trim())
      .filter((item) => item.length >= 4)
  );

  return {
    ftsQuery: unique([...spaced, ...likeTerms.slice(0, 2)]).join(' '),
    likeTerms
  };
};

export const questionAnswerText = (question: Pick<Question, 'answers' | 'type'>): string =>
  question.answers.join(question.type === 'fill_blank' ? ' / ' : ' ');

export type AssistantCandidateQuestion = Pick<Question, 'id' | 'sourceNo' | 'type' | 'stem' | 'answers'>;

export const scoreAssistantQuestion = (recognizedText: string, question: Pick<Question, 'stem' | 'options'>): number => {
  const normalizedQuery = normalizeAssistantText(recognizedText);
  const normalizedStem = normalizeAssistantText(question.stem);
  const queryCompact = compact(normalizedQuery);
  const stemCompact = compact(normalizedStem);
  if (!queryCompact || !stemCompact) return 0;

  const bigramScore = jaccard(createNgrams(queryCompact, 2), createNgrams(stemCompact, 2));
  const trigramScore = jaccard(createNgrams(queryCompact, 3), createNgrams(stemCompact, 3));
  const coverageScore = keywordCoverage(normalizedQuery, normalizedStem);
  const containmentScore =
    normalizedStem.includes(queryCompact.slice(0, Math.min(queryCompact.length, 10))) || queryCompact.includes(stemCompact.slice(0, Math.min(stemCompact.length, 10)))
      ? 1
      : 0;
  const lengthScore = 1 - Math.min(1, Math.abs(queryCompact.length - stemCompact.length) / Math.max(queryCompact.length, stemCompact.length, 1));

  return Number(clamp(bigramScore * 0.45 + trigramScore * 0.2 + coverageScore * 0.18 + containmentScore * 0.1 + lengthScore * 0.07).toFixed(3));
};

export const rankAssistantMatches = (
  recognizedText: string,
  source: AssistantTextSource,
  questions: AssistantCandidateQuestion[]
): AssistantMatchResult[] => {
  const normalizedText = normalizeAssistantText(recognizedText);
  return questions
    .map((question) => ({
      matched: true,
      source,
      recognizedText,
      normalizedText,
      confidence: scoreAssistantQuestion(recognizedText, question),
      answerText: questionAnswerText(question),
      questionId: question.id,
      sourceNo: question.sourceNo,
      questionType: question.type
    }))
    .sort((left, right) => right.confidence - left.confidence);
};

export const createAssistantDisplayKey = (match: Pick<AssistantMatchResult, 'questionId' | 'source' | 'answerText' | 'normalizedText' | 'recognizedText'>): string => {
  if (match.questionId) {
    return `${match.source}:${match.questionId}`;
  }

  const answer = compact(match.answerText ?? '').slice(0, 16);
  const text = compact(match.normalizedText || match.recognizedText).slice(0, 48);
  return `${match.source}:${answer}:${text}`;
};

export const shouldDisplayAssistantMatch = (best: AssistantMatchResult | undefined, second: AssistantMatchResult | undefined): boolean => {
  if (!best) return false;
  if (best.confidence < 0.62) return false;
  if (!second) return true;
  return best.confidence - second.confidence >= 0.08;
};

export const createPreviewInput = (payload: AssistantPreviewPayload): string => payload.text.trim();
