import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const workspaceRoot = process.cwd();
const runtimeRoot = join(workspaceRoot, 'tools', 'ocr-runtime');
const packageJsonPath = join(runtimeRoot, 'package.json');
const packageLockPath = join(runtimeRoot, 'package-lock.json');
const runtimeModulePath = join(runtimeRoot, 'node_modules', '@gutenye', 'ocr-node', 'package.json');
const installMarkerPath = join(runtimeRoot, 'node_modules', '.prepared-hash');

const readFingerprint = () =>
  createHash('sha256')
    .update(readFileSync(packageJsonPath))
    .update(readFileSync(packageLockPath))
    .digest('hex');

const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`));
    });
  });

const currentFingerprint = readFingerprint();
const installedFingerprint = existsSync(installMarkerPath) ? readFileSync(installMarkerPath, 'utf-8').trim() : '';

if (existsSync(runtimeModulePath) && installedFingerprint === currentFingerprint) {
  console.log('ocr runtime dependencies already prepared');
  process.exit(0);
}

if (existsSync(runtimeModulePath) && !installedFingerprint) {
  await mkdir(join(runtimeRoot, 'node_modules'), { recursive: true });
  await writeFile(installMarkerPath, `${currentFingerprint}\n`, 'utf-8');
  console.log('ocr runtime dependencies already installed, marker refreshed');
  process.exit(0);
}

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log('installing ocr runtime dependencies...');
await run(npmExecutable, ['ci', '--no-audit', '--no-fund'], runtimeRoot);
await mkdir(join(runtimeRoot, 'node_modules'), { recursive: true });
await writeFile(installMarkerPath, `${currentFingerprint}\n`, 'utf-8');
console.log('prepared ocr runtime dependencies');
