import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Validate API key middleware
const validateApiKey = (req, res, next) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'Server configuration error: Missing API key'
    });
  }
  next();
};

// Session endpoint to get ephemeral key
app.get('/session', validateApiKey, async (req, res) => {
  try {
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'verse',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      return res.status(response.status).json({
        error: 'Error obtaining session from OpenAI',
        details: errorData
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Query endpoint to proxy file search requests
app.post('/query', validateApiKey, async (req, res) => {
  try {
    const { keyword, model = 'gpt-4o-mini', maxResults = 5 } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ error: 'Keyword parameter is required' });
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: model,
        tools: [{
          type: 'file_search',
          vector_store_ids: ['vs_67ecdf6c4c388191babe14f6528ec5d6'],
          max_num_results: maxResults
        }],
        input: `Search about ${keyword} and return the relevant content.`,
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      return res.status(response.status).json({
        error: 'Error querying OpenAI API',
        details: errorData
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Basic status endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    endpoints: {
      '/session': 'GET - Obtain ephemeral key from OpenAI',
      '/query': 'POST - Proxy for file search API requests'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API proxy endpoints:`);
  console.log(`- GET /session - Ephemeral key endpoint`);
  console.log(`- POST /query - Query proxy endpoint`);
});
