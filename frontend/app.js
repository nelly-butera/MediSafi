// Configuration
const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api'
    : '/api'; // When deployed through load balancer

// State management
let currentResults = [];
let recentSearches = [];

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

// Load recent searches from localStorage
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
    recentSearches = recentSearches.slice(0, 5); // Keep only 5
    
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
    
    // Add click handlers
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

// Autocomplete
async function fetchAutocomplete(query) {
    if (query.length < 2) {
        hideElement(autocompleteList);
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/autocomplete?query=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Autocomplete failed');
        
        const data = await response.json();
        renderAutocomplete(data.suggestions);
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
        .map(s => `
            <div class="autocomplete-item" data-name="${s.brandName || s.genericName}">
                <strong>${s.brandName || s.genericName}</strong>
                ${s.brandName && s.genericName ? `<br><small>${s.genericName}</small>` : ''}
            </div>
        `)
        .join('');
    
    showElement(autocompleteList);
    
    // Add click handlers
    document.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
            searchInput.value = item.dataset.name;
            hideElement(autocompleteList);
            performSearch();
        });
    });
}

// Perform search
async function performSearch() {
    const query = searchInput.value.trim();
    let errorData = {};

    if (!query) {
        showError('Please enter a medication name to search');
        return;
    }
    
    showLoading();
    hideElement(autocompleteList);
    
    try {
        const response = await fetch(`${API_BASE_URL}/search?query=${encodeURIComponent(query)}&limit=20`);
        
        errorData = await response.json();
        if (!response.ok) {
            throw new Error(errorData.message || 'Search failed');
        }
        
        const data = await response.json();
        currentResults = data.drugs;
        
        saveRecentSearch(query);
        renderResults();
        showElement(filtersSection);
        showElement(resultsSection);
        
    } catch (e) {
        throw new Error(`Server returned status ${response.status}. Check network tab for details.`);
    } finally {
        hideLoading();
    }

    throw new Error(errorData.message || 'Search failed');
}

// Apply filters and sorting
function applyFiltersAndSort() {
    let filtered = [...currentResults];
    
    // Apply type filter
    const typeValue = typeFilter.value;
    if (typeValue !== 'all') {
        filtered = filtered.filter(drug => drug.productType === typeValue);
    }
    
    // Apply sorting
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
    
    // Add click handlers
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

// Show drug details in modal
async function showDrugDetails(drugId) {
    const drug = currentResults.find(d => d.id === drugId);
    
    if (!drug) return;
    
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
        
        ${drug.purpose !== 'N/A' ? `
        <h3>Purpose</h3>
        <div class="drug-detail-section">
            ${formatText(drug.purpose)}
        </div>
        ` : ''}
        
        ${drug.indications ? `
        <h3>Indications and Usage</h3>
        <div class="drug-detail-section">
            ${formatText(drug.indications)}
        </div>
        ` : ''}
        
        ${drug.dosage ? `
        <h3>Dosage and Administration</h3>
        <div class="drug-detail-section">
            ${formatText(drug.dosage)}
        </div>
        ` : ''}
        
        ${drug.warnings ? `
        <h3>Warnings and Precautions</h3>
        <div class="drug-detail-section" style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid var(--warning-color);">
            ${formatText(drug.warnings)}
        </div>
        ` : ''}
        
        ${drug.adverseReactions ? `
        <h3>Adverse Reactions</h3>
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
                Always consult your healthcare provider before starting, stopping, or changing any medication. 
                This is not a substitute for professional medical advice.
            </p>
        </div>
    `;
    
    showElement(drugModal);
    document.body.style.overflow = 'hidden';
}

// Format product type
function formatProductType(type) {
    if (!type || type === 'N/A') return 'N/A';
    return type.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

// Format text (basic HTML cleaning)
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

// Close autocomplete when clicking outside
document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !autocompleteList.contains(e.target)) {
        hideElement(autocompleteList);
    }
});

// Filter and sort handlers
typeFilter.addEventListener('change', renderResults);
sortSelect.addEventListener('change', renderResults);

// Modal handlers
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

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drugModal.classList.contains('hidden')) {
        hideElement(drugModal);
        document.body.style.overflow = 'auto';
    }
});

// Initialize
loadRecentSearches();

console.log('MedGuard initialized successfully');
console.log('API URL:', API_BASE_URL);