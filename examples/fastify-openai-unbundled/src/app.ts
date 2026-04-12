import Fastify from 'fastify';
import cors from '@fastify/cors';
import { summarizePaper } from './services/summarizer';

export default function build() {
    const server = Fastify({ logger: true });

    server.register(cors);

    server.get('/health', async () => {
        return { status: 'ok' };
    });

    server.post<{ Body: { url: string } }>('/summarize', async (request, reply) => {
        const { url } = request.body;

        if (!url) {
            return reply.status(400).send({ error: 'url is required' });
        }

        const summary = await summarizePaper(url);
        return { summary };
    });

    return server;
}
