import { app, BrowserWindow, globalShortcut, screen, shell, systemPreferences } from 'electron';
import type {
  AssistantMatchResult,
  AssistantPreviewPayload,
  AssistantRuntimeStatus,
  AssistantSettings,
  AssistantTextSource,
  AssistantTipPayload
} from '@shared/types';
import { defaultAssistantSettings } from '@shared/types';
import { IPC_EVENTS } from '@shared/ipc';
import { createAssistantDisplayKey, shouldDisplayAssistantMatch } from '@main/assistant/matching';
import type { AppDatabase } from '@main/database/AppDatabase';
import { AssistantHelperClient } from './AssistantHelperClient';
import { LocalOcrService } from './LocalOcrService';

interface AssistantManagerOptions {
  preloadPath: string;
  rendererIndex: string;
  isDev: boolean;
  devServerUrl?: string;
}

interface Point {
  x: number;
  y: number;
}

const OVERLAY_WIDTH = 238;
const OVERLAY_HEIGHT = 92;
const OCR_CACHE_TTL_MS = 700;
const TIP_STICKY_MS = 1800;
const HIDE_ON_LARGE_MOVE_PX = 260;
const TIP_CONFIDENCE_HOLD_FLOOR = 0.52;
const TIP_SWITCH_CONFIRMATIONS = 2;
const STATUS_BROADCAST_INTERVAL_MS = 250;

const distance = (left: Point, right: Point): number => Math.hypot(left.x - right.x, left.y - right.y);

const compact = (value: string): string => value.replace(/\s+/g, '');

const unique = <T,>(items: T[]): T[] => [...new Set(items)];

const usableText = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return compact(trimmed).length >= 8 ? trimmed : null;
};

const cloneStatus = (status: AssistantRuntimeStatus): AssistantRuntimeStatus =>
  JSON.parse(JSON.stringify(status)) as AssistantRuntimeStatus;

export class AssistantManager {
  private readonly helper = new AssistantHelperClient();

  private readonly ocr = new LocalOcrService();

  private settings: AssistantSettings;

  private status: AssistantRuntimeStatus;

  private overlayWindow: BrowserWindow | null = null;

  private currentTip: AssistantTipPayload | null = null;

  private pollTimer: NodeJS.Timeout | null = null;

  private busy = false;

  private hoverAnchor: Point | null = null;

  private hoverStartedAt = 0;

  private lastInspectedAt = 0;

  private lastMatchKey = '';

  private lastSuccessfulAt = 0;

  private lastTipAnchor: Point | null = null;

  private lastOcrKey = '';

  private lastOcrPoint: Point | null = null;

  private lastOcrSelection: Awaited<ReturnType<LocalOcrService['recognizeAtCursor']>> = null;

  private lastOcrAt = 0;

  private pendingMatchKey = '';

  private pendingMatchCount = 0;

  private lastBroadcastAt = 0;

  private lastBroadcastSerialized = '';

  private pendingBroadcastPayload: AssistantRuntimeStatus | null = null;

  private pendingBroadcastSerialized = '';

  private pendingBroadcastTimer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly db: AppDatabase,
    private readonly options: AssistantManagerOptions
  ) {
    this.settings = {
      ...defaultAssistantSettings(),
      ...this.db.getAssistantSettings()
    };
    this.status = {
      enabled: this.settings.enabled,
      running: false,
      overlayVisible: false,
      blockedReason: null,
      activeLibraryId: this.settings.activeLibraryId,
      activeLibraryName: this.getActiveLibraryName(this.settings.activeLibraryId),
      helperMode: this.helper.mode,
      lastTextSource: 'none',
      lastRecognizedText: null,
      permissions: {
        platform: process.platform,
        helper: this.helper.mode === 'native' ? 'missing' : 'unsupported',
        accessibility: process.platform === 'darwin' ? 'missing' : 'unsupported',
        screenCapture: this.helper.mode === 'native' ? 'unsupported' : 'unsupported',
        ocrRuntime: this.helper.mode === 'native' ? 'unsupported' : 'unsupported'
      },
      diagnostics: {
        isPackaged: app.isPackaged,
        appExecutablePath: process.execPath,
        helperBundleId: this.helper.mode === 'native' ? this.helper.bundleId : null,
        helperDisplayName: this.helper.mode === 'native' ? this.helper.displayName : null,
        helperExecutablePath: this.helper.mode === 'native' ? this.helper.executablePath : null,
        helperBundlePath: this.helper.mode === 'native' ? this.helper.bundlePath : null,
        permissionSource: this.helper.mode === 'native' ? 'native-helper' : 'electron-main',
        helperLastError: this.helper.error,
        ocrEngine: this.ocr.isSupported() ? this.ocr.displayName : null,
        ocrLastError: this.ocr.error,
        lastBestMatch: null,
        lastSecondMatch: null
      }
    };
  }

  public async initialize(): Promise<void> {
    this.registerShortcut();
    await this.refreshStatus();
    if (this.settings.enabled) {
      this.applyRunningState();
    }
  }

  public dispose(): void {
    this.stopPolling();
    this.hideTip();
    this.overlayWindow?.destroy();
    this.overlayWindow = null;
    globalShortcut.unregister(this.settings.shortcut);
    if (this.pendingBroadcastTimer) {
      clearTimeout(this.pendingBroadcastTimer);
      this.pendingBroadcastTimer = null;
    }
    this.helper.dispose();
  }

  public getSettings(): AssistantSettings {
    return { ...this.settings };
  }

  public async getStatus(): Promise<AssistantRuntimeStatus> {
    const previous = JSON.stringify(this.status);
    await this.refreshStatus();
    this.applyRunningState();
    if (JSON.stringify(this.status) !== previous) {
      this.broadcastStatus();
    }
    return cloneStatus(this.status);
  }

  public async updateSettings(patch: Partial<AssistantSettings>): Promise<AssistantSettings> {
    const previousShortcut = this.settings.shortcut;
    this.settings = this.db.updateAssistantSettings(patch);
    this.status.enabled = this.settings.enabled;
    this.status.activeLibraryId = this.settings.activeLibraryId;
    this.status.activeLibraryName = this.getActiveLibraryName(this.settings.activeLibraryId);

    if (patch.shortcut && patch.shortcut !== previousShortcut) {
      globalShortcut.unregister(previousShortcut);
      this.registerShortcut();
    }

    await this.refreshStatus();
    this.applyRunningState();
    this.broadcastStatus();
    return { ...this.settings };
  }

  public async toggle(enabled?: boolean): Promise<AssistantRuntimeStatus> {
    const nextEnabled = enabled ?? !this.settings.enabled;
    await this.updateSettings({ enabled: nextEnabled });
    if (nextEnabled && process.platform === 'darwin' && !this.status.running) {
      await this.requestPermissions();
    }
    return cloneStatus(this.status);
  }

  public async requestPermissions(): Promise<AssistantRuntimeStatus> {
    if (process.platform === 'darwin') {
      if (this.helper.mode === 'native') {
        try {
          this.status.permissions = await this.helper.requestPermissions();
        } catch (error) {
          this.status.permissions.helper = 'missing';
          this.status.blockedReason = error instanceof Error ? error.message : '答题助手 helper 启动失败';
        }
      } else {
        try {
          systemPreferences.isTrustedAccessibilityClient(true);
        } catch {
          // Ignore prompt failures and fall back to opening System Settings.
        }
      }

      const needsAccessibility = this.status.permissions.accessibility !== 'granted';
      const needsScreenCapture = this.status.permissions.ocrRuntime === 'granted' && this.status.permissions.screenCapture !== 'granted';

      if (needsAccessibility) {
        void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      } else if (needsScreenCapture) {
        void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      }

      this.helper.resetSession();
    }
    await this.refreshStatus();
    this.applyRunningState();
    this.broadcastStatus();
    return cloneStatus(this.status);
  }

  public previewMatch(payload: AssistantPreviewPayload): AssistantMatchResult {
    return this.db.previewAssistantMatch(this.settings.activeLibraryId, payload);
  }

  public isKeepingAlive(): boolean {
    return this.status.running;
  }

  private registerShortcut(): void {
    if (!this.settings.shortcut) return;
    try {
      globalShortcut.register(this.settings.shortcut, () => {
        void this.toggle();
      });
    } catch (error) {
      this.status.blockedReason = error instanceof Error ? error.message : '全局快捷键注册失败';
    }
  }

  private async refreshStatus(): Promise<void> {
    if (this.helper.mode === 'native') {
      try {
        this.status.permissions = await this.helper.getPermissions();
        if (this.status.permissions.ocrRuntime !== 'unsupported') {
          this.status.permissions.ocrRuntime = await this.ocr.getAvailability();
        }
      } catch (error) {
        this.status.permissions.helper = 'missing';
        this.status.blockedReason = error instanceof Error ? error.message : '答题助手 helper 启动失败';
      }
    } else if (process.platform === 'darwin') {
      try {
        this.status.permissions.accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'missing';
      } catch {
        this.status.permissions.accessibility = 'missing';
      }
    }

    this.status.enabled = this.settings.enabled;
    this.status.activeLibraryId = this.settings.activeLibraryId;
    this.status.activeLibraryName = this.getActiveLibraryName(this.settings.activeLibraryId);
    this.status.helperMode = this.helper.mode;
    this.status.diagnostics = {
      isPackaged: app.isPackaged,
      appExecutablePath: process.execPath,
      helperBundleId: this.helper.mode === 'native' ? this.helper.bundleId : null,
      helperDisplayName: this.helper.mode === 'native' ? this.helper.displayName : null,
      helperExecutablePath: this.helper.mode === 'native' ? this.helper.executablePath : null,
      helperBundlePath: this.helper.mode === 'native' ? this.helper.bundlePath : null,
      permissionSource: this.helper.mode === 'native' ? 'native-helper' : 'electron-main',
      helperLastError: this.helper.error,
      ocrEngine: this.ocr.isSupported() ? this.ocr.displayName : null,
      ocrLastError: this.ocr.error,
      lastBestMatch: this.status.diagnostics.lastBestMatch,
      lastSecondMatch: this.status.diagnostics.lastSecondMatch
    };

    const hasAccessibility = this.status.permissions.accessibility === 'granted';
    const hasOcrPath = this.status.permissions.screenCapture === 'granted' && this.status.permissions.ocrRuntime === 'granted';

    if (!this.settings.enabled) {
      this.status.running = false;
      this.status.blockedReason = null;
      return;
    }

    if (!this.settings.activeLibraryId) {
      this.status.running = false;
      this.status.blockedReason = '请先在应用中选择当前题库。';
      return;
    }

    if (this.helper.mode === 'none') {
      this.status.running = false;
      this.status.blockedReason = '当前平台未内置系统级答题助手运行时。';
      return;
    }

    if (!hasAccessibility && !hasOcrPath) {
      this.status.running = false;
      this.status.blockedReason =
        this.status.permissions.ocrRuntime === 'unsupported'
          ? '请先在系统设置中为“MengdianAssistantHelper（蒙电题库通答题助手）”授予“辅助功能”权限。授权后如状态未刷新，再完全退出并重新打开应用。'
          : '需要辅助功能权限，或屏幕录制权限与 OCR 运行时后才能启动答题助手。';
      return;
    }

    this.status.blockedReason = null;
    this.status.running = true;
  }

  private applyRunningState(): void {
    if (this.status.running) {
      this.startPolling();
    } else {
      this.stopPolling();
      this.hideTip();
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.tick();
    }, this.settings.pollIntervalMs);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.hoverAnchor = null;
    this.hoverStartedAt = 0;
    this.lastOcrKey = '';
    this.lastOcrPoint = null;
    this.lastOcrSelection = null;
    this.lastOcrAt = 0;
    this.pendingMatchKey = '';
    this.pendingMatchCount = 0;
  }

  private async tick(): Promise<void> {
    if (!this.status.running || this.busy) return;
    this.busy = true;

    try {
      const now = Date.now();
      const inspection = await this.helper.inspectAtCursor();
      this.status.diagnostics.helperLastError = this.helper.error;
      if (!inspection) {
        this.hideTipIfExpired(now);
        this.broadcastStatus();
        return;
      }
      this.status.blockedReason = null;

      const point = inspection.point;
      if (!this.hoverAnchor || distance(this.hoverAnchor, point) > this.settings.hoverTolerancePx) {
        this.hoverAnchor = point;
        this.hoverStartedAt = now;
        if (this.currentTip) {
          this.syncTipPosition(point);
          if (this.lastTipAnchor && distance(this.lastTipAnchor, point) > HIDE_ON_LARGE_MOVE_PX) {
            this.hideTipIfExpired(now, true);
          }
        }
        return;
      }

      if (now - this.hoverStartedAt < this.settings.dwellMs) {
        return;
      }

      if (now - this.lastInspectedAt < this.settings.pollIntervalMs) {
        return;
      }
      this.lastInspectedAt = now;

      const accessibilityText = usableText(inspection.accessibilityText);
      const ocrPoint = inspection.ocrPoint ?? point;
      const ocrSelection =
        !accessibilityText && inspection.ocrImagePath && inspection.ocrCaptureRect
          ? await this.resolveOcrSelection({
              imagePath: inspection.ocrImagePath,
              point: ocrPoint,
              captureRect: inspection.ocrCaptureRect
            }, now)
          : null;
      const ocrCandidates = unique(
        [ocrSelection?.selectedText ?? null, ...(ocrSelection?.candidates ?? [])]
          .map((value) => usableText(value))
          .filter((value): value is string => Boolean(value))
      );
      const ocrText = ocrCandidates[0] ?? usableText(inspection.ocrText) ?? usableText(ocrSelection?.rawText);
      const selectedText = accessibilityText ?? ocrText;
      const source: AssistantTextSource = accessibilityText ? 'accessibility' : ocrText ? 'ocr' : 'none';

      this.status.lastTextSource = source;
      this.status.lastRecognizedText = selectedText;
      this.status.diagnostics.ocrLastError = this.ocr.error;

      if (!selectedText || !this.settings.activeLibraryId) {
        this.pendingMatchKey = '';
        this.pendingMatchCount = 0;
        this.status.diagnostics.lastBestMatch = null;
        this.status.diagnostics.lastSecondMatch = null;
        this.hideTipIfExpired(now);
        this.broadcastStatus();
        return;
      }

      const matchInputs = source === 'ocr' ? ocrCandidates : [selectedText];
      const matches = this.rankMatches(matchInputs, source);
      const [best, second] = matches;
      const nextMatchKey = best ? createAssistantDisplayKey(best) : '';
      if (best?.recognizedText) {
        this.status.lastRecognizedText = best.recognizedText;
      }
      const shouldDisplay = shouldDisplayAssistantMatch(best, second) && Boolean(best?.answerText);
      const shouldKeepCurrentTip = Boolean(
        this.currentTip &&
        best?.answerText &&
        nextMatchKey &&
        nextMatchKey === this.lastMatchKey &&
        best.confidence >= TIP_CONFIDENCE_HOLD_FLOOR
      );
      const willDisplay = shouldDisplay || shouldKeepCurrentTip;
      this.status.diagnostics.lastBestMatch = best
        ? {
            matched: best.matched,
            answerText: best.answerText ?? null,
            confidence: best.confidence,
            sourceNo: best.sourceNo ?? null,
            shouldDisplay: willDisplay
          }
        : null;
      this.status.diagnostics.lastSecondMatch = second
        ? {
            confidence: second.confidence,
            sourceNo: second.sourceNo ?? null
          }
        : null;

      if (!willDisplay || !best?.answerText) {
        this.pendingMatchKey = '';
        this.pendingMatchCount = 0;
        this.hideTipIfExpired(now);
        this.broadcastStatus();
        return;
      }

      if (nextMatchKey === this.lastMatchKey && this.currentTip) {
        this.pendingMatchKey = '';
        this.pendingMatchCount = 0;
        this.lastSuccessfulAt = now;
        this.syncTipPosition(point);
        return;
      }

      if (this.currentTip && nextMatchKey) {
        if (this.pendingMatchKey !== nextMatchKey) {
          this.pendingMatchKey = nextMatchKey;
          this.pendingMatchCount = 1;
          this.lastSuccessfulAt = now;
          this.syncTipPosition(point);
          return;
        }

        if (this.pendingMatchCount < TIP_SWITCH_CONFIRMATIONS) {
          this.pendingMatchCount += 1;
        }

        if (this.pendingMatchCount < TIP_SWITCH_CONFIRMATIONS) {
          this.lastSuccessfulAt = now;
          this.syncTipPosition(point);
          return;
        }
      }

      this.lastMatchKey = nextMatchKey;
      this.pendingMatchKey = '';
      this.pendingMatchCount = 0;
      this.lastSuccessfulAt = now;
      this.showTip(point, best);
      this.broadcastStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : '答题助手轮询失败';
      this.status.blockedReason = null;
      this.status.diagnostics.helperLastError = this.helper.error;
      this.status.diagnostics.ocrLastError = this.helper.error ? this.ocr.error : this.ocr.error ?? message;
      this.hideTipIfExpired(Date.now());
      this.broadcastStatus();
    } finally {
      this.busy = false;
    }
  }

  private rankMatches(candidates: string[], source: AssistantTextSource): AssistantMatchResult[] {
    if (!this.settings.activeLibraryId) {
      return [];
    }

    const merged = new Map<string, AssistantMatchResult>();

    candidates
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length > 0)
      .forEach((candidate) => {
        this.db
          .matchAssistantText(this.settings.activeLibraryId, candidate, source)
          .slice(0, 3)
          .forEach((match) => {
            const key = match.questionId ?? `${candidate}:${match.confidence}`;
            const current = merged.get(key);
            if (!current || match.confidence > current.confidence) {
              merged.set(key, match);
            }
          });
      });

    return [...merged.values()].sort((left, right) => right.confidence - left.confidence);
  }

  private async resolveOcrSelection(
    input: Parameters<LocalOcrService['recognizeAtCursor']>[0],
    now: number
  ): Promise<Awaited<ReturnType<LocalOcrService['recognizeAtCursor']>>> {
    const point = input.point;
    const cacheKey = `${Math.round(point.x / 18)}:${Math.round(point.y / 18)}:${Math.round(input.captureRect.x)}:${Math.round(input.captureRect.y)}`;
    const canReuse =
      this.lastOcrKey === cacheKey &&
      this.lastOcrPoint &&
      distance(this.lastOcrPoint, point) <= this.settings.hoverTolerancePx * 1.5 &&
      now - this.lastOcrAt <= OCR_CACHE_TTL_MS;

    if (canReuse) {
      return this.lastOcrSelection;
    }

    const selection = await this.ocr.recognizeAtCursor(input);
    this.lastOcrKey = cacheKey;
    this.lastOcrPoint = point;
    this.lastOcrSelection = selection;
    this.lastOcrAt = now;
    return selection;
  }

  private showTip(point: Point, match: AssistantMatchResult): void {
    const answer = match.answerText ?? '';
    const tip: AssistantTipPayload = {
      visible: true,
      x: point.x,
      y: point.y,
      answer,
      confidence: Number((match.confidence * 100).toFixed(1))
    };

    this.currentTip = tip;
    this.lastTipAnchor = point;
    this.status.overlayVisible = true;
    if (this.helper.mode === 'native') {
      void this.helper.setTip(tip).catch(() => {
        this.status.diagnostics.helperLastError = this.helper.error;
      });
      return;
    }

    this.ensureOverlayWindow();
    this.overlayWindow?.setAlwaysOnTop(true, 'screen-saver', 1);
    this.overlayWindow?.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
    this.positionOverlay(point);
    this.overlayWindow?.showInactive();
    this.overlayWindow?.moveTop();
    this.overlayWindow?.webContents.send(IPC_EVENTS.assistantTipChanged, tip);
  }

  private hideTip(): void {
    this.currentTip = null;
    this.lastTipAnchor = null;
    this.status.overlayVisible = false;
    this.lastMatchKey = '';
    this.pendingMatchKey = '';
    this.pendingMatchCount = 0;
    if (this.helper.mode === 'native') {
      void this.helper.setTip(null).catch(() => {
        this.status.diagnostics.helperLastError = this.helper.error;
      });
      return;
    }

    this.overlayWindow?.hide();
    this.overlayWindow?.webContents.send(IPC_EVENTS.assistantTipChanged, null);
  }

  private hideTipIfExpired(now: number, force = false): void {
    if (!this.currentTip) {
      return;
    }

    if (!force && now - this.lastSuccessfulAt < TIP_STICKY_MS) {
      return;
    }

    this.hideTip();
  }

  private ensureOverlayWindow(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) return;

    const overlay = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      frame: false,
      transparent: true,
      show: false,
      resizable: false,
      fullscreenable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: this.options.preloadPath,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.setAlwaysOnTop(true, 'screen-saver', 1);
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setContentProtection(true);

    if (this.options.isDev && this.options.devServerUrl) {
      void overlay.loadURL(`${this.options.devServerUrl}#/assistant-overlay`);
    } else {
      void overlay.loadFile(this.options.rendererIndex, { hash: '/assistant-overlay' });
    }

    overlay.webContents.once('did-finish-load', () => {
      overlay.webContents.send(IPC_EVENTS.assistantTipChanged, this.currentTip);
      overlay.webContents.send(IPC_EVENTS.assistantStatusChanged, this.status);
    });

    overlay.on('closed', () => {
      this.overlayWindow = null;
    });

    this.overlayWindow = overlay;
  }

  private positionOverlay(point: Point): void {
    if (!this.overlayWindow) return;
    const display = screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) });
    const bounds = display.bounds;
    const x = Math.min(
      Math.max(Math.round(point.x + this.settings.overlayOffsetX), bounds.x),
      bounds.x + bounds.width - OVERLAY_WIDTH
    );
    const y = Math.min(
      Math.max(Math.round(bounds.y + bounds.height - point.y + this.settings.overlayOffsetY), bounds.y),
      bounds.y + bounds.height - OVERLAY_HEIGHT
    );

    this.overlayWindow.setBounds({
      x,
      y,
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT
    });
  }

  private syncTipPosition(point: Point): void {
    if (!this.currentTip) {
      return;
    }

    this.currentTip = {
      ...this.currentTip,
      x: point.x,
      y: point.y
    };
    this.lastTipAnchor = point;

    if (this.helper.mode === 'native') {
      void this.helper.setTip(this.currentTip).catch(() => {
        this.status.diagnostics.helperLastError = this.helper.error;
      });
      return;
    }

    this.positionOverlay(point);
    this.overlayWindow?.webContents.send(IPC_EVENTS.assistantTipChanged, this.currentTip);
  }

  private getActiveLibraryName(libraryId: string | null): string | null {
    if (!libraryId) return null;
    try {
      return this.db.getLibraryDetail(libraryId).name;
    } catch {
      return null;
    }
  }

  private flushStatusBroadcast(payload: AssistantRuntimeStatus, serialized: string): void {
    this.lastBroadcastAt = Date.now();
    this.lastBroadcastSerialized = serialized;
    this.pendingBroadcastPayload = null;
    this.pendingBroadcastSerialized = '';
    if (this.pendingBroadcastTimer) {
      clearTimeout(this.pendingBroadcastTimer);
      this.pendingBroadcastTimer = null;
    }

    BrowserWindow.getAllWindows().forEach((window) => {
      if (window.isDestroyed()) return;
      window.webContents.send(IPC_EVENTS.assistantStatusChanged, payload);
    });
  }

  private broadcastStatus(force = false): void {
    const payload = cloneStatus(this.status);
    const serialized = JSON.stringify(payload);
    if (!force && serialized === this.lastBroadcastSerialized && !this.pendingBroadcastPayload) {
      return;
    }

    if (force) {
      this.flushStatusBroadcast(payload, serialized);
      return;
    }

    this.pendingBroadcastPayload = payload;
    this.pendingBroadcastSerialized = serialized;

    const remaining = Math.max(0, STATUS_BROADCAST_INTERVAL_MS - (Date.now() - this.lastBroadcastAt));
    if (remaining === 0 && !this.pendingBroadcastTimer) {
      this.flushStatusBroadcast(payload, serialized);
      return;
    }

    if (this.pendingBroadcastTimer) {
      return;
    }

    this.pendingBroadcastTimer = setTimeout(() => {
      const nextPayload = this.pendingBroadcastPayload;
      const nextSerialized = this.pendingBroadcastSerialized;
      this.pendingBroadcastTimer = null;
      if (!nextPayload || !nextSerialized || nextSerialized === this.lastBroadcastSerialized) {
        this.pendingBroadcastPayload = null;
        this.pendingBroadcastSerialized = '';
        return;
      }
      this.flushStatusBroadcast(nextPayload, nextSerialized);
    }, remaining);
  }
}
