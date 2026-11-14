'use strict';

process.env.SESSION_SECRET ||= 'test-only-session-secret-value-at-least-32-characters';
process.env.DATABASE_URL ||= 'postgres://enertrack:test@127.0.0.1:1/enertrack_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
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
    assert.match(pageText, /id="submitAuditForApprovalButton" class="btn-action btn-green-hover"/);
    assert.match(pageText, /To submit this audit for approval, add at least one equipment recommendation\./);
    assert.match(pageText, /id="auditDate" readonly aria-readonly="true"/);
    assert.match(pageText, /btn-action btn-green-hover" type="button" onclick="addEquipmentDetail\('actual'\)"/);
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
    const stylesheetText = await stylesheet.text();
    assert.match(stylesheetText, /\.site-header/);
    assert.match(stylesheetText, /\.btn-green-hover:not\(:disabled\):hover\s*\{\s*background:\s*#16a34a/);
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

test('prevents adding equipment to or resubmitting an approved facility audit', async () => {
    const [submissionResponse, auditResponse] = await Promise.all([
        fetch(`${baseUrl}/js/submissions.js`),
        fetch(`${baseUrl}/js/audits.js`)
    ]);
    const item = { id: 'existing-item', category: 'Lighting', name: 'LED', watts: 30, qty: 4, hours: 8 };
    const record = { id: 'audit-1', key: 'Library', status: 'approved', inventory: [item] };
    const alerts = [];
    const context = {
        currentUser: { role: 'auditor' },
        selectedFacility: 'Library',
        selectedHostelName: '',
        audits: [record],
        inventory: [item],
        sharedSubmissions: [{ id: 'audit-1', auditKey: 'Library', status: 'approved' }],
        isAdministrator: () => false,
        alert: message => alerts.push(message)
    };
    vm.createContext(context);
    vm.runInContext(await submissionResponse.text(), context);
    vm.runInContext(await auditResponse.text(), context);

    await context.addEquipment();
    await context.submitCurrentAudit();

    assert.equal(record.status, 'approved');
    assert.equal(record.inventory.length, 1);
    assert.deepEqual(alerts, ['Facility already approved', 'Facility already approved']);
});

test('allows administrators to open the Conservation page', async () => {
    const response = await fetch(`${baseUrl}/js/auth.js`);
    const pages = new Map();
    const tabs = new Map();
    const createNavigationElement = () => ({
        active: false,
        classList: {
            add(name) { if (name === 'active') this.owner.active = true; },
            remove(name) { if (name === 'active') this.owner.active = false; },
            owner: null
        }
    });
    const createElement = () => {
        const element = createNavigationElement();
        element.classList.owner = element;
        return element;
    };
    ['pageDashboard', 'pageFacilities', 'pageUniversity', 'pageAudit', 'pageMeasures', 'pageProfiles']
        .forEach(id => pages.set(id, createElement()));
    ['tabDashboard', 'tabFacilities', 'tabUniversity', 'tabAudit', 'tabMeasures', 'tabProfiles']
        .forEach(id => tabs.set(id, createElement()));
    let equipmentRenders = 0;
    const context = {
        currentUser: { role: 'admin' },
        document: {
            querySelectorAll(selector) {
                return Array.from(selector === '.page-view' ? pages.values() : tabs.values());
            },
            getElementById(id) {
                return pages.get(id) || tabs.get(id);
            }
        },
        renderEquipmentDetails() {
            equipmentRenders += 1;
        }
    };
    vm.runInNewContext(await response.text(), context);

    context.switchPage('measures');

    assert.equal(pages.get('pageMeasures').active, true);
    assert.equal(tabs.get('tabMeasures').active, true);
    assert.equal(equipmentRenders, 1);
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

test('prevents auditors from deleting equipment while an audit is pending approval', async () => {
    const [submissionResponse, auditResponse, inventoryResponse] = await Promise.all([
        fetch(`${baseUrl}/js/submissions.js`),
        fetch(`${baseUrl}/js/audits.js`),
        fetch(`${baseUrl}/js/inventory-charts.js`)
    ]);
    const item = {
        id: 'equipment-1',
        category: 'Lighting',
        name: 'LED',
        watts: 30,
        qty: 1,
        hours: 8,
        dailyKwh: 0.24,
        monthlyKwh: 7.2,
        monthlyCost: 86.4,
        monthlyCarbon: 0.36
    };
    const record = { id: 'audit-1', key: 'Library', inventory: [item] };
    const alerts = [];
    const elements = new Map([
        ['inventoryActionHeader', { style: {} }],
        ['inventoryBody', {
            rows: [],
            set innerHTML(value) {
                if (value === '') this.rows = [];
            },
            appendChild(row) { this.rows.push(row); }
        }]
    ]);
    const context = {
        currentUser: { role: 'auditor' },
        selectedFacility: 'Library',
        selectedHostelName: '',
        audits: [record],
        facilityNames: ['Library'],
        inventory: record.inventory,
        sharedSubmissions: [{ id: 'audit-1', auditKey: 'Library', status: 'pending' }],
        apiRequest: async () => ({
            audits: [{
                id: 'audit-1',
                key: 'Library',
                facilityId: 'Library',
                status: 'pending',
                inventory: [item],
                historicalData: [],
                photos: []
            }]
        }),
        document: {
            getElementById: id => elements.get(id),
            createElement: () => ({
                children: [],
                appendChild(child) { this.children.push(child); },
                addEventListener() {}
            })
        },
        getCurrentAudit: () => record,
        loadSharedSubmissions: async () => {},
        updateSubmissionStatus() {},
        saveUserData() { throw new Error('Pending audit must not be saved after deletion.'); },
        calculateAll() {},
        updateAuditReportDisplay() {},
        reportApiError(error) { throw error; },
        alert: message => alerts.push(message)
    };
    vm.createContext(context);
    vm.runInContext(await submissionResponse.text(), context);
    vm.runInContext(await auditResponse.text(), context);
    vm.runInContext(await inventoryResponse.text(), context);

    context.renderInventoryTable();
    await context.deleteItem('equipment-1');

    assert.equal(elements.get('inventoryActionHeader').style.display, 'none');
    assert.equal(elements.get('inventoryBody').rows[0].children.length, 9);
    assert.equal(record.inventory.length, 1);
    assert.match(alerts[0], /submitted for approval cannot be deleted/i);
});

test('approval confirmation names Gross Campus Monthly Energy', async () => {
    const response = await fetch(`${baseUrl}/js/admin-review.js`);
    const confirmations = [];
    const alerts = [];
    const context = {
        currentUser: { role: 'admin' },
        sharedSubmissions: [],
        API_BASE: '',
        isAdministrator: () => true,
        confirm: message => {
            confirmations.push(message);
            return true;
        },
        apiRequest: async () => ({ audit: { id: 'audit-1', status: 'approved' } }),
        replaceSubmission() {},
        renderInventoryTable() {},
        saveSharedSubmissions() {},
        alert: message => alerts.push(message)
    };
    vm.runInNewContext(await response.text(), context);

    await context.approveSubmission('audit-1');

    assert.match(confirmations[0], /Gross Campus Monthly Energy/);
    assert.equal(alerts[0], 'Audit approved. It is now included in Gross Campus Monthly Energy.');
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

test('preserves each audit status and review metadata when background saves update audit data', () => {
    const auditRoutes = fs.readFileSync(require.resolve('../server/routes/audits'), 'utf8');

    assert.match(auditRoutes, /status = COALESCE\(\$5, audits\.status\)/);
    assert.doesNotMatch(auditRoutes, /CASE WHEN audits\.status = 'discarded' THEN 'draft' ELSE 'pending' END/);
    assert.doesNotMatch(auditRoutes, /reviewed_at = CASE WHEN \$5 IS NOT NULL THEN audits\.reviewed_at ELSE NULL END/);
    assert.doesNotMatch(auditRoutes, /reviewed_by = CASE WHEN \$5 IS NOT NULL THEN audits\.reviewed_by ELSE NULL END/);
    assert.match(auditRoutes, /current\.rows\[0\]\.status === 'approved'[\s\S]*Facility already approved/);
    assert.match(auditRoutes, /status <> 'approved' RETURNING id/);
    assert.match(auditRoutes, /audit\.rows\[0\]\.status === 'approved'[\s\S]*Facility already approved/);
    assert.match(auditRoutes, /pg_advisory_xact_lock\(hashtext\(\$1\), hashtext\(\$2\)\)/);
    assert.match(auditRoutes, /status IN \('pending', 'approved'\)/);
    assert.match(auditRoutes, /AND status = 'approved'[\s\S]*LIMIT 1/);
});

test('skips approved audits during background saves without blocking other facilities', async () => {
    const response = await fetch(`${baseUrl}/js/audit-sync.js`);
    const alreadyApproved = { id: 'approved-audit', status: 'approved' };
    const newlyApproved = { id: 'newly-approved-audit', status: 'pending' };
    const editable = { id: 'editable-audit', status: 'pending' };
    const attempts = [];
    const alerts = [];
    const context = {
        currentUser: { role: 'auditor' },
        audits: [alreadyApproved, newlyApproved, editable],
        alert: message => alerts.push(message),
        loadPersonalDashboard: async () => {}
    };
    vm.runInContext(await response.text(), vm.createContext(context));
    context.persistAuditRecord = async record => {
        attempts.push(record.id);
        if (record === newlyApproved) {
            const error = new Error('Facility already approved');
            error.status = 409;
            throw error;
        }
    };

    await context.putAudits(0);

    assert.deepEqual(attempts, ['newly-approved-audit', 'editable-audit']);
    assert.equal(newlyApproved.status, 'approved');
    assert.deepEqual(alerts, ['Facility already approved']);
});

test('lets administrators select each auditor audit independently in the facility view', async () => {
    const response = await fetch(`${baseUrl}/js/audits.js`);
    const elements = new Map();
    const document = {
        createElement: () => ({ value: '', textContent: '' }),
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, {
                    value: '',
                    innerHTML: '',
                    style: {},
                    children: [],
                    appendChild(option) { this.children.push(option); }
                });
            }
            return elements.get(id);
        }
    };
    const context = {
        currentUser: { role: 'admin' },
        selectedFacility: '',
        selectedHostelName: '',
        selectedAdminAuditId: 'audit-2',
        isAdministrator: () => true,
        facilityNames: ['Science Block'],
        audits: [
            { id: 'audit-1', key: 'Science Block', facilityId: 'Science Block', status: 'approved', auditorName: 'Auditor One', auditorEmail: 'one@example.com' },
            { id: 'audit-2', key: 'Science Block', facilityId: 'Science Block', status: 'discarded', auditorName: 'Auditor Two', auditorEmail: 'two@example.com' }
        ],
        document,
        alert() {}
    };
    vm.runInNewContext(await response.text(), context);
    context.initializeReportFacilitySelector = () => {};
    context.loadActiveAudit = () => {};

    context.initializeFacilitySelector();
    const facilitySelector = elements.get('facilitySelector');
    assert.deepEqual(facilitySelector.children.map(option => option.value), ['', 'audit-1', 'audit-2']);
    assert.equal(facilitySelector.value, 'audit-2');
    assert.match(facilitySelector.children[2].textContent, /Auditor Two/);

    facilitySelector.value = 'audit-1';
    context.handleFacilitySelection();
    assert.equal(context.selectedAdminAuditId, 'audit-1');
    assert.equal(context.getCurrentAudit().auditorName, 'Auditor One');
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
        renderEquipmentDetails() {},
        document: {
            querySelectorAll: () => [],
            getElementById: id => ({ classList: { add: () => activated.push(id) } })
        }
    };
    vm.runInNewContext(await response.text(), context);

    context.switchPage('facilities');
    assert.deepEqual(activated, ['pageFacilities', 'tabFacilities']);
    context.switchPage('measures');
    assert.deepEqual(activated, ['pageFacilities', 'tabFacilities', 'pageMeasures', 'tabMeasures']);

    context.switchPage('university');
    assert.deepEqual(activated, [
        'pageFacilities', 'tabFacilities', 'pageMeasures', 'tabMeasures', 'pageUniversity', 'tabUniversity'
    ]);
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
