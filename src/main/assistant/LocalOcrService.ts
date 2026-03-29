import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import type { OcrCaptureRect, OcrPointer, OcrSelection, OcrTextLine } from './ocr';
import { selectOcrText } from './ocr';

type OcrBoxPoint = [number, number];

type OcrBox = [OcrBoxPoint, OcrBoxPoint, OcrBoxPoint, OcrBoxPoint];

export interface OcrTextLineRuntime {
  text: string;
  score?: number;
  mean?: number;
  frame?: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  box?: OcrBox;
}

interface OcrRuntimeInstance {
  detect(imagePath: string): Promise<OcrTextLineRuntime[]>;
}

interface LocalOcrInput {
  imagePath: string;
  point: OcrPointer;
  captureRect: OcrCaptureRect;
}

const OCR_DETECT_TIMEOUT_MS = 1800;
const OCR_RUNTIME_BOOT_TIMEOUT_MS = 3000;
const OCR_RUNTIME_RETRY_INTERVAL_MS = 5000;

const withTimeout = async <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const boxToFrame = (box: OcrBox | undefined): OcrTextLine['frame'] | null => {
  if (!box || box.length !== 4) {
    return null;
  }

  const xs = box.map((point) => point?.[0]).filter((value): value is number => Number.isFinite(value));
  const ys = box.map((point) => point?.[1]).filter((value): value is number => Number.isFinite(value));
  if (xs.length !== 4 || ys.length !== 4) {
    return null;
  }

  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    top,
    left,
    width,
    height
  };
};

export const normalizeRuntimeLine = (line: OcrTextLineRuntime): OcrTextLine | null => {
  const text = typeof line.text === 'string' ? line.text.trim() : '';
  if (!text) {
    return null;
  }

  const frame =
    line.frame &&
    Number.isFinite(line.frame.top) &&
    Number.isFinite(line.frame.left) &&
    Number.isFinite(line.frame.width) &&
    Number.isFinite(line.frame.height) &&
    line.frame.width > 0 &&
    line.frame.height > 0
      ? line.frame
      : boxToFrame(line.box);

  if (!frame) {
    return null;
  }

  const confidence = typeof line.score === 'number' ? line.score : typeof line.mean === 'number' ? line.mean : 0;

  return {
    text,
    score: confidence,
    frame
  };
};

export class LocalOcrService {
  private instancePromise: Promise<OcrRuntimeInstance> | null = null;

  private lastError: string | null = null;

  private availability: 'unknown' | 'granted' | 'missing' = 'unknown';

  private availabilityCheckedAt = 0;

  public get displayName(): string {
    return 'Guten OCR / PP-OCRv4';
  }

  public get error(): string | null {
    return this.lastError;
  }

  public isSupported(): boolean {
    return existsSync(this.getEntryPath());
  }

  public async getAvailability(): Promise<'granted' | 'missing'> {
    if (!this.isSupported()) {
      this.availability = 'missing';
      return 'missing';
    }

    const now = Date.now();
    if (this.availability === 'granted') {
      return 'granted';
    }
    if (this.availability === 'missing' && now - this.availabilityCheckedAt < OCR_RUNTIME_RETRY_INTERVAL_MS) {
      return 'missing';
    }

    try {
      await this.getRuntime();
      this.lastError = null;
      this.availability = 'granted';
      this.availabilityCheckedAt = now;
      return 'granted';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : '本地 OCR 运行时初始化失败';
      this.instancePromise = null;
      this.availability = 'missing';
      this.availabilityCheckedAt = now;
      return 'missing';
    }
  }

  public async recognizeAtCursor(input: LocalOcrInput): Promise<OcrSelection | null> {
    if (!this.isSupported() || !existsSync(input.imagePath)) {
      return null;
    }

    try {
      const runtime = await this.getRuntime();
      const lines = (await withTimeout(
        runtime.detect(input.imagePath) as Promise<OcrTextLineRuntime[]>,
        OCR_DETECT_TIMEOUT_MS,
        `本地 OCR 超时（>${OCR_DETECT_TIMEOUT_MS}ms）`
      )) as OcrTextLineRuntime[];
      this.lastError = null;

      const normalizedLines: OcrTextLine[] = lines
        .map((line) => normalizeRuntimeLine(line))
        .filter((line): line is OcrTextLine => Boolean(line));

      this.availability = 'granted';
      this.availabilityCheckedAt = Date.now();
      return selectOcrText(normalizedLines, input.point, input.captureRect);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : '本地 OCR 运行失败';
      this.instancePromise = null;
      this.availability = 'missing';
      this.availabilityCheckedAt = Date.now();
      return null;
    }
  }

  private async getRuntime(): Promise<OcrRuntimeInstance> {
    if (!this.instancePromise) {
      this.instancePromise = this.loadRuntime().catch((error) => {
        this.instancePromise = null;
        throw error;
      });
    }

    return this.instancePromise;
  }

  private async loadRuntime(): Promise<OcrRuntimeInstance> {
    const entryPath = this.getEntryPath();
    const moduleUrl = pathToFileURL(entryPath).href;
    const imported = (await import(moduleUrl)) as { default?: { create?: () => Promise<OcrRuntimeInstance> } };
    const create = imported.default?.create;

    if (typeof create !== 'function') {
      throw new Error('本地 OCR 运行时未暴露 create() 接口');
    }

    return withTimeout(create(), OCR_RUNTIME_BOOT_TIMEOUT_MS, `本地 OCR 初始化超时（>${OCR_RUNTIME_BOOT_TIMEOUT_MS}ms）`);
  }

  private getRuntimeRoot(): string {
    return app.isPackaged ? join(process.resourcesPath, 'ocr-runtime') : join(process.cwd(), 'tools', 'ocr-runtime');
  }

  private getEntryPath(): string {
    return join(this.getRuntimeRoot(), 'node_modules', '@gutenye', 'ocr-node', 'build', 'index.js');
  }
}
