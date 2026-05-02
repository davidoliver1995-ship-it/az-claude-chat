import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '.env') });

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3737;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  const { messages, system, max_tokens = 4096 } = req.body;
  const gatewayBase = process.env.ANTHROPIC_BEDROCK_BASE_URL || process.env.AI_GATEWAY_URL || 'https://ai-gateway.astrazeneca.net/bedrock';
  const model = process.env.CLAUDE_MODEL || 'us.anthropic.claude-opus-4-5-20251101-v1:0';
  const apiKey = process.env.AI_GATEWAY_KEY || process.env.AWS_BEARER_TOKEN_BEDROCK || '';

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
    return res.json({ content: data.content[0].text, usage: data.usage });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  ┌────────────────────────────────────────────┐`);
  console.log(`  │   AZ Claude Chat — Running on port ${PORT}   │`);
  console.log(`  │   Open: http://localhost:${PORT}              │`);
  console.log(`  └────────────────────────────────────────────┘\n`);
});
