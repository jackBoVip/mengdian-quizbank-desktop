export const IPC_CHANNELS = {
  importPickFile: 'import.pickFile',
  importAnalyze: 'import.analyze',
  importSaveLibrary: 'import.saveLibrary',
  assistantGetSettings: 'assistant.getSettings',
  assistantUpdateSettings: 'assistant.updateSettings',
  assistantGetStatus: 'assistant.getStatus',
  assistantRequestPermissions: 'assistant.requestPermissions',
  assistantToggle: 'assistant.toggle',
  assistantPreviewMatch: 'assistant.previewMatch',
  libraryList: 'library.list',
  libraryDetail: 'library.detail',
  libraryUpdate: 'library.update',
  libraryDelete: 'library.delete',
  libraryExportPack: 'library.exportPack',
  libraryImportPack: 'library.importPack',
  libraryBackupAll: 'library.backupAll',
  questionList: 'question.list',
  questionUpdate: 'question.update',
  questionBulkUpdate: 'question.bulkUpdate',
  examList: 'exam.list',
  examUpsert: 'exam.upsert',
  examDelete: 'exam.delete',
  examStart: 'exam.start',
  examSubmit: 'exam.submit',
  practiceStart: 'practice.start',
  practiceAnswer: 'practice.answer',
  practicePause: 'practice.pause',
  practiceResume: 'practice.resume',
  practiceFinish: 'practice.finish',
  statsDashboard: 'stats.dashboard',
  statsLibraryProgress: 'stats.libraryProgress'
} as const;

export const IPC_EVENTS = {
  assistantStatusChanged: 'assistant.statusChanged',
  assistantTipChanged: 'assistant.tipChanged'
} as const;
