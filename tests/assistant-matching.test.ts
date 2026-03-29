import { describe, expect, it } from 'vitest';
import type { Question } from '@shared/types';
import { createAssistantDisplayKey, normalizeAssistantText, rankAssistantMatches, shouldDisplayAssistantMatch } from '@main/assistant/matching';

const createQuestion = (overrides: Partial<Question>): Question => ({
  id: overrides.id ?? 'question-id',
  libraryId: overrides.libraryId ?? 'library-id',
  sourceNo: overrides.sourceNo ?? '1',
  type: overrides.type ?? 'single',
  stem: overrides.stem ?? '默认题干',
  options: overrides.options ?? [
    { key: 'A', text: '选项A' },
    { key: 'B', text: '选项B' }
  ],
  answers: overrides.answers ?? ['A'],
  section: overrides.section ?? '默认章节',
  tags: overrides.tags ?? [],
  confidence: overrides.confidence ?? 1,
  issues: overrides.issues ?? [],
  explanation: overrides.explanation,
  createdAt: overrides.createdAt ?? '2026-03-28T00:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-03-28T00:00:00.000Z',
  isFavorite: overrides.isFavorite ?? false
});

describe('assistant matching', () => {
  it('normalizes question text for fuzzy lookup', () => {
    expect(normalizeAssistantText('12. 《安全生产法》规定，从业人员应当接受安全生产教育和培训。')).toBe(
      '安全生产法 规定 从业人员应当接受安全生产教育和培训'
    );
  });

  it('ranks the closest question first and exposes answer text', () => {
    const questions: Question[] = [
      createQuestion({
        id: 'match-1',
        stem: '《安全生产法》规定，从业人员应当接受安全生产教育和培训。',
        answers: ['A']
      }),
      createQuestion({
        id: 'match-2',
        stem: '生产经营单位主要负责人应当组织制定并实施本单位安全生产教育和培训计划。',
        answers: ['正确'],
        type: 'true_false',
        options: undefined
      })
    ];

    const matches = rankAssistantMatches('安全生产法规定 从业人员应当接受安全生产教育和培训', 'accessibility', questions);

    expect(matches[0]?.matched).toBe(true);
    expect(matches[0]?.questionId).toBe('match-1');
    expect(matches[0]?.answerText).toBe('A');
    expect(matches[0]?.confidence).toBeGreaterThan(matches[1]?.confidence ?? 0);
  });

  it('only shows a tip when the best match is clearly ahead', () => {
    const best = {
      matched: true,
      source: 'accessibility' as const,
      recognizedText: '题干',
      normalizedText: '题干',
      confidence: 0.81,
      answerText: 'A'
    };
    const second = {
      ...best,
      confidence: 0.69,
      answerText: 'B'
    };

    expect(shouldDisplayAssistantMatch(best, second)).toBe(true);
    expect(shouldDisplayAssistantMatch({ ...best, confidence: 0.58 }, second)).toBe(false);
    expect(shouldDisplayAssistantMatch(best, { ...second, confidence: 0.76 })).toBe(false);
  });

  it('uses a stable display key that does not change with confidence jitter', () => {
    const first = {
      matched: true,
      source: 'ocr' as const,
      recognizedText: '10 在电气设备上工作 保证安全的技术措施由执行',
      normalizedText: '在电气设备上工作 保证安全的技术措施由执行',
      confidence: 0.83,
      answerText: 'CD',
      questionId: 'question-10'
    };
    const second = {
      ...first,
      confidence: 0.77
    };

    expect(createAssistantDisplayKey(first)).toBe('ocr:question-10');
    expect(createAssistantDisplayKey(second)).toBe('ocr:question-10');
  });
});
