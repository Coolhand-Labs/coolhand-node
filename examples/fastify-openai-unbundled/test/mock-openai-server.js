'use strict';

const http = require('node:http');

const MOCK_SUMMARY = {
    title: 'Attention Is All You Need',
    authors: 'Vaswani et al.',
    abstract: 'Mock abstract for CI smoke testing.',
    keyFindings: ['Mock finding'],
    methodology: 'Mock methodology',
    limitations: 'Mock limitations',
    significance: 'Mock significance'
};

function createMockOpenAIServer() {
    return http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
            const body = JSON.stringify({
                id: 'mock-completion',
                object: 'chat.completion',
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: JSON.stringify(MOCK_SUMMARY)
                        },
                        finish_reason: 'stop'
                    }
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(body);
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    });
}

module.exports = { createMockOpenAIServer };
