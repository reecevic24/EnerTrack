function updateAuditReportDisplay() {
    const report = document.getElementById('aiReportContent');
    if (!report) return;
    const record = getCurrentAudit(false);
    report.textContent = record && record.report && record.reportVersion === AUDIT_REPORT_VERSION
        ? record.report
        : 'Select a facility with equipment, then generate its report.';
    const reportPhotos = document.getElementById('reportPhotoGallery');
    if (reportPhotos) {
        reportPhotos.innerHTML = '';
        (record && record.photos ? record.photos : []).forEach(photo => {
            const image = document.createElement('img');
            image.className = 'report-photo';
            image.src = photo.dataUrl;
            image.alt = photo.name || 'Audit photo';
            reportPhotos.appendChild(image);
        });
    }
}

function renderInventoryTable() {
    const tbody = document.getElementById('inventoryBody');
    const isApproved = isAuditLockedAsApproved(getCurrentAudit(false));
    const actionHeader = document.getElementById('inventoryActionHeader');
    actionHeader.style.display = isApproved ? 'none' : '';
    tbody.innerHTML = '';

    if (inventory.length === 0) {
        tbody.innerHTML = `
                    <tr>
                        <td colspan="${isApproved ? 9 : 10}" class="empty-state">No inventory added yet. Add equipment from the Facilities tab.</td>
                    </tr>`;
        return;
    }

    inventory.forEach(item => {
        const tr = document.createElement('tr');
        const values = [
            item.category || 'General',
            item.name,
            `${item.watts} W`,
            item.qty,
            `${item.hours} hrs`,
            item.dailyKwh?.toFixed(2),
            item.monthlyKwh?.toFixed(2),
            item.monthlyCost?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            item.monthlyCarbon?.toFixed(2)
        ];
        values.forEach((value, index) => {
            const cell = document.createElement('td');
            cell.textContent = value;
            if (index === 0) {
                const badge = document.createElement('span');
                badge.className = 'badge-pill';
                badge.textContent = value;
                cell.textContent = '';
                cell.appendChild(badge);
            }
            if (index === 1 || index === 7) {
                const strong = document.createElement('strong');
                strong.textContent = value;
                cell.textContent = '';
                cell.appendChild(strong);
            }
            tr.appendChild(cell);
        });
        if (!isApproved) {
            const actionCell = document.createElement('td');
            const deleteButton = document.createElement('button');
            deleteButton.className = 'btn-delete';
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', () => deleteItem(item.id));
            actionCell.appendChild(deleteButton);
            tr.appendChild(actionCell);
        }
        tbody.appendChild(tr);
    });
}

function updateCharts() {
    const labels = inventory.map(i => i.name);
    const costData = inventory.map(i => i.monthlyCost);

    if (barChartInstance) barChartInstance.destroy();

    const canvas = document.getElementById('barChart');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
        showChartUnavailable(canvas);
        console.error('Chart.js is unavailable; the equipment chart cannot be rendered.');
        return;
    }
    canvas.style.display = 'block';
    const fallback = canvas.parentElement.querySelector('.chart-unavailable');
    if (fallback) fallback.remove();
    const ctxBar = canvas.getContext('2d');

    barChartInstance = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: labels.length ? labels : ['No Equipment Data'],
            datasets: [{
                label: 'Monthly Cost (KES)',
                data: costData.length ? costData : [0],
                backgroundColor: '#04e617',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Monthly Operating Cost per Equipment (KES)',
                    color: '#e2e8f0',
                    font: { size: 14, weight: 'bold' }
                },
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: '#a0aec0', font: { size: 11 } }, grid: { display: false } },
                y: { ticks: { color: '#a0aec0', font: { size: 11 } }, grid: { color: '#2d3748' } }
            }
        }
    });
}

function showChartUnavailable(canvas) {
    canvas.style.display = 'none';
    let fallback = canvas.parentElement.querySelector('.chart-unavailable');
    if (!fallback) {
        fallback = document.createElement('p');
        fallback.className = 'chart-unavailable';
        fallback.textContent = 'Chart unavailable. The audit data and totals are still available.';
        canvas.parentElement.appendChild(fallback);
    }
}
