import OpenAI from 'openai';

// Construct lazily, on first use, instead of at module scope. openai v5+ captures
// globalThis.fetch by value in its constructor (`this.fetch = options.fetch ?? Shims.getDefaultFetch()`).
// A module-scope client would permanently hold whatever fetch existed at import time — before
// coolhand's initializeGlobalMonitoring() runs in main.ts's start() — silently bypassing monitoring.
let openai: OpenAI | undefined;

export function getOpenAIClient(): OpenAI {
    openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai;
}
