import 'dotenv/config';

const config = {
    port: process.env.PORT || 3001,
    host: process.env.HOST || '0.0.0.0',
    openai: {
        key: process.env.OPENAI_API_KEY
    },
    coolhand: {
        apiKey: process.env.COOLHAND_API_KEY || '',
        debug: process.env.COOLHAND_DEBUG === 'true',
        dryRun: process.env.COOLHAND_DRY_RUN === 'true',
        patternsFile: process.env.COOLHAND_PATTERNS_FILE || undefined
    }
};

export default config;
