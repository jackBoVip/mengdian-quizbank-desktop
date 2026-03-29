import { join } from 'node:path';
import { app } from 'electron';
import { AppDatabase } from './database/AppDatabase';

let database: AppDatabase | null = null;

export const getDatabase = (): AppDatabase => {
  if (database) return database;
  const dataDir = process.env.QUIZBANK_DATA_DIR || join(app.getPath('userData'), 'data');
  database = new AppDatabase(join(dataDir, 'quizbank.db'));
  return database;
};

export const closeDatabase = (): void => {
  if (!database) return;
  database.close();
  database = null;
};
