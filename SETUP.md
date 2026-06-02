# AZ Claude Chat - Setup Guide

A local web app that connects to Claude through the AstraZeneca AI Gateway.

## Requirements

- **Node.js 18+** - Download from https://nodejs.org (LTS version)
- **AZ VPN connected** - Required to reach the AI Gateway
- **AI Gateway API Key** - Get from AZ AI Gateway portal

## Quick Start

### Windows

1. Install Node.js from https://nodejs.org
2. Extract this folder anywhere (e.g., `C:\AZClaude`)
3. Edit `.env` file and add your API key:
   ```
   AI_GATEWAY_KEY=sk-your-key-here
   ```
4. Double-click `Launch AZ Claude.bat`
5. Browser opens to http://localhost:3737

### Mac

1. Install Node.js from https://nodejs.org (or `brew install node`)
2. Extract this folder anywhere
3. Edit `.env` file and add your API key
4. Double-click `Launch AZ Claude.command`
   - If blocked: Right-click → Open → Open anyway
5. Browser opens to http://localhost:3737

## Configuration (.env file)

```
# Required - your AZ AI Gateway key
AI_GATEWAY_KEY=sk-your-key-here

# Optional - defaults shown
AI_GATEWAY_URL=https://ai-gateway.astrazeneca.net/bedrock
CLAUDE_MODEL=us.anthropic.claude-opus-4-5-20251101-v1:0
PORT=3737

# Optional - for web search feature
TAVILY_API_KEY=your-tavily-key
```

## Troubleshooting

**"node is not recognized"**
- Node.js not installed. Download from nodejs.org and restart your terminal.

**Browser shows connection error**
- Make sure you're connected to AZ VPN
- Check the terminal window for error messages

**"AI_GATEWAY_KEY not set"**
- Edit the `.env` file and add your API key

**Port 3737 already in use**
- Close other instances of the app
- Or change PORT in .env to another number (e.g., 3738)

## Features

- Chat with Claude Opus 4.5
- Upload documents (PDF, DOCX, PPTX, images)
- Generate PowerPoint presentations
- Web search integration
- GitHub integration for code review

## Files to Share

When sharing with others, include everything EXCEPT:
- `node_modules/` folder (they'll install fresh)
- `.env` file (they need their own API key)

Zip up the folder and share. They just need to:
1. Unzip
2. Create `.env` with their API key
3. Double-click the launcher
