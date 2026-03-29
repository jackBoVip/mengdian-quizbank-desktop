import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAssistantSettings, type AssistantPermissionState } from '@shared/types';

const electronMocks = vi.hoisted(() => ({
  state: {
    accessibilityTrusted: false
  },
  getAllWindows: vi.fn(() => []),
  registerShortcut: vi.fn(() => true),
  unregisterShortcut: vi.fn(),
  openExternal: vi.fn(),
  isTrustedAccessibilityClient: vi.fn((_: boolean) => electronMocks.state.accessibilityTrusted)
}));

vi.mock('electron', () => {
  class BrowserWindowMock {
    public static getAllWindows(): unknown[] {
      return electronMocks.getAllWindows();
    }

    public readonly webContents = {
      send: vi.fn(),
      once: vi.fn()
    };

    public isDestroyed(): boolean {
      return false;
    }

    public destroy(): void {}

    public hide(): void {}

    public showInactive(): void {}

    public moveTop(): void {}

    public setBounds(): void {}

    public setAlwaysOnTop(): void {}

    public setContentProtection(): void {}

    public setIgnoreMouseEvents(): void {}

    public setVisibleOnAllWorkspaces(): void {}

    public loadURL(): Promise<void> {
      return Promise.resolve();
    }

    public loadFile(): Promise<void> {
      return Promise.resolve();
    }

    public on(): void {}
  }

  return {
    app: {
      isPackaged: false
    },
    BrowserWindow: BrowserWindowMock,
    globalShortcut: {
      register: electronMocks.registerShortcut,
      unregister: electronMocks.unregisterShortcut
    },
    screen: {
      getDisplayNearestPoint: vi.fn(() => ({
        workArea: {
          x: 0,
          y: 0,
          width: 1440,
          height: 900
        }
      }))
    },
    shell: {
      openExternal: electronMocks.openExternal
    },
    systemPreferences: {
      isTrustedAccessibilityClient: electronMocks.isTrustedAccessibilityClient
    }
  };
});

import { AssistantManager } from '@main/assistant/AssistantManager';

const createDb = () =>
  ({
    getAssistantSettings: () => ({
      ...defaultAssistantSettings(),
      enabled: true,
      activeLibraryId: 'library-1'
    }),
    updateAssistantSettings: (patch: Partial<ReturnType<typeof defaultAssistantSettings>>) => ({
      ...defaultAssistantSettings(),
      enabled: true,
      activeLibraryId: 'library-1',
      ...patch
    }),
    getLibraryDetail: () => ({
      name: '权限测试题库'
    }),
    previewAssistantMatch: vi.fn(),
    matchAssistantText: vi.fn(() => [])
  }) as never;

const grantedPermissions: AssistantPermissionState = {
  platform: 'darwin',
  helper: 'granted',
  accessibility: 'granted',
  screenCapture: 'unsupported',
  ocrRuntime: 'unsupported'
};

const missingPermissions: AssistantPermissionState = {
  platform: 'darwin',
  helper: 'granted',
  accessibility: 'missing',
  screenCapture: 'unsupported',
  ocrRuntime: 'unsupported'
};

const ocrReadyPermissions: AssistantPermissionState = {
  platform: 'darwin',
  helper: 'granted',
  accessibility: 'missing',
  screenCapture: 'granted',
  ocrRuntime: 'granted'
};

const screenCaptureMissingPermissions: AssistantPermissionState = {
  platform: 'darwin',
  helper: 'granted',
  accessibility: 'granted',
  screenCapture: 'missing',
  ocrRuntime: 'granted'
};

const createOcr = (availability: 'granted' | 'missing' = 'granted') =>
  ({
    displayName: 'Guten OCR / PP-OCRv4',
    error: null,
    isSupported: vi.fn(() => availability === 'granted'),
    getAvailability: vi.fn().mockResolvedValue(availability),
    recognizeAtCursor: vi.fn().mockResolvedValue(null)
  }) as never;

describe('assistant permission status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    electronMocks.state.accessibilityTrusted = false;
    vi.clearAllMocks();
    electronMocks.getAllWindows.mockReturnValue([]);
    electronMocks.registerShortcut.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps helper accessibility status when native helper is already authorized', async () => {
    const manager = new AssistantManager(createDb(), {
      preloadPath: '',
      rendererIndex: '',
      isDev: false
    });

    const helper = {
      mode: 'native' as const,
      bundleId: 'com.mengdian.quizbank.desktop.assistanthelper',
      displayName: 'MengdianAssistantHelper（蒙电题库通答题助手）',
      executablePath: '/tmp/MengdianAssistantHelper.app/Contents/MacOS/assistant-helper',
      bundlePath: '/tmp/MengdianAssistantHelper.app',
      error: null,
      getPermissions: vi.fn().mockResolvedValue(grantedPermissions),
      requestPermissions: vi.fn().mockResolvedValue(grantedPermissions),
      resetSession: vi.fn(),
      setTip: vi.fn().mockResolvedValue(undefined),
      inspectAtCursor: vi.fn().mockResolvedValue(null),
      dispose: vi.fn()
    };
    ((manager as unknown) as { helper: typeof helper }).helper = helper;
    ((manager as unknown) as { ocr: ReturnType<typeof createOcr> }).ocr = createOcr('granted');

    const status = await manager.getStatus();

    expect(status.permissions.accessibility).toBe('granted');
    expect(status.running).toBe(true);
    expect(status.diagnostics.permissionSource).toBe('native-helper');
    expect(status.diagnostics.helperBundleId).toBe('com.mengdian.quizbank.desktop.assistanthelper');
    expect(electronMocks.isTrustedAccessibilityClient).not.toHaveBeenCalled();

    manager.dispose();
  });

  it('requests accessibility permission through the native helper before opening settings', async () => {
    const manager = new AssistantManager(createDb(), {
      preloadPath: '',
      rendererIndex: '',
      isDev: false
    });

    const helper = {
      mode: 'native' as const,
      bundleId: 'com.mengdian.quizbank.desktop.assistanthelper',
      displayName: 'MengdianAssistantHelper（蒙电题库通答题助手）',
      executablePath: '/tmp/MengdianAssistantHelper.app/Contents/MacOS/assistant-helper',
      bundlePath: '/tmp/MengdianAssistantHelper.app',
      error: null,
      getPermissions: vi.fn().mockResolvedValue(grantedPermissions),
      requestPermissions: vi.fn().mockResolvedValue(missingPermissions),
      resetSession: vi.fn(),
      setTip: vi.fn().mockResolvedValue(undefined),
      inspectAtCursor: vi.fn().mockResolvedValue(null),
      dispose: vi.fn()
    };
    ((manager as unknown) as { helper: typeof helper }).helper = helper;
    ((manager as unknown) as { ocr: ReturnType<typeof createOcr> }).ocr = createOcr('granted');

    const status = await manager.requestPermissions();

    expect(helper.requestPermissions).toHaveBeenCalledTimes(1);
    expect(helper.resetSession).toHaveBeenCalledTimes(1);
    expect(electronMocks.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    expect(status.permissions.accessibility).toBe('granted');

    manager.dispose();
  });

  it('allows the assistant to run through the OCR path when accessibility is unavailable', async () => {
    const manager = new AssistantManager(createDb(), {
      preloadPath: '',
      rendererIndex: '',
      isDev: false
    });

    const helper = {
      mode: 'native' as const,
      bundleId: 'com.mengdian.quizbank.desktop.assistanthelper',
      displayName: 'MengdianAssistantHelper（蒙电题库通答题助手）',
      executablePath: '/tmp/MengdianAssistantHelper.app/Contents/MacOS/assistant-helper',
      bundlePath: '/tmp/MengdianAssistantHelper.app',
      error: null,
      getPermissions: vi.fn().mockResolvedValue(ocrReadyPermissions),
      requestPermissions: vi.fn().mockResolvedValue(ocrReadyPermissions),
      resetSession: vi.fn(),
      setTip: vi.fn().mockResolvedValue(undefined),
      inspectAtCursor: vi.fn().mockResolvedValue(null),
      dispose: vi.fn()
    };
    ((manager as unknown) as { helper: typeof helper }).helper = helper;
    ((manager as unknown) as { ocr: ReturnType<typeof createOcr> }).ocr = createOcr('granted');

    const status = await manager.getStatus();

    expect(status.permissions.accessibility).toBe('missing');
    expect(status.permissions.screenCapture).toBe('granted');
    expect(status.permissions.ocrRuntime).toBe('granted');
    expect(status.running).toBe(true);
    expect(status.blockedReason).toBeNull();
    expect(status.diagnostics.helperExecutablePath).toContain('MengdianAssistantHelper.app/Contents/MacOS/assistant-helper');

    manager.dispose();
  });

  it('opens the screen recording settings pane when OCR is available but screen capture is still missing', async () => {
    const manager = new AssistantManager(createDb(), {
      preloadPath: '',
      rendererIndex: '',
      isDev: false
    });

    const helper = {
      mode: 'native' as const,
      bundleId: 'com.mengdian.quizbank.desktop.assistanthelper',
      displayName: 'MengdianAssistantHelper（蒙电题库通答题助手）',
      executablePath: '/tmp/MengdianAssistantHelper.app/Contents/MacOS/assistant-helper',
      bundlePath: '/tmp/MengdianAssistantHelper.app',
      error: null,
      getPermissions: vi.fn().mockResolvedValue(screenCaptureMissingPermissions),
      requestPermissions: vi.fn().mockResolvedValue(screenCaptureMissingPermissions),
      resetSession: vi.fn(),
      setTip: vi.fn().mockResolvedValue(undefined),
      inspectAtCursor: vi.fn().mockResolvedValue(null),
      dispose: vi.fn()
    };
    ((manager as unknown) as { helper: typeof helper }).helper = helper;
    ((manager as unknown) as { ocr: ReturnType<typeof createOcr> }).ocr = createOcr('granted');

    const status = await manager.requestPermissions();

    expect(helper.requestPermissions).toHaveBeenCalledTimes(1);
    expect(helper.resetSession).toHaveBeenCalledTimes(1);
    expect(electronMocks.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    expect(status.permissions.screenCapture).toBe('missing');

    manager.dispose();
  });
});
