import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { app } from 'electron';
import type { AssistantPermissionState, AssistantTipPayload } from '@shared/types';

interface HelperResponse<T> {
  id?: number;
  ok: boolean;
  result?: T;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface HelperPermissionsResult {
  platform: NodeJS.Platform;
  helper: string;
  accessibility: string;
  screenCapture: string;
  ocrRuntime: string;
}

export interface HelperInspectResult {
  point: {
    x: number;
    y: number;
  };
  ocrPoint: {
    x: number;
    y: number;
  } | null;
  ocrCaptureRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  ocrImagePath: string | null;
  accessibilityText: string | null;
  ocrText: string | null;
}

const HELPER_APP_NAME = 'MengdianAssistantHelper.app';
const HELPER_DIR = ['assistant-helper', 'macos', HELPER_APP_NAME, 'Contents', 'MacOS'];
const HELPER_NAME = 'assistant-helper';
const HELPER_BUNDLE_ID = 'com.mengdian.quizbank.desktop.assistanthelper';
const HELPER_DISPLAY_NAME = 'MengdianAssistantHelper（蒙电题库通答题助手）';
const HELPER_REQUEST_TIMEOUT_MS = 2800;

const unsupportedPermissions = (): AssistantPermissionState => ({
  platform: process.platform,
  helper: process.platform === 'darwin' ? 'missing' : 'unsupported',
  accessibility: process.platform === 'darwin' ? 'missing' : 'unsupported',
  screenCapture: process.platform === 'darwin' ? 'missing' : 'unsupported',
  ocrRuntime: process.platform === 'darwin' ? 'unsupported' : 'unsupported'
});

const normalizePermissionValue = (value: string | undefined): AssistantPermissionState[keyof Omit<AssistantPermissionState, 'platform'>] =>
  value === 'granted' || value === 'missing' || value === 'unsupported' ? value : 'missing';

export class AssistantHelperClient {
  private lastError: string | null = null;

  private child: ChildProcessWithoutNullStreams | null = null;

  private stdoutBuffer = '';

  private nextRequestId = 1;

  private pending = new Map<number, PendingRequest>();

  public get mode(): 'native' | 'none' {
    return this.isSupported() ? 'native' : 'none';
  }

  public get error(): string | null {
    return this.lastError;
  }

  public get bundleId(): string {
    return HELPER_BUNDLE_ID;
  }

  public get displayName(): string {
    return HELPER_DISPLAY_NAME;
  }

  public get executablePath(): string {
    return this.getScriptPath();
  }

  public get bundlePath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'assistant-helper', 'macos', HELPER_APP_NAME)
      : join(process.cwd(), 'build', 'assistant-helper', 'macos', HELPER_APP_NAME);
  }

  public isSupported(): boolean {
    return process.platform === 'darwin' && existsSync(this.getScriptPath());
  }

  public async getPermissions(): Promise<AssistantPermissionState> {
    if (!this.isSupported()) return unsupportedPermissions();
    const result = await this.runOnce<HelperPermissionsResult>('status');
    return this.toPermissions(result);
  }

  public async requestPermissions(): Promise<AssistantPermissionState> {
    if (!this.isSupported()) return unsupportedPermissions();
    const result = await this.runOnce<HelperPermissionsResult>('requestPermissions');
    return this.toPermissions(result);
  }

  public async inspectAtCursor(): Promise<HelperInspectResult | null> {
    if (!this.isSupported()) return null;
    return this.requestSession<HelperInspectResult>('inspectAtCursor');
  }

  public async setTip(tip: AssistantTipPayload | null): Promise<void> {
    if (!this.isSupported()) {
      return;
    }

    if (!tip) {
      if (!this.child || this.child.killed) {
        return;
      }
      await this.requestSession('hideTip', undefined, false);
      return;
    }

    await this.requestSession('showTip', tip, true);
  }

  public resetSession(): void {
    this.resetChild();
  }

  public dispose(): void {
    this.rejectPending(new Error('答题助手 helper 已释放'));
    this.resetChild();
  }

  private getScriptPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, ...HELPER_DIR, HELPER_NAME)
      : join(process.cwd(), 'build', ...HELPER_DIR, HELPER_NAME);
  }

  private async runOnce<T>(method: string): Promise<T> {
    if (!this.isSupported()) {
      throw new Error('答题助手 helper 不可用');
    }

    return new Promise<T>((resolve, reject) => {
      const child = spawn(this.getScriptPath(), [method], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (error?: Error, value?: T): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);

        if (error) {
          this.lastError = error.message;
          reject(error);
          return;
        }

        this.lastError = null;
        resolve(value as T);
      };

      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error(`答题助手 helper 请求超时（>${HELPER_REQUEST_TIMEOUT_MS}ms）`));
      }, HELPER_REQUEST_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk).trim();
      });

      child.on('error', (error) => {
        finish(new Error(`答题助手 helper 启动失败: ${error.message}`));
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }

        const line = stdout
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean)
          .at(-1);

        if (!line) {
          const detail = stderr || `答题助手 helper 已退出（code=${code ?? 'unknown'}）`;
          finish(new Error(detail));
          return;
        }

        try {
          const payload = JSON.parse(line) as HelperResponse<T>;
          if (!payload.ok) {
            finish(new Error(payload.error ?? '答题助手 helper 返回未知错误'));
            return;
          }

          finish(undefined, payload.result as T);
        } catch (error) {
          const parseError = error instanceof Error ? error : new Error('答题助手 helper 输出解析失败');
          finish(parseError);
        }
      });
    });
  }

  private async requestSession<T>(method: string, params?: unknown, spawnIfNeeded = true): Promise<T> {
    if (!this.isSupported()) {
      throw new Error('答题助手 helper 不可用');
    }

    const child = spawnIfNeeded ? this.ensureChild() : this.child;
    if (!child || child.killed) {
      throw new Error('答题助手 helper 会话不可用');
    }
    const id = this.nextRequestId++;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error(`答题助手 helper 请求超时（>${HELPER_REQUEST_TIMEOUT_MS}ms）`);
        this.lastError = error.message;
        this.failChild(error);
      }, HELPER_REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout
      });

      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) {
          return;
        }

        const nextError = error instanceof Error ? error : new Error('答题助手 helper 写入失败');
        this.lastError = nextError.message;
        this.failChild(nextError);
      });
    });
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) {
      return this.child;
    }

    const child = spawn(this.getScriptPath(), ['serve'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.stdoutBuffer = '';
    this.child = child;

    child.stdout.on('data', (chunk) => {
      this.stdoutBuffer += String(chunk);
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() ?? '';

      lines
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          this.handleResponseLine(line);
        });
    });

    child.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) {
        this.lastError = message;
      }
    });

    child.on('error', (error) => {
      this.lastError = error.message;
      this.failChild(new Error(`答题助手 helper 启动失败: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        this.lastError = `答题助手 helper 已退出（code=${code}）`;
      }
      this.failChild(new Error(this.lastError ?? `答题助手 helper 已退出（code=${code ?? 'unknown'}）`));
    });

    return child;
  }

  private handleResponseLine(line: string): void {
    try {
      const payload = JSON.parse(line) as HelperResponse<unknown>;
      if (typeof payload.id !== 'number') {
        return;
      }

      const pending = this.pending.get(payload.id);
      if (!pending) {
        return;
      }
      this.pending.delete(payload.id);
      clearTimeout(pending.timeout);

      if (!payload.ok) {
        const error = new Error(payload.error ?? '答题助手 helper 返回未知错误');
        this.lastError = error.message;
        pending.reject(error);
        return;
      }

      this.lastError = null;
      pending.resolve(payload.result);
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error('答题助手 helper 输出解析失败');
      this.lastError = parseError.message;
      this.failChild(parseError);
    }
  }

  private rejectPending(error: Error): void {
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    this.pending.clear();
  }

  private failChild(error: Error): void {
    this.rejectPending(error);
    this.resetChild();
  }

  private resetChild(): void {
    const current = this.child;
    this.child = null;
    this.stdoutBuffer = '';
    if (current && !current.killed) {
      current.removeAllListeners();
      current.stdout.removeAllListeners();
      current.stderr.removeAllListeners();
      current.kill();
    }
  }

  private toPermissions(result: HelperPermissionsResult): AssistantPermissionState {
    return {
      platform: result.platform ?? process.platform,
      helper: normalizePermissionValue(result.helper),
      accessibility: normalizePermissionValue(result.accessibility),
      screenCapture: normalizePermissionValue(result.screenCapture),
      ocrRuntime: normalizePermissionValue(result.ocrRuntime)
    };
  }
}
