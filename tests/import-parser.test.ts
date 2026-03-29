import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeQuestionFile } from '@main/import';

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

describe('analyzeQuestionFile', () => {
  it('parses txt banks with all four question types', async () => {
    const analysis = await analyzeQuestionFile(join(process.cwd(), 'tests/fixtures/sample-question-bank.txt'));

    expect(analysis.summary.totalQuestions).toBe(6);
    expect(analysis.summary.byType.single).toBe(2);
    expect(analysis.summary.byType.fill_blank).toBe(1);
    expect(analysis.summary.byType.multiple).toBe(1);
    expect(analysis.summary.byType.true_false).toBe(2);
    expect(analysis.drafts[0]?.answers).toEqual(['A']);
    expect(analysis.drafts.at(-1)?.answers).toEqual(['正确']);
  });

  it('parses the provided docx fixture into the expected section counts', async () => {
    const analysis = await analyzeQuestionFile(join(process.cwd(), 'fixtures/内蒙古蒙电信产公司安全法律法规考试题库.docx'));

    expect(analysis.summary.totalQuestions).toBe(285);
    expect(analysis.summary.byType.single).toBe(100);
    expect(analysis.summary.byType.fill_blank).toBe(60);
    expect(analysis.summary.byType.multiple).toBe(60);
    expect(analysis.summary.byType.true_false).toBe(65);
  });

  it('splits fill blank answers by spaces when the stem contains multiple blanks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'quizbank-txt-'));
    cleanupPaths.push(dir);
    const filePath = join(dir, 'fill-blank-spaces.txt');

    await writeFile(
      filePath,
      `示例题库
一、填空题（共1题）
1.班前会“三讲三看一落实”工作内容包括（    ）、（    ）、（    ）。
答案：人员状态 作业现场 安全技术防护措施
`,
      'utf-8'
    );

    const analysis = await analyzeQuestionFile(filePath);

    expect(analysis.summary.totalQuestions).toBe(1);
    expect(analysis.drafts[0]?.type).toBe('fill_blank');
    expect(analysis.drafts[0]?.answers).toEqual(['人员状态', '作业现场', '安全技术防护措施']);
    expect(analysis.drafts[0]?.issues).toEqual([]);
  });

  it('parses structured xlsx sheets via column mapping', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'quizbank-xlsx-'));
    cleanupPaths.push(dir);
    const filePath = join(dir, 'structured.xlsx');

    const worksheet = XLSX.utils.json_to_sheet([
      {
        题号: 1,
        题型: '单选题',
        章节: '安全生产法',
        题目: '从业人员发现事故隐患后应当（    ）。',
        选项A: '立即报告',
        选项B: '不予理会',
        选项C: '继续作业',
        选项D: '擅自离岗',
        答案: 'A',
        标签: '法规,报告'
      },
      {
        题号: 2,
        题型: '判断题',
        章节: '消防',
        题目: '火灾时可以乘坐电梯。（×）',
        答案: '错误',
        标签: '消防'
      }
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '题库');
    XLSX.writeFile(workbook, filePath);

    const analysis = await analyzeQuestionFile(filePath);

    expect(analysis.summary.totalQuestions).toBe(2);
    expect(analysis.summary.byType.single).toBe(1);
    expect(analysis.summary.byType.true_false).toBe(1);
    expect(analysis.drafts[0]?.tags).toEqual(['法规', '报告']);
  });
});
