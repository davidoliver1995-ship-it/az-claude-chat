#!/bin/bash
# Setup Claude Code to use AZ AI Gateway
# Run this on your AZ Mac after cloning az-claude-chat

echo "Setting up Claude Code for AZ AI Gateway..."

# Check if .env exists
if [ ! -f ~/.az-claude-chat-env ]; then
  # Try to read from the az-claude-chat .env
  ENV_FILE="$(dirname "$0")/.env"
  if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE"
  fi
fi

KEY="${AI_GATEWAY_KEY:-YOUR_AZ_GATEWAY_KEY_HERE}"

# Create ~/.claude directory
mkdir -p ~/.claude

# Write settings.json
cat > ~/.claude/settings.json << SETTINGS
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH": "1",
    "ANTHROPIC_MODEL": "us.anthropic.claude-opus-4-5-20251101-v1:0",
    "ANTHROPIC_BEDROCK_BASE_URL": "https://ai-gateway.astrazeneca.net/bedrock",
    "AWS_REGION": "us-east-1",
    "AWS_BEARER_TOKEN_BEDROCK": "${KEY}"
  }
}
SETTINGS

echo "✅ Created ~/.claude/settings.json"
echo ""

# Install Claude Code if not already installed
if ! command -v claude &> /dev/null; then
  echo "Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code
  echo "✅ Claude Code installed"
else
  echo "✅ Claude Code already installed ($(claude --version 2>/dev/null || echo 'version unknown'))"
fi

echo ""
echo "Setup complete! To use Claude Code:"
echo "  cd /path/to/your/project"
echo "  claude"
echo ""
echo "NOTE: Claude Code is documented in the AZ AI Gateway as a demo/verification tool."
echo "Confirm with IT that usage is approved for your use case."
