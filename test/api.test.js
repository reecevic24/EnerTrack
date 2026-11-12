'use strict';

process.env.SESSION_SECRET ||= 'test-only-session-secret-value-at-least-32-characters';
process.env.DATABASE_URL ||= 'postgres://enertrack:test@127.0.0.1:1/enertrack_test';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.FRONTEND_ORIGINS = 'https://enertrackmo.netlify.app';
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
    assert.match(pageText, /id="auditFindings"/);
    assert.match(pageText, /id="auditRecommendations"/);
    assert.match(pageText, /id="dashboardAuditCount"/);
    assert.match(pageText, /id="dashboardRecentAudits"/);
    assert.match(pageText, /id="dashboardReports"/);
    assert.match(pageText, /src="moi-university-campus\.jpeg"[^>]*class="campus-img"/);
    assert.match(pageText, /Only an administrator can approve administrator access/);
    assert.match(pageText, /id="floorArea"/);
    assert.match(pageText, /id="authorName"[^>]*readonly/);
    assert.match(pageText, /Enter registered email or Reg No\.\/ID/);
    assert.match(pageText, /id="loginFormView" style="display: none;">/);
    assert.match(pageText, /id="registerFormView">/);
    assert.match(pageText, /id="resetPasswordSubmit"[^>]*>Update password<\/button>/);
    assert.match(pageText, /id="resetPasswordGroup" class="form-group" style="display: none;/);
    assert.equal(client.status, 200);
    assert.match(await client.text(), /apiRequest\('\/auth\/login',/);
    assert.equal(config.status, 200);
    assert.match(await config.text(), /https:\/\/enertrack-1\.onrender\.com/);
    assert.equal(stylesheet.status, 200);
    assert.match(await stylesheet.text(), /\.site-header/);
    assert.equal(frontendScript.status, 200);
    assert.match(await frontendScript.text(), /credentials: 'include'/);
    assert.equal(campusImage.status, 200);
    assert.match(campusImage.headers.get('content-type'), /image\/jpeg/);
    assert.ok((await campusImage.arrayBuffer()).byteLength > 0);
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
