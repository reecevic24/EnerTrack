function calculateAll() {
    const tariff = currentTariffRate();
    const emissionFactor = currentEmissionFactor();

    const totals = calculateInventoryTotals(inventory, tariff, emissionFactor);
    updateKPIs(totals.monthlyKwh, totals.monthlyCost, totals.monthlyCarbon, totals.activePowerKw, totals.reactiveKvar, totals.kva);
    renderInventoryTable();
    updateCharts();
    updateUniversitySummary();
}

function calculateInventoryTotals(items, tariff, emissionFactor) {
    const totals = {
        monthlyKwh: 0,
        monthlyCost: 0,
        monthlyCarbon: 0,
        activePowerWatts: 0,
        reactiveKvar: 0,
        kva: 0
    };
    items.forEach(item => {
        item.dailyKwh = (item.watts * item.qty * item.hours) / 1000;
        item.monthlyKwh = item.dailyKwh * 30;
        item.monthlyCost = item.monthlyKwh * tariff;
        item.monthlyCarbon = item.monthlyKwh * emissionFactor;

        const pf = (item.pf && item.pf > 0) ? item.pf : 1.0;
        item.activePowerKw = (item.watts * item.qty) / 1000;
        item.kva = item.activePowerKw / pf;
        item.kvar = Math.sqrt(Math.max(0, Math.pow(item.kva, 2) - Math.pow(item.activePowerKw, 2)));

        totals.monthlyKwh += item.monthlyKwh;
        totals.monthlyCost += item.monthlyCost;
        totals.monthlyCarbon += item.monthlyCarbon;
        totals.activePowerWatts += item.watts * item.qty;
        totals.reactiveKvar += item.kvar;
        totals.kva += item.kva;
    });
    totals.activePowerKw = totals.activePowerWatts / 1000;
    return totals;
}

function updateKPIs(kwh, cost, carbon, activeKw, reactiveKvar, kva) {
    document.getElementById('kpiKwh').textContent = `${kwh.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh`;
    document.getElementById('kpiCost').textContent = `KES ${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('kpiActivePower').textContent = `${activeKw.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kW`;
    document.getElementById('kpiCarbon').textContent = `${carbon.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg CO₂e`;
}

function getUniversityEnergySummary(tariff, emissionFactor) {
    const groupedAudits = new Map();
    facilityNames.forEach(name => {
        groupedAudits.set(name, { label: name, items: 0, kwh: 0, cost: 0, carbon: 0 });
    });
    const approvedSubmissions = sharedSubmissions.filter(record => record.status === 'approved');
    approvedSubmissions.forEach(record => {
        const label = record.facilityId === 'Hostels'
            ? 'Hostels'
            : currentAuditLabel(record);
        const items = Array.isArray(record.inventory) ? record.inventory : [];
        const totals = calculateInventoryTotals(items, tariff, emissionFactor);
        const existing = groupedAudits.get(label) || { label, items: 0, kwh: 0, cost: 0, carbon: 0 };
        existing.items += items.length;
        existing.kwh += totals.monthlyKwh;
        existing.cost += totals.monthlyCost;
        existing.carbon += totals.monthlyCarbon;
        groupedAudits.set(label, existing);
    });

    const summaries = Array.from(groupedAudits.values()).sort((a, b) => a.label.localeCompare(b.label));
    const totals = summaries.reduce((sum, facility) => ({
        kwh: sum.kwh + facility.kwh,
        cost: sum.cost + facility.cost,
        carbon: sum.carbon + facility.carbon
    }), { kwh: 0, cost: 0, carbon: 0 });
    return { summaries, totals };
}

function updateUniversitySummary() {
    const tariff = currentTariffRate();
    const emissionFactor = currentEmissionFactor();
    const { summaries, totals } = getUniversityEnergySummary(tariff, emissionFactor);
    const auditedCount = summaries.filter(facility => facility.items > 0).length;
    const format = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('universityKwh').textContent = `${format(totals.kwh)} kWh`;
    document.getElementById('universityCost').textContent = `KES ${format(totals.cost)}`;
    document.getElementById('universityCarbon').textContent = `${format(totals.carbon)} kg CO₂e`;
    document.getElementById('dashboardUniversityKwh').textContent = `${format(totals.kwh)} kWh`;
    document.getElementById('dashboardUniversityCost').textContent = `KES ${format(totals.cost)}`;
    document.getElementById('dashboardFacilityCount').textContent = `${auditedCount} / ${facilityNames.length}`;
    document.getElementById('dashboardFacilityCount').closest('.box').hidden =
        !!currentUser && currentUser.role !== 'admin';
    document.getElementById('dashboardAuditCountLabel').textContent =
        currentUser && currentUser.role !== 'admin' ? 'My submitted audits' : 'Facility audits';

    const tbody = document.getElementById('universityFacilityBody');
    tbody.innerHTML = '';
    summaries.forEach(facility => {
        const row = document.createElement('tr');
        [facility.label, facility.items, `${format(facility.kwh)} kWh`, `KES ${format(facility.cost)}`].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });
    if (!summaries.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.className = 'empty-state';
        cell.textContent = 'No facility audit data yet.';
        row.appendChild(cell);
        tbody.appendChild(row);
    }

    const canvas = document.getElementById('universityChart');
    if (universityChartInstance) universityChartInstance.destroy();
    if (canvas && typeof Chart !== 'undefined') {
        canvas.style.display = 'block';
        const fallback = canvas.parentElement.querySelector('.chart-unavailable');
        if (fallback) fallback.remove();
        universityChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: summaries.map(facility => facility.label),
                datasets: [{
                    label: 'Monthly Energy (kWh)',
                    data: summaries.map(facility => facility.kwh),
                    backgroundColor: '#04e617',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#a0aec0' }, grid: { display: false } },
                    y: { ticks: { color: '#a0aec0' }, grid: { color: '#2d3748' } }
                }
            }
        });
    } else if (canvas) {
        showChartUnavailable(canvas);
    }
}

async function loadPersonalDashboard() {
    if (!currentUser) return;
    try {
        const { personal } = await apiRequest('/api/dashboard');
        const submittedAuditCount = sharedSubmissions.filter(item =>
            normalizeEmail(item.auditorEmail) === normalizeEmail(currentUser.email) &&
            item.status !== 'draft'
        ).length;
        document.getElementById('dashboardAuditCount').textContent =
            String(isAdministrator() ? personal.totals.auditCount : submittedAuditCount);

        const recentContainer = document.getElementById('dashboardRecentAudits');
        recentContainer.innerHTML = '';
        if (!personal.recentAudits.length) {
            recentContainer.textContent = 'No facility audits yet.';
        } else {
            personal.recentAudits.forEach(audit => {
                const row = document.createElement('div');
                row.className = 'submission-card';
                row.textContent = `${audit.label} · ${audit.status} · ${new Date(audit.updatedAt).toLocaleString()}`;
                recentContainer.appendChild(row);
            });
        }

        const reportsContainer = document.getElementById('dashboardReports');
        reportsContainer.innerHTML = '';
        const reports = personal.reports.filter(audit => audit.reportGenerated);
        if (!reports.length) {
            reportsContainer.textContent = 'No reports generated yet.';
            return;
        }
        reports.forEach(audit => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-action';
            button.textContent = `Download ${audit.label} report`;
            button.addEventListener('click', () => downloadDashboardReport(audit.id, audit.label));
            reportsContainer.appendChild(button);
        });
    } catch (error) {
        reportApiError(error);
    }
}

async function downloadDashboardReport(auditId, label) {
    try {
        const response = await fetch(
            `${API_BASE}/api/audits/${encodeURIComponent(auditId)}/report.pdf`,
            { credentials: 'include' }
        );
        if (!response.ok) {
            let message = `Request failed (${response.status}).`;
            try {
                const body = await response.json();
                if (body.error) message = body.error;
            } catch {}
            throw new Error(message);
        }
        const downloadUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${label.replace(/[^a-z0-9_-]+/gi, '-')}-audit-report.pdf`;
        link.click();
        URL.revokeObjectURL(downloadUrl);
    } catch (error) {
        reportApiError(error);
    }
}
