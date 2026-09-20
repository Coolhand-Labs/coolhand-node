export const DEFAULT_EXCLUDE_API_PATTERNS: readonly string[] = Object.freeze([
  "/batchPredictionJobs/",
  // Azure OpenAI control-plane paths — both spellings needed since matching is a
  // contiguous substring check and "/openai/files" does not match "/openai/v1/files".
  "/openai/files", "/openai/v1/files",
  "/openai/batches", "/openai/v1/batches",
  "/openai/fine_tuning", "/openai/v1/fine_tuning",
  "/openai/models", "/openai/v1/models"
]);
