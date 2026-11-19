export const ARCHIVE_MODEL_CONTEXT = `
  ALTER TABLE model_log ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1));
`;
