'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateInventoryTotals } = require('../server/services/energy');
const { generateAuditReport } = require('../server/services/report');
const { buildAuditPdf } = require('../server/services/pdf');

test('calculates daily-equipment-based monthly energy, cost, emissions, and connected load', () => {
    const result = calculateInventoryTotals([
        { watts: 30, qty: 20, hours: 10 },
        { watts: 100, qty: 2, hours: 5 }
    ], 12, 0.05);

    assert.deepEqual(result, {
        monthlyKwh: 210,
        monthlyCost: 2520,
        monthlyCarbon: 10.5,
        activePowerKw: 0.8
    });
});

test('returns zero totals for an empty inventory', () => {
    assert.deepEqual(calculateInventoryTotals([], 12, 0.05), {
        monthlyKwh: 0,
        monthlyCost: 0,
        monthlyCarbon: 0,
        activePowerKw: 0
    });

    test('generates the twelve data-driven report sections and uses saved audit readings', () => {
        const report = generateAuditReport({
            key: 'Tech Building',
            facilityId: 'Tech Building',
            auditorName: 'Test Auditor',
            facilityInfo: { auditDate: '2026-11-06', savingsTarget: 10 },
            tariffRate: 12,
            emissionFactor: 0.05,
            inventory: [{ category: 'Lighting', name: 'LED', watts: 30, qty: 20, hours: 10 }],
            historicalData: [{ month: '2026-10', kwh: 1200, cost: 14400 }],
            photos: [{ id: 'photo-1' }]
        });

        test('creates a PDF file from the generated audit report', async () => {
            const pdf = await buildAuditPdf({ reportReference: 'ET-TEST' }, 'ENERTRACK | ENERGY AUDIT REPORT\n1. COVER PAGE\nFacility: Test');
            assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')));
            assert.ok(pdf.length > 500);
        });

        for (let section = 1; section <= 12; section += 1) {
            assert.ok(report.includes(`${section}. `), `report includes section ${section}`);
        }
        assert.match(report, /180\.00 kWh\/month/);
        assert.match(report, /1200\.00 kWh\/month/);
        assert.match(report, /Audit photographs: 1 photo/);
        assert.match(report, /not a connected language-model assessment/i);
    });
});
