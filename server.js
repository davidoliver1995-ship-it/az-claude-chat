import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3737;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Request body missing' });
  const { messages, system, max_tokens = 4096 } = req.body;
  const gatewayBase = process.env.AI_GATEWAY_URL || 'https://ai-gateway.astrazeneca.net/bedrock';
  const model = process.env.CLAUDE_MODEL || 'us.anthropic.claude-opus-4-5-20251101-v1:0';
  const apiKey = process.env.AI_GATEWAY_KEY || '';

  if (!apiKey) {
    return res.status(500).json({ error: 'AI_GATEWAY_KEY not set in .env file.' });
  }

  try {
    const body = { anthropic_version: 'bedrock-2023-05-31', max_tokens, messages };
    if (system) body.system = system;

    const response = await fetch(`${gatewayBase}/model/${model}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Gateway error ${response.status}: ${err.slice(0, 300)}` });
    }

    const data = await response.json();
    // Handle response — may be text or other content types
    const firstBlock = data.content && data.content[0];
    const textContent = firstBlock
      ? (firstBlock.text ?? JSON.stringify(firstBlock))
      : '';
    return res.json({ content: textContent, usage: data.usage });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GitHub API proxy - avoids CORS issues from browser
app.all('/api/github/*', async (req, res) => {
  const token = req.headers['x-github-token'] || '';
  const githubPath = req.path.replace('/api/github/', '');
  const query = Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '';
  const url = `https://api.github.com/${githubPath}${query}`;

  try {
    const opts = {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'AZ-Claude-Chat/1.0',
      },
    };
    if (req.method !== 'GET' && req.body && Object.keys(req.body).length) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(req.body);
    }
    const r = await fetch(url, opts);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  ┌────────────────────────────────────────────┐`);
  console.log(`  │   AZ Claude Chat — Running on port ${PORT}   │`);
  console.log(`  │   Open: http://localhost:${PORT}              │`);
  console.log(`  └────────────────────────────────────────────┘\n`);
  console.log('  Gateway:', process.env.AI_GATEWAY_URL);
  console.log('  Key loaded:', process.env.AI_GATEWAY_KEY ? 'YES' : 'NO');
});
