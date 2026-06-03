import Fastify from 'fastify';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';
import { judge } from './judge.js';
import { SPECS } from './runners.js';
import type { CodeLanguage, ExecuteRequest, TestCase } from './types.js';

mkdirSync(config.workRoot, { recursive: true });

const app = Fastify({
  logger: true,
  bodyLimit: 2 * 1024 * 1024, // 2 MiB request cap
});

// Bearer-token auth on everything except /health.
app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health' || req.method === 'OPTIONS') return;
  if (!config.judgeSecret) return; // no secret configured → dev mode, skip
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${config.judgeSecret}`) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

app.get('/health', async () => ({ ok: true }));

app.post('/execute', async (req, reply) => {
  const body = req.body as Partial<ExecuteRequest>;
  const error = validate(body);
  if (error) {
    return reply.code(400).send({ error });
  }

  const result = await judge(body as ExecuteRequest);
  return reply.send(result);
});

function validate(body: Partial<ExecuteRequest>): string | null {
  if (!body || typeof body !== 'object') return 'Invalid body';
  const { code, language, testCases } = body;

  if (typeof code !== 'string' || code.length === 0) return 'Missing code';
  if (Buffer.byteLength(code, 'utf8') > config.maxCodeBytes) {
    return `Code exceeds ${config.maxCodeBytes} bytes`;
  }
  if (!language || !(language in SPECS)) {
    return `Unsupported language: ${String(language)}`;
  }
  if (!Array.isArray(testCases) || testCases.length === 0) {
    return 'Missing testCases';
  }
  if (testCases.length > config.maxTestCases) {
    return `Too many test cases (max ${config.maxTestCases})`;
  }
  for (const tc of testCases as TestCase[]) {
    if (typeof tc?.input !== 'string' || typeof tc?.expectedOutput !== 'string') {
      return 'Each test case needs string input and expectedOutput';
    }
  }
  // language is now a valid CodeLanguage key
  void (language as CodeLanguage);
  return null;
}

app
  .listen({ port: config.port, host: config.host })
  .then((addr) => app.log.info(`judge listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
