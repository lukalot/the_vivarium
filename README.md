# The Vivarium 🌌

> "A simple game about the end of the world"

An experimental LLM-powered text-based game built with THREE.js, featuring hierarchical world simulation and Claude-generated narratives.

## Features ✨

- **LLM-Powered Simulation** - Claude 3.5 Haiku generates rich object interactions
- **Hierarchical World System** - Bottom-up simulation with emergent behavior
- **Turn-Based Action Model** - Player actions drive world progression
- **Adaptive ASCII Terminal** - Responsive character rendering with THREE.js
- **Smart Padding System** - Configurable screen layout and spacing
- **Real-time Narrative Generation** - Dynamic storytelling based on player actions

## Quick Start 🚀

### 1. Clone & Install
```bash
git clone https://github.com/lukalot/the_vivarium.git
cd the_vivarium
npm install
```

### 2. Configure API Key
```bash
# Create environment file
echo "ANTHROPIC_API_KEY=your-api-key-here" > .env

# Get your key from: https://console.anthropic.com/
```

### 3. Start Backend & Frontend
```bash
# Start proxy server (handles API calls)
npm start

# In another terminal, start frontend
npm run client

# Or run both together
npm run dev:full
```

### 4. Play!
- Open http://localhost:3000
- Type commands or actions directly in the terminal
- Watch the LLM-powered world respond!

## How It Works 🧠

### Backend Proxy Server
- **Express.js server** - Handles CORS and API key security  
- **Port 3001** - Proxies requests to Anthropic API
- **Environment variables** - Keeps API keys secure server-side

### Frontend Game Client  
- **Port 3000** - Main game interface
- **THREE.js terminal** - ASCII rendering with 3D graphics
- **Hierarchical simulation** - Objects react bottom-up
- **LLM narrator** - Claude generates atmospheric descriptions

### Game Commands 🎮

**In-Game Actions:**
```
look                     # Observe your surroundings
who                      # See your character (Sam)
examine ship_cat         # Inspect objects
turn the steering wheel  # Take an action
pet the cat gently       # Another action
help                     # Show all commands
```

**Console Commands:**
```javascript
checkLLM()              // Verify LLM connection
act("your action")      // Test actions from console
demoActions()           // Run multiple test actions
```

## Architecture 🏗️

```
Frontend (Port 3000)     Backend (Port 3001)      Anthropic API
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ ASCII Terminal  │────▶│ Express Proxy   │────▶│ Claude 3.5 Haiku│
│ World Simulation│     │ CORS Handler    │     │ API             │
│ Action Parser   │     │ API Key Security│     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Development 🛠️

### Project Structure
```
the_vivarium/
├── server.js           # Backend proxy server
├── main.js             # Frontend game client  
├── world.js            # World simulation system
├── llm.js              # LLM integration manager
├── index.html          # Main game page
├── package.json        # Dependencies & scripts
└── .env                # API keys (create this)
```

### Debugging
```javascript
// Check server connection
checkLLM()

// View world state  
inspect('boat_1')
listObjects()

// Test narrator
testNarrator()
```

## Troubleshooting 🩺

**❌ LLM Not Available**
1. Create `.env` file with your Anthropic API key
2. Run `npm start` to start the proxy server  
3. Refresh the game page
4. Run `checkLLM()` to verify connection

**❌ CORS Errors**
- Make sure backend server is running on port 3001
- Check that frontend is on port 3000
- Restart both servers if needed

**❌ Connection Refused**
- Backend: `npm start` (port 3001)
- Frontend: `npm run client` (port 3000)
- Or both: `npm run dev:full`

---

*Welcome to the eschaton. Enjoy your stay.* ▊