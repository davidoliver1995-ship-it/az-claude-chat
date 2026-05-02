#!/bin/bash
# Kill any existing server
lsof -ti:3737 | xargs kill -9 2>/dev/null
sleep 1
# Open browser after 3 seconds (in background)
(sleep 3 && open http://localhost:3737) &
# Start server in foreground (keeps terminal open, shows output)
cd ~/az-claude-chat
node server.js
