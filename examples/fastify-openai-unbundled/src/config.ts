import 'dotenv/config';

const config = {
    port: process.env.PORT || 3001,
    host: process.env.HOST || '0.0.0.0',
    openai: {
        key: process.env.OPENAI_API_KEY
    },
    coolhand: {
        apiKey: process.env.COOLHAND_API_KEY || '',
        debug: process.env.COOLHAND_DEBUG === 'true'
    },
    datadog: {
        enabled: process.env.DD_ENABLED === 'true',
        mlApp: process.env.DD_ML_APP || 'fastify-openai-unbundled',
        site: process.env.DD_SITE || 'datadoghq.com',
        env: process.env.DD_ENV || 'development',
        service: process.env.DD_SERVICE || 'fastify-openai-unbundled',
        apiKey: process.env.DD_API_KEY || ''
    }
};

export default config;
