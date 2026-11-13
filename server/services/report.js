'use strict';

const { calculateInventoryTotals } = require('./energy');

const categoryActions = {
    Lighting: 'Review LED suitability, occupancy controls, and switching schedules',
    HVAC: 'Optimize cooling setpoints, servicing, and operating schedules',
    Motors: 'Service motors and pumps; assess suitable variable-speed controls',
    Electronics: 'Enable power management and switch off idle equipment'
};

function generateAuditReport(audit) {
    const inventory = audit.inventory || [];
    const history = audit.historicalData || [];
    const info = audit.facilityInfo || {};
    const tariff = Number(audit.tariffRate) || 0;
    const emissionFactor = Number(audit.emissionFactor) || 0;
    const totals = calculateInventoryTotals(inventory, tariff, emissionFactor);
    const categories = new Map();
    for (const item of inventory) {
        const dailyKwh = item.watts * item.qty * item.hours / 1000;
        const current = categories.get(item.category) || { dailyKwh: 0, monthlyKwh: 0 };
        current.dailyKwh += dailyKwh;
        current.monthlyKwh += dailyKwh * 30;
        categories.set(item.category, current);
    }
    const orderedCategories = Array.from(categories.entries()).sort((a, b) => b[1].monthlyKwh - a[1].monthlyKwh);
    const largest = inventory.reduce((result, item) => {
        const monthlyKwh = item.watts * item.qty * item.hours / 1000 * 30;
        return monthlyKwh > result.monthlyKwh ? { ...item, monthlyKwh } : result;
    }, { name: 'No equipment recorded', monthlyKwh: 0 });
    const largestShare = totals.monthlyKwh ? largest.monthlyKwh / totals.monthlyKwh * 100 : 0;
    const savingsTarget = Math.min(100, Math.max(0, Number(info.savingsTarget) || 0));
    const savedKwh = totals.monthlyKwh * savingsTarget / 100;
    const savedCost = savedKwh * tariff;
    const annualKwh = totals.monthlyKwh * 12;
    const annualCost = totals.monthlyCost * 12;
    const annualSavings = savedCost * 12;
    const averageHistoryKwh = history.length
        ? history.reduce((sum, item) => sum + item.kwh, 0) / history.length
        : null;
    const averageHistoryCost = history.length
        ? history.reduce((sum, item) => sum + item.cost, 0) / history.length
        : null;
    const reference = audit.reportReference || `ET-${(info.auditDate || new Date().toISOString().slice(0, 10))
        .replace(/-/g, '')}-${String(audit.key).replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`;
    const title = audit.facilityId === 'Hostels' && audit.hostelName
        ? `Hostels - ${audit.hostelName}`
        : audit.facilityId;
    const findings = [];
    if (inventory.length && largestShare >= 40) {
        findings.push(`${largest.name} represents ${largestShare.toFixed(1)}% of listed equipment energy; prioritize an efficiency and operating-schedule review.`);
    }
    if (categories.has('Lighting')) findings.push('Review lighting schedules, occupancy controls, and LED suitability.');
    if (categories.has('HVAC')) findings.push('Inspect cooling setpoints, filters, ventilation schedules, and HVAC maintenance.');
    if (categories.has('Motors')) findings.push('Inspect motor and pump alignment, maintenance, and operating schedules.');
    if (categories.has('Electronics')) findings.push('Enable power management and switch off idle electronics.');
    if (!history.length) findings.push('Collect monthly utility bills or meter readings to establish and validate a historical baseline.');
    if (!findings.length) findings.push('Verify the equipment inventory against site measurements and continue routine energy monitoring.');
    const auditorFindings = String(audit.findings || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    findings.push(...auditorFindings.map(item => `Auditor finding: ${item}`));

    const equipmentLines = inventory.map(item => {
        const monthlyKwh = item.watts * item.qty * item.hours / 1000 * 30;
        const dailyKwh = monthlyKwh / 30;
        const share = totals.monthlyKwh ? monthlyKwh / totals.monthlyKwh * 100 : 0;
        return `- ${item.name} (${item.category}), quantity ${item.qty}, ${item.watts} W each, ${item.hours} hours/day; ${dailyKwh.toFixed(2)} kWh/day, ${monthlyKwh.toFixed(2)} kWh/month (${share.toFixed(1)}%).`;
    });
    const categoryLines = orderedCategories.map(([name, value]) => {
        const share = totals.monthlyKwh ? value.monthlyKwh / totals.monthlyKwh * 100 : 0;
        return `- ${name}: ${value.dailyKwh.toFixed(2)} kWh/day; ${value.monthlyKwh.toFixed(2)} kWh/month; ${share.toFixed(1)}% of estimated use.`;
    });
    const recommendationLines = orderedCategories.map(([category, value], index) => {
        const share = totals.monthlyKwh ? value.monthlyKwh / totals.monthlyKwh : 0;
        const allocatedSaving = savedKwh * share;
        const priority = share >= 0.3 ? 'High' : 'Medium';
        const timeline = priority === 'High' ? 'Immediate to 1 month' : 'Within 3 months';
        return `${index + 1}. ${categoryActions[category] || `Review ${category} operating schedules and maintenance`} — Priority: ${priority}; Timeline: ${timeline}. Planning allocation: ${allocatedSaving.toFixed(2)} kWh/month and KES ${(allocatedSaving * tariff).toFixed(2)}/month.`;
    });
    const auditorRecommendations = Array.isArray(audit.recommendations) ? audit.recommendations : [];
    recommendationLines.push(...auditorRecommendations.map((item, index) =>
        `${recommendationLines.length + index + 1}. Auditor recommendation: ${item}`
    ));

    return [
        'ENERTRACK | ENERGY AUDIT REPORT',
        '1. COVER PAGE',
        'Institution: Moi University',
        `Facility: ${title}`,
        `Physical location: ${info.facilityLocation || 'Not recorded'}`,
        `Date of audit: ${info.auditDate || 'Not recorded'}`,
        `Auditor: ${info.authorName || audit.auditorName || 'Not recorded'}`,
        `Report reference: ${reference}`,
        '',
        '2. EXECUTIVE SUMMARY',
        `Estimated consumption is ${totals.monthlyKwh.toFixed(2)} kWh/month (${annualKwh.toFixed(2)} kWh/year). Estimated expenditure is KES ${totals.monthlyCost.toFixed(2)}/month and KES ${annualCost.toFixed(2)}/year at KES ${tariff.toFixed(2)}/kWh.`,
        `Estimated emissions are ${totals.monthlyCarbon.toFixed(2)} kg CO2e/month. The largest listed load is ${largest.name} (${largestShare.toFixed(1)}% of the equipment-based estimate).`,
        `Illustrative savings target: ${savingsTarget.toFixed(1)}%, or ${savedKwh.toFixed(2)} kWh/month and KES ${savedCost.toFixed(2)}/month. This is a planning scenario, not a measured or guaranteed saving.`,
        `Key findings: ${findings.slice(0, 4).join(' ')}`,
        '',
        '3. INTRODUCTION AND BACKGROUND',
        `Background: ${info.background || 'No additional facility background was supplied.'}`,
        'Objectives: establish an equipment-based baseline, identify major loads, and develop prioritized conservation actions.',
        '',
        '4. FACILITY INFORMATION',
        `Facility: ${title}`,
        `Location: ${info.facilityLocation || 'Not recorded'}`,
        `Operating hours: ${info.operatingHours ? `${info.operatingHours} hours/day` : 'Not recorded'}`,
        `Occupants/users: ${info.occupants || 'Not recorded'}`,
        `Energy sources: ${info.energySources || 'Not recorded'}`,
        '',
        '5. ENERGY CONSUMPTION ANALYSIS',
        `Equipment-based estimate: ${totals.monthlyKwh.toFixed(2)} kWh/month; KES ${totals.monthlyCost.toFixed(2)}/month.`,
        `Annualized estimate: ${annualKwh.toFixed(2)} kWh/year; KES ${annualCost.toFixed(2)}/year. This assumes a representative month, not historical bills.`,
        `Historical utility data: ${history.length} month(s); ${averageHistoryKwh === null ? 'unavailable' : `average ${averageHistoryKwh.toFixed(2)} kWh/month and KES ${averageHistoryCost.toFixed(2)}/month`}.`,
        ...history.map(item => `- ${item.month}: ${item.kwh.toFixed(2)} kWh; KES ${item.cost.toFixed(2)}.`),
        '',
        '6. EQUIPMENT AND ENERGY USAGE ASSESSMENT',
        `Equipment entries: ${inventory.length}. Estimated connected load: ${totals.activePowerKw.toFixed(2)} kW; this is not measured peak demand.`,
        ...(equipmentLines.length ? equipmentLines : ['No equipment inventory was provided.']),
        'Category consumption:',
        ...(categoryLines.length ? categoryLines : ['No category consumption was calculated.']),
        '',
        '7. ENERGY PERFORMANCE ASSESSMENT',
        `Largest individual load: ${largest.name}, ${largest.monthlyKwh.toFixed(2)} kWh/month (${largestShare.toFixed(1)}%).`,
        `Estimated daily consumption: ${(totals.monthlyKwh / 30).toFixed(2)} kWh/day.`,
        'Power factor, measured maximum demand, actual equipment efficiency, and meter-level load distribution were not collected.',
        '',
        '8. IDENTIFIED ENERGY CONSERVATION OPPORTUNITIES',
        ...findings.map((item, index) => `${index + 1}. ${item}`),
        '',
        '9. ESTIMATED ENERGY AND COST SAVINGS',
        `Auditor-entered planning target: ${savingsTarget.toFixed(1)}%; an assumption, not a measured saving.`,
        `Current estimated consumption: ${totals.monthlyKwh.toFixed(2)} kWh/month.`,
        `Expected consumption at target: ${(totals.monthlyKwh - savedKwh).toFixed(2)} kWh/month.`,
        `Potential energy saving: ${savedKwh.toFixed(2)} kWh/month; ${(savedKwh * 12).toFixed(2)} kWh/year.`,
        `Potential cost saving: KES ${savedCost.toFixed(2)}/month; KES ${annualSavings.toFixed(2)}/year.`,
        'Planning figures only; confirm against a measured baseline, site operating conditions, implementation costs, and applicable tariffs.',
        '',
        '10. RECOMMENDATIONS AND ACTION PLAN',
        ...(recommendationLines.length ? recommendationLines : ['Verify equipment inventory and optimize operating schedules — Priority: Medium; Timeline: Within 3 months.']),
        'Implementation costs and payback periods were not provided and are not estimated.',
        '',
        '11. CONCLUSION',
        `The inventory-based estimate is ${totals.monthlyKwh.toFixed(2)} kWh/month. Verify inputs against utility bills and site measurements before implementing recommendations.`,
        '',
        '12. APPENDICES',
        `A. Equipment inventory: ${inventory.length} item(s).`,
        `B. Historical bills: ${history.length} month(s).`,
        `C. Audit photographs: ${(audit.photos || []).length} photo(s) attached to this audit.`,
        'D. Calculation basis: daily kWh = watts x quantity x hours/day / 1,000; monthly estimate = daily estimate x 30; annualized estimate = monthly estimate x 12.',
        '',
        'REPORT LIMITATIONS',
        'This data-driven draft uses auditor-entered data and deterministic calculations. It is not a connected language-model assessment. Review findings and savings against site measurements before relying on them.'
    ].join('\n');
}

module.exports = { generateAuditReport };
