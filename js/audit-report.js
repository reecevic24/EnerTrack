function generateAuditReport() {
    const reportSelection = document.getElementById('reportFacilitySelector').value;
    if (reportSelection === ALL_FACILITIES_REPORT) {
        generateAllFacilitiesReport();
        return;
    }
    if (!reportSelection || !selectedFacility) {
        alert('Select a facility or All facilities before generating a report.');
        return;
    }
    if (selectedFacility === 'Hostels' && !selectedHostelName) {
        generateHostelsAggregateReport();
        return;
    }

    const record = getCurrentAudit(false);
    if (!record || !Array.isArray(inventory) || !inventory.length) {
        alert('Add at least one equipment item to this facility audit before generating a report.');
        return;
    }
    if (inventory.some(item => !item
        || typeof item.name !== 'string' || !item.name.trim()
        || typeof item.category !== 'string' || !item.category.trim()
        || !Number.isFinite(Number(item.watts)) || Number(item.watts) <= 0
        || !Number.isInteger(Number(item.qty)) || Number(item.qty) < 1
        || !Number.isFinite(Number(item.hours)) || Number(item.hours) < 0 || Number(item.hours) > 24)) {
        alert('The equipment inventory contains incomplete or invalid values. Correct the equipment details before generating the report.');
        return;
    }
    const historicalEntries = Array.isArray(record.historicalData) ? record.historicalData : [];
    if (historicalEntries.some(entry => !entry
        || typeof entry.month !== 'string' || !/^\d{4}-\d{2}$/.test(entry.month)
        || Number(entry.month.slice(5)) < 1 || Number(entry.month.slice(5)) > 12
        || !Number.isFinite(Number(entry.kwh)) || Number(entry.kwh) < 0
        || !Number.isFinite(Number(entry.cost)) || Number(entry.cost) < 0)) {
        alert('The utility bill history contains incomplete or invalid values. Correct the billing data before generating the report.');
        return;
    }

    const tariff = parseFloat(document.getElementById('tariffRate').value) || 12;
    const emissionFactor = parseFloat(document.getElementById('emissionFactor').value) || 0.05;
    const totals = calculateInventoryTotals(inventory, tariff, emissionFactor);
    const categoryTotals = new Map();
    inventory.forEach(item => {
        const current = categoryTotals.get(item.category) || { monthlyKwh: 0 };
        current.monthlyKwh += item.monthlyKwh;
        categoryTotals.set(item.category, current);
    });
    const categories = Array.from(categoryTotals.entries()).sort((a, b) => b[1].monthlyKwh - a[1].monthlyKwh);
    const historical = historicalEntries.slice().sort((a, b) => a.month.localeCompare(b.month));
    const annualKwh = totals.monthlyKwh * 12;
    const annualCost = totals.monthlyCost * 12;
    const totalUnits = inventory.reduce((sum, item) => sum + Number(item.qty), 0);
    const weightedOperatingHours = totalUnits
        ? inventory.reduce((sum, item) => sum + Number(item.qty) * Number(item.hours), 0) / totalUnits
        : 0;
    const topItems = inventory.slice()
        .sort((a, b) => b.monthlyKwh - a.monthlyKwh)
        .slice(0, 5);
    const averageHistoricalKwh = historical.length
        ? historical.reduce((sum, entry) => sum + Number(entry.kwh), 0) / historical.length
        : null;
    const averageHistoricalCost = historical.length
        ? historical.reduce((sum, entry) => sum + Number(entry.cost), 0) / historical.length
        : null;
    record.inventory = inventory;
    record.historicalData = historicalData;
    record.photos = auditPhotos;
    record.facilityInfo = { ...facilityInfo };
    updateUniversitySummary();
    updateCharts();
    const format = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const campus = getUniversityEnergySummary(tariff, emissionFactor);
    const reportGeneratedAt = new Date().toLocaleString();
    const facilityName = currentAuditLabel(record);
    const facilityDetails = [
        ['Location', facilityInfo.facilityLocation],
        ['Floor area', facilityInfo.floorArea ? `${facilityInfo.floorArea} m²` : ''],
        ['Operating hours', facilityInfo.operatingHours],
        ['Energy sources', facilityInfo.energySources],
        ['Audit purpose', facilityInfo.auditPurpose],
        ['Background', facilityInfo.background],
        ['Scope', facilityInfo.scope]
    ].filter(([, value]) => value !== undefined && value !== null && String(value).trim());
    const auditorName = facilityInfo.authorName || (currentUser ? currentUser.name : '');
    const consumptionByFacilityLines = campus.summaries.map(facility =>
        `${facility.label}: ${format(facility.kwh)} kWh/month, ${facility.items} equipment item(s), KES ${format(facility.cost)}/month`
    );
    const photoLines = auditPhotos.map(photo => photo.name || 'Unnamed site photo');
    const recommendationLines = getAuditRecommendationLines(record);
    const categoryLines = categories.length
        ? categories.map(([category, values]) => {
            const share = totals.monthlyKwh ? values.monthlyKwh / totals.monthlyKwh * 100 : 0;
            return `${category}: ${format(values.monthlyKwh)} kWh/month (${format(share)}% of this facility estimate)`;
        })
        : ['No category data is available.'];
    const topItemLines = topItems.map((item, index) => {
        const share = totals.monthlyKwh ? item.monthlyKwh / totals.monthlyKwh * 100 : 0;
        return `${index + 1}. ${item.name} (${item.category}), quantity ${item.qty}: ${format(item.monthlyKwh)} kWh/month (${format(share)}%)`;
    });
    const findings = [
        `${facilityName} has ${inventory.length} equipment entries covering ${totalUnits} units, with an estimated connected load of ${format(totals.activePowerKw)} kW.`,
        `Estimated consumption is ${format(totals.monthlyKwh)} kWh/month, with ${categories[0] ? `${categories[0][0]}` : 'no category'} as the largest equipment category.`,
        `Average quantity-weighted operating time is ${format(weightedOperatingHours)} hours per unit per day.`,
        ...(averageHistoricalKwh === null
            ? ['No historical utility bills are recorded, so the equipment estimate cannot be compared with billed consumption.']
            : [`The ${historical.length}-month historical average is ${format(averageHistoricalKwh)} kWh/month${averageHistoricalKwh > 0 ? `; the equipment estimate is ${format(Math.abs((totals.monthlyKwh - averageHistoricalKwh) / averageHistoricalKwh * 100))}% ${totals.monthlyKwh >= averageHistoricalKwh ? 'above' : 'below'} that average` : '; percentage comparison is unavailable because the historical average is zero'}.`])
    ];
    const prioritizedActions = [];
    if (categories.length) {
        prioritizedActions.push(`Review the ${categories[0][0]} loads first; they account for ${format(totals.monthlyKwh ? categories[0][1].monthlyKwh / totals.monthlyKwh * 100 : 0)}% of modeled facility energy.`);
    }
    if (topItems.length) {
        prioritizedActions.push(`Check operating schedules, controls, and condition for the highest-use equipment, led by ${topItems[0].name}.`);
    }
    if (averageHistoricalKwh !== null) {
        prioritizedActions.push('Reconcile the equipment estimate with utility bills and meter readings, checking audit coverage, occupancy, and billing periods.');
    } else {
        prioritizedActions.push('Add recent utility bills and meter readings to validate the modeled energy and cost estimates.');
    }
    if (weightedOperatingHours >= 12) {
        prioritizedActions.push('Verify long daily operating schedules and identify equipment that can safely be switched off or scheduled more efficiently.');
    }
    if (recommendationLines.length) {
        prioritizedActions.push('Apply and track the auditor recommendations listed below, then compare the next billing period with this baseline.');
    } else {
        prioritizedActions.push('Record specific, measurable actions, owners, and target dates for energy-saving work.');
    }
    const report = [
        'ENERTRACK | COMPREHENSIVE ENERGY AUDIT REPORT',
        `Generated: ${reportGeneratedAt}`,
        'Report method: Local, rule-based analysis of saved audit data; no external AI service was used.',
        '',
        'EXECUTIVE SUMMARY',
        `${facilityName} has ${inventory.length} equipment entries (${totalUnits} units). Modeled consumption is ${format(totals.monthlyKwh)} kWh/month, estimated cost is KES ${format(totals.monthlyCost)}/month, and estimated emissions are ${format(totals.monthlyCarbon)} kg CO₂e/month. The largest modeled energy category is ${categories[0] ? categories[0][0] : 'not available'}.`,
        '',
        'KEY FINDINGS',
        ...findings.map((finding, index) => `${index + 1}. ${finding}`),
        '',
        'PRIORITIZED NEXT STEPS',
        ...prioritizedActions.map((action, index) => `${index + 1}. ${action}`),
        '',
        'AUDIT BASIS AND FACILITY DETAILS',
        `Facility: ${facilityName}`,
        ...(auditorName ? [`Auditor: ${auditorName}`] : []),
        ...(facilityInfo.auditDate ? [`Audit date: ${facilityInfo.auditDate}`] : []),
        ...(facilityDetails.length ? facilityDetails.map(([label, value]) => `${label}: ${value}`) : ['No additional facility details were recorded.']),
        '',
        'CAMPUS-WIDE SUB-METER SUMMARY (AGGREGATED APP AUDITS)',
        `${format(campus.totals.kwh)} kWh/month; KES ${format(campus.totals.cost)}/month; ${format(campus.totals.carbon)} kg CO₂e/month`,
        '',
        'CONSUMPTION BY FACILITY (SUB METERS)',
        ...consumptionByFacilityLines,
        '',
        'CURRENT FACILITY AUDIT',
        `Facility: ${currentAuditLabel(record)}`,
        ...(auditorName ? [`Auditor: ${auditorName}`] : []),
        ...(facilityInfo.auditDate ? [`Audit date: ${facilityInfo.auditDate}`] : []),
        ...(facilityDetails.length ? ['', 'FACILITY DETAILS', ...facilityDetails.map(([label, value]) => `${label}: ${value}`)] : []),
        '',
        'CURRENT FACILITY ENERGY SUMMARY',
        `Equipment entries: ${inventory.length}`,
        `Estimated connected load: ${format(totals.activePowerKw)} kW`,
        `Estimated energy: ${format(totals.monthlyKwh / 30)} kWh/day; ${format(totals.monthlyKwh)} kWh/month; ${format(annualKwh)} kWh/year`,
        `Estimated cost at KES ${format(tariff)}/kWh: KES ${format(totals.monthlyCost)}/month; KES ${format(annualCost)}/year`,
        `Estimated emissions at ${format(emissionFactor)} kg CO₂e/kWh: ${format(totals.monthlyCarbon)} kg CO₂e/month`,
        `Average historical bill: ${averageHistoricalKwh === null ? 'not available' : `${format(averageHistoricalKwh)} kWh/month; KES ${format(averageHistoricalCost)} per recorded month`}`,
        '',
        'AUDIT INVENTORY LIST',
        ...inventory.map(item =>
            `${item.category} | ${item.name} | ${item.watts} W each | Quantity ${item.qty} | ${item.hours} h/day | ${format(item.dailyKwh)} kWh/day | ${format(item.monthlyKwh)} kWh/month | KES ${format(item.monthlyCost)}/month | ${format(item.monthlyCarbon)} kg CO₂e/month`
        ),
        '',
        'ENERGY BY EQUIPMENT CATEGORY',
        ...categoryLines,
        '',
        'HIGHEST-USE EQUIPMENT (TOP 5)',
        ...(topItemLines.length ? topItemLines : ['No equipment items are available.']),
        ...(historical.length
            ? ['', 'HISTORICAL ENERGY USE AND BILLS', ...historical.map(entry => `${formatBillingMonth(entry.month)} | ${format(entry.kwh)} kWh | KES ${format(entry.cost)}`)]
            : ['', 'HISTORICAL ENERGY USE AND BILLS', 'No utility bill entries have been added to this facility.']),
        '',
        'AUDITOR SITE PHOTOS',
        ...(photoLines.length ? photoLines.map((name, index) => `${index + 1}. ${name}`) : ['No site photos have been added to this facility.']),
        '',
        'AUDITOR RECOMMENDATIONS BY EQUIPMENT CATEGORY',
        ...(recommendationLines.length ? recommendationLines : ['No auditor recommendations have been entered.']),
        '',
        'METHOD AND LIMITATIONS',
        'Equipment energy is estimated from rated watts × quantity × operating hours per day × 30 days. Annual figures multiply the monthly estimate by 12 and are projections, not measured annual results.',
        `Cost estimates use the configured tariff of KES ${format(tariff)}/kWh. Emissions estimates use the configured factor of ${format(emissionFactor)} kg CO₂e/kWh.`,
        'Results depend on the completeness and accuracy of inventory, operating-hour, tariff, emission-factor, and bill-history inputs. Validate findings against meters and utility bills before making operational or financial decisions.'
    ].join('\n');

    record.report = report;
    record.reportVersion = AUDIT_REPORT_VERSION;
    record.reportGeneratedAt = new Date().toISOString();
    saveAudits();
    updateAuditReportDisplay();
}

function generateAllFacilitiesReport() {
    const activeAudit = getCurrentAudit(false);
    if (activeAudit) {
        activeAudit.inventory = inventory;
        activeAudit.facilityInfo = { ...facilityInfo };
        activeAudit.historicalData = historicalData;
        activeAudit.photos = auditPhotos;
    }

    const reportAudits = audits
        .filter(audit => Array.isArray(audit.inventory) && audit.inventory.length)
        .slice()
        .sort((a, b) => currentAuditLabel(a).localeCompare(currentAuditLabel(b), 'en', {
            numeric: true,
            sensitivity: 'base'
        }));
    if (!reportAudits.length) {
        alert('Add equipment to at least one facility audit before generating the all-facilities report.');
        return;
    }

    const format = value => Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const totals = { monthlyKwh: 0, monthlyCost: 0, monthlyCarbon: 0, activePowerKw: 0 };
    const facilitySections = [];
    const photos = [];

    for (const audit of reportAudits) {
        const label = currentAuditLabel(audit);
        const items = audit.inventory;
        if (items.some(item => !item
            || typeof item.name !== 'string' || !item.name.trim()
            || typeof item.category !== 'string' || !item.category.trim()
            || !Number.isFinite(Number(item.watts)) || Number(item.watts) <= 0
            || !Number.isInteger(Number(item.qty)) || Number(item.qty) < 1
            || !Number.isFinite(Number(item.hours)) || Number(item.hours) < 0 || Number(item.hours) > 24)) {
            alert(`The equipment inventory for ${label} contains invalid values. Correct it before generating the report.`);
            return;
        }

        const historical = Array.isArray(audit.historicalData) ? audit.historicalData : [];
        if (historical.some(entry => !entry
            || typeof entry.month !== 'string' || !/^\d{4}-\d{2}$/.test(entry.month)
            || Number(entry.month.slice(5)) < 1 || Number(entry.month.slice(5)) > 12
            || !Number.isFinite(Number(entry.kwh)) || Number(entry.kwh) < 0
            || !Number.isFinite(Number(entry.cost)) || Number(entry.cost) < 0)) {
            alert(`The utility bill history for ${label} contains incomplete or invalid values. Correct it before generating the report.`);
            return;
        }

        const settings = audit.energySettings || {};
        const configuredTariff = Number(settings.tariffRate ?? audit.tariffRate);
        const configuredEmissionFactor = Number(settings.emissionFactor ?? audit.emissionFactor);
        const tariff = Number.isFinite(configuredTariff) ? configuredTariff : DEFAULT_TARIFF_RATE;
        const emissionFactor = Number.isFinite(configuredEmissionFactor)
            ? configuredEmissionFactor
            : DEFAULT_EMISSION_FACTOR;
        const facilityTotals = calculateInventoryTotals(items, tariff, emissionFactor);
        totals.monthlyKwh += facilityTotals.monthlyKwh;
        totals.monthlyCost += facilityTotals.monthlyCost;
        totals.monthlyCarbon += facilityTotals.monthlyCarbon;
        totals.activePowerKw += facilityTotals.activePowerKw;

        const details = audit.facilityInfo || {};
        const detailLines = [
            ['Auditor', details.authorName || audit.auditorName],
            ['Audit date', details.auditDate],
            ['Location', details.facilityLocation],
            ['Floor area', details.floorArea ? `${details.floorArea} m²` : ''],
            ['Operating hours', details.operatingHours],
            ['Energy sources', details.energySources],
            ['Audit purpose', details.auditPurpose],
            ['Background', details.background],
            ['Scope', details.scope]
        ].filter(([, value]) => value !== undefined && value !== null && String(value).trim())
            .map(([label, value]) => `${label}: ${value}`);
        const findings = String(audit.findings || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        const recommendations = Array.isArray(audit.recommendations)
            ? audit.recommendations.map(value => String(value).trim()).filter(Boolean)
            : [];
        facilitySections.push([
            label,
            `Audit status: ${audit.status || 'draft'}`,
            ...detailLines,
            `Equipment entries: ${items.length}`,
            `Estimated consumption: ${format(facilityTotals.monthlyKwh)} kWh/month`,
            `Estimated cost: KES ${format(facilityTotals.monthlyCost)}/month`,
            `Estimated emissions: ${format(facilityTotals.monthlyCarbon)} kg CO₂e/month`,
            'Equipment:',
            ...items.map(item =>
                `  ${item.category} | ${item.name} | ${item.watts} W | quantity ${item.qty} | ${item.hours} hours/day | ${format(item.monthlyKwh)} kWh/month`
            ),
            ...(historical.length
                ? ['Historical bills:', ...historical.map(entry =>
                    `  ${formatBillingMonth(entry.month)} | ${format(entry.kwh)} kWh | KES ${format(entry.cost)}`)]
                : ['Historical bills: none recorded']),
            ...(findings.length
                ? ['Auditor findings:', ...findings.map(finding => `  ${finding}`)]
                : ['Auditor findings: none recorded']),
            ...(recommendations.length
                ? ['Auditor recommendations:', ...recommendations.map(recommendation => `  ${recommendation}`)]
                : ['Auditor recommendations: none recorded']),
            ''
        ]);
        (Array.isArray(audit.photos) ? audit.photos : []).forEach(photo => {
            photos.push({
                facility: label,
                name: photo.name || 'Audit photo',
                src: photo.dataUrl || photo.url
            });
        });
    }

    const report = [
        'ENERTRACK | ALL-FACILITIES ENERGY AUDIT REPORT',
        `Generated: ${new Date().toLocaleString()}`,
        `Facility audits included: ${reportAudits.length}`,
        '',
        'COMBINED SUMMARY',
        `Estimated connected load: ${format(totals.activePowerKw)} kW`,
        `Estimated consumption: ${format(totals.monthlyKwh)} kWh/month`,
        `Estimated cost: KES ${format(totals.monthlyCost)}/month`,
        `Estimated emissions: ${format(totals.monthlyCarbon)} kg CO₂e/month`,
        '',
        'FACILITY DETAILS AND EQUIPMENT',
        ...facilitySections.flat(),
        'METHOD AND LIMITATIONS',
        'Energy is estimated from the saved equipment ratings, quantities, and daily operating hours. Cost and emissions use each audit’s configured tariff and emission factor. Validate these estimates against utility bills and meter readings.'
    ].join('\n');
    document.getElementById('aiReportContent').textContent = report;

    const gallery = document.getElementById('reportPhotoGallery');
    gallery.innerHTML = '';
    photos.forEach(photo => {
        if (!photo.src) return;
        const figure = document.createElement('figure');
        figure.className = 'audit-photo-card';
        const image = document.createElement('img');
        image.src = photo.src;
        image.alt = `${photo.facility}: ${photo.name}`;
        const caption = document.createElement('figcaption');
        caption.textContent = `${photo.facility} — ${photo.name}`;
        figure.append(image, caption);
        gallery.appendChild(figure);
    });
}

function getAuditRecommendationLines(record) {
    const savedRecommendations = Array.isArray(record && record.recommendations)
        ? record.recommendations.map(recommendation => String(recommendation).trim()).filter(Boolean)
        : [];
    if (savedRecommendations.length) return savedRecommendations;
    return loadRecommendations
        .filter(recommendation => recommendation.text && recommendation.text.trim())
        .map(recommendation => `${recommendation.loadType || 'Equipment category'}: ${recommendation.text.trim()}`);
}

function generateHostelsAggregateReport() {
    const hostelAudits = audits
        .filter(audit => audit.facilityId === 'Hostels' && audit.hostelName)
        .sort((a, b) => a.hostelName.localeCompare(b.hostelName, 'en', {
            numeric: true,
            sensitivity: 'base'
        }));
    const activeAudit = getCurrentAudit(false);
    if (activeAudit) {
        activeAudit.inventory = inventory;
        activeAudit.facilityInfo = { ...facilityInfo };
        activeAudit.historicalData = historicalData;
        activeAudit.photos = auditPhotos;
    }
    if (!hostelAudits.length || !hostelAudits.some(audit =>
        Array.isArray(audit.inventory) && audit.inventory.length
    )) {
        alert('Add equipment to at least one named hostel audit before generating the combined Hostels report.');
        return;
    }

    for (const audit of hostelAudits) {
        const items = Array.isArray(audit.inventory) ? audit.inventory : [];
        if (items.some(item => !item
            || typeof item.name !== 'string' || !item.name.trim()
            || typeof item.category !== 'string' || !item.category.trim()
            || !Number.isFinite(Number(item.watts)) || Number(item.watts) <= 0
            || !Number.isInteger(Number(item.qty)) || Number(item.qty) < 1
            || !Number.isFinite(Number(item.hours)) || Number(item.hours) < 0 || Number(item.hours) > 24)) {
            alert(`The equipment inventory for ${audit.hostelName} contains invalid values. Correct it before generating the combined Hostels report.`);
            return;
        }

        const bills = Array.isArray(audit.historicalData) ? audit.historicalData : [];
        if (bills.some(entry => !entry
            || typeof entry.month !== 'string' || !/^\d{4}-\d{2}$/.test(entry.month)
            || Number(entry.month.slice(5)) < 1 || Number(entry.month.slice(5)) > 12
            || !Number.isFinite(Number(entry.kwh)) || Number(entry.kwh) < 0
            || !Number.isFinite(Number(entry.cost)) || Number(entry.cost) < 0)) {
            alert(`The utility bill history for ${audit.hostelName} contains invalid values. Correct it before generating the combined Hostels report.`);
            return;
        }
    }

    const tariff = parseFloat(document.getElementById('tariffRate').value) || 12;
    const emissionFactor = parseFloat(document.getElementById('emissionFactor').value) || 0.05;
    const format = value => Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const categoryTotals = new Map();
    const monthlyBills = new Map();
    const hostelTotals = [];
    const allItems = [];
    const allPhotos = [];
    let totalEquipmentEntries = 0;
    let totalUnits = 0;
    let weightedOperatingHoursTotal = 0;
    let monthlyKwh = 0;
    let monthlyCost = 0;
    let monthlyCarbon = 0;
    let activePowerKw = 0;

    hostelAudits.forEach(audit => {
        const items = Array.isArray(audit.inventory) ? audit.inventory : [];
        const totals = calculateInventoryTotals(items, tariff, emissionFactor);
        totalEquipmentEntries += items.length;
        totalUnits += items.reduce((sum, item) => sum + Number(item.qty), 0);
        weightedOperatingHoursTotal += items.reduce((sum, item) =>
            sum + Number(item.qty) * Number(item.hours), 0);
        monthlyKwh += totals.monthlyKwh;
        monthlyCost += totals.monthlyCost;
        monthlyCarbon += totals.monthlyCarbon;
        activePowerKw += totals.activePowerKw;
        items.forEach(item => {
            allItems.push({ ...item, hostelName: audit.hostelName });
            const category = categoryTotals.get(item.category) || { monthlyKwh: 0 };
            category.monthlyKwh += item.monthlyKwh;
            categoryTotals.set(item.category, category);
        });
        (Array.isArray(audit.photos) ? audit.photos : []).forEach(photo => {
            allPhotos.push(`${audit.hostelName}: ${photo.name || 'Unnamed site photo'}`);
        });
        (Array.isArray(audit.historicalData) ? audit.historicalData : []).forEach(entry => {
            const month = monthlyBills.get(entry.month) || { kwh: 0, cost: 0, hostels: 0 };
            month.kwh += Number(entry.kwh);
            month.cost += Number(entry.cost);
            month.hostels += 1;
            monthlyBills.set(entry.month, month);
        });
        hostelTotals.push({
            name: audit.hostelName,
            entries: items.length,
            units: items.reduce((sum, item) => sum + Number(item.qty), 0),
            kwh: totals.monthlyKwh,
            cost: totals.monthlyCost,
            carbon: totals.monthlyCarbon
        });
    });

    const categories = Array.from(categoryTotals.entries())
        .sort((a, b) => b[1].monthlyKwh - a[1].monthlyKwh);
    const rankedItems = allItems.slice()
        .sort((a, b) => b.monthlyKwh - a.monthlyKwh)
        .slice(0, 10);
    const historicalEntries = Array.from(monthlyBills.entries())
        .sort(([monthA], [monthB]) => monthA.localeCompare(monthB));
    const averageHistoricalKwh = historicalEntries.length
        ? historicalEntries.reduce((sum, [, bill]) => sum + bill.kwh, 0) / historicalEntries.length
        : null;
    const annualKwh = monthlyKwh * 12;
    const annualCost = monthlyCost * 12;
    const averageOperatingHours = totalUnits ? weightedOperatingHoursTotal / totalUnits : 0;
    const savedRecommendations = hostelAudits.flatMap(audit =>
        Array.isArray(audit.recommendations) ? audit.recommendations : []
    ).map(recommendation => String(recommendation).trim()).filter(Boolean);
    const recommendations = savedRecommendations.length
        ? [...new Set(savedRecommendations)]
        : getAuditRecommendationLines(null);
    const actions = [];
    if (categories.length) {
        actions.push(`Prioritize ${categories[0][0]} across the hostels; it represents ${format(monthlyKwh ? categories[0][1].monthlyKwh / monthlyKwh * 100 : 0)}% of modeled hostel energy.`);
    }
    if (rankedItems.length) {
        actions.push(`Review the operating schedule and condition of the highest-use equipment, led by ${rankedItems[0].name} in ${rankedItems[0].hostelName}.`);
    }
    actions.push(averageHistoricalKwh === null
        ? 'Add and reconcile monthly utility bills for each hostel to validate the combined equipment estimate.'
        : 'Compare aggregated monthly bills against the equipment estimate and investigate differences in meter coverage, occupancy, and billing periods.');
    if (averageOperatingHours >= 12) {
        actions.push('Review long daily run times and identify equipment that can safely be scheduled or switched off when not in use.');
    }
    actions.push(recommendations.length
        ? 'Assign owners and target dates to the auditor recommendations, then verify savings using subsequent bills.'
        : 'Record specific energy-saving actions, responsible owners, and target dates for follow-up.');

    if (!activeAudit) {
        alert('Select a named hostel before generating the combined Hostels report.');
        return;
    }
    const report = [
        'ENERTRACK | COMPREHENSIVE HOSTELS ENERGY AUDIT REPORT',
        `Generated: ${new Date().toLocaleString()}`,
        'Report method: Local, rule-based analysis aggregating all named hostel dropdown audits. No external AI service was used.',
        '',
        'EXECUTIVE SUMMARY',
        `${hostelAudits.length} named hostel audits contribute ${totalEquipmentEntries} equipment entries (${totalUnits} units). Combined modeled consumption is ${format(monthlyKwh)} kWh/month (${format(annualKwh)} kWh/year), estimated cost is KES ${format(monthlyCost)}/month, and estimated emissions are ${format(monthlyCarbon)} kg CO₂e/month. Combined connected load is ${format(activePowerKw)} kW.`,
        '',
        'KEY FINDINGS',
        `1. ${hostelTotals.filter(hostel => hostel.entries > 0).length} of ${hostelAudits.length} named hostels currently have equipment recorded.`,
        `2. ${categories.length ? `${categories[0][0]} is the largest energy category at ${format(categories[0][1].monthlyKwh)} kWh/month (${format(monthlyKwh ? categories[0][1].monthlyKwh / monthlyKwh * 100 : 0)}% of the combined estimate).` : 'No equipment category totals are available.'}`,
        `3. Average quantity-weighted operating time is ${format(averageOperatingHours)} hours per unit per day.`,
        ...(averageHistoricalKwh === null
            ? ['4. No hostel utility bill history is available for comparison.']
            : [`4. Combined historical bills average ${format(averageHistoricalKwh)} kWh/month across ${historicalEntries.length} recorded month(s).`]),
        '',
        'PRIORITIZED ACTIONS',
        ...actions.map((action, index) => `${index + 1}. ${action}`),
        '',
        'COMBINED HOSTELS SUB-METER TOTAL',
        `Equipment entries: ${totalEquipmentEntries}`,
        `Equipment units: ${totalUnits}`,
        `Estimated connected load: ${format(activePowerKw)} kW`,
        `Estimated energy: ${format(monthlyKwh / 30)} kWh/day; ${format(monthlyKwh)} kWh/month; ${format(annualKwh)} kWh/year`,
        `Estimated cost at KES ${format(tariff)}/kWh: KES ${format(monthlyCost)}/month; KES ${format(annualCost)}/year`,
        `Estimated emissions at ${format(emissionFactor)} kg CO₂e/kWh: ${format(monthlyCarbon)} kg CO₂e/month`,
        '',
        'BREAKDOWN BY HOSTEL',
        ...hostelTotals.map(hostel =>
            `${hostel.name}: ${hostel.entries} equipment entries; ${hostel.units} units; ${format(hostel.kwh)} kWh/month; KES ${format(hostel.cost)}/month; ${format(hostel.carbon)} kg CO₂e/month`
        ),
        '',
        'COMBINED ENERGY BY EQUIPMENT CATEGORY',
        ...(categories.length
            ? categories.map(([category, values]) =>
                `${category}: ${format(values.monthlyKwh)} kWh/month (${format(monthlyKwh ? values.monthlyKwh / monthlyKwh * 100 : 0)}%)`)
            : ['No equipment category totals are available.']),
        '',
        'HIGHEST-USE EQUIPMENT ACROSS ALL HOSTELS (TOP 10)',
        ...(rankedItems.length
            ? rankedItems.map((item, index) =>
                `${index + 1}. ${item.name} (${item.category}) — ${item.hostelName}; quantity ${item.qty}; ${format(item.monthlyKwh)} kWh/month`)
            : ['No equipment items are available.']),
        '',
        'AGGREGATED HOSTEL UTILITY BILLS',
        ...(historicalEntries.length
            ? historicalEntries.map(([month, bill]) =>
                `${formatBillingMonth(month)}: ${format(bill.kwh)} kWh; KES ${format(bill.cost)}; ${bill.hostels} hostel bill record(s)`)
            : ['No historical utility bills have been entered for the named hostels.']),
        '',
        'AUDITOR RECOMMENDATIONS',
        ...(recommendations.length ? recommendations : ['No auditor recommendations have been entered.']),
        '',
        'AUDITOR SITE PHOTOS',
        ...(allPhotos.length ? allPhotos.map((photo, index) => `${index + 1}. ${photo}`) : ['No hostel site photos have been added.']),
        '',
        'METHOD AND LIMITATIONS',
        'Hostel inventory values are summed across named hostel audits. Energy is estimated from rated watts × quantity × operating hours per day × 30 days. Annual values are projections, not measured annual results.',
        `Cost uses the configured tariff of KES ${format(tariff)}/kWh; emissions use the configured factor of ${format(emissionFactor)} kg CO₂e/kWh.`,
        'Historical bill totals combine records for the same month. Missing audits or bills, incomplete inventory, and differences in occupancy or billing periods may affect comparisons. Validate results against meters and utility bills.'
    ].join('\n');

    activeAudit.report = report;
    activeAudit.reportVersion = AUDIT_REPORT_VERSION;
    activeAudit.reportGeneratedAt = new Date().toISOString();
    activeAudit.inventory = inventory;
    activeAudit.facilityInfo = { ...facilityInfo };
    activeAudit.historicalData = historicalData;
    activeAudit.photos = auditPhotos;
    saveAudits();
    updateAuditReportDisplay();
}
