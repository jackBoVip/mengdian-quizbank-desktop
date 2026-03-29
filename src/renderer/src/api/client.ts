import type { QuizBankApi } from '@shared/types';

const BRIDGE_WAIT_MS = 2_000;
const BRIDGE_POLL_MS = 50;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const waitForBridge = async (): Promise<QuizBankApi> => {
  const deadline = Date.now() + BRIDGE_WAIT_MS;

  while (Date.now() <= deadline) {
    if (window.quizBank) {
      return window.quizBank;
    }
    await sleep(BRIDGE_POLL_MS);
  }

  throw new Error('桌面桥接未就绪，请关闭应用后重新打开。');
};

export const api: QuizBankApi = {
  import: {
    pickFile: async () => (await waitForBridge()).import.pickFile(),
    analyze: async (filePath) => (await waitForBridge()).import.analyze(filePath),
    saveLibrary: async (payload) => (await waitForBridge()).import.saveLibrary(payload)
  },
  assistant: {
    getSettings: async () => (await waitForBridge()).assistant.getSettings(),
    updateSettings: async (patch) => (await waitForBridge()).assistant.updateSettings(patch),
    getStatus: async () => (await waitForBridge()).assistant.getStatus(),
    requestPermissions: async () => (await waitForBridge()).assistant.requestPermissions(),
    toggle: async (enabled) => (await waitForBridge()).assistant.toggle(enabled),
    previewMatch: async (payload) => (await waitForBridge()).assistant.previewMatch(payload),
    onStatusChanged: (listener) => {
      let disposed = false;
      let unsubscribe: (() => void) | undefined;

      void waitForBridge().then((bridge) => {
        if (disposed) return;
        unsubscribe = bridge.assistant.onStatusChanged(listener);
      });

      return () => {
        disposed = true;
        unsubscribe?.();
      };
    },
    onTipChanged: (listener) => {
      let disposed = false;
      let unsubscribe: (() => void) | undefined;

      void waitForBridge().then((bridge) => {
        if (disposed) return;
        unsubscribe = bridge.assistant.onTipChanged(listener);
      });

      return () => {
        disposed = true;
        unsubscribe?.();
      };
    }
  },
  library: {
    list: async () => (await waitForBridge()).library.list(),
    detail: async (libraryId) => (await waitForBridge()).library.detail(libraryId),
    update: async (payload) => (await waitForBridge()).library.update(payload),
    delete: async (libraryId) => (await waitForBridge()).library.delete(libraryId),
    exportPack: async (libraryId) => (await waitForBridge()).library.exportPack(libraryId),
    importPack: async () => (await waitForBridge()).library.importPack(),
    backupAll: async () => (await waitForBridge()).library.backupAll()
  },
  question: {
    list: async (query) => (await waitForBridge()).question.list(query),
    update: async (question) => (await waitForBridge()).question.update(question),
    bulkUpdate: async (libraryId, questionIds, patch) => (await waitForBridge()).question.bulkUpdate(libraryId, questionIds, patch)
  },
  exam: {
    list: async (libraryId) => (await waitForBridge()).exam.list(libraryId),
    upsert: async (payload) => (await waitForBridge()).exam.upsert(payload),
    delete: async (templateId) => (await waitForBridge()).exam.delete(templateId),
    start: async (payload) => (await waitForBridge()).exam.start(payload),
    submit: async (sessionId) => (await waitForBridge()).exam.submit(sessionId)
  },
  practice: {
    start: async (payload) => (await waitForBridge()).practice.start(payload),
    answer: async (payload) => (await waitForBridge()).practice.answer(payload),
    pause: async (sessionId) => (await waitForBridge()).practice.pause(sessionId),
    resume: async (sessionId) => (await waitForBridge()).practice.resume(sessionId),
    finish: async (sessionId) => (await waitForBridge()).practice.finish(sessionId)
  },
  stats: {
    dashboard: async () => (await waitForBridge()).stats.dashboard(),
    libraryProgress: async (libraryId) => (await waitForBridge()).stats.libraryProgress(libraryId)
  }
};
