import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { CoolhandAPIPattern } from '../src/types';

jest.spyOn(console, 'log').mockImplementation();
jest.spyOn(console, 'warn').mockImplementation();
jest.spyOn(console, 'error').mockImplementation();

const ORIGINAL_PATTERNS = [
  'OpenAI', 'Anthropic', 'Google AI', 'GitHub Models', 'Vertex AI', 'OpenRouter', 'OpenCode', 'Cloudflare AI Gateway'
];
const NEW_PATTERNS = [
  'DeepSeek', 'Mistral', 'Perplexity', 'xAI', 'Cohere', 'TypeSafe Jev', 'Ollama', 'Bedrock', 'ElevenLabs',
  'Azure OpenAI', 'Azure AI Services', 'Azure AI Foundry (Serverless)', 'Azure Machine Learning'
];

function nodeService(): PatternMatchingService {
  delete (globalThis as any).EdgeRuntime;
  return new PatternMatchingService({ silent: true });
}

function edgeService(): PatternMatchingService {
  (globalThis as any).EdgeRuntime = 'edge';
  try {
    return new PatternMatchingService({ silent: true });
  } finally {
    delete (globalThis as any).EdgeRuntime;
  }
}

// [url, expected pattern name or null]
const URL_CASES: Array<[string, string | null]> = [
  // OpenAI-compatible hosts: every path
  ['https://api.deepseek.com/chat/completions', 'DeepSeek'],
  ['https://api.deepseek.com/v1/chat/completions', 'DeepSeek'],
  ['https://api.mistral.ai/v1/chat/completions', 'Mistral'],
  ['https://api.mistral.ai/v1/embeddings', 'Mistral'],
  ['https://api.perplexity.ai/chat/completions', 'Perplexity'],
  ['https://api.x.ai/v1/chat/completions', 'xAI'],
  // Cohere: only v2 chat and v1/v2 embed
  ['https://api.cohere.com/v2/chat', 'Cohere'],
  ['https://api.cohere.ai/v2/chat', 'Cohere'],
  ['https://api.cohere.com/v2/chat?stream=true', 'Cohere'],
  ['https://api.cohere.com/v1/embed', 'Cohere'],
  ['https://api.cohere.com/v2/embed', 'Cohere'],
  ['https://api.cohere.com/v1/chat', null],
  ['https://api.cohere.com/v1/rerank', null],
  ['https://api.cohere.com/v2/rerank', null],
  ['https://api.cohere.com/v1/embed-jobs', null],
  ['https://api.cohere.com/v1/tokenize', null],
  ['https://api.cohere.com/v1/classify', null],
  ['https://api.cohere.com/v2/chatbots', null],
  ['https://api.cohere.com/', null],
  ['https://evil-api.cohere.com.example.net/v2/chat', null],
  // TypeSafe Jev: only /v1/systemone
  ['https://api.typesafe.ai/v1/systemone', 'TypeSafe Jev'],
  ['https://api.typesafe.ai/v1/systemone/run', 'TypeSafe Jev'],
  ['https://api.typesafe.ai/v1/systemone?x=1', 'TypeSafe Jev'],
  ['https://api.typesafe.ai/v1/models', null],
  ['https://api.typesafe.ai/v1/systemones', null],
  ['https://api.typesafe.ai/', null],
  // Ollama: identified by port 11434 or ollama.com, and always by path
  ['http://localhost:11434/api/chat', 'Ollama'],
  ['http://localhost:11434/api/generate', 'Ollama'],
  ['http://127.0.0.1:11434/api/embed', 'Ollama'],
  ['http://192.168.1.20:11434/api/embeddings', 'Ollama'],
  ['http://[::1]:11434/api/chat', 'Ollama'],
  ['https://ollama.com/api/chat', 'Ollama'],
  ['http://localhost:11434/api/tags', null],
  ['http://localhost:11434/api/pull', null],
  ['http://localhost:11434/', null],
  ['http://localhost:3000/api/chat', null],
  ['http://localhost/api/chat', null],
  ['https://example.com/api/chat', null],
  ['https://example.com/api/generate', null],
  ['https://api.example.com/api/embeddings', null],
  ['https://ollama.com/library/llama3', null],
  // Bedrock: bedrock-runtime.<region>.amazonaws.com on model / openai paths
  ['https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3/invoke', 'Bedrock'],
  ['https://bedrock-runtime.eu-west-2.amazonaws.com/model/amazon.nova-lite-v1:0/converse', 'Bedrock'],
  ['https://bedrock-runtime.us-west-2.amazonaws.com/model/x/converse-stream', 'Bedrock'],
  ['https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/chat/completions', 'Bedrock'],
  ['https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com/model/x/invoke', 'Bedrock'],
  ['https://bedrock-runtime.cn-north-1.amazonaws.com.cn/model/x/invoke', 'Bedrock'],
  ['https://bedrock-runtime.us-east-1.amazonaws.com/guardrail/abc/version/1/apply', null],
  ['https://bedrock-runtime.us-east-1.amazonaws.com/', null],
  ['https://bedrock.us-east-1.amazonaws.com/model/x/invoke', null],
  ['https://bedrock-runtime.amazonaws.com/model/x/invoke', null],
  ['https://bedrock-runtime.us-east-1.amazonaws.com.evil.example/model/x/invoke', null],
  ['https://notbedrock-runtime.us-east-1.amazonaws.com/model/x/invoke', null],
  ['https://s3.us-east-1.amazonaws.com/model/x/invoke', null],
  // Azure OpenAI dedicated hosts: host-wide
  ['https://myres.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21', 'Azure OpenAI'],
  ['https://myres.openai.azure.us/openai/v1/chat/completions', 'Azure OpenAI'],
  // Azure AI Services shares its host with Speech/Vision/etc., so only /openai/ and /models/ count
  ['https://myres.cognitiveservices.azure.com/openai/deployments/gpt-4o/chat/completions', 'Azure AI Services'],
  ['https://myres.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview', 'Azure AI Services'],
  ['https://myres.cognitiveservices.azure.com/speech/recognition/conversation', null],
  ['https://myres.cognitiveservices.azure.com/', null],
  ['https://myres.cognitiveservices.azure.com.evil.example/openai/deployments/x/chat/completions', null],
  // Azure AI Foundry serverless and Azure ML managed online endpoints: host-wide
  ['https://mymodel.eastus2.models.ai.azure.com/v1/chat/completions', 'Azure AI Foundry (Serverless)'],
  ['https://myendpoint.eastus.inference.ml.azure.com/score', 'Azure Machine Learning'],
  // ElevenLabs: host-wide
  ['https://api.elevenlabs.io/v1/text-to-speech/abc', 'ElevenLabs'],
  ['https://api.elevenlabs.io/v1/convai/conversations', 'ElevenLabs'],
  ['https://elevenlabs.io/pricing', null],
];

describe('provider patterns added for #247', () => {
  describe.each([
    ['Node runtime (api-patterns.json)', nodeService],
    ['Edge runtime fallback', edgeService],
  ])('%s', (_label, build) => {
    let service: PatternMatchingService;

    beforeEach(() => {
      service = build();
    });

    it.each(URL_CASES)('matchesAPIPatternFromURL(%s) -> %s', (url, expected) => {
      expect(service.matchesAPIPatternFromURL(url)?.pattern.name ?? null).toBe(expected);
    });

    it.each(URL_CASES)('matchesAPIPatternSync(string %s) -> %s', (url, expected) => {
      expect(service.matchesAPIPatternSync(url)?.pattern.name ?? null).toBe(expected);
    });

    it.each(URL_CASES)('matchesAPIPatternSync(options for %s) -> %s', (url, expected) => {
      const u = new URL(url);
      const options = {
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port ? Number(u.port) : undefined,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
      };
      expect(service.matchesAPIPatternSync(options)?.pattern.name ?? null).toBe(expected);
    });

    it.each(URL_CASES)('matchesAPIPattern async (options for %s) -> %s', async (url, expected) => {
      const u = new URL(url);
      const options = {
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port ? Number(u.port) : undefined,
        path: `${u.pathname}${u.search}`,
      };
      expect((await service.matchesAPIPatternFromURL(url))?.pattern.name ?? null).toBe(expected);
      expect((await service.matchesAPIPattern(options))?.pattern.name ?? null).toBe(expected);
    });

    it('accepts a numeric-string port in request options (as Node does)', () => {
      const options = { hostname: 'localhost', port: '11434' as unknown as number, path: '/api/chat' };
      expect(service.matchesAPIPatternSync(options)?.pattern.name).toBe('Ollama');
    });

    it('fails closed for options without a path on a path-bound pattern', () => {
      expect(service.matchesAPIPatternSync({ hostname: 'api.cohere.com' })).toBeNull();
      expect(service.matchesAPIPatternSync({ hostname: 'localhost', port: 11434 })).toBeNull();
    });

    it('derives the path from options.href when options.path is absent', () => {
      expect(service.matchesAPIPatternSync({ hostname: 'api.cohere.com', href: 'https://api.cohere.com/v2/chat' })?.pattern.name)
        .toBe('Cohere');
      expect(service.matchesAPIPatternSync({ hostname: 'api.cohere.com', href: 'https://api.cohere.com/v1/chat' })).toBeNull();
    });

    it('reports how a port-identified Ollama request matched', () => {
      expect(service.matchesAPIPatternFromURL('http://localhost:11434/api/chat')).toMatchObject({
        matchType: 'path',
        matchValue: '/api/chat',
      });
      expect(service.matchesAPIPatternFromURL('https://ollama.com/api/chat')).toMatchObject({
        matchType: 'domain',
        matchValue: 'ollama.com',
      });
    });

    it('redacts each new provider\'s credential headers', () => {
      const redact = (url: string, headers: Record<string, string>) => {
        const matched = service.matchesAPIPatternFromURL(url);
        return service.sanitizeHeaders(headers, matched?.pattern);
      };
      expect(redact('https://api.typesafe.ai/v1/systemone', { Authorization: 'Bearer secret', 'content-type': 'application/json' }))
        .toEqual({ authorization: '[REDACTED]', 'content-type': 'application/json' });
      expect(redact('https://api.elevenlabs.io/v1/text-to-speech/abc', { 'xi-api-key': 'secret' }))
        .toEqual({ 'xi-api-key': '[REDACTED]' });
      expect(redact('https://bedrock-runtime.us-east-1.amazonaws.com/model/x/invoke', {
        authorization: 'AWS4-HMAC-SHA256 Credential=abc', 'x-amz-security-token': 'secret'
      })).toEqual({ authorization: '[REDACTED]', 'x-amz-security-token': '[REDACTED]' });
      for (const url of [
        'https://api.deepseek.com/chat/completions', 'https://api.mistral.ai/v1/chat/completions',
        'https://api.perplexity.ai/chat/completions', 'https://api.x.ai/v1/chat/completions',
        'https://api.cohere.com/v2/chat',
      ]) {
        expect(redact(url, { authorization: 'Bearer secret' })).toEqual({ authorization: '[REDACTED]' });
      }
    });
  });

  describe('existing providers are unchanged', () => {
    // These providers have always matched on domain alone, whatever the path. Making
    // `paths` binding for them would silently stop capturing traffic.
    const service = nodeService();
    const edge = edgeService();

    it.each([
      'https://api.openai.com/v1/files',
      'https://api.openai.com/anything/at/all',
      'https://api.anthropic.com/v1/messages',
      'https://api.anthropic.com/v1/anything',
      'https://generativelanguage.googleapis.com/v1beta/anything',
      'https://models.github.ai/whatever',
      'https://aiplatform.googleapis.com/whatever',
      'https://openrouter.ai/whatever',
      'https://opencode.ai/zen/v1/chat/completions',
      'https://gateway.ai.cloudflare.com/v1/acct/gw/openai/chat/completions',
    ])('still matches %s regardless of path', (url) => {
      expect(service.matchesAPIPatternFromURL(url)).not.toBeNull();
      expect(edge.matchesAPIPatternFromURL(url)).not.toBeNull();
      const u = new URL(url);
      expect(service.matchesAPIPatternSync({ hostname: u.hostname, path: u.pathname })).not.toBeNull();
    });

    it('does not set requiresPathMatch or ports on any pre-existing pattern', async () => {
      const patterns = await service.getLoadedPatterns();
      for (const name of ORIGINAL_PATTERNS) {
        const pattern = patterns.find((p) => p.name === name);
        expect(pattern).toBeDefined();
        expect(pattern?.requiresPathMatch).toBeUndefined();
        expect(pattern?.ports).toBeUndefined();
      }
    });

    it('still does not capture the traffic it never did', () => {
      expect(service.matchesAPIPatternFromURL('https://example.com/v1/chat/completions')).toBeNull();
      expect(service.matchesAPIPatternFromURL('http://localhost:8080/v1/chat/completions')).toBeNull();
    });
  });

  describe('node and edge-runtime default patterns stay consistent (#235)', () => {
    const node = nodeService();
    const edge = edgeService();

    it('ships every new provider in both places', () => {
      const nodeNames = node.getLoadedPatternsSync().map((p) => p.name);
      const edgeNames = edge.getLoadedPatternsSync().map((p) => p.name);
      for (const name of NEW_PATTERNS) {
        expect(nodeNames).toContain(name);
        expect(edgeNames).toContain(name);
      }
    });

    it.each(NEW_PATTERNS)('%s has the same matching fields in api-patterns.json and the edge fallback', (name) => {
      const pick = (p: CoolhandAPIPattern | undefined) => p && {
        domains: p.domains,
        paths: p.paths ?? [],
        ports: p.ports,
        requiresPathMatch: p.requiresPathMatch,
        headers: p.headers,
      };
      const fromNode = node.getLoadedPatternsSync().find((p) => p.name === name);
      const fromEdge = edge.getLoadedPatternsSync().find((p) => p.name === name);
      expect(pick(fromEdge)).toEqual(pick(fromNode));
    });

    it('routes every URL case to the same pattern in both runtimes', () => {
      for (const [url] of URL_CASES) {
        expect(edge.matchesAPIPatternFromURL(url)?.pattern.name).toBe(node.matchesAPIPatternFromURL(url)?.pattern.name);
      }
    });
  });

  describe('requiresPathMatch / ports / wildcard domains in custom pattern files', () => {
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolhand-patterns-'));
    });
    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    function fromFile(patterns: unknown[]): PatternMatchingService {
      delete (globalThis as any).EdgeRuntime;
      const file = path.join(dir, `p-${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify({ patterns }));
      return new PatternMatchingService({ customPatternsFile: file, silent: true });
    }

    it('ignores paths when requiresPathMatch is absent (paths stay non-binding)', () => {
      const svc = fromFile([{ name: 'Host Wide', domains: ['a.example.com'], paths: ['/only'] }]);
      expect(svc.matchesAPIPatternFromURL('https://a.example.com/other')?.pattern.name).toBe('Host Wide');
    });

    it('never matches a requiresPathMatch pattern that lists no paths', () => {
      const svc = fromFile([{ name: 'Bound', domains: ['a.example.com'], paths: [], requiresPathMatch: true }]);
      expect(svc.matchesAPIPatternFromURL('https://a.example.com/x')).toBeNull();
    });

    it('does not let ports capture anything unless requiresPathMatch is set', () => {
      const svc = fromFile([{ name: 'PortOnly', domains: [], paths: ['/api/chat'], ports: [9999] }]);
      expect(svc.matchesAPIPatternFromURL('http://localhost:9999/api/chat')).toBeNull();
    });

    it('lets a later pattern win when an earlier path-bound pattern rejects the path', () => {
      const svc = fromFile([
        { name: 'Bound', domains: ['a.example.com'], paths: ['/v2/chat'], requiresPathMatch: true },
        { name: 'Fallback', domains: ['a.example.com'], paths: [] },
      ]);
      expect(svc.matchesAPIPatternFromURL('https://a.example.com/v2/chat')?.pattern.name).toBe('Bound');
      expect(svc.matchesAPIPatternFromURL('https://a.example.com/v1/chat')?.pattern.name).toBe('Fallback');
    });

    it('treats * as exactly one DNS label and escapes regex characters in the rest', () => {
      const svc = fromFile([{ name: 'Wild', domains: ['svc.*.example.com'] }]);
      expect(svc.matchesAPIPatternFromURL('https://svc.eu1.example.com/x')?.pattern.name).toBe('Wild');
      expect(svc.matchesAPIPatternFromURL('https://extra.svc.eu1.example.com/x')?.pattern.name).toBe('Wild');
      expect(svc.matchesAPIPatternFromURL('https://svc.example.com/x')).toBeNull();
      expect(svc.matchesAPIPatternFromURL('https://svc.a.b.example.com/x')).toBeNull();
      expect(svc.matchesAPIPatternFromURL('https://svcXeu1Xexample.com/x')).toBeNull();
      expect(svc.matchesAPIPatternFromURL('https://svc.eu1.example.com.evil.net/x')).toBeNull();
    });
  });
});
