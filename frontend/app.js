// Configuration
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api'
    : '/api';

// OpenFDA API Endpoints
const FDA_DRUG_LABEL_URL = 'https://api.fda.gov/drug/label.json';
const FDA_ADVERSE_EVENTS_URL = 'https://api.fda.gov/drug/event.json';

// Date range for adverse events (2004 to today)
const DATE_RANGE = '[20040101+TO+20251125]';

// State management
let currentResults = [];
let recentSearches = [];
let currentDrugName = '';

// DOM Elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const autocompleteList = document.getElementById('autocompleteList');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorMessage = document.getElementById('errorMessage');
const resultsSection = document.getElementById('resultsSection');
const resultsContainer = document.getElementById('resultsContainer');
const filtersSection = document.getElementById('filtersSection');
const resultsCount = document.getElementById('resultsCount');
const typeFilter = document.getElementById('typeFilter');
const sortSelect = document.getElementById('sortSelect');
const drugModal = document.getElementById('drugModal');
const modalClose = document.getElementById('modalClose');
const drugDetail = document.getElementById('drugDetail');
const recentSearchesSection = document.getElementById('recentSearches');
const recentSearchesList = document.getElementById('recentSearchesList');

// Load recent searches
function loadRecentSearches() {
    const stored = localStorage.getItem('recentSearches');
    if (stored) {
        recentSearches = JSON.parse(stored);
        renderRecentSearches();
    }
}

// Save recent search
function saveRecentSearch(query) {
    if (!query || query.trim().length === 0) return;
    
    const normalizedQuery = query.trim().toLowerCase();
    recentSearches = recentSearches.filter(s => s.toLowerCase() !== normalizedQuery);
    recentSearches.unshift(query.trim());
    recentSearches = recentSearches.slice(0, 5);
    
    localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
    renderRecentSearches();
}

// Render recent searches
function renderRecentSearches() {
    if (recentSearches.length === 0) {
        recentSearchesSection.classList.add('hidden');
        return;
    }
    
    recentSearchesSection.classList.remove('hidden');
    recentSearchesList.innerHTML = recentSearches
        .map(search => `
            <span class="recent-search-tag" data-search="${search}">
                ${search}
            </span>
        `)
        .join('');
    
    document.querySelectorAll('.recent-search-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            searchInput.value = tag.dataset.search;
            performSearch();
        });
    });
}

// Show/hide elements
function showElement(element) {
    element.classList.remove('hidden');
}

function hideElement(element) {
    element.classList.add('hidden');
}

// Show loading state
function showLoading() {
    showElement(loadingIndicator);
    hideElement(errorMessage);
    hideElement(resultsSection);
    hideElement(filtersSection);
}

// Hide loading state
function hideLoading() {
    hideElement(loadingIndicator);
}

// Show error
function showError(message) {
    errorMessage.textContent = message;
    showElement(errorMessage);
    hideElement(resultsSection);
    hideElement(filtersSection);
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Autocomplete using OpenFDA
async function fetchAutocomplete(query) {
    if (query.length < 2) {
        hideElement(autocompleteList);
        return;
    }
    
    try {
        const searchQuery = `openfda.brand_name:${query}*`;
        const url = `${FDA_DRUG_LABEL_URL}?search=${encodeURIComponent(searchQuery)}&limit=5`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            hideElement(autocompleteList);
            return;
        }
        
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            const suggestions = data.results.map(r => ({
                brandName: r.openfda?.brand_name?.[0],
                genericName: r.openfda?.generic_name?.[0]
            }));
            renderAutocomplete(suggestions);
        } else {
            hideElement(autocompleteList);
        }
    } catch (error) {
        console.error('Autocomplete error:', error);
        hideElement(autocompleteList);
    }
}

// Render autocomplete
function renderAutocomplete(suggestions) {
    if (!suggestions || suggestions.length === 0) {
        hideElement(autocompleteList);
        return;
    }
    
    autocompleteList.innerHTML = suggestions
        .filter(s => s.brandName || s.genericName)
        .map(s => `
            <div class="autocomplete-item" data-name="${s.brandName || s.genericName}">
                <strong>${s.brandName || s.genericName}</strong>
                ${s.brandName && s.genericName ? `<br><small>${s.genericName}</small>` : ''}
            </div>
        `)
        .join('');
    
    showElement(autocompleteList);
    
    document.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
            searchInput.value = item.dataset.name;
            hideElement(autocompleteList);
            performSearch();
        });
    });
}

// Fetch adverse events data for a drug
async function fetchAdverseEvents(drugName) {
    try {
        const searchQuery = `(receivedate:${DATE_RANGE})+AND+${encodeURIComponent(drugName)}`;
        const url = `${FDA_ADVERSE_EVENTS_URL}?search=${searchQuery}&limit=100`;
        
        const response = await fetch(url);
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.results || [];
    } catch (error) {
        console.error('Adverse events fetch error:', error);
        return null;
    }
}

// Fetch drug indications (what the drug is used for)
async function fetchDrugIndications(drugName) {
    try {
        const searchQuery = `(receivedate:${DATE_RANGE})+AND+${encodeURIComponent(drugName)}`;
        const url = `${FDA_ADVERSE_EVENTS_URL}?search=${searchQuery}&count=patient.drug.drugindication.exact`;
        
        const response = await fetch(url);
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.results || [];
    } catch (error) {
        console.error('Indications fetch error:', error);
        return null;
    }
}

// Fetch common reactions for a drug
async function fetchDrugReactions(drugName) {
    try {
        const searchQuery = `(receivedate:${DATE_RANGE})+AND+${encodeURIComponent(drugName)}`;
        const url = `${FDA_ADVERSE_EVENTS_URL}?search=${searchQuery}&count=patient.reaction.reactionmeddrapt.exact`;
        
        const response = await fetch(url);
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.results || [];
    } catch (error) {
        console.error('Reactions fetch error:', error);
        return null;
    }
}

// Get adverse event statistics
async function getAdverseEventStats() {
    try {
        const url = `${FDA_ADVERSE_EVENTS_URL}?search=receivedate:${DATE_RANGE}&count=receivedate`;
        const response = await fetch(url);
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.results || [];
    } catch (error) {
        console.error('Stats fetch error:', error);
        return null;
    }
}

// Perform comprehensive search
async function performSearch() {
    const query = searchInput.value.trim();

    if (!query) {
        showError('Please enter a medication name to search');
        return;
    }
    
    showLoading();
    hideElement(autocompleteList);
    currentDrugName = query;
    
    try {
        // Fetch drug label information
        const labelData = await searchDrugLabel(query);
        
        if (!labelData.drugs || labelData.drugs.length === 0) {
            showError(`No results found for "${query}". Try: aspirin, ibuprofen, metformin, paracetamol, or atorvastatin`);
            return;
        }
        
        currentResults = labelData.drugs;
        saveRecentSearch(query);
        renderResults();
        showElement(filtersSection);
        showElement(resultsSection);
        
    } catch (error) {
        console.error('Search error:', error);
        showError(`Search failed: ${error.message}. Please try again.`);
    } finally {
        hideLoading();
    }
}

// Search drug label information
async function searchDrugLabel(query) {
    const searchQuery = `openfda.brand_name:"${query}" openfda.generic_name:"${query}"`;
    const url = `${FDA_DRUG_LABEL_URL}?search=${encodeURIComponent(searchQuery)}&limit=20`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
        if (response.status === 404) {
            return { drugs: [] };
        }
        throw new Error(`FDA API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.results || data.results.length === 0) {
        return { drugs: [] };
    }
    
    const drugs = data.results.map(result => {
        const openfda = result.openfda || {};
        return {
            id: result.id || result.spl_id?.[0] || 'N/A',
            brandName: openfda.brand_name?.[0] || 'N/A',
            genericName: openfda.generic_name?.[0] || 'N/A',
            manufacturer: openfda.manufacturer_name?.[0] || 'N/A',
            productType: openfda.product_type?.[0] || 'N/A',
            route: openfda.route?.[0] || 'N/A',
            substanceName: openfda.substance_name?.[0] || 'N/A',
            purpose: result.purpose ? result.purpose[0].substring(0, 500) : 'N/A',
            indications: result.indications_and_usage ? result.indications_and_usage[0].substring(0, 1000) : 'N/A',
            warnings: result.warnings ? result.warnings[0].substring(0, 1000) : 'N/A',
            dosage: result.dosage_and_administration ? result.dosage_and_administration[0].substring(0, 1000) : 'N/A',
            adverseReactions: result.adverse_reactions ? result.adverse_reactions[0].substring(0, 500) : 'N/A',
            activeIngredients: result.active_ingredient ? result.active_ingredient[0] : 'N/A',
            pharmacologicClass: openfda.pharm_class_epc?.[0] || 'N/A',
        };
    });
    
    return {
        query: query,
        count: drugs.length,
        drugs: drugs
    };
}

// Apply filters and sorting
function applyFiltersAndSort() {
    let filtered = [...currentResults];
    
    const typeValue = typeFilter.value;
    if (typeValue !== 'all') {
        filtered = filtered.filter(drug => drug.productType === typeValue);
    }
    
    const sortValue = sortSelect.value;
    filtered.sort((a, b) => {
        const nameA = (a.brandName !== 'N/A' ? a.brandName : a.genericName).toLowerCase();
        const nameB = (b.brandName !== 'N/A' ? b.brandName : b.genericName).toLowerCase();
        
        if (sortValue === 'name-asc') {
            return nameA.localeCompare(nameB);
        } else {
            return nameB.localeCompare(nameA);
        }
    });
    
    return filtered;
}

// Render results
function renderResults() {
    const filtered = applyFiltersAndSort();
    
    resultsCount.textContent = `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`;
    
    if (filtered.length === 0) {
        resultsContainer.innerHTML = '<p style="text-align: center; padding: 40px;">No medications found matching your criteria.</p>';
        return;
    }
    
    resultsContainer.innerHTML = filtered.map(drug => `
        <div class="drug-card" data-id="${drug.id}">
            <div class="drug-card-header">
                <h3 class="drug-brand-name">${drug.brandName}</h3>
                ${drug.genericName !== 'N/A' ? `<p class="drug-generic-name">${drug.genericName}</p>` : ''}
            </div>
            <div class="drug-card-body">
                <div class="drug-info-item">
                    <span class="drug-info-label">Type:</span>
                    <span class="drug-type-badge">${formatProductType(drug.productType)}</span>
                </div>
                ${drug.manufacturer !== 'N/A' ? `
                <div class="drug-info-item">
                    <span class="drug-info-label">Manufacturer:</span>
                    <span class="drug-info-value">${truncate(drug.manufacturer, 30)}</span>
                </div>
                ` : ''}
                ${drug.route !== 'N/A' ? `
                <div class="drug-info-item">
                    <span class="drug-info-label">Route:</span>
                    <span class="drug-info-value">${drug.route}</span>
                </div>
                ` : ''}
            </div>
            <div class="drug-card-footer">
                <button class="view-details-btn" data-id="${drug.id}">View Full Details</button>
            </div>
        </div>
    `).join('');
    
    document.querySelectorAll('.view-details-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const drugId = btn.dataset.id;
            showDrugDetails(drugId);
        });
    });
    
    document.querySelectorAll('.drug-card').forEach(card => {
        card.addEventListener('click', () => {
            const drugId = card.dataset.id;
            showDrugDetails(drugId);
        });
    });
}

// Show drug details with enhanced adverse event data
async function showDrugDetails(drugId) {
    const drug = currentResults.find(d => d.id === drugId);
    if (!drug) return;
    
    // Show basic details first
    drugDetail.innerHTML = `
        <h2>${drug.brandName}</h2>
        ${drug.genericName !== 'N/A' ? `<p style="font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 20px;">${drug.genericName}</p>` : ''}
        
        <div class="loading-indicator" style="text-align: center; padding: 20px;">
            <div class="spinner"></div>
            <p>Loading additional data from FDA adverse events database...</p>
        </div>
    `;
    
    showElement(drugModal);
    document.body.style.overflow = 'hidden';
    
    // Fetch additional data in parallel
    const drugName = drug.brandName !== 'N/A' ? drug.brandName : drug.genericName;
    const [indications, reactions] = await Promise.all([
        fetchDrugIndications(drugName),
        fetchDrugReactions(drugName)
    ]);
    
    // Render complete details
    drugDetail.innerHTML = `
        <h2>${drug.brandName}</h2>
        ${drug.genericName !== 'N/A' ? `<p style="font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 20px;">${drug.genericName}</p>` : ''}
        
        <div class="drug-detail-grid">
            <div class="detail-item">
                <div class="detail-label">Product Type</div>
                <div class="detail-value">${formatProductType(drug.productType)}</div>
            </div>
            ${drug.manufacturer !== 'N/A' ? `
            <div class="detail-item">
                <div class="detail-label">Manufacturer</div>
                <div class="detail-value">${drug.manufacturer}</div>
            </div>
            ` : ''}
            ${drug.route !== 'N/A' ? `
            <div class="detail-item">
                <div class="detail-label">Route of Administration</div>
                <div class="detail-value">${drug.route}</div>
            </div>
            ` : ''}
            ${drug.pharmacologicClass !== 'N/A' ? `
            <div class="detail-item">
                <div class="detail-label">Pharmacologic Class</div>
                <div class="detail-value">${drug.pharmacologicClass}</div>
            </div>
            ` : ''}
        </div>
        
        ${indications && indications.length > 0 ? `
        <h3>Common Uses (From Adverse Event Reports)</h3>
        <div class="drug-detail-section">
            <ul style="margin: 0; padding-left: 20px;">
                ${indications.slice(0, 10).map(ind => `
                    <li style="margin-bottom: 8px;">
                        <strong>${ind.term}</strong> - ${ind.count.toLocaleString()} reports
                    </li>
                `).join('')}
            </ul>
        </div>
        ` : ''}
        
        ${drug.purpose !== 'N/A' ? `
        <h3>Purpose</h3>
        <div class="drug-detail-section">
            ${formatText(drug.purpose)}
        </div>
        ` : ''}
        
        ${drug.indications !== 'N/A' ? `
        <h3>Indications and Usage</h3>
        <div class="drug-detail-section">
            ${formatText(drug.indications)}
        </div>
        ` : ''}
        
        ${reactions && reactions.length > 0 ? `
        <h3>Most Reported Adverse Reactions</h3>
        <div class="drug-detail-section" style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <p style="margin-bottom: 10px; font-weight: 600;">Based on ${reactions.reduce((sum, r) => sum + r.count, 0).toLocaleString()} adverse event reports:</p>
            <ul style="margin: 0; padding-left: 20px;">
                ${reactions.slice(0, 15).map(reaction => `
                    <li style="margin-bottom: 8px;">
                        <strong>${reaction.term}</strong> - ${reaction.count.toLocaleString()} reports
                    </li>
                `).join('')}
            </ul>
        </div>
        ` : ''}
        
        ${drug.dosage !== 'N/A' ? `
        <h3>Dosage and Administration</h3>
        <div class="drug-detail-section">
            ${formatText(drug.dosage)}
        </div>
        ` : ''}
        
        ${drug.warnings !== 'N/A' ? `
        <h3>Warnings and Precautions</h3>
        <div class="drug-detail-section" style="background: #fee; padding: 15px; border-radius: 8px; border-left: 4px solid #ef4444;">
            ${formatText(drug.warnings)}
        </div>
        ` : ''}
        
        ${drug.adverseReactions !== 'N/A' ? `
        <h3>Adverse Reactions (From Label)</h3>
        <div class="drug-detail-section">
            ${formatText(drug.adverseReactions)}
        </div>
        ` : ''}
        
        ${drug.activeIngredients !== 'N/A' ? `
        <h3>Active Ingredients</h3>
        <div class="drug-detail-section">
            ${formatText(drug.activeIngredients)}
        </div>
        ` : ''}
        
        <div style="margin-top: 30px; padding: 20px; background: var(--bg-color); border-radius: 8px;">
            <p style="font-size: 0.9rem; color: var(--text-secondary);">
                <strong>Important:</strong> This information is provided for educational purposes only. 
                Adverse event data is from voluntary reports and does not establish causation.
                Always consult your healthcare provider before starting, stopping, or changing any medication. 
                This is not a substitute for professional medical advice.
            </p>
        </div>
    `;
}

// Format product type
function formatProductType(type) {
    if (!type || type === 'N/A') return 'N/A';
    return type.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

// Format text
function formatText(text) {
    if (!text || text === 'N/A') return 'Not available';
    return text
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/^(.+)$/, '<p>$1</p>');
}

// Truncate text
function truncate(text, length) {
    if (!text || text.length <= length) return text;
    return text.substring(0, length) + '...';
}

// Event Listeners
searchBtn.addEventListener('click', performSearch);

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        performSearch();
    }
});

const debouncedAutocomplete = debounce(fetchAutocomplete, 300);
searchInput.addEventListener('input', (e) => {
    debouncedAutocomplete(e.target.value);
});

document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !autocompleteList.contains(e.target)) {
        hideElement(autocompleteList);
    }
});

typeFilter.addEventListener('change', renderResults);
sortSelect.addEventListener('change', renderResults);

modalClose.addEventListener('click', () => {
    hideElement(drugModal);
    document.body.style.overflow = 'auto';
});

drugModal.addEventListener('click', (e) => {
    if (e.target === drugModal) {
        hideElement(drugModal);
        document.body.style.overflow = 'auto';
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drugModal.classList.contains('hidden')) {
        hideElement(drugModal);
        document.body.style.overflow = 'auto';
    }
});

// Initialize
loadRecentSearches();

console.log('MedGuard initialized successfully');
console.log('FDA Drug Label API:', FDA_DRUG_LABEL_URL);
console.log('FDA Adverse Events API:', FDA_ADVERSE_EVENTS_URL);