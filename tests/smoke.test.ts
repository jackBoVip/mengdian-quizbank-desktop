import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('smoke flow', () => {
  it(
    'builds the app and completes the import/practice/exam smoke workflow in Electron',
    async () => {
      const fixturePath = join(process.cwd(), 'fixtures/内蒙古蒙电信产公司安全法律法规考试题库.docx');
      const { stdout } = await execFileAsync('pnpm', ['smoke'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          QUIZBANK_SMOKE_FIXTURE: fixturePath
        },
        maxBuffer: 1024 * 1024 * 20
      });

      const lastLine = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .at(-1);
      expect(lastLine).toBeTruthy();

      const summary = JSON.parse(lastLine ?? '{}') as {
        ok: boolean;
        questionCount: number;
        stats: { libraryCount: number; practiceCount: number };
      };
      expect(summary.ok).toBe(true);
      expect(summary.questionCount).toBeGreaterThan(200);
      expect(summary.stats.libraryCount).toBe(1);
      expect(summary.stats.practiceCount).toBeGreaterThanOrEqual(2);
    },
    120_000
  );
});
