'use strict';

// Smoke test for the fastify-openai-unbundled example: proves that coolhand-node's global
// monitoring actually intercepts the example's OpenAI call, not just that the app runs and
// returns 200. This is exactly the assertion that was missing when issue #210 broke silently
// for ~3 weeks (examples/ isn't otherwise exercised by CI).
//
// Run from examples/fastify-openai-unbundled/ after `npm run build` (both root and here):
//   node test/smoke-test.js

const path = require('node:path');
const { spawn } = require('node:child_process');
const { createMockOpenAIServer } = require('./mock-openai-server');

const MOCK_OPENAI_PORT = 4001;
const APP_PORT = process.env.PORT || 3999;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const STARTUP_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 250;

function collectOutput(child) {
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    return () => Buffer.concat(chunks).toString('utf-8');
}

async function waitForHealth(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${url}/health`);
            if (res.ok) { return; }
        } catch {
            // server not up yet
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

async function main() {
    const mockServer = createMockOpenAIServer();
    await new Promise((resolve) => mockServer.listen(MOCK_OPENAI_PORT, resolve));

    const appChild = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'main.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(APP_PORT),
            OPENAI_API_KEY: 'test-key',
            OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_OPENAI_PORT}/v1`,
            COOLHAND_API_KEY: process.env.COOLHAND_API_KEY || 'test-coolhand-key',
            COOLHAND_DEBUG: 'false',
            COOLHAND_DRY_RUN: 'true',
            COOLHAND_PATTERNS_FILE: 'test/mock-patterns.json'
        }
    });

    const getOutput = collectOutput(appChild);
    let exitCode = 0;

    try {
        await waitForHealth(APP_URL, STARTUP_TIMEOUT_MS);

        const res = await fetch(`${APP_URL}/summarize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://arxiv.org/abs/1706.03762' })
        });

        if (res.status !== 200) {
            throw new Error(`Expected 200 from /summarize, got ${res.status}`);
        }

        const body = await res.json();
        if (!body.summary || typeof body.summary !== 'object') {
            throw new Error(`Expected a summary object in the response, got: ${JSON.stringify(body)}`);
        }

        // Give coolhand's async logging pipeline a moment to flush its console output.
        await new Promise((r) => setTimeout(r, 500));

        const output = getOutput();
        if (!output.includes('INTERCEPTING')) {
            throw new Error(
                'Monitoring did not intercept the OpenAI call — this is the exact silent failure ' +
                'mode from issue #210. Captured output:\n' + output
            );
        }

        console.log('✅ Smoke test passed: /summarize returned 200 and the OpenAI call was intercepted.');
    } catch (error) {
        exitCode = 1;
        console.error('❌ Smoke test failed:', error.message);
        console.error('--- Captured app output ---');
        console.error(getOutput());
    } finally {
        appChild.kill();
        await new Promise((resolve) => mockServer.close(resolve));
    }

    process.exit(exitCode);
}

main().catch((error) => {
    console.error('❌ Smoke test crashed:', error);
    process.exit(1);
});
