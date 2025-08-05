// Simple proxy server for Anthropic API calls
// Keeps API key secure on the backend

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for frontend
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8000']
}));

app.use(express.json());

// Proxy endpoint for Anthropic API
app.post('/api/claude', async (req, res) => {
    try {
        const { prompt, maxTokens = 150 } = req.body;
        
        if (!process.env.ANTHROPIC_API_KEY) {
            return res.status(500).json({ 
                error: 'ANTHROPIC_API_KEY not configured in server environment' 
            });
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: maxTokens,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return res.status(response.status).json({
                error: `Anthropic API error: ${response.status} ${response.statusText}`,
                details: errorData
            });
        }

        const data = await response.json();
        res.json(data);

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            details: error.message 
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        anthropicConfigured: !!process.env.ANTHROPIC_API_KEY 
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
    console.log(`🔑 Anthropic API key: ${process.env.ANTHROPIC_API_KEY ? 'Configured' : 'Missing'}`);
});