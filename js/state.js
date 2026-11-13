let inventory = [];
let audits = [];
let currentUser = null;
let auditSaveTimer = null;
const userDataSaveTimers = {};
const AUDIT_REPORT_VERSION = 5;
let sharedSubmissions = [];
let barChartInstance = null;
let universityChartInstance = null;
let equipmentDetails = { actual: [], recommended: [] };
let actualEquipmentChartInstance = null;
let recommendedEquipmentChartInstance = null;
let selectedFacility = 'Admin';
let selectedHostelName = '';
let selectedAdminAuditId = '';
const ADD_HOSTEL_OPTION = '__add_hostel__';
let facilityInfo = { facilityLocation: '', authorName: '' };
let historicalData = [];
let auditPhotos = [];
let auditsRevision = null;
let sessionExpiryNotified = false;
const DEFAULT_TARIFF_RATE = 12;
const DEFAULT_EMISSION_FACTOR = 0.05;

// The catalogue is seeded in the database and loaded from /api/facilities; this
// list is only the offline fallback used when that request fails.
let facilityNames = [
    'Admin',
    'Hostels',
    'Soweto 2',
    'Soweto Kitchen',
    'Ngeria Hostels',
    'Tech Building',
    'Main water supply',
    'MTL',
    'Annex'
];

const API_BASE = String(window.ENERTRACK_API_BASE_URL || '').replace(/\/+$/, '');

function createDefaultEnergySettings() {
    return { tariffRate: DEFAULT_TARIFF_RATE, emissionFactor: DEFAULT_EMISSION_FACTOR };
}

function currentTariffRate() {
    const value = parseFloat(document.getElementById('tariffRate').value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TARIFF_RATE;
}

function currentEmissionFactor() {
    const value = parseFloat(document.getElementById('emissionFactor').value);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_EMISSION_FACTOR;
}

function readEnergySettingsFromForm() {
    return { tariffRate: currentTariffRate(), emissionFactor: currentEmissionFactor() };
}

function createDefaultRecommendations() {
    return [
        { id: 'lighting', loadType: 'Lighting', text: '' },
        { id: 'hvac', loadType: 'HVAC (Air conditioners, Refrigerators etc)', text: '' },
        { id: 'motors', loadType: 'Motors and Pumps', text: '' },
        { id: 'electronics', loadType: 'Electronics & IT Systems', text: '' }
    ];
}
let loadRecommendations = createDefaultRecommendations();
let saveTimeout = null;

function resetSession() {
    currentUser = null;
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function apiRequest(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    return fetch(`${API_BASE}${path}`, { credentials: 'include', ...options, headers }).then(async response => {
        if (response.status === 204) return null;
        let body;
        try {
            body = await response.json();
        } catch {
            const error = new Error(response.ok
                ? 'The server returned an invalid response.'
                : `Request failed (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        if (!response.ok) {
            if (response.status === 401 && currentUser && !path.startsWith('/api/auth/')) {
                resetSession();
                if (!sessionExpiryNotified) {
                    sessionExpiryNotified = true;
                    alert('Your session expired. Please log in again.');
                }
            }
            const error = new Error(body.error || `Request failed (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return body;
    });
}

function reportApiError(error) {
    console.error('EnerTrack server request failed.', error);
    alert(error.message || 'The server request failed. Please try again.');
}

function persistUserData(key, value) {
    clearTimeout(userDataSaveTimers[key]);
    userDataSaveTimers[key] = setTimeout(() => {
        if (key === 'recommendations') {
            apiRequest('/api/recommendations', {
                method: 'PUT',
                body: JSON.stringify({ recommendations: value })
            }).catch(reportApiError);
            return;
        }
        if (!currentUser) return;
        const storageKey = `enertrack_${key}_${normalizeEmail(currentUser.email)}`;
        try {
            localStorage.setItem(storageKey, JSON.stringify(value));
        } catch (error) {
            console.error('Unable to save equipment details in this browser.', error);
            alert('Equipment details could not be saved in this browser. Check available storage and try again.');
        }
    }, 300);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swCode = `
                    self.addEventListener('install', e => { self.skipWaiting(); });
                    self.addEventListener('activate', e => { self.clients.claim(); });
                    self.addEventListener('fetch', e => { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); });
                `;
        const blob = new Blob([swCode], { type: 'text/javascript' });
        const swUrl = URL.createObjectURL(blob);
        navigator.serviceWorker.register(swUrl).catch(err => console.log('SW registration notice: ', err));
    });
}
