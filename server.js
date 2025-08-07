// Simple proxy server for Groq API calls
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

// Proxy endpoint for Groq API
app.post('/api/groq', async (req, res) => {
    try {
        const { prompt, maxTokens = 150 } = req.body;
        
        if (!process.env.GROQ_API_KEY) {
            return res.status(500).json({ 
                error: 'GROQ_API_KEY not configured in server environment' 
            });
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'moonshotai/kimi-k2-instruct',
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                max_tokens: maxTokens,
                temperature: 0.6,
                top_p: 1,
                stream: false,
                stop: null
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return res.status(response.status).json({
                error: `Groq API error: ${response.status} ${response.statusText}`,
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
        groqConfigured: !!process.env.GROQ_API_KEY 
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
    console.log(`🔑 Groq API key: ${process.env.GROQ_API_KEY ? 'Configured' : 'Missing'}`);
});