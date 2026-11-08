'use strict';

process.env.SESSION_SECRET ||= 'test-only-session-secret-value-at-least-32-characters';
process.env.DATABASE_URL ||= 'postgres://enertrack:test@127.0.0.1:1/enertrack_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/app');

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

test('serves the existing frontend and its API bridge', async () => {
    const [page, client, config] = await Promise.all([
        fetch(baseUrl),
        fetch(`${baseUrl}/client.js`),
        fetch(`${baseUrl}/api-config.js`)
    ]);
    assert.equal(page.status, 200);
    const pageText = await page.text();
    assert.match(pageText, /EnerTrack/);
    assert.match(pageText, /id="auditFindings"/);
    assert.match(pageText, /id="auditRecommendations"/);
    assert.match(pageText, /id="dashboardAuditCount"/);
    assert.match(pageText, /id="dashboardRecentAudits"/);
    assert.match(pageText, /id="dashboardReports"/);
    assert.doesNotMatch(pageText, /id="floorArea"|id="buildingType"/);
    assert.match(pageText, /id="authorName"[^>]*readonly/);
    assert.match(pageText, /Enter email or registration number/);
    assert.match(pageText, /id="loginFormView">/);
    assert.match(pageText, /id="registerFormView" style="display: none;">/);
    assert.match(pageText, /id="resetPasswordSubmit"[^>]*>Send reset link<\/button>/);
    assert.match(pageText, /id="resetPasswordGroup" style="display: none;/);
    assert.equal(client.status, 200);
    assert.match(await client.text(), /apiRequest\('\/auth\/login',/);
    assert.equal(config.status, 200);
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
