import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportBatchAnalysis, QuestionDraft, SaveLibraryPayload } from '@shared/types';
import { AppDatabase } from '@main/database/AppDatabase';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0, cleanupPaths.length).map((path) =>
      rm(path, {
        recursive: true,
        force: true
      })
    )
  );
});

const createDraft = (index: number, overrides: Partial<QuestionDraft> = {}): QuestionDraft => ({
  tempId: overrides.tempId ?? `draft-${index}`,
  sourceNo: overrides.sourceNo ?? String(index),
  type: overrides.type ?? 'single',
  stem: overrides.stem ?? `第${index}题 默认题干内容`,
  options: overrides.options ?? [
    { key: 'A', text: '选项A' },
    { key: 'B', text: '选项B' }
  ],
  answers: overrides.answers ?? ['A'],
  section: overrides.section ?? '默认章节',
  tags: overrides.tags ?? ['默认标签'],
  confidence: overrides.confidence ?? 1,
  issues: overrides.issues ?? [],
  explanation: overrides.explanation
});

const createAnalysis = (drafts: QuestionDraft[]): ImportBatchAnalysis => ({
  batchId: 'assistant-candidate-batch',
  status: 'draft',
  drafts,
  sourceName: 'assistant-candidate-fixture.docx',
  format: 'docx',
  createdAt: '2026-03-29T00:00:00.000Z',
  summary: {
    totalQuestions: drafts.length,
    byType: {
      single: drafts.filter((draft) => draft.type === 'single').length,
      multiple: drafts.filter((draft) => draft.type === 'multiple').length,
      fill_blank: drafts.filter((draft) => draft.type === 'fill_blank').length,
      true_false: drafts.filter((draft) => draft.type === 'true_false').length
    },
    issueCounts: {
      info: 0,
      warning: 0,
      error: 0
    },
    lowConfidenceCount: 0,
    sections: [...new Set(drafts.map((draft) => draft.section))],
    tags: [...new Set(drafts.flatMap((draft) => draft.tags))],
    sourceName: 'assistant-candidate-fixture.docx',
    format: 'docx',
    notes: []
  }
});

describe('assistant candidate search', () => {
  it('rescues noisy OCR text with relaxed FTS candidate retrieval', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistant-candidate-'));
    cleanupPaths.push(dir);
    const db = new AppDatabase(join(dir, 'quizbank.db'));

    const drafts = [
      createDraft(1, {
        stem: '作业人员应当接受安全生产教育和培训。',
        section: '安全管理'
      }),
      createDraft(2, {
        stem: '生产经营单位主要负责人应当组织制定并实施本单位安全生产教育和培训计划。',
        section: '主要负责人',
        answers: ['正确'],
        type: 'true_false',
        options: undefined
      })
    ];

    const analysis = createAnalysis(drafts);
    db.saveImportBatch(analysis);
    const library = db.saveLibraryFromDrafts({
      batchId: analysis.batchId,
      name: '候选检索测试题库',
      drafts,
      description: ''
    } satisfies SaveLibraryPayload);

    const result = db.previewAssistantMatch(library.id, {
      text: '作业人员 应当 接受 错词 安全生产 教育 和 培训'
    });

    expect(result.matched).toBe(true);
    expect(result.sourceNo).toBe('1');
    expect(result.answerText).toBe('A');
    expect(result.confidence).toBeGreaterThan(0.62);

    db.close();
  });

  it('can still match questions beyond the first 80 entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistant-candidate-tail-'));
    cleanupPaths.push(dir);
    const db = new AppDatabase(join(dir, 'quizbank.db'));

    const drafts = Array.from({ length: 120 }, (_, index) =>
      createDraft(index + 1, {
        stem:
          index === 109
            ? '第110题 作业人员应当接受安全生产教育和培训。'
            : `第${index + 1}题 这是用于候选检索回归测试的默认题干 ${index + 1}`
      })
    );

    const analysis = createAnalysis(drafts);
    db.saveImportBatch(analysis);
    const library = db.saveLibraryFromDrafts({
      batchId: analysis.batchId,
      name: '候选检索尾部回归题库',
      drafts,
      description: ''
    } satisfies SaveLibraryPayload);

    const result = db.previewAssistantMatch(library.id, {
      text: '第110题作业人员应当接受安全生产教肓和培训'
    });

    expect(result.matched).toBe(true);
    expect(result.sourceNo).toBe('110');
    expect(result.answerText).toBe('A');
    expect(result.confidence).toBeGreaterThan(0.62);

    db.close();
  });
});
