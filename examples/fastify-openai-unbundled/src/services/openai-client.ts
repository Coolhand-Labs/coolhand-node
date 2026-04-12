import OpenAI from 'openai';

// OpenAI client created at module scope — same pattern as real-world apps.
// This means the client is instantiated BEFORE coolhand monitoring is initialized.
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export { openai };
