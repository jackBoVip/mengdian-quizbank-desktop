import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import type { QuizBankApi } from '@shared/types';

const api: QuizBankApi = {
  import: {
    pickFile: () => ipcRenderer.invoke(IPC_CHANNELS.importPickFile),
    analyze: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.importAnalyze, filePath),
    saveLibrary: (payload) => ipcRenderer.invoke(IPC_CHANNELS.importSaveLibrary, payload)
  },
  assistant: {
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.assistantGetSettings),
    updateSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.assistantUpdateSettings, patch),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.assistantGetStatus),
    requestPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.assistantRequestPermissions),
    toggle: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.assistantToggle, enabled),
    previewMatch: (payload) => ipcRenderer.invoke(IPC_CHANNELS.assistantPreviewMatch, payload),
    onStatusChanged: (listener) => {
      const subscription = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload);
      ipcRenderer.on(IPC_EVENTS.assistantStatusChanged, subscription);
      return () => ipcRenderer.off(IPC_EVENTS.assistantStatusChanged, subscription);
    },
    onTipChanged: (listener) => {
      const subscription = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload);
      ipcRenderer.on(IPC_EVENTS.assistantTipChanged, subscription);
      return () => ipcRenderer.off(IPC_EVENTS.assistantTipChanged, subscription);
    }
  },
  library: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.libraryList),
    detail: (libraryId) => ipcRenderer.invoke(IPC_CHANNELS.libraryDetail, libraryId),
    update: (payload) => ipcRenderer.invoke(IPC_CHANNELS.libraryUpdate, payload),
    delete: (libraryId) => ipcRenderer.invoke(IPC_CHANNELS.libraryDelete, libraryId),
    exportPack: (libraryId) => ipcRenderer.invoke(IPC_CHANNELS.libraryExportPack, libraryId),
    importPack: () => ipcRenderer.invoke(IPC_CHANNELS.libraryImportPack),
    backupAll: () => ipcRenderer.invoke(IPC_CHANNELS.libraryBackupAll)
  },
  question: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.questionList, query),
    update: (question) => ipcRenderer.invoke(IPC_CHANNELS.questionUpdate, question),
    bulkUpdate: (libraryId, questionIds, patch) => ipcRenderer.invoke(IPC_CHANNELS.questionBulkUpdate, libraryId, questionIds, patch)
  },
  exam: {
    list: (libraryId) => ipcRenderer.invoke(IPC_CHANNELS.examList, libraryId),
    upsert: (payload) => ipcRenderer.invoke(IPC_CHANNELS.examUpsert, payload),
    delete: (templateId) => ipcRenderer.invoke(IPC_CHANNELS.examDelete, templateId),
    start: (payload) => ipcRenderer.invoke(IPC_CHANNELS.examStart, payload),
    submit: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.examSubmit, sessionId)
  },
  practice: {
    start: (payload) => ipcRenderer.invoke(IPC_CHANNELS.practiceStart, payload),
    answer: (payload) => ipcRenderer.invoke(IPC_CHANNELS.practiceAnswer, payload),
    pause: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.practicePause, sessionId),
    resume: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.practiceResume, sessionId),
    finish: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.practiceFinish, sessionId)
  },
  stats: {
    dashboard: () => ipcRenderer.invoke(IPC_CHANNELS.statsDashboard),
    libraryProgress: (libraryId) => ipcRenderer.invoke(IPC_CHANNELS.statsLibraryProgress, libraryId)
  }
};

contextBridge.exposeInMainWorld('quizBank', api);
