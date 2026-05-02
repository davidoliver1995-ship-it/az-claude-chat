#!/bin/bash
# Kill any existing server
lsof -ti:3737 | xargs kill -9 2>/dev/null
sleep 1
# Start server
cd ~/az-claude-chat
node server.js &
sleep 2
# Open browser
open http://localhost:3737
# Wait to keep terminal open
wait
