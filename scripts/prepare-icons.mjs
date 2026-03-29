import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pngDir = join(root, 'build/icons/png');
const linuxIconDir = join(root, 'build/icons/linux');
const rendererPublicDir = join(root, 'src/renderer/public');
const windowsIconPath = join(root, 'build/icons/icon.ico');

const requiredSizes = [16, 32, 48, 64, 128, 256, 512, 1024];

for (const size of requiredSizes) {
  const filePath = join(pngDir, `icon-${size}.png`);
  if (!existsSync(filePath)) {
    throw new Error(`Missing icon source: ${filePath}`);
  }
}

mkdirSync(rendererPublicDir, { recursive: true });
mkdirSync(linuxIconDir, { recursive: true });
cpSync(join(pngDir, 'icon-512.png'), join(rendererPublicDir, 'brand-logo.png'));
cpSync(join(pngDir, 'icon-128.png'), join(rendererPublicDir, 'favicon.png'));

for (const size of requiredSizes) {
  cpSync(join(pngDir, `icon-${size}.png`), join(linuxIconDir, `${size}x${size}.png`));
}

const icoSizes = [16, 32, 48, 64, 128, 256];
const imageBuffers = icoSizes.map((size) => readFileSync(join(pngDir, `icon-${size}.png`)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(imageBuffers.length, 4);

let offset = header.length + imageBuffers.length * 16;
const entries = imageBuffers.map((buffer, index) => {
  const size = icoSizes[index];
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(buffer.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += buffer.length;
  return entry;
});

writeFileSync(windowsIconPath, Buffer.concat([header, ...entries, ...imageBuffers]));
