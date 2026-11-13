'use strict';

process.env.SESSION_SECRET ||= 'test-only-session-secret-value-at-least-32-characters';
process.env.DATABASE_URL ||= 'postgres://enertrack:test@127.0.0.1:1/enertrack_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
process.env.FRONTEND_ORIGINS = 'https://enertrackmo.netlify.app,https://reecevic24.github.io';
const app = require('../server/app');
const { requireAuditor } = require('../server/routes/auth');

let server;
let baseUrl;

test.before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('serves the updated frontend, assets, and existing API bridge', async () => {
    const [page, client, config, campusImage, stylesheet, frontendScript] = await Promise.all([
        fetch(baseUrl),
        fetch(`${baseUrl}/client.js`),
        fetch(`${baseUrl}/api-config.js`),
        fetch(`${baseUrl}/moi-university-campus.jpeg`),
        fetch(`${baseUrl}/css/base.css`),
        fetch(`${baseUrl}/js/state.js`)
    ]);
    assert.equal(page.status, 200);
    const pageText = await page.text();
    assert.match(pageText, /EnerTrack/);
    assert.doesNotMatch(pageText, /id="auditFindings"/);
    assert.doesNotMatch(pageText, /id="auditRecommendations"/);
    assert.doesNotMatch(pageText, /id="dashboardAuditCount"/);
    assert.doesNotMatch(pageText, /id="dashboardRecentAudits"/);
    assert.doesNotMatch(pageText, /id="dashboardReports"/);
    assert.match(pageText, /src="moi-university-campus\.jpeg"[^>]*class="campus-img"/);
    assert.match(pageText, /Only an administrator can approve administrator access/);
    assert.match(pageText, /id="addAdminsButton"/);
    assert.match(pageText, /id="seeAdminsButton"/);
    assert.match(pageText, /id="approveAuditsButton"/);
    assert.match(pageText, /id="auditStatusButton"/);
    assert.match(pageText, /onclick="beginAuditRecommendations\(\)">Add recommendations/);
    assert.match(pageText, /id="mySubmissionPanel"/);
    assert.match(pageText, /Submitted details are read-only to administrators/);
    assert.match(pageText, /id="auditorRecommendationsPanel"/);
    assert.match(pageText, /id="submitAuditForApprovalButton"/);
    assert.match(pageText, /To submit this audit for approval, add at least one equipment recommendation\./);
    assert.doesNotMatch(pageText, /id="floorArea"/);
    assert.match(pageText, /id="regPass"[^>]*minlength="6"/);
    assert.match(pageText, /id="authorName"[^>]*readonly/);
    assert.match(pageText, /Enter registered email or Reg No\.\/ID/);
    assert.match(pageText, /id="loginFormView" style="display: none;">/);
    assert.match(pageText, /id="registerFormView">/);
    assert.match(pageText, /id="resetPasswordSubmit"[^>]*>Update password<\/button>/);
    assert.match(pageText, /id="resetPasswordGroup" class="form-group" style="display: none;/);
    assert.equal(client.status, 200);
    assert.match(await client.text(), /apiRequest\('\/auth\/login',/);
    assert.equal(config.status, 200);
    const configText = await config.text();
    assert.match(configText, /https:\/\/enertrack-1\.onrender\.com/);
    const githubPagesConfig = { window: { location: { hostname: 'reecevic24.github.io' } } };
    vm.runInNewContext(configText, githubPagesConfig);
    assert.equal(githubPagesConfig.window.ENERTRACK_API_BASE_URL, 'https://enertrack-1.onrender.com');
    assert.equal(stylesheet.status, 200);
    assert.match(await stylesheet.text(), /\.site-header/);
    assert.equal(frontendScript.status, 200);
    assert.match(await frontendScript.text(), /credentials: 'include'/);
    assert.equal(campusImage.status, 200);
    assert.match(campusImage.headers.get('content-type'), /image\/jpeg/);
    assert.ok((await campusImage.arrayBuffer()).byteLength > 0);
});

test('requires complete facility details and equipment before auditor recommendations', async () => {
    const response = await fetch(`${baseUrl}/js/submissions.js`);
    const values = new Map([
        ['facilitySelector', 'Science Block'],
        ['facilityLocation', 'Main Campus'],
        ['authorName', 'Test Auditor'],
        ['energySources', 'Grid electricity'],
        ['auditDate', '2026-11-12']
    ]);
    const elements = new Map();
    const context = {
        selectedFacility: 'Science Block',
        selectedHostelName: '',
        inventory: [{ category: 'Lighting', name: 'LED', watts: 30, qty: 4, hours: 8 }],
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, {
                    value: values.get(id) || '',
                    focus() {}
                });
                return elements.get(id);
            }
        }
    };
    vm.runInNewContext(await response.text(), context);

    assert.equal(context.getAuditReadinessIssue(), null);
    context.inventory = [];
    assert.equal(context.getAuditReadinessIssue().message, 'Add at least one complete equipment item before continuing.');
});

test('clears facility, equipment, and recommendation inputs after submission', async () => {
    const response = await fetch(`${baseUrl}/js/submissions.js`);
    const elements = new Map();
    const inputIds = [
        'facilityLocation', 'authorName', 'energySources', 'auditDate',
        'hostelName', 'equipment', 'wattage', 'availableNumber', 'operatingHours',
        'historyMonth', 'historyKwh', 'historyCost', 'auditPhotos'
    ];
    inputIds.forEach(id => elements.set(id, { value: 'entered value' }));
    let renderedRecommendations = 0;
    const context = {
        loadRecommendations: [
            { id: 'lighting', loadType: 'Lighting', text: 'Install efficient lighting.' },
            { id: 'hvac', loadType: 'HVAC', text: 'Improve HVAC controls.' },
            { id: 'motors', loadType: 'Motors', text: 'Maintain pumps.' },
            { id: 'electronics', loadType: 'Electronics', text: 'Enable power saving.' },
            { id: 'custom_1', loadType: 'Custom', text: 'Custom recommendation.' }
        ],
        document: { getElementById: id => elements.get(id) || null },
        renderLoadRecommendationBoxes: () => { renderedRecommendations += 1; }
    };
    vm.runInNewContext(await response.text(), context);
    context.clearAuditEntryFields();

    inputIds.forEach(id => assert.equal(elements.get(id).value, ''));
    assert.equal(context.loadRecommendations.length, 4);
    assert.ok(context.loadRecommendations.every(item => item.text === ''));
    assert.equal(renderedRecommendations, 1);
});

test('keeps submitted recommendations available to reports after the entry fields are cleared', async () => {
    const response = await fetch(`${baseUrl}/js/audit-report.js`);
    const context = {
        loadRecommendations: [{ loadType: 'Lighting', text: '' }]
    };
    vm.runInNewContext(await response.text(), context);

    assert.equal(
        context.getAuditRecommendationLines({ recommendations: ['Lighting: Install efficient lighting.'] }).join(''),
        'Lighting: Install efficient lighting.'
    );
});

test('does not mark a submitted audit as changed when photo URLs are normalized locally', async () => {
    const response = await fetch(`${baseUrl}/js/submissions.js`);
    const context = {};
    vm.runInNewContext(await response.text(), context);
    const record = {
        facilityInfo: { facilityLocation: 'Main Campus', auditDate: '2026-11-12' },
        inventory: [{ category: 'Lighting', name: 'LED', watts: 30, qty: 4, hours: 8 }],
        historicalData: [{ month: '2026-10', kwh: 100, cost: 1200 }],
        photos: [{ id: 'photo-1', url: '/api/audits/photo-1', dataUrl: 'https://api.example/api/audits/photo-1' }]
    };
    const submission = { auditorSnapshot: context.createAuditorSnapshot(record) };

    assert.equal(context.auditHasUnsubmittedChanges(record, submission), false);
    record.photos[0].dataUrl = 'data:image/jpeg;base64,abc';
    assert.equal(context.auditHasUnsubmittedChanges(record, submission), true);
});

test('prevents administrator accounts from entering or submitting audits', async () => {
    const response = await fetch(`${baseUrl}/js/submissions.js`);
    const alerts = [];
    const context = {
        currentUser: { role: 'admin' },
        isAdministrator: () => true,
        alert: message => alerts.push(message)
    };
    vm.runInNewContext(await response.text(), context);

    context.beginAuditRecommendations();
    await context.submitCurrentAudit();

    assert.equal(alerts.length, 2);
    assert.ok(alerts.every(message => /administrator accounts cannot/i.test(message)));
});

test('keeps the facility submission instruction unchanged after an audit is submitted', async () => {
    const response = await fetch(`${baseUrl}/js/submissions.js`);
    const status = { textContent: '' };
    const context = {
        currentUser: { role: 'auditor' },
        document: { getElementById: id => id === 'submissionStatus' ? status : null },
        renderInventoryTable() {}
    };
    vm.runInNewContext(await response.text(), context);

    context.updateSubmissionStatus();
    assert.equal(status.textContent, 'To submit this audit for approval, add at least one equipment recommendation.');
});

test('resets the facility entry screen without selecting the just-submitted audit', async () => {
    const response = await fetch(`${baseUrl}/js/audits.js`);
    const calls = [];
    const context = {
        selectedFacility: 'Science Block',
        selectedHostelName: 'Hostel A'
    };
    vm.runInNewContext(await response.text(), context);
    context.initializeFacilitySelector = () => calls.push('initialize');
    context.loadActiveAudit = () => calls.push('load');
    context.switchPage = page => calls.push(page);

    context.resetFacilityEntryAfterSubmission();
    assert.equal(context.selectedFacility, '');
    assert.equal(context.selectedHostelName, '');
    assert.deepEqual(calls, ['initialize', 'load', 'facilities']);
});

test('restricts audit writes to auditor accounts', () => {
    let statusCode;
    let responseBody;
    let nextCalled = false;
    const response = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(body) {
            responseBody = body;
            return this;
        }
    };

    requireAuditor({ session: { user: { role: 'admin' } } }, response, () => { nextCalled = true; });
    assert.equal(statusCode, 403);
    assert.match(responseBody.error, /auditor access/i);
    assert.equal(nextCalled, false);

    requireAuditor({ session: { user: { role: 'auditor' } } }, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('allows administrators to view facilities but prevents audit entry', async () => {
    const response = await fetch(`${baseUrl}/js/auth.js`);
    const activated = [];
    const context = {
        currentUser: { role: 'admin' },
        updateUniversitySummary() {},
        document: {
            querySelectorAll: () => [],
            getElementById: id => ({ classList: { add: () => activated.push(id) } })
        }
    };
    vm.runInNewContext(await response.text(), context);

    context.switchPage('facilities');
    assert.deepEqual(activated, ['pageFacilities', 'tabFacilities']);
    context.switchPage('measures');
    assert.deepEqual(activated, ['pageFacilities', 'tabFacilities']);

    context.switchPage('university');
    assert.deepEqual(activated, ['pageFacilities', 'tabFacilities', 'pageUniversity', 'tabUniversity']);
});

test('exposes the personal dashboard loader to the sign-in flow', async () => {
    const response = await fetch(`${baseUrl}/js/calculations.js`);
    const context = {};
    vm.runInNewContext(await response.text(), context);
    assert.equal(typeof context.loadPersonalDashboard, 'function');
});

test('shows auditors only their own submitted audits on the dashboard', async () => {
    const response = await fetch(`${baseUrl}/js/calculations.js`);
    const elements = new Map();
    const context = {
        currentUser: { email: 'auditor@example.com', role: 'auditor' },
        sharedSubmissions: [
            { auditorEmail: 'auditor@example.com', status: 'pending' },
            { auditorEmail: 'AUDITOR@example.com', status: 'approved' },
            { auditorEmail: 'auditor@example.com', status: 'draft' },
            { auditorEmail: 'another@example.com', status: 'pending' }
        ],
        normalizeEmail: email => String(email || '').trim().toLowerCase(),
        apiRequest: async () => ({
            personal: { totals: { auditCount: 99 }, recentAudits: [], reports: [] }
        }),
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '' });
                return elements.get(id);
            }
        },
        reportApiError: error => { throw error; }
    };
    context.isAdministrator = () => context.currentUser.role === 'admin';
    vm.runInNewContext(await response.text(), context);
    await context.loadPersonalDashboard();
    assert.equal(elements.get('dashboardAuditCount').textContent, '2');
});

test('skips personal dashboard loading when its widgets are removed', async () => {
    const response = await fetch(`${baseUrl}/js/calculations.js`);
    let requestCount = 0;
    const context = {
        currentUser: { email: 'auditor@example.com', role: 'auditor' },
        document: { getElementById: () => null },
        apiRequest: async () => { requestCount += 1; }
    };
    vm.runInNewContext(await response.text(), context);
    await context.loadPersonalDashboard();
    assert.equal(requestCount, 0);
});

test('allows credentialed API requests from the deployed Netlify origin', async () => {
    const preflight = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'OPTIONS',
        headers: {
            Origin: 'https://enertrackmo.netlify.app',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type'
        }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://enertrackmo.netlify.app');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);

    const session = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Origin: 'https://enertrackmo.netlify.app' }
    });
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('access-control-allow-origin'), 'https://enertrackmo.netlify.app');
    assert.equal(session.headers.get('access-control-allow-credentials'), 'true');
});

test('allows credentialed API requests from the GitHub Pages origin', async () => {
    const origin = 'https://reecevic24.github.io';
    const preflight = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type'
        }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

    const session = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Origin: origin }
    });
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('access-control-allow-origin'), origin);
    assert.equal(session.headers.get('access-control-allow-credentials'), 'true');
});

test('leaves anonymous sessions unauthenticated and protects private endpoints', async () => {
    const session = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { user: null });

    for (const route of ['/api/audits', '/api/dashboard', '/api/admin/audits', '/api/admin/users']) {
        const response = await fetch(`${baseUrl}${route}`);
        assert.equal(response.status, 401, `${route} requires a signed-in session`);
        assert.match((await response.json()).error, /log in/i);
    }

    const claimAdmin = await fetch(`${baseUrl}/api/auth/claim-admin`, { method: 'POST' });
    assert.equal(claimAdmin.status, 401, 'initial administrator setup requires a signed-in account');

    const roleChange = await fetch(`${baseUrl}/api/admin/users/00000000-0000-4000-8000-000000000001/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' })
    });
    assert.equal(roleChange.status, 401, 'account role approval requires authentication');

    const deleteResponse = await fetch(`${baseUrl}/api/audits/00000000-0000-4000-8000-000000000001`, {
        method: 'DELETE'
    });
    assert.equal(deleteResponse.status, 401, 'audit deletion requires a signed-in session');
    assert.match((await deleteResponse.json()).error, /log in/i);
});

test('rejects malformed login data before querying PostgreSQL', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid/i);
});

test('rejects registration passwords shorter than six characters before querying PostgreSQL', async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Test Auditor',
            regNo: 'TEST-001',
            email: 'test-auditor@example.com',
            password: 'abcde'
        })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid/i);
});

test('accepts a six-character registration password at the validation boundary', async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Test Auditor',
            regNo: 'TEST-002',
            email: 'not-an-email',
            password: 'abcdef'
        })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.deepEqual(body.details.map(issue => issue.field), ['email']);
});
