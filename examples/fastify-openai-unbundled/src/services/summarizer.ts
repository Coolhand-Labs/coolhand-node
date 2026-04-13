import { openai } from './openai-client';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const PaperSummary = z.object({
    title: z.string(),
    authors: z.string(),
    abstract: z.string(),
    keyFindings: z.array(z.string()),
    methodology: z.string(),
    limitations: z.string(),
    significance: z.string()
});

export async function summarizePaper(url: string) {
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'system',
                content: `You are an academic paper summarizer. Given a URL to a paper, provide a structured summary. If you cannot access the URL, summarize based on any information you can infer from the URL itself (e.g. arxiv IDs, DOIs).`
            },
            {
                role: 'user',
                content: `Please summarize the academic paper at: ${url}`
            }
        ],
        response_format: zodResponseFormat(PaperSummary, 'paper_summary')
    });

    const content = response.choices[0].message?.content;
    if (!content) {
        throw new Error('No content received from OpenAI');
    }

    return JSON.parse(content);
}
