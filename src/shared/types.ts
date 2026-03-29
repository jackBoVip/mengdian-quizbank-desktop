export type QuestionType = 'single' | 'multiple' | 'fill_blank' | 'true_false';

export type ImportFormat = 'docx' | 'txt' | 'xlsx';

export type ImportIssueLevel = 'info' | 'warning' | 'error';

export type AssistantMatchScope = 'current_library';

export type AssistantTriggerMode = 'auto_hover';

export type AssistantRecognitionMode = 'hybrid';

export type AssistantTipContent = 'answer_confidence';

export type AssistantPermissionValue = 'granted' | 'missing' | 'unsupported';

export type AssistantTextSource = 'accessibility' | 'ocr' | 'none';

export type SessionMode = 'practice' | 'exam';

export type SessionStatus = 'active' | 'paused' | 'finished';

export interface SelectOption {
  label: string;
  value: string;
}

export interface QuestionOption {
  key: string;
  text: string;
}

export interface ImportIssue {
  code: string;
  message: string;
  level: ImportIssueLevel;
}

export interface QuestionDraft {
  tempId: string;
  sourceNo: string;
  type: QuestionType;
  stem: string;
  options?: QuestionOption[];
  answers: string[];
  section: string;
  tags: string[];
  confidence: number;
  issues: ImportIssue[];
  explanation?: string;
}

export interface Question extends Omit<QuestionDraft, 'tempId'> {
  id: string;
  libraryId: string;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
}

export interface ImportSummary {
  totalQuestions: number;
  byType: Record<QuestionType, number>;
  issueCounts: Record<ImportIssueLevel, number>;
  lowConfidenceCount: number;
  sections: string[];
  tags: string[];
  sourceName: string;
  format: ImportFormat;
  notes: string[];
}

export interface ImportBatchAnalysis {
  batchId: string;
  status: 'draft' | 'published';
  drafts: QuestionDraft[];
  summary: ImportSummary;
  sourceName: string;
  format: ImportFormat;
  createdAt: string;
}

export interface LibrarySummary {
  id: string;
  name: string;
  description: string;
  questionCount: number;
  sectionCount: number;
  tagCount: number;
  sourceFormat: ImportFormat | null;
  createdAt: string;
  updatedAt: string;
  templateCount: number;
}

export interface LibraryDetail extends LibrarySummary {
  sections: SelectOption[];
  tags: SelectOption[];
  examTemplates: ExamTemplate[];
  recentExamResults: PracticeSessionSummary[];
}

export interface ExamRule {
  questionType: QuestionType;
  count: number;
  score: number;
}

export interface ExamScope {
  sections?: string[];
  tags?: string[];
}

export interface ExamTemplate {
  id: string;
  libraryId: string;
  name: string;
  durationMinutes: number;
  passScore: number;
  totalScore: number;
  randomize: boolean;
  rules: ExamRule[];
  scope: ExamScope;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeFilter {
  libraryId: string;
  order: 'sequential' | 'random';
  questionTypes?: QuestionType[];
  sections?: string[];
  tags?: string[];
  favoritesOnly?: boolean;
  wrongOnly?: boolean;
  limit?: number;
}

export interface StartPracticePayload extends PracticeFilter {
  title?: string;
}

export interface StartExamPayload {
  libraryId: string;
  examTemplateId: string;
}

export interface PracticeAnswerPayload {
  sessionId: string;
  questionId: string;
  answers: string[];
}

export interface SessionQuestion {
  questionId: string;
  sourceNo: string;
  type: QuestionType;
  stem: string;
  options?: QuestionOption[];
  section: string;
  tags: string[];
  explanation?: string;
  correctAnswers?: string[];
  userAnswers?: string[];
  isCorrect?: boolean;
  score?: number;
}

export interface PracticeSessionSummary {
  id: string;
  libraryId: string;
  mode: SessionMode;
  title: string;
  status: SessionStatus;
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  score: number;
  totalScore: number;
  passScore: number | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface PracticeSession extends PracticeSessionSummary {
  questions: SessionQuestion[];
  currentIndex: number;
  instantFeedback: boolean;
  showAnswers: boolean;
  examTemplateId: string | null;
}

export interface WeakDimensionStat {
  name: string;
  accuracy: number;
  answeredCount: number;
}

export interface DashboardStats {
  libraryCount: number;
  questionCount: number;
  practiceCount: number;
  favoritesCount: number;
  wrongCount: number;
  accuracy: number;
  recentExams: PracticeSessionSummary[];
  weakSections: WeakDimensionStat[];
  weakTypes: WeakDimensionStat[];
}

export interface LibraryProgress {
  libraryId: string;
  libraryName: string;
  answeredCount: number;
  correctCount: number;
  accuracy: number;
  favoritesCount: number;
  wrongCount: number;
  lastPracticedAt: string | null;
}

export interface AssistantSettings {
  enabled: boolean;
  matchScope: AssistantMatchScope;
  triggerMode: AssistantTriggerMode;
  recognitionMode: AssistantRecognitionMode;
  tipContent: AssistantTipContent;
  activeLibraryId: string | null;
  shortcut: string;
  pollIntervalMs: number;
  dwellMs: number;
  hoverTolerancePx: number;
  overlayOffsetX: number;
  overlayOffsetY: number;
}

export interface AssistantPermissionState {
  platform: NodeJS.Platform;
  helper: AssistantPermissionValue;
  accessibility: AssistantPermissionValue;
  screenCapture: AssistantPermissionValue;
  ocrRuntime: AssistantPermissionValue;
}

export interface AssistantMatchResult {
  matched: boolean;
  source: AssistantTextSource;
  recognizedText: string;
  normalizedText: string;
  confidence: number;
  answerText?: string;
  questionId?: string;
  sourceNo?: string;
  questionType?: QuestionType;
}

export interface AssistantTipPayload {
  visible: boolean;
  x: number;
  y: number;
  answer: string;
  confidence: number;
}

export interface AssistantRuntimeStatus {
  enabled: boolean;
  running: boolean;
  overlayVisible: boolean;
  blockedReason: string | null;
  activeLibraryId: string | null;
  activeLibraryName: string | null;
  helperMode: 'native' | 'none';
  lastTextSource: AssistantTextSource;
  lastRecognizedText: string | null;
  permissions: AssistantPermissionState;
  diagnostics: {
    isPackaged: boolean;
    appExecutablePath: string;
    helperBundleId: string | null;
    helperDisplayName: string | null;
    helperExecutablePath: string | null;
    helperBundlePath: string | null;
    permissionSource: 'native-helper' | 'electron-main';
    helperLastError: string | null;
    ocrEngine: string | null;
    ocrLastError: string | null;
    lastBestMatch: {
      matched: boolean;
      answerText: string | null;
      confidence: number;
      sourceNo: string | null;
      shouldDisplay: boolean;
    } | null;
    lastSecondMatch: {
      confidence: number;
      sourceNo: string | null;
    } | null;
  };
}

export interface AssistantPreviewPayload {
  text: string;
}

export interface QuestionQuery {
  libraryId: string;
  search?: string;
  type?: QuestionType;
  section?: string;
  tag?: string;
  favoritesOnly?: boolean;
}

export interface BulkQuestionPatch {
  type?: QuestionType;
  section?: string;
  tags?: string[];
}

export interface SaveLibraryPayload {
  batchId: string;
  name: string;
  description?: string;
  drafts: QuestionDraft[];
}

export interface UpdateLibraryPayload {
  id: string;
  name: string;
  description: string;
}

export interface UpsertExamTemplatePayload {
  libraryId: string;
  template: Omit<ExamTemplate, 'id' | 'createdAt' | 'updatedAt' | 'totalScore'> & { id?: string };
}

export interface ImportPickResult {
  canceled: boolean;
  filePath?: string;
}

export interface QuizBankApi {
  import: {
    pickFile: () => Promise<ImportPickResult>;
    analyze: (filePath: string) => Promise<ImportBatchAnalysis>;
    saveLibrary: (payload: SaveLibraryPayload) => Promise<LibraryDetail>;
  };
  assistant: {
    getSettings: () => Promise<AssistantSettings>;
    updateSettings: (patch: Partial<AssistantSettings>) => Promise<AssistantSettings>;
    getStatus: () => Promise<AssistantRuntimeStatus>;
    requestPermissions: () => Promise<AssistantRuntimeStatus>;
    toggle: (enabled?: boolean) => Promise<AssistantRuntimeStatus>;
    previewMatch: (payload: AssistantPreviewPayload) => Promise<AssistantMatchResult>;
    onStatusChanged: (listener: (status: AssistantRuntimeStatus) => void) => () => void;
    onTipChanged: (listener: (tip: AssistantTipPayload | null) => void) => () => void;
  };
  library: {
    list: () => Promise<LibrarySummary[]>;
    detail: (libraryId: string) => Promise<LibraryDetail>;
    update: (payload: UpdateLibraryPayload) => Promise<LibraryDetail>;
    delete: (libraryId: string) => Promise<void>;
    exportPack: (libraryId: string) => Promise<{ canceled: boolean; filePath?: string }>;
    importPack: () => Promise<{ canceled: boolean; importedLibraryId?: string }>;
    backupAll: () => Promise<{ canceled: boolean; filePath?: string }>;
  };
  question: {
    list: (query: QuestionQuery) => Promise<Question[]>;
    update: (question: Question) => Promise<Question>;
    bulkUpdate: (libraryId: string, questionIds: string[], patch: BulkQuestionPatch) => Promise<number>;
  };
  exam: {
    list: (libraryId: string) => Promise<ExamTemplate[]>;
    upsert: (payload: UpsertExamTemplatePayload) => Promise<ExamTemplate>;
    delete: (templateId: string) => Promise<void>;
    start: (payload: StartExamPayload) => Promise<PracticeSession>;
    submit: (sessionId: string) => Promise<PracticeSession>;
  };
  practice: {
    start: (payload: StartPracticePayload) => Promise<PracticeSession>;
    answer: (payload: PracticeAnswerPayload) => Promise<PracticeSession>;
    pause: (sessionId: string) => Promise<PracticeSession>;
    resume: (sessionId: string) => Promise<PracticeSession>;
    finish: (sessionId: string) => Promise<PracticeSession>;
  };
  stats: {
    dashboard: () => Promise<DashboardStats>;
    libraryProgress: (libraryId: string) => Promise<LibraryProgress>;
  };
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  fill_blank: '填空题',
  true_false: '判断题'
};

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
  docx: 'DOCX',
  txt: 'TXT',
  xlsx: 'XLSX'
};

export const emptyDashboardStats = (): DashboardStats => ({
  libraryCount: 0,
  questionCount: 0,
  practiceCount: 0,
  favoritesCount: 0,
  wrongCount: 0,
  accuracy: 0,
  recentExams: [],
  weakSections: [],
  weakTypes: []
});

export const defaultAssistantSettings = (): AssistantSettings => ({
  enabled: false,
  matchScope: 'current_library',
  triggerMode: 'auto_hover',
  recognitionMode: 'hybrid',
  tipContent: 'answer_confidence',
  activeLibraryId: null,
  shortcut: 'CommandOrControl+Shift+H',
  pollIntervalMs: 120,
  dwellMs: 140,
  hoverTolerancePx: 24,
  overlayOffsetX: 20,
  overlayOffsetY: 20
});
