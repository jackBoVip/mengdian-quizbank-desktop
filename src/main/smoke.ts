import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { app } from 'electron';
import { analyzeQuestionFile } from './import';
import { getDatabase } from './app-context';

const findSmokeFixture = (): string => {
  const explicit = process.env.QUIZBANK_SMOKE_FIXTURE;
  if (explicit && existsSync(explicit)) return explicit;

  const docxFixture = join(process.cwd(), 'fixtures', '内蒙古蒙电信产公司安全法律法规考试题库.docx');
  if (existsSync(docxFixture)) return docxFixture;

  return join(process.cwd(), 'tests', 'fixtures', 'sample-question-bank.txt');
};

export const runSmokeMode = async (): Promise<void> => {
  process.env.QUIZBANK_DATA_DIR = join(tmpdir(), 'mengdian-quizbank-smoke');

  await app.whenReady();
  const db = getDatabase();
  const fixturePath = findSmokeFixture();
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

  const firstQuestion = questions[0];
  if (firstQuestion) {
    db.answerSession({
      sessionId: practice.id,
      questionId: firstQuestion.id,
      answers: firstQuestion.answers
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
  app.exit(0);
};
