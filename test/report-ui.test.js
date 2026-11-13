'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repositoryRoot = path.resolve(__dirname, '..');

function createReportContext() {
    const nodes = {
        reportFacilitySelector: { value: '__all_facilities__' },
        facilitySelector: { value: '' },
        hostelName: { value: '' },
        hostelNameGroup: { style: {} },
        aiReportContent: { textContent: '' },
        reportPhotoGallery: {
            innerHTML: '',
            children: [],
            appendChild(child) {
                this.children.push(child);
            }
        }
    };
    const document = {
        getElementById(id) {
            return nodes[id];
        },
        createElement(tagName) {
            return { tagName, append() {} };
        }
    };
    const context = {
        document,
        alert(message) {
            throw new Error(message);
        },
        selectedFacility: '',
        selectedHostelName: '',
        DEFAULT_TARIFF_RATE: 12,
        DEFAULT_EMISSION_FACTOR: 0.05,
        audits: [
            {
                key: 'Library',
                facilityId: 'Library',
                status: 'approved',
                facilityInfo: { authorName: 'Auditor One' },
                energySettings: { tariffRate: 10, emissionFactor: 0.1 },
                inventory: [{ category: 'Lighting', name: 'LED', watts: 100, qty: 2, hours: 10 }],
                historicalData: [],
                photos: [],
                recommendations: ['Replace remaining fluorescent lamps.']
            },
            {
                key: 'Hostels:hostel a',
                facilityId: 'Hostels',
                hostelName: 'Hostel A',
                energySettings: { tariffRate: 20, emissionFactor: 0.05 },
                inventory: [{ category: 'Fans', name: 'Ceiling fan', watts: 200, qty: 1, hours: 5 }],
                historicalData: [],
                photos: [],
                recommendations: []
            }
        ],
        calculateInventoryTotals(items, tariff, emissionFactor) {
            const totals = { monthlyKwh: 0, monthlyCost: 0, monthlyCarbon: 0, activePowerKw: 0 };
            items.forEach(item => {
                item.monthlyKwh = item.watts * item.qty * item.hours * 30 / 1000;
                item.monthlyCost = item.monthlyKwh * tariff;
                item.monthlyCarbon = item.monthlyKwh * emissionFactor;
                totals.monthlyKwh += item.monthlyKwh;
                totals.monthlyCost += item.monthlyCost;
                totals.monthlyCarbon += item.monthlyCarbon;
                totals.activePowerKw += item.watts * item.qty / 1000;
            });
            return totals;
        }
    };
    vm.createContext(context);
    for (const file of ['js/audits.js', 'js/audit-evidence.js', 'js/audit-report.js']) {
        vm.runInContext(fs.readFileSync(path.join(repositoryRoot, file), 'utf8'), context, { filename: file });
    }
    return { context, nodes };
}

test('all-facilities report combines facility estimates and includes individual breakdowns', () => {
    const { context, nodes } = createReportContext();

    context.generateAuditReport();

    assert.match(nodes.aiReportContent.textContent, /ALL-FACILITIES ENERGY AUDIT REPORT/);
    assert.match(nodes.aiReportContent.textContent, /Facility audits included: 2/);
    assert.match(nodes.aiReportContent.textContent, /Estimated consumption: 90\.00 kWh\/month/);
    assert.match(nodes.aiReportContent.textContent, /Estimated cost: KES 1,200\.00\/month/);
    assert.match(nodes.aiReportContent.textContent, /Library/);
    assert.match(nodes.aiReportContent.textContent, /Hostels - Hostel A/);
    assert.match(nodes.aiReportContent.textContent, /Replace remaining fluorescent lamps/);
});

test('report page provides a facility selector and a print-facility selector', () => {
    const html = fs.readFileSync(path.join(repositoryRoot, 'index.html'), 'utf8');

    assert.match(html, /id="reportFacilitySelector"/);
    assert.match(html, /id="generateAuditReportButton"/);
    assert.match(html, /id="printFacilitySelector"/);
});

test('selecting a named hostel report activates that hostel audit', () => {
    const { context, nodes } = createReportContext();
    let activeAuditLoads = 0;
    context.loadActiveAudit = () => {
        activeAuditLoads += 1;
    };
    nodes.reportFacilitySelector.value = 'Hostels:hostel a';

    context.handleReportFacilitySelection();

    assert.equal(context.selectedFacility, 'Hostels');
    assert.equal(context.selectedHostelName, 'Hostel A');
    assert.equal(nodes.facilitySelector.value, 'Hostels:hostel a');
    assert.equal(nodes.hostelName.value, 'Hostel A');
    assert.equal(nodes.hostelNameGroup.style.display, 'flex');
    assert.equal(activeAuditLoads, 1);
});
