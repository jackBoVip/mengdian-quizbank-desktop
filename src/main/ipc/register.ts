import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import type {
  AssistantSettings,
  BulkQuestionPatch,
  PracticeAnswerPayload,
  Question,
  QuestionQuery,
  SaveLibraryPayload,
  StartExamPayload,
  StartPracticePayload,
  UpdateLibraryPayload,
  UpsertExamTemplatePayload
} from '../../shared/types';
import { analyzeQuestionFile } from '../import';
import type { AppDatabase } from '../database/AppDatabase';
import type { AssistantManager } from '../assistant/AssistantManager';

const FILE_FILTERS = [
  { name: '题库文件', extensions: ['docx', 'txt', 'xlsx'] }
];

const buildLibraryPackName = (name: string): string => `${name.replace(/[\\/:*?"<>|]/g, '_')}.qbank.json`;

export const registerIpcHandlers = (db: AppDatabase, assistantManager: AssistantManager): void => {
  const getOwnerWindow = (event: IpcMainInvokeEvent): BrowserWindow | undefined => BrowserWindow.fromWebContents(event.sender) ?? undefined;

  ipcMain.handle(IPC_CHANNELS.importPickFile, async (event) => {
    const ownerWindow = getOwnerWindow(event);
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, {
          properties: ['openFile'],
          filters: FILE_FILTERS
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: FILE_FILTERS
        });
    return {
      canceled: result.canceled,
      filePath: result.filePaths[0]
    };
  });

  ipcMain.handle(IPC_CHANNELS.importAnalyze, async (_, filePath: string) => {
    const analysis = await analyzeQuestionFile(filePath);
    db.saveImportBatch(analysis);
    return analysis;
  });

  ipcMain.handle(IPC_CHANNELS.importSaveLibrary, async (_, payload: SaveLibraryPayload) => db.saveLibraryFromDrafts(payload));

  ipcMain.handle(IPC_CHANNELS.assistantGetSettings, async () => assistantManager.getSettings());
  ipcMain.handle(IPC_CHANNELS.assistantUpdateSettings, async (_, patch: Partial<AssistantSettings>) => assistantManager.updateSettings(patch));
  ipcMain.handle(IPC_CHANNELS.assistantGetStatus, async () => assistantManager.getStatus());
  ipcMain.handle(IPC_CHANNELS.assistantRequestPermissions, async () => assistantManager.requestPermissions());
  ipcMain.handle(IPC_CHANNELS.assistantToggle, async (_, enabled?: boolean) => assistantManager.toggle(enabled));
  ipcMain.handle(IPC_CHANNELS.assistantPreviewMatch, async (_, payload) => assistantManager.previewMatch(payload));

  ipcMain.handle(IPC_CHANNELS.libraryList, async () => db.listLibraries());
  ipcMain.handle(IPC_CHANNELS.libraryDetail, async (_, libraryId: string) => db.getLibraryDetail(libraryId));
  ipcMain.handle(IPC_CHANNELS.libraryUpdate, async (_, payload: UpdateLibraryPayload) => db.updateLibrary(payload));
  ipcMain.handle(IPC_CHANNELS.libraryDelete, async (_, libraryId: string) => db.deleteLibrary(libraryId));

  ipcMain.handle(IPC_CHANNELS.libraryExportPack, async (event, libraryId: string) => {
    const detail = db.getLibraryDetail(libraryId);
    const ownerWindow = getOwnerWindow(event);
    const result = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, {
          defaultPath: buildLibraryPackName(detail.name),
          filters: [{ name: '题库包', extensions: ['json'] }]
        })
      : await dialog.showSaveDialog({
          defaultPath: buildLibraryPackName(detail.name),
          filters: [{ name: '题库包', extensions: ['json'] }]
        });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    await db.exportLibraryPack(libraryId, result.filePath);
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle(IPC_CHANNELS.libraryImportPack, async (event) => {
    const ownerWindow = getOwnerWindow(event);
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, {
          properties: ['openFile'],
          filters: [{ name: '题库包', extensions: ['json'] }]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: '题库包', extensions: ['json'] }]
        });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }
    const library = await db.importLibraryPack(result.filePaths[0]);
    return { canceled: false, importedLibraryId: library.id };
  });

  ipcMain.handle(IPC_CHANNELS.libraryBackupAll, async (event) => {
    const ownerWindow = getOwnerWindow(event);
    const result = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, {
          defaultPath: `quizbank-backup-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: '整库备份', extensions: ['json'] }]
        })
      : await dialog.showSaveDialog({
          defaultPath: `quizbank-backup-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: '整库备份', extensions: ['json'] }]
        });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    await db.backupAll(result.filePath);
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle(IPC_CHANNELS.questionList, async (_, query: QuestionQuery) => db.listQuestions(query));
  ipcMain.handle(IPC_CHANNELS.questionUpdate, async (_, question: Question) => db.updateQuestion(question));
  ipcMain.handle(
    IPC_CHANNELS.questionBulkUpdate,
    async (_, libraryId: string, questionIds: string[], patch: BulkQuestionPatch) => db.bulkUpdateQuestions(libraryId, questionIds, patch)
  );

  ipcMain.handle(IPC_CHANNELS.examList, async (_, libraryId: string) => db.listExamTemplates(libraryId));
  ipcMain.handle(IPC_CHANNELS.examUpsert, async (_, payload: UpsertExamTemplatePayload) => db.upsertExamTemplate(payload));
  ipcMain.handle(IPC_CHANNELS.examDelete, async (_, templateId: string) => db.deleteExamTemplate(templateId));
  ipcMain.handle(IPC_CHANNELS.examStart, async (_, payload: StartExamPayload) => db.startExam(payload));
  ipcMain.handle(IPC_CHANNELS.examSubmit, async (_, sessionId: string) => db.submitExam(sessionId));

  ipcMain.handle(IPC_CHANNELS.practiceStart, async (_, payload: StartPracticePayload) => db.startPractice(payload));
  ipcMain.handle(IPC_CHANNELS.practiceAnswer, async (_, payload: PracticeAnswerPayload) => db.answerSession(payload));
  ipcMain.handle(IPC_CHANNELS.practicePause, async (_, sessionId: string) => db.pauseSession(sessionId));
  ipcMain.handle(IPC_CHANNELS.practiceResume, async (_, sessionId: string) => db.resumeSession(sessionId));
  ipcMain.handle(IPC_CHANNELS.practiceFinish, async (_, sessionId: string) => db.finishPractice(sessionId));

  ipcMain.handle(IPC_CHANNELS.statsDashboard, async () => db.getDashboardStats());
  ipcMain.handle(IPC_CHANNELS.statsLibraryProgress, async (_, libraryId: string) => db.getLibraryProgress(libraryId));
};
