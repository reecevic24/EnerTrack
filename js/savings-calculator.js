function handleAuditSettingChange() {
    const record = getCurrentAudit(false);
    if (record) {
        record.energySettings = readEnergySettingsFromForm();
        record.report = '';
        record.reportGeneratedAt = '';
        saveAudits();
    }
    calculateAll();
    updateAuditReportDisplay();
}

function renderEquipmentDetails() {
    renderEquipmentGroup('actual');
    renderEquipmentGroup('recommended');
    updateEquipmentPieChart('actual');
    updateEquipmentPieChart('recommended');
}

function renderEquipmentGroup(group) {
    const container = document.getElementById(`${group}EquipmentContainer`);
    if (!container) return;
    container.innerHTML = '';
    const items = equipmentDetails[group];
    if (!items.length) {
        const hint = document.createElement('p');
        hint.className = 'facility-hint';
        hint.textContent = `No ${group} equipment added yet.`;
        container.appendChild(hint);
    }

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'equipment-detail-row';
        const fields = [
            ['Equipment name', 'equipmentName', 'text', 'e.g. LED lighting'],
            ['Power rating (W)', 'powerWatts', 'number', ''],
            ['Quantity', 'qty', 'number', ''],
            ['Operating hours per day', 'hoursPerDay', 'number', '']
        ];
        fields.forEach(([labelText, property, type, placeholder]) => {
            const fieldGroup = document.createElement('div');
            fieldGroup.className = 'form-group';
            const label = document.createElement('label');
            label.textContent = labelText;
            const input = document.createElement('input');
            input.type = type;
            input.value = item[property] ?? '';
            input.placeholder = placeholder;
            if (type === 'number') {
                input.min = property === 'hoursPerDay' ? '0' : property === 'qty' ? '1' : '0';
                input.step = property === 'qty' ? '1' : 'any';
                if (property === 'hoursPerDay') input.max = '24';
            }
            input.addEventListener('input', () => {
                item[property] = input.value;
                saveEquipmentDetails();
                const energyOutput = document.getElementById(`${group}MonthlyEnergy_${item.id}`);
                if (energyOutput) {
                    energyOutput.textContent = `${formatEquipmentEnergy(calculateEquipmentMonthlyKwh(item))} kWh`;
                }
                updateEquipmentPieChart(group);
                if (group === 'actual') updateEquipmentPieChart('recommended');
            });
            fieldGroup.append(label, input);
            row.appendChild(fieldGroup);
        });

        const energyGroup = document.createElement('div');
        energyGroup.className = 'equipment-calculation-result';
        energyGroup.innerHTML = '<span>Calculated energy / month</span>';
        const energyOutput = document.createElement('strong');
        energyOutput.id = `${group}MonthlyEnergy_${item.id}`;
        energyOutput.textContent = `${formatEquipmentEnergy(calculateEquipmentMonthlyKwh(item))} kWh`;
        energyGroup.appendChild(energyOutput);
        row.appendChild(energyGroup);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn-delete';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => {
            equipmentDetails[group] = equipmentDetails[group].filter(entry => entry.id !== item.id);
            saveEquipmentDetails();
            renderEquipmentGroup(group);
            updateEquipmentPieChart(group);
            if (group === 'actual') updateEquipmentPieChart('recommended');
        });
        row.appendChild(removeButton);
        container.appendChild(row);
    });
}

function addEquipmentDetail(group) {
    equipmentDetails[group].push({
        id: `equipment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        equipmentName: '',
        powerWatts: '',
        qty: '',
        hoursPerDay: ''
    });
    saveEquipmentDetails();
    renderEquipmentGroup(group);
    updateEquipmentPieChart(group);
    if (group === 'actual') updateEquipmentPieChart('recommended');
}

function saveEquipmentDetails() {
    if (!currentUser) return;
    persistUserData('equipmentDetails', {
        actual: equipmentDetails.actual,
        recommended: equipmentDetails.recommended
    });
}

function normalizeEquipmentDetails(value) {
    if (!value) return { actual: [], recommended: [] };
    const normalizeItems = (items, group) => {
        if (!Array.isArray(items)) throw new Error(`Stored ${group} equipment must be an array.`);
        return items.map((item, index) => ({
            id: item.id || `${group}_${index}`,
            equipmentName: typeof item.equipmentName === 'string' ? item.equipmentName : '',
            powerWatts: item.powerWatts ?? '',
            qty: item.qty ?? 1,
            hoursPerDay: item.hoursPerDay ?? ''
        }));
    };
    return Array.isArray(value)
        ? { actual: normalizeItems(value, 'actual'), recommended: [] }
        : {
            actual: normalizeItems(value.actual || [], 'actual'),
            recommended: normalizeItems(value.recommended || [], 'recommended')
        };
}

function updateEquipmentPieChart(group) {
    const canvas = document.getElementById(`${group}EquipmentChart`);
    if (!canvas) return;
    const chartInstance = group === 'actual' ? actualEquipmentChartInstance : recommendedEquipmentChartInstance;
    const existingMonthlyKwh = equipmentDetails.actual.reduce(
        (total, item) => total + calculateEquipmentMonthlyKwh(item),
        0
    );
    const items = equipmentDetails[group]
        .map(item => ({
            id: item.id,
            name: item.equipmentName.trim(),
            monthlyKwh: calculateEquipmentMonthlyKwh(item)
        }))
        .filter(item => item.name && Number.isFinite(item.monthlyKwh) && item.monthlyKwh > 0);

    const totalMonthlyKwh = items.reduce((total, item) => total + item.monthlyKwh, 0);
    if (group === 'actual') {
        document.getElementById('existingMonthlyEnergy').textContent = `${formatEquipmentEnergy(totalMonthlyKwh)} kWh`;
    } else {
        document.getElementById('recommendedMonthlyEnergy').textContent = `${formatEquipmentEnergy(totalMonthlyKwh)} kWh`;
        const savedKwh = existingMonthlyKwh - totalMonthlyKwh;
        const savingsPercent = existingMonthlyKwh > 0 ? (savedKwh / existingMonthlyKwh) * 100 : 0;
        document.getElementById('energySavedMonthly').textContent = `${formatEquipmentEnergy(savedKwh)} kWh`;
        document.getElementById('energySavedPercent').textContent = existingMonthlyKwh > 0
            ? `${savingsPercent.toFixed(1)}%`
            : 'N/A (no existing baseline)';
    }

    if (chartInstance) chartInstance.destroy();
    if (!items.length && (group !== 'recommended' || existingMonthlyKwh === 0)) {
        canvas.style.display = 'none';
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'chart-unavailable';
        emptyMessage.textContent = `Add ${group === 'actual' ? 'existing' : 'recommended'} equipment details to see its monthly energy chart.`;
        const existingMessage = canvas.parentElement.querySelector('.chart-unavailable');
        if (existingMessage) existingMessage.replaceWith(emptyMessage);
        else canvas.parentElement.appendChild(emptyMessage);
        if (group === 'actual') actualEquipmentChartInstance = null;
        else recommendedEquipmentChartInstance = null;
        return;
    }

    if (typeof Chart === 'undefined') {
        showChartUnavailable(canvas);
        if (group === 'actual') actualEquipmentChartInstance = null;
        else recommendedEquipmentChartInstance = null;
        return;
    }

    const fallback = canvas.parentElement.querySelector('.chart-unavailable');
    if (fallback) fallback.remove();
    canvas.style.display = 'block';
    const labels = items.map(item => item.name);
    const values = items.map(item => item.monthlyKwh);
    let chartTitle = `${group === 'actual' ? 'Existing' : 'Recommended'} Equipment Monthly Energy`;
    if (group === 'recommended') {
        const savedKwh = existingMonthlyKwh - totalMonthlyKwh;
        if (savedKwh > 0) {
            labels.push('Energy saved');
            values.push(savedKwh);
        }
        chartTitle = 'Recommended Energy Compared with Existing';
    }
    const chart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                label: 'Monthly Energy (kWh)',
                data: values,
                backgroundColor: ['#04e617', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316', '#ec4899', '#64748b'],
                borderColor: '#121824',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: chartTitle, color: '#cbd5e1' },
                legend: { position: 'bottom', labels: { color: '#cbd5e1' } },
                tooltip: {
                    callbacks: {
                        label: context => `${context.label}: ${Number(context.raw).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh/month`
                    }
                }
            }
        }
    });
    if (group === 'actual') actualEquipmentChartInstance = chart;
    else recommendedEquipmentChartInstance = chart;
}

function calculateEquipmentMonthlyKwh(item) {
    const watts = Number(item.powerWatts);
    const quantity = Number(item.qty);
    const hours = Number(item.hoursPerDay);
    if (!item.equipmentName.trim() || !Number.isFinite(watts) || watts <= 0
        || !Number.isInteger(quantity) || quantity <= 0
        || !Number.isFinite(hours) || hours <= 0 || hours > 24) return 0;
    return watts * quantity * hours * 30 / 1000;
}

function formatEquipmentEnergy(value) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
