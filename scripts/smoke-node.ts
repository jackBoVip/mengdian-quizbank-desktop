import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AppDatabase } from '../src/main/database/AppDatabase.ts';
import { analyzeQuestionFile } from '../src/main/import/index.ts';

const resolveFixture = (): string => {
  const explicit = process.env.QUIZBANK_SMOKE_FIXTURE;
  if (explicit && existsSync(explicit)) return explicit;

  const docxFixture = join(process.cwd(), 'fixtures', '内蒙古蒙电信产公司安全法律法规考试题库.docx');
  if (existsSync(docxFixture)) return docxFixture;

  return join(process.cwd(), 'tests/fixtures/sample-question-bank.txt');
};

const main = async (): Promise<void> => {
  const fixturePath = resolveFixture();
  const dir = await mkdtemp(join(tmpdir(), 'quizbank-smoke-'));
  const db = new AppDatabase(join(dir, 'quizbank.db'));

  try {
    const analysis = await analyzeQuestionFile(fixturePath);
    db.saveImportBatch(analysis);
    const library = db.saveLibraryFromDrafts({
      batchId: analysis.batchId,
      name: 'Smoke Library',
      description: 'Smoke Test',
      drafts: analysis.drafts
    });
    const questions = db.listQuestions({ libraryId: library.id });

    const practice = db.startPractice({
      libraryId: library.id,
      order: 'sequential',
      limit: Math.min(5, questions.length),
      title: 'Smoke Practice'
    });

    if (questions[0]) {
      db.answerSession({
        sessionId: practice.id,
        questionId: questions[0].id,
        answers: questions[0].answers
      });
    }
    db.finishPractice(practice.id);

    const template = db.listExamTemplates(library.id)[0];
    if (template) {
      const exam = db.startExam({
        libraryId: library.id,
        examTemplateId: template.id
      });
      exam.questions.slice(0, 3).forEach((question) => {
        const source = questions.find((item) => item.id === question.questionId);
        if (!source) return;
        db.answerSession({
          sessionId: exam.id,
          questionId: question.questionId,
          answers: source.answers
        });
      });
      db.submitExam(exam.id);
    }

    const stats = db.getDashboardStats();
    process.stdout.write(`${JSON.stringify({ ok: true, libraryId: library.id, questionCount: library.questionCount, stats })}\n`);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
};

await main();
