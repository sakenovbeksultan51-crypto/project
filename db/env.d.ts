declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSISTANT_PROVIDER?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    OLLAMA_BASE_URL?: string;
    OLLAMA_MODEL?: string;
  }
}
