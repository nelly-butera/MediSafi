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
    ? ['http://localhost:8080', 'http://3.87.160.166']
    : '*'
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Simple in-memory cache
const cache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

const OPENFDA_BASE_URL = 'https://api.fda.gov';

// Helper function to extract drug data
function extractDrugData(result) {
  const openfda = result.openfda || {};
  const indications = result.indications_and_usage ? result.indications_and_usage[0] : '';
  const warnings = result.warnings ? result.warnings[0] : '';
  const dosage = result.dosage_and_administration ? result.dosage_and_administration[0] : '';
  const adverseReactions = result.adverse_reactions ? result.adverse_reactions[0] : '';
  
  return {
    // === FIXES APPLIED HERE ===
    id: result.id || (result.spl_id && result.spl_id.length > 0 ? result.spl_id[0] : 'N/A'),
    brandName: openfda.brand_name && openfda.brand_name.length > 0 ? openfda.brand_name[0] : 'N/A',
    genericName: openfda.generic_name && openfda.generic_name.length > 0 ? openfda.generic_name[0] : 'N/A',
    manufacturer: openfda.manufacturer_name && openfda.manufacturer_name.length > 0 ? openfda.manufacturer_name[0] : 'N/A',
    productType: openfda.product_type && openfda.product_type.length > 0 ? openfda.product_type[0] : 'N/A',
    route: openfda.route && openfda.route.length > 0 ? openfda.route[0] : 'N/A',
    substanceName: openfda.substance_name && openfda.substance_name.length > 0 ? openfda.substance_name[0] : 'N/A',
    // Rest of the properties were already correctly using ternary checks:
    purpose: result.purpose ? result.purpose[0].substring(0, 500) : 'N/A',
    indications: indications.substring(0, 1000),
    warnings: warnings.substring(0, 1000),
    dosage: dosage.substring(0, 1000),
    adverseReactions: adverseReactions.substring(0, 500),
    activeIngredients: result.active_ingredient ? result.active_ingredient[0] : 'N/A',
    pharmacologicClass: openfda.pharm_class_epc && openfda.pharm_class_epc.length > 0 ? openfda.pharm_class_epc[0] : 'N/A',
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

// Search endpoint - FIXED VERSION
app.get('/api/search', async (req, res) => {
  try {
    const { query, limit = 10 } = req.query;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

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

    // FIXED: Correct OpenFDA search syntax
    // Use quotes for exact match OR wildcard for partial match
    const searchUrl = `${OPENFDA_BASE_URL}/drug/label.json`;
    const searchQuery = `openfda.brand_name:"${sanitizedQuery}" openfda.generic_name:"${sanitizedQuery}"`;
    
    const params = {
      search: searchQuery,
      limit: Math.min(parseInt(limit), 20)
    };

    console.log('Searching OpenFDA with query:', searchQuery);
    console.log('Full URL:', `${searchUrl}?search=${encodeURIComponent(searchQuery)}&limit=${params.limit}`);
    
    const response = await axios.get(searchUrl, { 
      params,
      timeout: 10000 
    });

    if (!response.data.results || response.data.results.length === 0) {
      return res.status(404).json({ 
        error: 'No medications found',
        message: `No results found for "${query}". Try: aspirin, ibuprofen, metformin, or atorvastatin`
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
    console.error('Error details:', error.response?.data || error);
    
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
      message: 'An error occurred while searching. Please try again later.',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
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

// Autocomplete endpoint
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
    
    // Use wildcard for autocomplete
    const searchQuery = `openfda.brand_name:${sanitizedQuery}*`;
    
    const response = await axios.get(searchUrl, {
      params: {
        search: searchQuery,
        limit: 5
      },
      timeout: 5000
    });

    
    const suggestions = response.data.results
      ? response.data.results.map(r => ({
          brandName: r.openfda && r.openfda.brand_name && r.openfda.brand_name.length > 0 ? r.openfda.brand_name[0] : undefined,
          genericName: r.openfda && r.openfda.generic_name && r.openfda.generic_name.length > 0 ? r.openfda.generic_name[0] : undefined
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

// Clear cache endpoint
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
  console.log(`\nTry searching for: aspirin, ibuprofen, metformin, atorvastatin`);
});

module.exports = app;