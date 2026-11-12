'use strict';

// Keep local development same-origin; use the Render API for the Netlify site.
window.ENERTRACK_API_BASE_URL = window.ENERTRACK_API_BASE_URL ||
    (window.location.hostname === 'enertrackmo.netlify.app' ? 'https://enertrack-1.onrender.com' : '');
