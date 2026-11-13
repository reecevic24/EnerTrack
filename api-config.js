'use strict';

// Keep local development same-origin; use the Render API for deployed static sites.
window.ENERTRACK_API_BASE_URL = window.ENERTRACK_API_BASE_URL ||
    (['enertrackmo.netlify.app', 'reecevic24.github.io'].includes(window.location.hostname)
        ? 'https://enertrack-1.onrender.com'
        : '');
