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
  const { messages, system, max_tokens = 32000 } = req.body;
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
  console.log('[GitHub Proxy]', req.method, githubPath, '| token length:', token.length, '| starts:', token.slice(0,8));
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

// Tavily web search endpoint
app.post('/api/search', async (req, res) => {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  }

  const { query, maxResults = 5 } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Query required' });
  }

  const https = await import('https');
  const postData = JSON.stringify({
    api_key: tavilyKey,
    query,
    max_results: maxResults,
    search_depth: 'basic',
    include_answer: true,
    include_raw_content: false,
  });

  const options = {
    hostname: 'api.tavily.com',
    port: 443,
    path: '/search',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    rejectUnauthorized: false, // Allow self-signed certs (VPN proxy)
  };

  try {
    const data = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });
      request.on('error', reject);
      request.write(postData);
      request.end();
    });

    return res.json({
      answer: data.answer || null,
      results: (data.results || []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  ┌────────────────────────────────────────────┐`);
  console.log(`  │   AZ Claude Chat — Running on port ${PORT}   │`);
  console.log(`  │   Open: http://localhost:${PORT}              │`);
  console.log(`  └────────────────────────────────────────────┘\n`);
  console.log('  Gateway:', process.env.AI_GATEWAY_URL);
  console.log('  Key loaded:', process.env.AI_GATEWAY_KEY ? 'YES' : 'NO');
  console.log('  Web search:', process.env.TAVILY_API_KEY ? 'ENABLED' : 'disabled');
});


// Document parsing endpoint
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

app.post('/api/parse-document', async (req, res) => {
  const { filename, content, mimeType } = req.body;
  // content is base64-encoded file data
  if (!content) return res.status(400).json({ error: 'No content provided' });

  const buffer = Buffer.from(content, 'base64');
  let text = '';

  try {
    const ext = filename.split('.').pop().toLowerCase();

    if (ext === 'pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      text = data.text;

    } else if (ext === 'docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;

    } else if (ext === 'pptx') {
      // PPTX is a zip — extract slide content and speaker notes
      const unzipper = require('unzipper');
      const directory = await unzipper.Open.buffer(buffer);

      // Get slide files
      const slideFiles = directory.files.filter(f => f.path.match(/^ppt\/slides\/slide\d+\.xml$/));
      slideFiles.sort((a, b) => {
        const numA = parseInt(a.path.match(/\d+/)?.[0] || 0);
        const numB = parseInt(b.path.match(/\d+/)?.[0] || 0);
        return numA - numB;
      });

      // Get speaker notes files
      const notesFiles = directory.files.filter(f => f.path.match(/^ppt\/notesSlides\/notesSlide\d+\.xml$/));
      const notesMap = {};
      for (const nf of notesFiles) {
        const noteNum = parseInt(nf.path.match(/\d+/)?.[0] || 0);
        const xml = (await nf.buffer()).toString('utf8');
        const noteText = xml.replace(/<a:t>(.*?)<\/a:t>/g, '$1 ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (noteText) notesMap[noteNum] = noteText;
      }

      const slideTexts = [];
      for (let i = 0; i < slideFiles.length; i++) {
        const sf = slideFiles[i];
        const slideNum = i + 1;
        const xml = (await sf.buffer()).toString('utf8');

        // Extract text content
        const slideText = xml.replace(/<a:t>(.*?)<\/a:t>/g, '$1 ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

        let slideOutput = `[Slide ${slideNum}]\n${slideText || '(No text content)'}`;

        // Add speaker notes if available
        if (notesMap[slideNum]) {
          slideOutput += `\n\n[Speaker Notes]\n${notesMap[slideNum]}`;
        }

        slideTexts.push(slideOutput);
      }
      text = slideTexts.join('\n\n---\n\n');

    } else {
      return res.status(400).json({ error: `Unsupported format: .${ext}` });
    }

    return res.json({ text: text.slice(0, 50000), truncated: text.length > 50000, charCount: text.length });
  } catch (e) {
    return res.status(500).json({ error: `Parse failed: ${e.message}` });
  }
});
