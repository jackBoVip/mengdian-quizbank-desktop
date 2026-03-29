import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const workspaceRoot = process.cwd();
const helperRoot = join(workspaceRoot, 'build', 'assistant-helper');
const helperAppRoot = join(helperRoot, 'macos', 'MengdianAssistantHelper.app');
const executablePath = join(helperAppRoot, 'Contents', 'MacOS', 'assistant-helper');
const plistPath = join(helperAppRoot, 'Contents', 'Info.plist');
const sourcePath = join(workspaceRoot, 'native', 'assistant-helper-macos.m');
const moduleCachePath = join(workspaceRoot, 'build', '.clang-module-cache');

await rm(helperRoot, {
  recursive: true,
  force: true
});

if (process.platform !== 'darwin') {
  await mkdir(join(helperRoot, 'unsupported'), { recursive: true });
  console.log('skipped assistant helper build on non-macOS host');
  process.exit(0);
}

await mkdir(dirname(executablePath), {
  recursive: true
});
await mkdir(moduleCachePath, {
  recursive: true
});

await execFileAsync('clang', [
  '-fmodules',
  '-fobjc-arc',
  '-fmodules-cache-path=' + moduleCachePath,
  '-framework',
  'Foundation',
  '-framework',
  'AppKit',
  '-framework',
  'ApplicationServices',
  '-framework',
  'ScreenCaptureKit',
  sourcePath,
  '-o',
  executablePath
], {
  cwd: workspaceRoot
});

await chmod(executablePath, 0o755);

await writeFile(
  plistPath,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>蒙电题库通答题助手</string>
  <key>CFBundleExecutable</key>
  <string>assistant-helper</string>
  <key>CFBundleIdentifier</key>
  <string>com.mengdian.quizbank.desktop.assistanthelper</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>蒙电题库通答题助手</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`,
  'utf-8'
);

console.log(`prepared assistant helper app: ${helperAppRoot}`);
