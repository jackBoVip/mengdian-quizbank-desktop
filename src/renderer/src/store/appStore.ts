import { create } from 'zustand';
import type {
  BulkQuestionPatch,
  DashboardStats,
  ImportBatchAnalysis,
  LibraryDetail,
  LibraryProgress,
  LibrarySummary,
  PracticeAnswerPayload,
  PracticeSession,
  Question,
  QuestionDraft,
  QuestionQuery,
  SaveLibraryPayload,
  StartExamPayload,
  StartPracticePayload
} from '@shared/types';
import { emptyDashboardStats } from '@shared/types';
import { api } from '@renderer/api/client';

interface AppState {
  dashboard: DashboardStats;
  libraries: LibrarySummary[];
  selectedLibraryId: string | null;
  selectedLibrary: LibraryDetail | null;
  libraryQuestions: Question[];
  libraryProgress: LibraryProgress | null;
  importAnalysis: ImportBatchAnalysis | null;
  activeSession: PracticeSession | null;
  bootstrap: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
  refreshLibraries: () => Promise<void>;
  loadLibrary: (libraryId: string) => Promise<void>;
  loadLibraryQuestions: (query: QuestionQuery) => Promise<void>;
  refreshLibraryProgress: (libraryId: string) => Promise<void>;
  setImportAnalysis: (analysis: ImportBatchAnalysis | null) => void;
  updateReviewDraft: (tempId: string, updater: (draft: QuestionDraft) => QuestionDraft) => void;
  bulkUpdateReviewDrafts: (tempIds: string[], patch: BulkQuestionPatch) => void;
  saveReviewedLibrary: (payload: Omit<SaveLibraryPayload, 'batchId' | 'drafts'>) => Promise<LibraryDetail>;
  updateQuestion: (question: Question) => Promise<Question>;
  bulkUpdateQuestions: (libraryId: string, questionIds: string[], patch: BulkQuestionPatch) => Promise<number>;
  setActiveSession: (session: PracticeSession | null) => void;
  startPractice: (payload: StartPracticePayload) => Promise<PracticeSession>;
  startExam: (payload: StartExamPayload) => Promise<PracticeSession>;
  answerSession: (payload: PracticeAnswerPayload) => Promise<PracticeSession>;
  finishActiveSession: () => Promise<PracticeSession | null>;
  pauseActiveSession: () => Promise<PracticeSession | null>;
}

export const useAppStore = create<AppState>((set, get) => ({
  dashboard: emptyDashboardStats(),
  libraries: [],
  selectedLibraryId: null,
  selectedLibrary: null,
  libraryQuestions: [],
  libraryProgress: null,
  importAnalysis: null,
  activeSession: null,
  bootstrap: async () => {
    const [dashboard, libraries] = await Promise.all([api.stats.dashboard(), api.library.list()]);
    set({ dashboard, libraries });
    if (libraries[0]?.id) {
      void api.assistant.updateSettings({ activeLibraryId: libraries[0].id }).catch(() => undefined);
    }
  },
  refreshDashboard: async () => {
    const dashboard = await api.stats.dashboard();
    set({ dashboard });
  },
  refreshLibraries: async () => {
    const libraries = await api.library.list();
    set({ libraries });
  },
  loadLibrary: async (libraryId) => {
    const [selectedLibrary, libraryProgress] = await Promise.all([api.library.detail(libraryId), api.stats.libraryProgress(libraryId)]);
    set({ selectedLibrary, selectedLibraryId: libraryId, libraryProgress });
    void api.assistant.updateSettings({ activeLibraryId: libraryId }).catch(() => undefined);
    await get().loadLibraryQuestions({ libraryId });
  },
  loadLibraryQuestions: async (query) => {
    const libraryQuestions = await api.question.list(query);
    set({ libraryQuestions });
  },
  refreshLibraryProgress: async (libraryId) => {
    const libraryProgress = await api.stats.libraryProgress(libraryId);
    set({ libraryProgress });
  },
  setImportAnalysis: (analysis) => set({ importAnalysis: analysis }),
  updateReviewDraft: (tempId, updater) => {
    const analysis = get().importAnalysis;
    if (!analysis) return;
    set({
      importAnalysis: {
        ...analysis,
        drafts: analysis.drafts.map((draft) => (draft.tempId === tempId ? updater(draft) : draft))
      }
    });
  },
  bulkUpdateReviewDrafts: (tempIds, patch) => {
    const analysis = get().importAnalysis;
    if (!analysis) return;
    const targets = new Set(tempIds);
    set({
      importAnalysis: {
        ...analysis,
        drafts: analysis.drafts.map((draft) =>
          targets.has(draft.tempId)
            ? {
                ...draft,
                type: patch.type ?? draft.type,
                section: patch.section ?? draft.section,
                tags: patch.tags ?? draft.tags
              }
            : draft
        )
      }
    });
  },
  saveReviewedLibrary: async ({ name, description }) => {
    const analysis = get().importAnalysis;
    if (!analysis) {
      throw new Error('当前没有待保存的导入结果。');
    }
    const library = await api.import.saveLibrary({
      batchId: analysis.batchId,
      name,
      description,
      drafts: analysis.drafts
    });
    set({ importAnalysis: null, selectedLibrary: library, selectedLibraryId: library.id });
    await Promise.all([get().refreshLibraries(), get().refreshDashboard(), get().refreshLibraryProgress(library.id)]);
    await get().loadLibraryQuestions({ libraryId: library.id });
    return library;
  },
  updateQuestion: async (question) => {
    const updated = await api.question.update(question);
    const { selectedLibraryId } = get();
    set((state) => ({
      libraryQuestions: state.libraryQuestions.map((item) => (item.id === updated.id ? updated : item))
    }));
    if (selectedLibraryId) {
      await Promise.all([get().loadLibrary(selectedLibraryId), get().refreshDashboard()]);
    }
    return updated;
  },
  bulkUpdateQuestions: async (libraryId, questionIds, patch) => {
    const count = await api.question.bulkUpdate(libraryId, questionIds, patch);
    await get().loadLibraryQuestions({ libraryId });
    await get().loadLibrary(libraryId);
    return count;
  },
  setActiveSession: (activeSession) => set({ activeSession }),
  startPractice: async (payload) => {
    const activeSession = await api.practice.start(payload);
    set({ activeSession });
    return activeSession;
  },
  startExam: async (payload) => {
    const activeSession = await api.exam.start(payload);
    set({ activeSession });
    return activeSession;
  },
  answerSession: async (payload) => {
    const activeSession = await api.practice.answer(payload);
    set({ activeSession });
    await get().refreshDashboard();
    return activeSession;
  },
  finishActiveSession: async () => {
    const { activeSession } = get();
    if (!activeSession) return null;
    const nextSession =
      activeSession.mode === 'exam' ? await api.exam.submit(activeSession.id) : await api.practice.finish(activeSession.id);
    set({ activeSession: nextSession });
    await get().refreshDashboard();
    return nextSession;
  },
  pauseActiveSession: async () => {
    const { activeSession } = get();
    if (!activeSession) return null;
    const nextSession = await api.practice.pause(activeSession.id);
    set({ activeSession: nextSession });
    return nextSession;
  }
}));
