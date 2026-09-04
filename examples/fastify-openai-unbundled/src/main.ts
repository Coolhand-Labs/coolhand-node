// Uses the base `coolhand-node` package rather than the `coolhand-node/auto-monitor` subpath:
// auto-monitor auto-initializes from COOLHAND_* env vars as a side effect of being imported,
// which would race ahead of (and silently override) the explicit config passed below.
import { initializeGlobalMonitoring } from 'coolhand-node';
import config from './config';
import build from './app';

const server = build();

export async function start(port = +config.port) {
    /* Initialize Coolhand LLM Monitoring */
    if (config.coolhand.apiKey) {
        await initializeGlobalMonitoring({
            apiKey: config.coolhand.apiKey,
            debug: config.coolhand.debug,
            silent: false,
            dryRun: config.coolhand.dryRun,
            patternsFile: config.coolhand.patternsFile
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

export { server };
