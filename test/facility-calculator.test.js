'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repositoryRoot = path.resolve(__dirname, '..');

test('administrator equipment calculations stay separate from saved audit inventory', () => {
    const inventory = [{ category: 'Lighting', name: 'Saved light', watts: 20, qty: 1, hours: 2 }];
    const audit = { inventory, report: 'Saved report' };
    const fields = {
        equipmentCategory: { value: 'HVAC' },
        equipment: { value: 'Test air conditioner' },
        wattage: { value: '1200' },
        availableNumber: { value: '2' },
        operatingHours: { value: '5' },
        auditForm: { resetCalled: false, reset() { this.resetCalled = true; } },
        adminEquipmentCalculator: { hidden: true },
        adminCalculationBody: {
            rows: [],
            set innerHTML(value) {
                if (value === '') this.rows = [];
            },
            appendChild(row) {
                this.rows.push(row);
            }
        },
        adminCalculationSummary: { textContent: '' }
    };
    const context = {
        document: {
            getElementById(id) {
                return fields[id];
            },
            createElement() {
                return {
                    children: [],
                    appendChild(child) {
                        this.children.push(child);
                    }
                };
            }
        },
        isAdministrator: () => true,
        currentTariffRate: () => 12,
        currentEmissionFactor: () => 0.05,
        calculateInventoryTotals(items, tariff, emissionFactor) {
            const totals = { monthlyKwh: 0, monthlyCost: 0, monthlyCarbon: 0 };
            items.forEach(item => {
                item.monthlyKwh = item.watts * item.qty * item.hours * 30 / 1000;
                item.monthlyCost = item.monthlyKwh * tariff;
                item.monthlyCarbon = item.monthlyKwh * emissionFactor;
                totals.monthlyKwh += item.monthlyKwh;
                totals.monthlyCost += item.monthlyCost;
                totals.monthlyCarbon += item.monthlyCarbon;
            });
            return totals;
        },
        alert(message) {
            throw new Error(message);
        },
        inventory,
        audits: [audit],
        adminCalculationItems: []
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(repositoryRoot, 'js', 'audits.js'), 'utf8'),
        context,
        { filename: 'js/audits.js' }
    );

    context.addEquipment();

    assert.equal(context.adminCalculationItems.length, 1);
    assert.equal(context.adminCalculationItems[0].monthlyKwh, 360);
    assert.equal(fields.adminCalculationSummary.textContent.includes('360.00 kWh/month'), true);
    assert.equal(fields.adminCalculationBody.rows.length, 1);
    assert.equal(fields.auditForm.resetCalled, true);
    assert.equal(context.inventory, inventory);
    assert.deepEqual(inventory, [{ category: 'Lighting', name: 'Saved light', watts: 20, qty: 1, hours: 2 }]);
    assert.equal(audit.inventory, inventory);
    assert.equal(audit.report, 'Saved report');
});
