import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import type {
  AssistantMatchResult,
  AssistantPreviewPayload,
  AssistantSettings,
  AssistantTextSource,
  BulkQuestionPatch,
  DashboardStats,
  ExamTemplate,
  ImportBatchAnalysis,
  LibraryDetail,
  LibraryProgress,
  LibrarySummary,
  PracticeAnswerPayload,
  PracticeFilter,
  PracticeSession,
  PracticeSessionSummary,
  Question,
  QuestionDraft,
  QuestionQuery,
  QuestionType,
  SaveLibraryPayload,
  SessionMode,
  SessionQuestion,
  SessionStatus,
  StartExamPayload,
  StartPracticePayload,
  UpdateLibraryPayload,
  UpsertExamTemplatePayload
} from '../../shared/types';
import { defaultAssistantSettings, emptyDashboardStats } from '../../shared/types';
import {
  answersEqual,
  nowIso,
  normalizeAnswerList,
  normalizeLine,
  normalizeWhitespace,
  QUESTION_TYPE_TO_SECTION,
  randomId
} from '../domain/question-utils';
import {
  type AssistantCandidateQuestion,
  buildAssistantSearchTerms,
  normalizeAssistantText,
  rankAssistantMatches
} from '../assistant/matching';

type SqliteDatabase = Database.Database;

const readSqlAsset = (fileName: string): string => {
  const bundledPath = fileURLToPath(new URL(`./sql/${fileName}`, import.meta.url));
  if (existsSync(bundledPath)) {
    return readFileSync(bundledPath, 'utf-8');
  }

  const sourcePath = join(process.cwd(), 'src', 'main', 'database', 'sql', fileName);
  return readFileSync(sourcePath, 'utf-8');
};

const initSql = readSqlAsset('001_init.sql');
const assistantSql = readSqlAsset('002_assistant.sql');

interface SessionSnapshot {
  questionIds: string[];
  scoreMap: Record<string, number>;
  instantFeedback: boolean;
  title: string;
  showAnswersOnFinish: boolean;
}

interface PackFile {
  version: 1;
  exportedAt: string;
  library: {
    name: string;
    description: string;
    sourceFormat: string | null;
    sourceName: string | null;
  };
  questions: Question[];
  examTemplates: ExamTemplate[];
}

interface BackupFile {
  version: 1;
  exportedAt: string;
  libraries: LibrarySummary[];
  libraryPacks: PackFile[];
  sessions: PracticeSessionSummary[];
}

interface AssistantCandidateRow {
  id: string;
  source_no: string;
  type: QuestionType;
  stem: string;
  answer_json: string;
}

export class AppDatabase {
  private db: SqliteDatabase;

  public constructor(private readonly dbPath: string) {
    this.db = this.initialize();
  }

  private initialize(): SqliteDatabase {
    const parentDir = dirname(this.dbPath);
    mkdirSync(parentDir, { recursive: true });
    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const exists = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get('001_init');
    if (!exists) {
      db.exec(initSql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('001_init', nowIso());
    }

    const assistantExists = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get('002_assistant');
    if (!assistantExists) {
      db.exec(assistantSql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('002_assistant', nowIso());
    }

    return db;
  }

  public close(): void {
    this.db.close();
  }

  public saveImportBatch(analysis: ImportBatchAnalysis): ImportBatchAnalysis {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO import_batches
            (id, source_name, source_format, status, summary_json, drafts_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          analysis.batchId,
          analysis.sourceName,
          analysis.format,
          analysis.status,
          JSON.stringify(analysis.summary),
          JSON.stringify(analysis.drafts),
          analysis.createdAt,
          nowIso()
        );

      this.db.prepare('DELETE FROM import_issues WHERE batch_id = ?').run(analysis.batchId);
      const insertIssue = this.db.prepare(
        `INSERT INTO import_issues (id, batch_id, question_source_no, level, code, message)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      analysis.drafts.forEach((draft) => {
        draft.issues.forEach((issue) => {
          insertIssue.run(randomId(), analysis.batchId, draft.sourceNo, issue.level, issue.code, issue.message);
        });
      });
    });

    tx();
    return analysis;
  }

  public getImportBatch(batchId: string): ImportBatchAnalysis | null {
    const row = this.db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId) as
      | {
          id: string;
          source_name: string;
          source_format: string;
          status: 'draft' | 'published';
          summary_json: string;
          drafts_json: string;
          created_at: string;
        }
      | undefined;

    if (!row) return null;

    return {
      batchId: row.id,
      sourceName: row.source_name,
      format: row.source_format as ImportBatchAnalysis['format'],
      status: row.status,
      summary: JSON.parse(row.summary_json),
      drafts: JSON.parse(row.drafts_json),
      createdAt: row.created_at
    };
  }

  public saveLibraryFromDrafts(payload: SaveLibraryPayload): LibraryDetail {
    const batch = this.getImportBatch(payload.batchId);
    if (!batch) {
      throw new Error('导入批次不存在，无法保存题库。');
    }

    const libraryId = randomId();
    const now = nowIso();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO libraries (id, name, description, source_name, source_format, question_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          libraryId,
          payload.name.trim(),
          payload.description?.trim() ?? '',
          batch.sourceName,
          batch.format,
          payload.drafts.length,
          now,
          now
        );

      const sectionCache = new Map<string, string>();
      const tagCache = new Map<string, string>();
      const insertQuestion = this.db.prepare(
        `INSERT INTO questions
          (id, library_id, source_no, type, stem, explanation, section_id, answer_json, issues_json, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertChoice = this.db.prepare(
        `INSERT INTO choices (id, question_id, option_key, option_text, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      );
      const insertQuestionTag = this.db.prepare(
        `INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)`
      );

      payload.drafts.forEach((draft) => {
        const questionId = randomId();
        const sectionId = this.ensureSection(libraryId, draft.section, sectionCache);
        insertQuestion.run(
          questionId,
          libraryId,
          draft.sourceNo,
          draft.type,
          draft.stem,
          draft.explanation ?? '',
          sectionId,
          JSON.stringify(draft.answers),
          JSON.stringify(draft.issues),
          draft.confidence,
          now,
          now
        );

        draft.options?.forEach((option, index) => {
          insertChoice.run(randomId(), questionId, option.key, option.text, index);
        });

        draft.tags.forEach((tag) => {
          const tagId = this.ensureTag(libraryId, tag, tagCache);
          insertQuestionTag.run(questionId, tagId);
        });

        this.rebuildQuestionSearch(questionId);
      });

      const defaultTemplate = this.buildDefaultExamTemplate(libraryId, payload.drafts);
      this.insertExamTemplate(defaultTemplate);

      this.db.prepare('UPDATE import_batches SET status = ?, updated_at = ? WHERE id = ?').run('published', now, payload.batchId);
    });

    tx();
    return this.getLibraryDetail(libraryId);
  }

  public listLibraries(): LibrarySummary[] {
    const rows = this.db
      .prepare(
        `SELECT
          l.id,
          l.name,
          l.description,
          l.question_count,
          l.source_format,
          l.created_at,
          l.updated_at,
          (SELECT COUNT(*) FROM sections s WHERE s.library_id = l.id) AS section_count,
          (SELECT COUNT(*) FROM tags t WHERE t.library_id = l.id) AS tag_count,
          (SELECT COUNT(*) FROM exam_templates et WHERE et.library_id = l.id) AS template_count
         FROM libraries l
         ORDER BY l.updated_at DESC`
      )
      .all() as Array<{
      id: string;
      name: string;
      description: string;
      question_count: number;
      source_format: string | null;
      created_at: string;
      updated_at: string;
      section_count: number;
      tag_count: number;
      template_count: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      questionCount: row.question_count,
      sectionCount: row.section_count,
      tagCount: row.tag_count,
      sourceFormat: (row.source_format as LibrarySummary['sourceFormat']) ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      templateCount: row.template_count
    }));
  }

  public getLibraryDetail(libraryId: string): LibraryDetail {
    const row = this.db
      .prepare(
        `SELECT
          l.id,
          l.name,
          l.description,
          l.question_count,
          l.source_format,
          l.created_at,
          l.updated_at,
          (SELECT COUNT(*) FROM sections s WHERE s.library_id = l.id) AS section_count,
          (SELECT COUNT(*) FROM tags t WHERE t.library_id = l.id) AS tag_count,
          (SELECT COUNT(*) FROM exam_templates et WHERE et.library_id = l.id) AS template_count
         FROM libraries l
         WHERE l.id = ?`
      )
      .get(libraryId) as
      | {
          id: string;
          name: string;
          description: string;
          question_count: number;
          source_format: string | null;
          created_at: string;
          updated_at: string;
          section_count: number;
          tag_count: number;
          template_count: number;
        }
      | undefined;

    if (!row) {
      throw new Error('题库不存在。');
    }

    const sections = this.db
      .prepare('SELECT name FROM sections WHERE library_id = ? ORDER BY name COLLATE NOCASE')
      .all(libraryId) as Array<{ name: string }>;
    const tags = this.db
      .prepare('SELECT name FROM tags WHERE library_id = ? ORDER BY name COLLATE NOCASE')
      .all(libraryId) as Array<{ name: string }>;
    const recentExamResults = this.listSessionSummaries(libraryId, 'exam').slice(0, 5);

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      questionCount: row.question_count,
      sectionCount: row.section_count,
      tagCount: row.tag_count,
      sourceFormat: (row.source_format as LibrarySummary['sourceFormat']) ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      templateCount: row.template_count,
      sections: sections.map((item) => ({ label: item.name, value: item.name })),
      tags: tags.map((item) => ({ label: item.name, value: item.name })),
      examTemplates: this.listExamTemplates(libraryId),
      recentExamResults
    };
  }

  public updateLibrary(payload: UpdateLibraryPayload): LibraryDetail {
    this.db
      .prepare('UPDATE libraries SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(payload.name.trim(), payload.description.trim(), nowIso(), payload.id);
    return this.getLibraryDetail(payload.id);
  }

  public deleteLibrary(libraryId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM question_search WHERE library_id = ?').run(libraryId);
      this.db.prepare('DELETE FROM libraries WHERE id = ?').run(libraryId);
    });
    tx();
  }

  public listQuestions(query: QuestionQuery): Question[] {
    const where: string[] = ['q.library_id = ?'];
    const params: Array<string | number> = [query.libraryId];

    if (query.type) {
      where.push('q.type = ?');
      params.push(query.type);
    }

    if (query.section) {
      where.push('s.name = ?');
      params.push(query.section);
    }

    if (query.tag) {
      where.push(
        `EXISTS (
          SELECT 1
          FROM question_tags qt
          INNER JOIN tags t ON t.id = qt.tag_id
          WHERE qt.question_id = q.id AND t.name = ?
        )`
      );
      params.push(query.tag);
    }

    if (query.favoritesOnly) {
      where.push('EXISTS (SELECT 1 FROM favorites f WHERE f.question_id = q.id)');
    }

    if (query.search?.trim()) {
      const searchTerm = normalizeWhitespace(query.search);
      where.push(
        `(q.id IN (
          SELECT question_id
          FROM question_search
          WHERE question_search MATCH ?
        ) OR q.stem LIKE ?)`
      );
      params.push(this.toFtsQuery(searchTerm), `%${searchTerm}%`);
    }

    const rows = this.db
      .prepare(
        `SELECT
          q.*,
          s.name AS section_name,
          EXISTS(SELECT 1 FROM favorites f WHERE f.question_id = q.id) AS is_favorite
         FROM questions q
         LEFT JOIN sections s ON s.id = q.section_id
         WHERE ${where.join(' AND ')}
         ORDER BY COALESCE(CAST(q.source_no AS INTEGER), 999999), q.source_no ASC`
      )
      .all(...params);

    return this.hydrateQuestions(rows as Array<Record<string, unknown>>);
  }

  public updateQuestion(question: Question): Question {
    const tx = this.db.transaction(() => {
      const sectionId = this.ensureSection(question.libraryId, question.section);
      this.db
        .prepare(
          `UPDATE questions
           SET source_no = ?, type = ?, stem = ?, explanation = ?, section_id = ?, answer_json = ?, issues_json = ?, confidence = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          question.sourceNo,
          question.type,
          question.stem,
          question.explanation ?? '',
          sectionId,
          JSON.stringify(normalizeAnswerList(question.type, question.answers)),
          JSON.stringify(question.issues),
          question.confidence,
          nowIso(),
          question.id
        );

      this.db.prepare('DELETE FROM choices WHERE question_id = ?').run(question.id);
      question.options?.forEach((option, index) => {
        this.db
          .prepare(
            `INSERT INTO choices (id, question_id, option_key, option_text, sort_order)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(randomId(), question.id, option.key, option.text, index);
      });

      this.db.prepare('DELETE FROM question_tags WHERE question_id = ?').run(question.id);
      question.tags.forEach((tag) => {
        const tagId = this.ensureTag(question.libraryId, tag);
        this.db.prepare('INSERT INTO question_tags (question_id, tag_id) VALUES (?, ?)').run(question.id, tagId);
      });

      if (question.isFavorite) {
        this.db
          .prepare('INSERT OR IGNORE INTO favorites (library_id, question_id, created_at) VALUES (?, ?, ?)')
          .run(question.libraryId, question.id, nowIso());
      } else {
        this.db.prepare('DELETE FROM favorites WHERE question_id = ?').run(question.id);
      }

      this.rebuildQuestionSearch(question.id);
    });

    tx();
    const updated = this.listQuestions({ libraryId: question.libraryId }).find((item) => item.id === question.id);
    if (!updated) {
      throw new Error('题目更新后未找到记录。');
    }
    return updated;
  }

  public bulkUpdateQuestions(libraryId: string, questionIds: string[], patch: BulkQuestionPatch): number {
    const tx = this.db.transaction(() => {
      questionIds.forEach((questionId) => {
        const current = this.listQuestions({ libraryId }).find((item) => item.id === questionId);
        if (!current) return;
        this.updateQuestion({
          ...current,
          type: patch.type ?? current.type,
          section: patch.section ?? current.section,
          tags: patch.tags ?? current.tags
        });
      });
    });
    tx();
    return questionIds.length;
  }

  public listExamTemplates(libraryId: string): ExamTemplate[] {
    const rows = this.db
      .prepare('SELECT * FROM exam_templates WHERE library_id = ? ORDER BY updated_at DESC')
      .all(libraryId) as Array<{
      id: string;
      library_id: string;
      name: string;
      config_json: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => this.deserializeExamTemplate(row));
  }

  public upsertExamTemplate(payload: UpsertExamTemplatePayload): ExamTemplate {
    const id = payload.template.id ?? randomId();
    const createdAt = payload.template.id
      ? (this.db.prepare('SELECT created_at FROM exam_templates WHERE id = ?').get(id) as { created_at?: string } | undefined)?.created_at ?? nowIso()
      : nowIso();
    const template: ExamTemplate = {
      id,
      libraryId: payload.libraryId,
      name: payload.template.name,
      durationMinutes: payload.template.durationMinutes,
      passScore: payload.template.passScore,
      totalScore: payload.template.rules.reduce((sum, rule) => sum + rule.count * rule.score, 0),
      randomize: payload.template.randomize,
      rules: payload.template.rules,
      scope: payload.template.scope,
      createdAt,
      updatedAt: nowIso()
    };

    this.insertExamTemplate(template);
    return template;
  }

  public deleteExamTemplate(templateId: string): void {
    this.db.prepare('DELETE FROM exam_templates WHERE id = ?').run(templateId);
  }

  public startPractice(payload: StartPracticePayload): PracticeSession {
    const questions = this.selectQuestionsForFilter(payload);
    if (!questions.length) {
      throw new Error('当前筛选条件下没有可练习的题目。');
    }

    const questionIds = questions.map((question) => question.id);
    const scoreMap = Object.fromEntries(questionIds.map((id) => [id, 1]));
    const sessionId = this.insertSession({
      libraryId: payload.libraryId,
      title: payload.title?.trim() || '练习模式',
      questionIds,
      scoreMap,
      mode: 'practice',
      status: 'active',
      examTemplateId: null,
      filter: payload,
      config: {
        instantFeedback: true,
        showAnswersOnFinish: true
      },
      totalScore: questionIds.length,
      passScore: null
    });

    return this.getSession(sessionId);
  }

  public startExam(payload: StartExamPayload): PracticeSession {
    const template = this.listExamTemplates(payload.libraryId).find((item) => item.id === payload.examTemplateId);
    if (!template) {
      throw new Error('考试模板不存在。');
    }

    const selectedQuestions: Question[] = [];
    const usedIds = new Set<string>();
    template.rules.forEach((rule) => {
      const candidates = this.selectQuestionsForFilter({
        libraryId: payload.libraryId,
        order: template.randomize ? 'random' : 'sequential',
        questionTypes: [rule.questionType],
        sections: template.scope.sections,
        tags: template.scope.tags
      }).filter((question) => !usedIds.has(question.id));

      candidates.slice(0, rule.count).forEach((question) => {
        usedIds.add(question.id);
        selectedQuestions.push(question);
      });
    });

    if (!selectedQuestions.length) {
      throw new Error('考试模板范围内没有可用题目。');
    }

    const scoreMap = Object.fromEntries(
      selectedQuestions.map((question) => {
        const rule = template.rules.find((item) => item.questionType === question.type);
        return [question.id, rule?.score ?? 1];
      })
    );

    const sessionId = this.insertSession({
      libraryId: payload.libraryId,
      title: template.name,
      questionIds: selectedQuestions.map((question) => question.id),
      scoreMap,
      mode: 'exam',
      status: 'active',
      examTemplateId: template.id,
      filter: template.scope,
      config: {
        instantFeedback: false,
        showAnswersOnFinish: true
      },
      totalScore: template.totalScore,
      passScore: template.passScore
    });

    return this.getSession(sessionId);
  }

  public submitExam(sessionId: string): PracticeSession {
    this.finishSession(sessionId, 'finished');
    return this.getSession(sessionId);
  }

  public answerSession(payload: PracticeAnswerPayload): PracticeSession {
    const session = this.getSession(payload.sessionId);
    const target = session.questions.find((question) => question.questionId === payload.questionId);
    if (!target) {
      throw new Error('会话中不存在该题目。');
    }

    const actualQuestion = this.listQuestions({ libraryId: session.libraryId }).find((question) => question.id === payload.questionId);
    if (!actualQuestion) {
      throw new Error('题目不存在，无法提交答案。');
    }

    const normalizedAnswers = normalizeAnswerList(target.type, payload.answers);
    const isCorrect = answersEqual(target.type, normalizedAnswers, actualQuestion.answers);
    const score = isCorrect ? this.getQuestionScore(payload.sessionId, payload.questionId) : 0;
    const now = nowIso();

    this.db
      .prepare(
        `INSERT INTO practice_answers (id, session_id, question_id, user_answer_json, is_correct, score, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, question_id) DO UPDATE SET
           user_answer_json = excluded.user_answer_json,
           is_correct = excluded.is_correct,
           score = excluded.score,
           answered_at = excluded.answered_at`
      )
      .run(randomId(), payload.sessionId, payload.questionId, JSON.stringify(normalizedAnswers), isCorrect ? 1 : 0, score, now);

    this.recalculateSession(payload.sessionId);
    return this.getSession(payload.sessionId);
  }

  public pauseSession(sessionId: string): PracticeSession {
    this.finishSession(sessionId, 'paused');
    return this.getSession(sessionId);
  }

  public resumeSession(sessionId: string): PracticeSession {
    this.db.prepare('UPDATE practice_sessions SET status = ?, updated_at = ? WHERE id = ?').run('active', nowIso(), sessionId);
    return this.getSession(sessionId);
  }

  public finishPractice(sessionId: string): PracticeSession {
    this.finishSession(sessionId, 'finished');
    return this.getSession(sessionId);
  }

  public getSession(sessionId: string): PracticeSession {
    const row = this.db.prepare('SELECT * FROM practice_sessions WHERE id = ?').get(sessionId) as
      | {
          id: string;
          library_id: string;
          mode: SessionMode;
          status: SessionStatus;
          title: string;
          exam_template_id: string | null;
          filter_json: string;
          config_json: string;
          snapshot_json: string;
          score: number;
          total_score: number;
          pass_score: number | null;
          question_count: number;
          answered_count: number;
          correct_count: number;
          started_at: string;
          updated_at: string;
          finished_at: string | null;
        }
      | undefined;

    if (!row) {
      throw new Error('会话不存在。');
    }

    const snapshot = JSON.parse(row.snapshot_json) as SessionSnapshot;
    const questionMap = new Map(this.listQuestions({ libraryId: row.library_id }).map((question) => [question.id, question]));
    const answerRows = this.db
      .prepare('SELECT question_id, user_answer_json, is_correct, score FROM practice_answers WHERE session_id = ?')
      .all(sessionId) as Array<{ question_id: string; user_answer_json: string; is_correct: number; score: number }>;
    const answerMap = new Map(answerRows.map((answer) => [answer.question_id, answer]));

    const questions: SessionQuestion[] = snapshot.questionIds
      .map((questionId) => questionMap.get(questionId))
      .filter((item): item is Question => Boolean(item))
      .map((question) => {
        const answer = answerMap.get(question.id);
        const revealAnswers =
          row.mode === 'practice'
            ? row.status === 'finished' || Boolean(answer)
            : row.status === 'finished';

        return {
          questionId: question.id,
          sourceNo: question.sourceNo,
          type: question.type,
          stem: question.stem,
          options: question.options,
          section: question.section,
          tags: question.tags,
          explanation: row.status === 'finished' ? question.explanation : undefined,
          correctAnswers: revealAnswers ? question.answers : undefined,
          userAnswers: answer ? JSON.parse(answer.user_answer_json) : undefined,
          isCorrect: answer ? Boolean(answer.is_correct) : undefined,
          score: answer?.score ?? 0
        };
      });

    const firstUnanswered = questions.findIndex((question) => !question.userAnswers?.length);

    return {
      id: row.id,
      libraryId: row.library_id,
      mode: row.mode,
      title: row.title,
      status: row.status,
      questionCount: row.question_count,
      answeredCount: row.answered_count,
      correctCount: row.correct_count,
      score: row.score,
      totalScore: row.total_score,
      passScore: row.pass_score,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
      questions,
      currentIndex: firstUnanswered >= 0 ? firstUnanswered : Math.max(questions.length - 1, 0),
      instantFeedback: row.mode === 'practice',
      showAnswers: row.mode === 'practice' || row.status === 'finished',
      examTemplateId: row.exam_template_id
    };
  }

  public getDashboardStats(): DashboardStats {
    const libraryCount = this.db.prepare('SELECT COUNT(*) AS count FROM libraries').get() as { count: number };
    if (libraryCount.count === 0) {
      return emptyDashboardStats();
    }

    const questionCount = this.db.prepare('SELECT COUNT(*) AS count FROM questions').get() as { count: number };
    const practiceCount = this.db.prepare('SELECT COUNT(*) AS count FROM practice_sessions').get() as { count: number };
    const favoritesCount = this.db.prepare('SELECT COUNT(*) AS count FROM favorites').get() as { count: number };
    const answerStats = this.db.prepare('SELECT COUNT(*) AS total, SUM(is_correct) AS correct FROM practice_answers').get() as {
      total: number;
      correct: number | null;
    };
    const wrongCount = this.db.prepare('SELECT COUNT(*) AS count FROM practice_answers WHERE is_correct = 0').get() as { count: number };

    const weakSections = this.db
      .prepare(
        `SELECT s.name AS name, COUNT(*) AS answered_count, AVG(pa.is_correct) AS accuracy
         FROM practice_answers pa
         INNER JOIN questions q ON q.id = pa.question_id
         LEFT JOIN sections s ON s.id = q.section_id
         GROUP BY s.name
         HAVING COUNT(*) > 0
         ORDER BY accuracy ASC, answered_count DESC
         LIMIT 5`
      )
      .all() as Array<{ name: string | null; answered_count: number; accuracy: number }>;

    const weakTypes = this.db
      .prepare(
        `SELECT q.type AS name, COUNT(*) AS answered_count, AVG(pa.is_correct) AS accuracy
         FROM practice_answers pa
         INNER JOIN questions q ON q.id = pa.question_id
         GROUP BY q.type
         HAVING COUNT(*) > 0
         ORDER BY accuracy ASC, answered_count DESC
         LIMIT 4`
      )
      .all() as Array<{ name: string; answered_count: number; accuracy: number }>;

    const recentExams = this.db
      .prepare(
        `SELECT * FROM practice_sessions
         WHERE mode = 'exam'
         ORDER BY COALESCE(finished_at, updated_at) DESC
         LIMIT 5`
      )
      .all() as Array<Record<string, unknown>>;

    return {
      libraryCount: libraryCount.count,
      questionCount: questionCount.count,
      practiceCount: practiceCount.count,
      favoritesCount: favoritesCount.count,
      wrongCount: wrongCount.count,
      accuracy: answerStats.total ? Number((((answerStats.correct ?? 0) / answerStats.total) * 100).toFixed(1)) : 0,
      recentExams: recentExams.map((row) => this.mapSessionSummary(row)),
      weakSections: weakSections.map((row) => ({
        name: row.name ?? '未分组',
        answeredCount: row.answered_count,
        accuracy: Number(((row.accuracy ?? 0) * 100).toFixed(1))
      })),
      weakTypes: weakTypes.map((row) => ({
        name: QUESTION_TYPE_TO_SECTION[row.name as QuestionType] ?? row.name,
        answeredCount: row.answered_count,
        accuracy: Number(((row.accuracy ?? 0) * 100).toFixed(1))
      }))
    };
  }

  public getLibraryProgress(libraryId: string): LibraryProgress {
    const library = this.getLibraryDetail(libraryId);
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS answered_count,
          SUM(pa.is_correct) AS correct_count,
          MAX(pa.answered_at) AS last_practiced_at
         FROM practice_answers pa
         INNER JOIN questions q ON q.id = pa.question_id
         WHERE q.library_id = ?`
      )
      .get(libraryId) as { answered_count: number; correct_count: number | null; last_practiced_at: string | null };
    const favoritesCount = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM favorites f
         INNER JOIN questions q ON q.id = f.question_id
         WHERE q.library_id = ?`
      )
      .get(libraryId) as { count: number };
    const wrongCount = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM practice_answers pa
         INNER JOIN questions q ON q.id = pa.question_id
         WHERE q.library_id = ? AND pa.is_correct = 0`
      )
      .get(libraryId) as { count: number };

    return {
      libraryId,
      libraryName: library.name,
      answeredCount: row.answered_count,
      correctCount: row.correct_count ?? 0,
      accuracy: row.answered_count ? Number((((row.correct_count ?? 0) / row.answered_count) * 100).toFixed(1)) : 0,
      favoritesCount: favoritesCount.count,
      wrongCount: wrongCount.count,
      lastPracticedAt: row.last_practiced_at
    };
  }

  public getAssistantSettings(): AssistantSettings {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('assistant') as { value_json: string } | undefined;
    if (!row) {
      const defaults = defaultAssistantSettings();
      this.db
        .prepare('INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
        .run('assistant', JSON.stringify(defaults), nowIso());
      return defaults;
    }

    const parsed = {
      ...defaultAssistantSettings(),
      ...(JSON.parse(row.value_json) as Partial<AssistantSettings>)
    };

    let changed = false;

    if (parsed.dwellMs === 550 || parsed.dwellMs === 2000) {
      parsed.dwellMs = 140;
      changed = true;
    }

    if (parsed.pollIntervalMs === 350) {
      parsed.pollIntervalMs = 120;
      changed = true;
    }

    if (parsed.hoverTolerancePx === 16) {
      parsed.hoverTolerancePx = 24;
      changed = true;
    }

    if (changed) {
      this.db
        .prepare('INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
        .run('assistant', JSON.stringify(parsed), nowIso());
    }

    return parsed;
  }

  public updateAssistantSettings(patch: Partial<AssistantSettings>): AssistantSettings {
    const nextSettings = {
      ...this.getAssistantSettings(),
      ...patch
    };

    this.db
      .prepare('INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run('assistant', JSON.stringify(nextSettings), nowIso());

    return nextSettings;
  }

  public matchAssistantText(activeLibraryId: string | null, recognizedText: string, source: AssistantTextSource): AssistantMatchResult[] {
    const normalizedText = normalizeAssistantText(recognizedText);

    if (!recognizedText || !normalizedText) {
      return [{
        matched: false,
        source,
        recognizedText,
        normalizedText,
        confidence: 0
      }];
    }

    if (!activeLibraryId) {
      return [{
        matched: false,
        source,
        recognizedText,
        normalizedText,
        confidence: 0
      }];
    }

    const candidates = this.findAssistantCandidates(activeLibraryId, recognizedText, 28);
    const ranked = rankAssistantMatches(recognizedText, source, candidates);
    return ranked.length > 0
      ? ranked
      : [
          {
            matched: false,
            source,
            recognizedText,
            normalizedText,
            confidence: 0
          }
        ];
  }

  public previewAssistantMatch(activeLibraryId: string | null, payload: AssistantPreviewPayload): AssistantMatchResult {
    return this.matchAssistantText(activeLibraryId, payload.text.trim(), 'ocr')[0];
  }

  public async exportLibraryPack(libraryId: string, filePath: string): Promise<void> {
    const pack = this.buildLibraryPack(libraryId);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(pack, null, 2), 'utf-8');
  }

  public async importLibraryPack(filePath: string): Promise<LibraryDetail> {
    const raw = await readFile(filePath, 'utf-8');
    const pack = JSON.parse(raw) as PackFile;
    const analysis: ImportBatchAnalysis = {
      batchId: randomId(),
      status: 'draft',
      drafts: pack.questions.map((question) => ({
        tempId: randomId(),
        sourceNo: question.sourceNo,
        type: question.type,
        stem: question.stem,
        options: question.options,
        answers: question.answers,
        section: question.section,
        tags: question.tags,
        confidence: question.confidence,
        issues: question.issues,
        explanation: question.explanation
      })),
      summary: {
        totalQuestions: pack.questions.length,
        byType: {
          single: pack.questions.filter((question) => question.type === 'single').length,
          multiple: pack.questions.filter((question) => question.type === 'multiple').length,
          fill_blank: pack.questions.filter((question) => question.type === 'fill_blank').length,
          true_false: pack.questions.filter((question) => question.type === 'true_false').length
        },
        issueCounts: {
          info: 0,
          warning: 0,
          error: 0
        },
        lowConfidenceCount: pack.questions.filter((question) => question.confidence < 0.7).length,
        sections: [...new Set(pack.questions.map((question) => question.section))],
        tags: [...new Set(pack.questions.flatMap((question) => question.tags))],
        sourceName: pack.library.sourceName ?? '题库包导入',
        format: (pack.library.sourceFormat as ImportBatchAnalysis['format']) ?? 'txt',
        notes: ['从题库包恢复']
      },
      sourceName: pack.library.sourceName ?? '题库包导入',
      format: (pack.library.sourceFormat as ImportBatchAnalysis['format']) ?? 'txt',
      createdAt: nowIso()
    };
    this.saveImportBatch(analysis);
    const library = this.saveLibraryFromDrafts({
      batchId: analysis.batchId,
      name: `${pack.library.name}（导入）`,
      description: pack.library.description,
      drafts: analysis.drafts
    });

    pack.examTemplates.forEach((template) => {
      if (template.name === '默认模拟考试') return;
      this.upsertExamTemplate({
        libraryId: library.id,
        template: {
          ...template,
          id: undefined
        }
      });
    });

    return this.getLibraryDetail(library.id);
  }

  public async backupAll(filePath: string): Promise<void> {
    const libraries = this.listLibraries();
    const packs = libraries.map((library) => this.buildLibraryPack(library.id));

    const sessions = this.db
      .prepare('SELECT * FROM practice_sessions ORDER BY updated_at DESC')
      .all() as Array<Record<string, unknown>>;

    const backup: BackupFile = {
      version: 1,
      exportedAt: nowIso(),
      libraries,
      libraryPacks: packs,
      sessions: sessions.map((row) => this.mapSessionSummary(row))
    };

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(backup, null, 2), 'utf-8');
  }

  private ensureSection(libraryId: string, sectionName: string, cache?: Map<string, string>): string {
    const name = normalizeLine(sectionName) || '未分组';
    const cached = cache?.get(name);
    if (cached) return cached;

    const existing = this.db
      .prepare('SELECT id FROM sections WHERE library_id = ? AND name = ?')
      .get(libraryId, name) as { id: string } | undefined;
    if (existing) {
      cache?.set(name, existing.id);
      return existing.id;
    }

    const id = randomId();
    this.db.prepare('INSERT INTO sections (id, library_id, name) VALUES (?, ?, ?)').run(id, libraryId, name);
    cache?.set(name, id);
    return id;
  }

  private ensureTag(libraryId: string, tagName: string, cache?: Map<string, string>): string {
    const name = normalizeLine(tagName);
    const cached = cache?.get(name);
    if (cached) return cached;

    const existing = this.db
      .prepare('SELECT id FROM tags WHERE library_id = ? AND name = ?')
      .get(libraryId, name) as { id: string } | undefined;
    if (existing) {
      cache?.set(name, existing.id);
      return existing.id;
    }

    const id = randomId();
    this.db.prepare('INSERT INTO tags (id, library_id, name) VALUES (?, ?, ?)').run(id, libraryId, name);
    cache?.set(name, id);
    return id;
  }

  private rebuildQuestionSearch(questionId: string): void {
    const question = this.db
      .prepare(
        `SELECT
          q.id,
          q.library_id,
          q.stem,
          s.name AS section_name
         FROM questions q
         LEFT JOIN sections s ON s.id = q.section_id
         WHERE q.id = ?`
      )
      .get(questionId) as { id: string; library_id: string; stem: string; section_name: string | null } | undefined;
    if (!question) return;

    const choices = this.db
      .prepare('SELECT option_text FROM choices WHERE question_id = ? ORDER BY sort_order ASC')
      .all(questionId) as Array<{ option_text: string }>;
    const tags = this.db
      .prepare(
        `SELECT t.name
         FROM question_tags qt
         INNER JOIN tags t ON t.id = qt.tag_id
         WHERE qt.question_id = ?
         ORDER BY t.name ASC`
      )
      .all(questionId) as Array<{ name: string }>;

    this.db.prepare('DELETE FROM question_search WHERE question_id = ?').run(questionId);
    this.db
      .prepare(
        `INSERT INTO question_search (question_id, library_id, stem, choices, section, tags)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        question.id,
        question.library_id,
        question.stem,
        choices.map((choice) => choice.option_text).join(' '),
        question.section_name ?? '',
        tags.map((tag) => tag.name).join(' ')
      );
  }

  private buildDefaultExamTemplate(libraryId: string, drafts: QuestionDraft[]): ExamTemplate {
    const rules = (['single', 'multiple', 'fill_blank', 'true_false'] as QuestionType[])
      .map((type) => ({
        questionType: type,
        count: drafts.filter((draft) => draft.type === type).length,
        score: 1
      }))
      .filter((rule) => rule.count > 0);
    const totalScore = rules.reduce((sum, rule) => sum + rule.count * rule.score, 0);

    return {
      id: randomId(),
      libraryId,
      name: '默认模拟考试',
      durationMinutes: 60,
      passScore: Math.ceil(totalScore * 0.8),
      totalScore,
      randomize: true,
      rules,
      scope: {},
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  private insertExamTemplate(template: ExamTemplate): void {
    this.db
      .prepare(
        `INSERT INTO exam_templates (id, library_id, name, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           config_json = excluded.config_json,
           updated_at = excluded.updated_at`
      )
      .run(
        template.id,
        template.libraryId,
        template.name,
        JSON.stringify({
          durationMinutes: template.durationMinutes,
          passScore: template.passScore,
          totalScore: template.totalScore,
          randomize: template.randomize,
          rules: template.rules,
          scope: template.scope
        }),
        template.createdAt,
        template.updatedAt
      );
  }

  private deserializeExamTemplate(row: {
    id: string;
    library_id: string;
    name: string;
    config_json: string;
    created_at: string;
    updated_at: string;
  }): ExamTemplate {
    const config = JSON.parse(row.config_json) as Omit<ExamTemplate, 'id' | 'libraryId' | 'name' | 'createdAt' | 'updatedAt'>;
    return {
      id: row.id,
      libraryId: row.library_id,
      name: row.name,
      durationMinutes: config.durationMinutes,
      passScore: config.passScore,
      totalScore: config.totalScore,
      randomize: config.randomize,
      rules: config.rules,
      scope: config.scope,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private selectQuestionsForFilter(filter: PracticeFilter): Question[] {
    let questions = this.listQuestions({
      libraryId: filter.libraryId
    });

    if (filter.questionTypes?.length) {
      const typeSet = new Set(filter.questionTypes);
      questions = questions.filter((question) => typeSet.has(question.type));
    }
    if (filter.sections?.length) {
      const sectionSet = new Set(filter.sections);
      questions = questions.filter((question) => sectionSet.has(question.section));
    }
    if (filter.tags?.length) {
      const tagSet = new Set(filter.tags);
      questions = questions.filter((question) => question.tags.some((tag) => tagSet.has(tag)));
    }
    if (filter.favoritesOnly) {
      questions = questions.filter((question) => question.isFavorite);
    }
    if (filter.wrongOnly) {
      const wrongIds = new Set(
        (
          this.db.prepare(
            `SELECT DISTINCT pa.question_id
             FROM practice_answers pa
             INNER JOIN questions q ON q.id = pa.question_id
             WHERE q.library_id = ? AND pa.is_correct = 0`
          ).all(filter.libraryId) as Array<{ question_id: string }>
        ).map((row) => row.question_id)
      );
      questions = questions.filter((question) => wrongIds.has(question.id));
    }

    if (filter.order === 'random') {
      questions = [...questions].sort(() => Math.random() - 0.5);
    }

    if (filter.limit && filter.limit > 0) {
      questions = questions.slice(0, filter.limit);
    }

    return questions;
  }

  private insertSession(params: {
    libraryId: string;
    title: string;
    questionIds: string[];
    scoreMap: Record<string, number>;
    mode: SessionMode;
    status: SessionStatus;
    examTemplateId: string | null;
    filter: object;
    config: { instantFeedback: boolean; showAnswersOnFinish: boolean };
    totalScore: number;
    passScore: number | null;
  }): string {
    const sessionId = randomId();
    const now = nowIso();
    const snapshot: SessionSnapshot = {
      questionIds: params.questionIds,
      scoreMap: params.scoreMap,
      instantFeedback: params.config.instantFeedback,
      title: params.title,
      showAnswersOnFinish: params.config.showAnswersOnFinish
    };

    this.db
      .prepare(
        `INSERT INTO practice_sessions
          (id, library_id, mode, status, title, exam_template_id, filter_json, config_json, snapshot_json, score, total_score, pass_score, question_count, answered_count, correct_count, started_at, updated_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL)`
      )
      .run(
        sessionId,
        params.libraryId,
        params.mode,
        params.status,
        params.title,
        params.examTemplateId,
        JSON.stringify(params.filter),
        JSON.stringify(params.config),
        JSON.stringify(snapshot),
        0,
        params.totalScore,
        params.passScore,
        params.questionIds.length,
        now,
        now
      );

    return sessionId;
  }

  private recalculateSession(sessionId: string): void {
    const summary = this.db
      .prepare(
        `SELECT COUNT(*) AS answered_count, SUM(is_correct) AS correct_count, SUM(score) AS score
         FROM practice_answers
         WHERE session_id = ?`
      )
      .get(sessionId) as { answered_count: number; correct_count: number | null; score: number | null };

    this.db
      .prepare(
        `UPDATE practice_sessions
         SET answered_count = ?, correct_count = ?, score = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(summary.answered_count, summary.correct_count ?? 0, summary.score ?? 0, nowIso(), sessionId);
  }

  private finishSession(sessionId: string, status: SessionStatus): void {
    this.recalculateSession(sessionId);
    this.db
      .prepare(
        `UPDATE practice_sessions
         SET status = ?, updated_at = ?, finished_at = CASE WHEN ? = 'finished' THEN ? ELSE finished_at END
         WHERE id = ?`
      )
      .run(status, nowIso(), status, nowIso(), sessionId);
  }

  private getQuestionScore(sessionId: string, questionId: string): number {
    const row = this.db.prepare('SELECT snapshot_json FROM practice_sessions WHERE id = ?').get(sessionId) as { snapshot_json: string };
    const snapshot = JSON.parse(row.snapshot_json) as SessionSnapshot;
    return snapshot.scoreMap[questionId] ?? 1;
  }

  private listSessionSummaries(libraryId: string, mode?: SessionMode): PracticeSessionSummary[] {
    const sql = mode
      ? 'SELECT * FROM practice_sessions WHERE library_id = ? AND mode = ? ORDER BY updated_at DESC'
      : 'SELECT * FROM practice_sessions WHERE library_id = ? ORDER BY updated_at DESC';
    const rows = mode ? this.db.prepare(sql).all(libraryId, mode) : this.db.prepare(sql).all(libraryId);
    return (rows as Array<Record<string, unknown>>).map((row) => this.mapSessionSummary(row));
  }

  private mapSessionSummary(row: Record<string, unknown>): PracticeSessionSummary {
    return {
      id: String(row.id),
      libraryId: String(row.library_id),
      mode: row.mode as SessionMode,
      title: String(row.title),
      status: row.status as SessionStatus,
      questionCount: Number(row.question_count),
      answeredCount: Number(row.answered_count),
      correctCount: Number(row.correct_count),
      score: Number(row.score),
      totalScore: Number(row.total_score),
      passScore: row.pass_score === null ? null : Number(row.pass_score),
      startedAt: String(row.started_at),
      updatedAt: String(row.updated_at),
      finishedAt: row.finished_at === null ? null : String(row.finished_at)
    };
  }

  private hydrateQuestions(rows: Array<Record<string, unknown>>): Question[] {
    return rows.map((row) => {
      const questionId = String(row.id);
      const choices = this.db
        .prepare('SELECT option_key, option_text FROM choices WHERE question_id = ? ORDER BY sort_order ASC')
        .all(questionId) as Array<{ option_key: string; option_text: string }>;
      const tags = this.db
        .prepare(
          `SELECT t.name
           FROM question_tags qt
           INNER JOIN tags t ON t.id = qt.tag_id
           WHERE qt.question_id = ?
           ORDER BY t.name COLLATE NOCASE`
        )
        .all(questionId) as Array<{ name: string }>;

      return {
        id: questionId,
        libraryId: String(row.library_id),
        sourceNo: String(row.source_no),
        type: row.type as QuestionType,
        stem: String(row.stem),
        options:
          choices.length > 0
            ? choices.map((choice) => ({
                key: choice.option_key,
                text: choice.option_text
              }))
            : undefined,
        answers: JSON.parse(String(row.answer_json)),
        section: String(row.section_name ?? '未分组'),
        tags: tags.map((tag) => tag.name),
        confidence: Number(row.confidence),
        issues: JSON.parse(String(row.issues_json)),
        explanation: String(row.explanation ?? ''),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        isFavorite: Boolean(row.is_favorite)
      };
    });
  }

  private toFtsQuery(value: string): string {
    return value
      .split(/\s+/)
      .map((token) => token.replace(/["*]/g, '').trim())
      .filter(Boolean)
      .join(' ');
  }

  private relaxedAssistantFtsQuery(recognizedText: string): string {
    return [...new Set(normalizeAssistantText(recognizedText).split(/\s+/).map((token) => token.trim()).filter((token) => token.length >= 2))]
      .slice(0, 8)
      .join(' OR ');
  }

  private toAssistantCandidate(row: AssistantCandidateRow): AssistantCandidateQuestion {
    return {
      id: row.id,
      sourceNo: row.source_no,
      type: row.type,
      stem: row.stem,
      answers: JSON.parse(row.answer_json)
    };
  }

  private loadAssistantCandidatesByIds(libraryId: string, ids: string[]): AssistantCandidateQuestion[] {
    if (!ids.length) {
      return [];
    }

    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT id, source_no, type, stem, answer_json
         FROM questions
         WHERE library_id = ?
           AND id IN (${placeholders})`
      )
      .all(libraryId, ...ids) as AssistantCandidateRow[];

    const mapped = new Map(rows.map((row) => [row.id, this.toAssistantCandidate(row)]));
    return ids.map((id) => mapped.get(id)).filter((row): row is AssistantCandidateQuestion => Boolean(row));
  }

  private listAssistantFallbackCandidates(libraryId: string): AssistantCandidateQuestion[] {
    const rows = this.db
      .prepare(
        `SELECT id, source_no, type, stem, answer_json
         FROM questions
         WHERE library_id = ?`
      )
      .all(libraryId) as AssistantCandidateRow[];

    return rows.map((row) => this.toAssistantCandidate(row));
  }

  private findAssistantCandidates(libraryId: string, recognizedText: string, limit = 24): AssistantCandidateQuestion[] {
    const { ftsQuery, likeTerms } = buildAssistantSearchTerms(recognizedText);
    const relaxedFtsQuery = this.relaxedAssistantFtsQuery(recognizedText);
    const searchLimit = Math.max(limit * 3, 48);
    const ids = new Set<string>();
    const orderedIds: string[] = [];

    const pushIds = (nextIds: string[]): void => {
      nextIds.forEach((id) => {
        if (ids.has(id)) {
          return;
        }
        ids.add(id);
        orderedIds.push(id);
      });
    };

    if (ftsQuery) {
      const ftsRows = this.db
        .prepare(
          `SELECT question_id
           FROM question_search
           WHERE library_id = ?
             AND question_search MATCH ?
           ORDER BY bm25(question_search)
           LIMIT ?`
        )
        .all(libraryId, this.toFtsQuery(ftsQuery), searchLimit) as Array<{ question_id: string }>;
      pushIds(ftsRows.map((row) => row.question_id));
    }

    if (relaxedFtsQuery && relaxedFtsQuery !== ftsQuery && ids.size < searchLimit) {
      const relaxedRows = this.db
        .prepare(
          `SELECT question_id
           FROM question_search
           WHERE library_id = ?
             AND question_search MATCH ?
           ORDER BY bm25(question_search)
           LIMIT ?`
        )
        .all(libraryId, this.toFtsQuery(relaxedFtsQuery), searchLimit - ids.size) as Array<{ question_id: string }>;
      pushIds(relaxedRows.map((row) => row.question_id));
    }

    likeTerms.forEach((term) => {
      if (ids.size >= searchLimit) return;
      const rows = this.db
        .prepare(
          `SELECT id
           FROM questions
           WHERE library_id = ?
             AND stem LIKE ?
           LIMIT ?`
        )
        .all(libraryId, `%${term}%`, searchLimit - ids.size) as Array<{ id: string }>;
      pushIds(rows.map((row) => row.id));
    });

    if (orderedIds.length > 0) {
      return this.loadAssistantCandidatesByIds(libraryId, orderedIds.slice(0, searchLimit));
    }

    return this.listAssistantFallbackCandidates(libraryId);
  }

  private buildLibraryPack(libraryId: string): PackFile {
    const library = this.getLibraryDetail(libraryId);
    const sourceRow = this.db
      .prepare('SELECT source_name, source_format FROM libraries WHERE id = ?')
      .get(libraryId) as { source_name: string | null; source_format: string | null };

    return {
      version: 1,
      exportedAt: nowIso(),
      library: {
        name: library.name,
        description: library.description,
        sourceFormat: sourceRow.source_format,
        sourceName: sourceRow.source_name
      },
      questions: this.listQuestions({ libraryId }),
      examTemplates: this.listExamTemplates(libraryId)
    };
  }
}
