// backend/server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['http://localhost:8080', 'http://your-lb-ip']
    : '*'
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Simple in-memory cache to reduce API calls
const cache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

// OpenFDA API base URL
const OPENFDA_BASE_URL = 'https://api.fda.gov';

// Helper function to clean and extract drug data
function extractDrugData(result) {
  const openfda = result.openfda || {};
  const indications = result.indications_and_usage ? result.indications_and_usage[0] : '';
  const warnings = result.warnings ? result.warnings[0] : '';
  const dosage = result.dosage_and_administration ? result.dosage_and_administration[0] : '';
  const adverseReactions = result.adverse_reactions ? result.adverse_reactions[0] : '';
  
  return {
    id: result.id || result.spl_id?.[0] || 'N/A',
    brandName: openfda.brand_name?.[0] || 'N/A',
    genericName: openfda.generic_name?.[0] || 'N/A',
    manufacturer: openfda.manufacturer_name?.[0] || 'N/A',
    productType: openfda.product_type?.[0] || 'N/A',
    route: openfda.route?.[0] || 'N/A',
    substanceName: openfda.substance_name?.[0] || 'N/A',
    purpose: result.purpose ? result.purpose[0].substring(0, 500) : 'N/A',
    indications: indications.substring(0, 1000),
    warnings: warnings.substring(0, 1000),
    dosage: dosage.substring(0, 1000),
    adverseReactions: adverseReactions.substring(0, 500),
    activeIngredients: result.active_ingredient ? result.active_ingredient[0] : 'N/A',
    pharmacologicClass: openfda.pharm_class_epc?.[0] || 'N/A',
  };
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    server: process.env.SERVER_ID || 'unknown'
  });
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query, limit = 10 } = req.query;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Sanitize input
    const sanitizedQuery = query.trim().replace(/[^\w\s-]/gi, '');
    
    // Check cache
    const cacheKey = `search_${sanitizedQuery}_${limit}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('Returning cached results for:', sanitizedQuery);
        return res.json({ ...cached.data, cached: true });
      }
    }

    // Call OpenFDA API
    const searchUrl = `${OPENFDA_BASE_URL}/drug/label.json`;
    const params = {
      search: `openfda.brand_name:"${sanitizedQuery}" OR openfda.generic_name:"${sanitizedQuery}"`,
      limit: Math.min(parseInt(limit), 20) // Cap at 20
    };

    console.log('Searching OpenFDA:', sanitizedQuery);
    const response = await axios.get(searchUrl, { 
      params,
      timeout: 10000 
    });

    if (!response.data.results || response.data.results.length === 0) {
      return res.status(404).json({ 
        error: 'No medications found',
        message: `No results found for "${query}". Try a different search term.`
      });
    }

    // Extract and clean data
    const drugs = response.data.results.map(extractDrugData);

    const responseData = {
      query: sanitizedQuery,
      count: drugs.length,
      total: response.data.meta?.results?.total || drugs.length,
      drugs
    };

    // Cache results
    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: responseData
    });

    res.json(responseData);

  } catch (error) {
    console.error('Search error:', error.message);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: 'No results found',
        message: 'No medications found matching your search.'
      });
    }
    
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ 
        error: 'Request timeout',
        message: 'The request took too long. Please try again.'
      });
    }

    res.status(500).json({ 
      error: 'Internal server error',
      message: 'An error occurred while searching. Please try again later.'
    });
  }
});

// Get drug details by ID
app.get('/api/drug/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Drug ID is required' });
    }

    // Check cache
    const cacheKey = `drug_${id}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        return res.json({ ...cached.data, cached: true });
      }
    }

    // Call OpenFDA API
    const searchUrl = `${OPENFDA_BASE_URL}/drug/label.json`;
    const response = await axios.get(searchUrl, {
      params: {
        search: `id:"${id}"`,
        limit: 1
      },
      timeout: 10000
    });

    if (!response.data.results || response.data.results.length === 0) {
      return res.status(404).json({ 
        error: 'Drug not found',
        message: 'No medication found with that ID.'
      });
    }

    const drug = extractDrugData(response.data.results[0]);

    // Cache result
    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: { drug }
    });

    res.json({ drug });

  } catch (error) {
    console.error('Drug detail error:', error.message);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'An error occurred while fetching drug details.'
    });
  }
});

// Autocomplete endpoint for search suggestions
app.get('/api/autocomplete', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.json({ suggestions: [] });
    }

    const sanitizedQuery = query.trim().replace(/[^\w\s-]/gi, '');
    
    // Check cache
    const cacheKey = `autocomplete_${sanitizedQuery}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        return res.json({ ...cached.data, cached: true });
      }
    }

    const searchUrl = `${OPENFDA_BASE_URL}/drug/label.json`;
    const response = await axios.get(searchUrl, {
      params: {
        search: `openfda.brand_name:${sanitizedQuery}* OR openfda.generic_name:${sanitizedQuery}*`,
        limit: 5
      },
      timeout: 5000
    });

    const suggestions = response.data.results
      ? response.data.results.map(r => ({
          brandName: r.openfda?.brand_name?.[0],
          genericName: r.openfda?.generic_name?.[0]
        }))
      : [];

    const responseData = { suggestions };

    // Cache results
    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: responseData
    });

    res.json(responseData);

  } catch (error) {
    console.error('Autocomplete error:', error.message);
    res.json({ suggestions: [] });
  }
});

// Clear cache endpoint (for maintenance)
app.post('/api/cache/clear', (req, res) => {
  cache.clear();
  res.json({ message: 'Cache cleared successfully' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`MedGuard API Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;