import type { QuizBankApi } from '@shared/types';

declare global {
  interface Window {
    quizBank: QuizBankApi;
  }
}

export {};
