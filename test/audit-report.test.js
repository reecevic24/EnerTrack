'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateAuditReport } = require('../server/services/report');

test('includes auditor-entered findings and recommendations in generated reports', () => {
    const report = generateAuditReport({
        key: 'Tech Building',
        facilityId: 'Tech Building',
        facilityInfo: { auditDate: '2026-11-06', savingsTarget: 10 },
        tariffRate: 12,
        emissionFactor: 0.05,
        inventory: [{ category: 'Lighting', name: 'LED', watts: 30, qty: 20, hours: 10 }],
        historicalData: [],
        findings: 'Several lights remain on after occupancy hours.\nThe west wing has high daytime lighting use.',
        recommendations: ['Install occupancy sensors in low-traffic corridors.']
    });

    assert.match(report, /Auditor finding: Several lights remain on after occupancy hours\./);
    assert.match(report, /Auditor finding: The west wing has high daytime lighting use\./);
    assert.match(report, /Auditor recommendation: Install occupancy sensors in low-traffic corridors\./);
    assert.doesNotMatch(report, /Floor area:|Building type:/);
});
