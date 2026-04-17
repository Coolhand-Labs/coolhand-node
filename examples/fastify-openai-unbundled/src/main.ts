import config from './config';
import build from './app';

/* bootstrap datadog agent — mirrors culina-chatops pattern */
let tracer: any;
if (config.datadog.enabled) {
    tracer = require('dd-trace').init({
        llmobs: {
            mlApp: config.datadog.mlApp,
            agentlessEnabled: true
        },
        site: config.datadog.site,
        env: config.datadog.env,
        service: config.datadog.service,
        apiKey: config.datadog.apiKey
    });
    // eslint-disable-next-line no-console
    console.log('[dd-trace] initialized');
} else {
    tracer = { llmobs: { annotate: () => {}, flush: () => {} } };
}

const server = build();

export async function start(port = +config.port) {
    /* Initialize Coolhand LLM Monitoring */
    if (config.coolhand.apiKey) {
        // Use new Function to emit native import() in compiled CJS output.
        // TypeScript otherwise compiles await import() to require(), which fails for ESM-only packages.
        const _import = new Function('m', 'return import(m)');
        const { initializeGlobalMonitoring } = await _import('coolhand-node/auto-monitor');
        await initializeGlobalMonitoring({
            apiKey: config.coolhand.apiKey,
            debug: config.coolhand.debug,
            silent: false
        });
        server.log.info('Coolhand LLM monitoring initialized');
    } else {
        server.log.warn('Coolhand monitoring disabled - no API key provided');
    }

    await server.listen({ port, host: config.host });
}

if (require.main === module) {
    (async () => {
        try {
            await start();
        } catch (error) {
            server.log.error(error);
            process.exit(1);
        }
    })();
}

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) =>
    process.on(signal, async () => {
        server.log.info(`${signal} received: Shutting down!`);
        await server.close();
        process.exit();
    })
);

export { server, tracer };
