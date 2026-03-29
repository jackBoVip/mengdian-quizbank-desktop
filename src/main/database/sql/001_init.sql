CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_name TEXT,
  source_format TEXT,
  question_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (library_id, name)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (library_id, name)
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  source_no TEXT NOT NULL,
  type TEXT NOT NULL,
  stem TEXT NOT NULL,
  explanation TEXT,
  section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  answer_json TEXT NOT NULL,
  issues_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS choices (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,
  option_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE (question_id, option_key)
);

CREATE TABLE IF NOT EXISTS question_tags (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

CREATE TABLE IF NOT EXISTS exam_templates (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  exam_template_id TEXT REFERENCES exam_templates(id) ON DELETE SET NULL,
  filter_json TEXT NOT NULL DEFAULT '{}',
  config_json TEXT NOT NULL DEFAULT '{}',
  snapshot_json TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  total_score REAL NOT NULL DEFAULT 0,
  pass_score REAL,
  question_count INTEGER NOT NULL DEFAULT 0,
  answered_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS practice_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_answer_json TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  answered_at TEXT NOT NULL,
  UNIQUE (session_id, question_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (library_id, question_id)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_format TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  drafts_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_issues (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  question_source_no TEXT NOT NULL,
  level TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS question_search USING fts5(
  question_id UNINDEXED,
  library_id UNINDEXED,
  stem,
  choices,
  section,
  tags
);

CREATE INDEX IF NOT EXISTS idx_questions_library ON questions(library_id);
CREATE INDEX IF NOT EXISTS idx_questions_section ON questions(section_id);
CREATE INDEX IF NOT EXISTS idx_choices_question ON choices(question_id);
CREATE INDEX IF NOT EXISTS idx_question_tags_question ON question_tags(question_id);
CREATE INDEX IF NOT EXISTS idx_question_tags_tag ON question_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_exam_templates_library ON exam_templates(library_id);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_library ON practice_sessions(library_id);
CREATE INDEX IF NOT EXISTS idx_practice_answers_session ON practice_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);
