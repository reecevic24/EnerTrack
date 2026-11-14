'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repositoryRoot = path.resolve(__dirname, '..');

function createReportContext() {
    const reportOptions = [];
    const nodes = {
        reportFacilitySelector: {
            _value: '__all_facilities__',
            options: reportOptions,
            set innerHTML(value) {
                if (value === '') this.options.length = 0;
            },
            get innerHTML() {
                return '';
            },
            set value(value) {
                this._value = value;
            },
            get value() {
                return this._value;
            },
            appendChild(option) {
                this.options.push(option);
            }
        },
        facilitySelector: { value: '' },
        hostelName: { value: '' },
        hostelNameGroup: { style: {} },
        generateAuditReportButton: { disabled: false },
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
        currentUser: null,
        facilityNames: ['Library', 'Hostels', 'Annex'],
        createDefaultEnergySettings() {
            return { tariffRate: 12, emissionFactor: 0.05 };
        },
        DEFAULT_TARIFF_RATE: 12,
        DEFAULT_EMISSION_FACTOR: 0.05,
        currentTariffRate: () => 12,
        currentEmissionFactor: () => 0.05,
        getUniversityEnergySummary: () => ({
            summaries: [],
            totals: { kwh: 90, cost: 1200, carbon: 4.5 }
        }),
        audits: [
            {
                id: 'library-audit',
                key: 'Library',
                facilityId: 'Library',
                status: 'approved',
                auditorName: 'Auditor One',
                facilityInfo: { authorName: 'Auditor One' },
                energySettings: { tariffRate: 10, emissionFactor: 0.1 },
                inventory: [{ category: 'Lighting', name: 'LED', watts: 100, qty: 2, hours: 10 }],
                historicalData: [],
                photos: [],
                recommendations: ['Replace remaining fluorescent lamps.']
            },
            {
                id: 'hostel-audit',
                key: 'Hostels:hostel a',
                facilityId: 'Hostels',
                hostelName: 'Hostel A',
                auditorName: 'Auditor Two',
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

test('all-facilities report shows university totals without auditor or facility details', () => {
    const { context, nodes } = createReportContext();

    context.generateAuditReport();

    assert.match(nodes.aiReportContent.textContent, /GROSS CAMPUS UNIVERSITY ENERGY REPORT/);
    assert.match(nodes.aiReportContent.textContent, /Energy consumption: 90\.00 kWh/);
    assert.match(nodes.aiReportContent.textContent, /Energy cost: KES 1,200\.00/);
    assert.match(nodes.aiReportContent.textContent, /Carbon emissions: 4\.50 kg CO₂e/);
    assert.doesNotMatch(nodes.aiReportContent.textContent, /Auditor|Library|Hostel A|RECOMMENDATIONS/i);
    assert.equal(nodes.reportPhotoGallery.innerHTML, '');
});

test('report page provides a facility selector and a print-facility selector', () => {
    const html = fs.readFileSync(path.join(repositoryRoot, 'index.html'), 'utf8');

    assert.match(html, /id="reportFacilitySelector"/);
    assert.match(html, /id="generateAuditReportButton"/);
    assert.match(html, /id="printFacilitySelector"/);
    assert.match(html, /id="printHeaderUserLabel">Auditor/);
});

test('university breakdown print header shows the print date instead of the auditor name', async () => {
    const callbacks = {};
    const nodes = {
        printHeaderUserLabel: { textContent: 'Auditor' },
        printHeaderUserName: { textContent: 'Auditor One' }
    };
    const bodyClasses = new Set();
    const context = {
        document: {
            body: {
                classList: {
                    add(className) { bodyClasses.add(className); },
                    remove(className) { bodyClasses.delete(className); }
                }
            },
            getElementById(id) { return nodes[id] || null; }
        },
        window: {
            addEventListener(eventName, callback) { callbacks[eventName] = callback; },
            print() {}
        },
        requestAnimationFrame(callback) { callback(); },
        updateUniversitySummary() {}
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(repositoryRoot, 'js/ui.js'), 'utf8'), context);

    await context.downloadUniversityBreakdown();

    assert.equal(nodes.printHeaderUserLabel.textContent, 'Date of print');
    assert.equal(nodes.printHeaderUserName.textContent, new Date().toLocaleDateString());
    assert.equal(bodyClasses.has('print-university-breakdown'), true);

    callbacks.afterprint();

    assert.equal(nodes.printHeaderUserLabel.textContent, 'Auditor');
    assert.equal(nodes.printHeaderUserName.textContent, 'Auditor One');
    assert.equal(bodyClasses.has('print-university-breakdown'), false);
});

test('administrator report selector lists every audit and available facility distinctly', () => {
    const { context, nodes } = createReportContext();
    context.currentUser = { role: 'admin' };
    context.audits.push({
        id: 'second-library-audit',
        key: 'Library',
        facilityId: 'Library',
        auditorName: 'Auditor Three',
        inventory: [{ category: 'Fans', name: 'Desk fan', watts: 30, qty: 1, hours: 2 }],
        facilityInfo: {},
        historicalData: [],
        photos: [],
        recommendations: []
    });
    context.audits.push({
        id: null,
        key: 'Annex',
        facilityId: 'Annex',
        inventory: [],
        facilityInfo: {},
        historicalData: [],
        photos: [],
        recommendations: []
    });

    context.initializeReportFacilitySelector();

    const values = nodes.reportFacilitySelector.options.map(option => option.value);
    const labels = nodes.reportFacilitySelector.options.map(option => option.textContent);
    assert.ok(values.includes('audit:library-audit'));
    assert.ok(values.includes('audit:second-library-audit'));
    assert.ok(values.includes('facility:Annex'));
    assert.ok(labels.includes('Library — Auditor One'));
    assert.ok(labels.includes('Library — Auditor Three'));
    assert.ok(labels.includes('All facilities and audits'));
    assert.equal(nodes.generateAuditReportButton.disabled, false);
});

test('administrator all-facilities report contains only university totals', () => {
    const { context, nodes } = createReportContext();
    context.currentUser = { role: 'admin' };

    context.generateAuditReport();

    assert.match(nodes.aiReportContent.textContent, /Energy consumption: 90\.00 kWh/);
    assert.doesNotMatch(nodes.aiReportContent.textContent, /Auditor|Annex|FACILITY DETAILS/i);
});

test('administrator can generate a report for the audit selected by its unique ID', () => {
    const { context, nodes } = createReportContext();
    context.currentUser = { role: 'admin', name: 'Admin' };
    context.audits.push({
        id: 'second-library-audit',
        key: 'Library',
        facilityId: 'Library',
        status: 'submitted',
        auditorName: 'Auditor Three',
        auditorEmail: 'auditor.three@example.com',
        facilityInfo: { authorName: 'Auditor Three' },
        energySettings: { tariffRate: 12, emissionFactor: 0.05 },
        inventory: [{ category: 'Fans', name: 'Desk fan', watts: 30, qty: 1, hours: 2 }],
        historicalData: [],
        photos: [],
        recommendations: []
    });
    context.updateUniversitySummary = () => {};
    context.updateFacilityLabels = () => {};
    context.updateCharts = () => {};
    context.getUniversityEnergySummary = () => ({
        summaries: [],
        totals: { kwh: 0, cost: 0, carbon: 0 }
    });
    context.saveAudits = () => {};
    context.updateAuditReportDisplay = record => {
        nodes.aiReportContent.textContent = record.report;
    };
    context.loadRecommendations = [];
    context.AUDIT_REPORT_VERSION = 5;

    nodes.reportFacilitySelector.value = 'audit:second-library-audit';
    context.handleReportFacilitySelection();
    context.generateAuditReport();

    assert.match(nodes.aiReportContent.textContent, /Desk fan/);
    assert.match(nodes.aiReportContent.textContent, /Auditor Three/);
    assert.doesNotMatch(nodes.aiReportContent.textContent, /LED/);
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
