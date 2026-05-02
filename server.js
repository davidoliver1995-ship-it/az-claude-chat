import 'dotenv/config';
console.log('[DEBUG] AI_GATEWAY_KEY loaded:', process.env.AI_GATEWAY_KEY ? 'YES ('+process.env.AI_GATEWAY_KEY.length+' chars)' : 'NO');
import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3737;

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => { if (req.path.startsWith('/api')) console.log('[REQ]', req.method, req.path); next(); });
app.use(express.static(join(__dirname, 'public')));

// Proxy Claude requests through AZ gateway
app.post('/api/chat', async (req, res) => {
  const { messages, system, max_tokens = 4096 } = req.body;
  const gatewayBase = process.env.ANTHROPIC_BEDROCK_BASE_URL || process.env.AI_GATEWAY_URL || 'https://ai-gateway.astrazeneca.net/bedrock';
  const model = process.env.CLAUDE_MODEL || 'us.anthropic.claude-opus-4-5-20251101-v1:0';
  const apiKey = process.env.AI_GATEWAY_KEY || process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.ANTHROPIC_API_KEY || '';

  console.log('[CHAT] apiKey length:', apiKey.length, 'starts:', apiKey.slice(0,4));
  console.log('[CHAT] gatewayBase:', gatewayBase);
  if (!apiKey) {
    return res.status(500).json({ error: 'AI_GATEWAY_KEY not set in .env file.' });
  }

  try {
    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens,
      messages,
    };
    if (system) body.system = system;

    const response = await fetch(`${gatewayBase}/model/${model}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Gateway error: ${response.status} — ${err.slice(0, 200)}` });
    }

    const data = await response.json();
    return res.json({ content: data.content[0].text, usage: data.usage });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  ┌────────────────────────────────────────────┐`);
  console.log(`  │                                            │`);
  console.log(`  │   AZ Claude Chat — Running on port ${PORT}   │`);
  console.log(`  │   Open: http://localhost:${PORT}              │`);
  console.log(`  │                                            │`);
  console.log(`  └────────────────────────────────────────────┘\n`);
});
