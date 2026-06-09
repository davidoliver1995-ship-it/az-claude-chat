import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

// Web search tool definition
const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: 'Search the web for current information. Use this when you need up-to-date information, recent news, current prices, weather, or facts you are uncertain about. Do not use for questions the user can answer from uploaded documents.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query'
      }
    },
    required: ['query']
  }
};

// Helper to perform Tavily search
async function performTavilySearch(query) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) return null;

  const https = await import('https');
  const postData = JSON.stringify({
    api_key: tavilyKey,
    query,
    max_results: 5,
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
    rejectUnauthorized: false,
  };

  return new Promise((resolve) => {
    const request = https.request(options, (response) => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          let result = '';
          if (data.answer) result += `Summary: ${data.answer}\n\n`;
          if (data.results) {
            data.results.forEach((r, i) => {
              result += `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}\n\n`;
            });
          }
          resolve(result || 'No results found.');
        } catch (e) {
          resolve('Search failed: ' + e.message);
        }
      });
    });
    request.on('error', (e) => resolve('Search failed: ' + e.message));
    request.write(postData);
    request.end();
  });
}

app.post('/api/chat', async (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Request body missing' });
  const { messages, system, max_tokens = 32000, extended_thinking = false } = req.body;
  const gatewayBase = process.env.AI_GATEWAY_URL || 'https://ai-gateway.astrazeneca.net/bedrock';
  const model = process.env.CLAUDE_MODEL || 'us.anthropic.claude-opus-4-5-20251101-v1:0';
  const apiKey = process.env.AI_GATEWAY_KEY || '';
  const hasSearchEnabled = !!process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'AI_GATEWAY_KEY not set in .env file.' });
  }

  const startTime = Date.now();
  console.log(`[API] Request started | extended_thinking: ${extended_thinking} | messages: ${messages.length} | tools: ${hasSearchEnabled}`);

  // Helper to make API call with timeout
  async function callAPI(msgs, useThinking, tools = null) {
    const body = { anthropic_version: 'bedrock-2023-05-31', max_tokens, messages: msgs };
    if (system) body.system = system;
    if (tools && tools.length > 0) body.tools = tools;

    if (useThinking) {
      body.thinking = { type: 'enabled', budget_tokens: 10000 };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    try {
      const response = await fetch(`${gatewayBase}/model/${model}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  try {
    // Clone messages for the tool use loop
    let workingMessages = JSON.parse(JSON.stringify(messages));
    const tools = hasSearchEnabled ? [WEB_SEARCH_TOOL] : [];
    let finalTextContent = '';
    let thinkingContent = '';
    let iterations = 0;
    const maxIterations = 5;

    // Tool use loop - keep calling until Claude gives a final text response
    while (iterations < maxIterations) {
      iterations++;
      let response = await callAPI(workingMessages, extended_thinking && iterations === 1, tools);
      console.log(`[API] Iteration ${iterations} | status: ${response.status} | elapsed: ${Date.now() - startTime}ms`);

      // Handle extended thinking fallback on first iteration
      if (!response.ok && extended_thinking && iterations === 1 && response.status === 400) {
        const errText = await response.text();
        if (errText.includes('thinking') || errText.includes('Extra inputs')) {
          console.log('[API] Extended thinking not supported, retrying without...');
          response = await callAPI(workingMessages, false, tools);
        } else {
          return res.status(response.status).json({ error: `Gateway error ${response.status}: ${errText.slice(0, 300)}` });
        }
      }

      if (!response.ok) {
        const err = await response.text();
        console.log(`[API] Error: ${err.slice(0, 200)}`);
        return res.status(response.status).json({ error: `Gateway error ${response.status}: ${err.slice(0, 300)}` });
      }

      const data = await response.json();
      console.log(`[API] Response | stop_reason: ${data.stop_reason} | content blocks: ${data.content?.length || 0}`);

      // Check if Claude wants to use a tool
      if (data.stop_reason === 'tool_use') {
        const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
        const toolResults = [];

        for (const toolUse of toolUseBlocks) {
          if (toolUse.name === 'web_search') {
            console.log(`[API] Tool call: web_search("${toolUse.input.query}")`);
            const searchResult = await performTavilySearch(toolUse.input.query);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: searchResult
            });
          }
        }

        // Add assistant message with tool use, then tool results
        workingMessages.push({ role: 'assistant', content: data.content });
        workingMessages.push({ role: 'user', content: toolResults });

      } else {
        // Final response - extract text
        if (data.content && Array.isArray(data.content)) {
          for (const block of data.content) {
            if (block.type === 'thinking') {
              thinkingContent = block.thinking || '';
            } else if (block.type === 'text') {
              finalTextContent += block.text || '';
            } else if (block.text) {
              finalTextContent += block.text;
            }
          }
        }
        break;
      }
    }

    if (iterations >= maxIterations && !finalTextContent) {
      return res.status(500).json({ error: 'Too many tool iterations without final response' });
    }

    console.log(`[API] Success | iterations: ${iterations} | text length: ${finalTextContent.length} | total: ${Date.now() - startTime}ms`);
    return res.json({ content: finalTextContent, thinking: thinkingContent, usage: null });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    if (error.name === 'AbortError') {
      console.log(`[API] Timeout after ${elapsed}ms`);
      return res.status(504).json({ error: 'Request timed out after 5 minutes. Try a simpler request.' });
    }
    console.log(`[API] Error after ${elapsed}ms: ${error.message}`);
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

app.listen(PORT, '0.0.0.0', () => {
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
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      text = result.text;

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
