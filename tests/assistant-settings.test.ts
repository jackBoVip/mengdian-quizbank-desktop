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

const createDraft = (overrides: Partial<QuestionDraft>): QuestionDraft => ({
  tempId: overrides.tempId ?? 'draft-1',
  sourceNo: overrides.sourceNo ?? '1',
  type: overrides.type ?? 'single',
  stem: overrides.stem ?? '《安全生产法》规定，从业人员应当接受安全生产教育和培训。',
  options: overrides.options ?? [
    { key: 'A', text: '掌握岗位安全知识' },
    { key: 'B', text: '无需培训' }
  ],
  answers: overrides.answers ?? ['A'],
  section: overrides.section ?? '安全生产法',
  tags: overrides.tags ?? ['法规'],
  confidence: overrides.confidence ?? 1,
  issues: overrides.issues ?? [],
  explanation: overrides.explanation
});

const createAnalysis = (drafts: QuestionDraft[]): ImportBatchAnalysis => ({
  batchId: 'assistant-batch',
  status: 'draft',
  drafts,
  sourceName: 'assistant-fixture.docx',
  format: 'docx',
  createdAt: '2026-03-28T00:00:00.000Z',
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
      warning: drafts.reduce((count, draft) => count + draft.issues.filter((issue) => issue.level === 'warning').length, 0),
      error: drafts.reduce((count, draft) => count + draft.issues.filter((issue) => issue.level === 'error').length, 0)
    },
    lowConfidenceCount: drafts.filter((draft) => draft.confidence < 0.8).length,
    sections: [...new Set(drafts.map((draft) => draft.section))],
    tags: [...new Set(drafts.flatMap((draft) => draft.tags))],
    sourceName: 'assistant-fixture.docx',
    format: 'docx',
    notes: []
  }
});

describe('assistant settings persistence', () => {
  it('stores assistant settings in app_settings and restores them on reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistant-settings-'));
    cleanupPaths.push(dir);
    const dbPath = join(dir, 'quizbank.db');

    const db = new AppDatabase(dbPath);
    expect(db.getAssistantSettings().enabled).toBe(false);

    db.updateAssistantSettings({
      enabled: true,
      activeLibraryId: 'library-123'
    });
    db.close();

    const reopened = new AppDatabase(dbPath);
    expect(reopened.getAssistantSettings()).toMatchObject({
      enabled: true,
      activeLibraryId: 'library-123',
      matchScope: 'current_library',
      dwellMs: 140,
      pollIntervalMs: 120,
      hoverTolerancePx: 24
    });
    reopened.close();
  });

  it('upgrades the legacy hover dwell time to 2 seconds on reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistant-dwell-'));
    cleanupPaths.push(dir);
    const dbPath = join(dir, 'quizbank.db');

    const db = new AppDatabase(dbPath);
    db.updateAssistantSettings({
      enabled: true,
      dwellMs: 550
    });
    db.close();

    const reopened = new AppDatabase(dbPath);
    expect(reopened.getAssistantSettings()).toMatchObject({
      dwellMs: 140,
      pollIntervalMs: 120,
      hoverTolerancePx: 24
    });
    reopened.close();
  });

  it('matches preview text against the current library only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistant-preview-'));
    cleanupPaths.push(dir);
    const db = new AppDatabase(join(dir, 'quizbank.db'));

    const drafts = [
      createDraft({ tempId: 'draft-1', sourceNo: '1' }),
      createDraft({
        tempId: 'draft-2',
        sourceNo: '2',
        stem: '生产经营单位主要负责人应当组织制定并实施本单位安全生产教育和培训计划。',
        type: 'true_false',
        options: undefined,
        answers: ['正确'],
        section: '主要负责人'
      })
    ];
    const analysis = createAnalysis(drafts);
    db.saveImportBatch(analysis);

    const library = db.saveLibraryFromDrafts({
      batchId: analysis.batchId,
      name: '答题助手测试题库',
      drafts,
      description: ''
    } satisfies SaveLibraryPayload);

    const result = db.previewAssistantMatch(library.id, {
      text: '安全生产法规定 从业人员应当接受安全生产教育和培训'
    });

    expect(result.matched).toBe(true);
    expect(result.answerText).toBe('A');
    expect(result.questionType).toBe('single');
    expect(result.confidence).toBeGreaterThan(0.62);

    db.close();
  });
});
