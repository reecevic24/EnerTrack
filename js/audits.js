const ALL_FACILITIES_REPORT = '__all_facilities__';
let selectedReportAuditValue = '';

function isReportAdministrator() {
    return !!currentUser && currentUser.role === 'admin';
}

function reportAuditOptionValue(audit) {
    return audit.id ? `audit:${audit.id}` : `facility:${audit.key}`;
}

function getAdminReportAudits() {
    const reportAudits = audits.slice();
    facilityNames.forEach(name => {
        const alreadyListed = reportAudits.some(audit =>
            String(audit.facilityId).toLocaleLowerCase() === name.toLocaleLowerCase()
        );
        if (!alreadyListed) {
            reportAudits.push({
                id: null,
                key: name,
                facilityId: name,
                hostelName: '',
                status: 'draft',
                facilityInfo: {},
                inventory: [],
                historicalData: [],
                photos: [],
                energySettings: createDefaultEnergySettings(),
                findings: '',
                recommendations: []
            });
        }
    });
    return reportAudits;
}

function currentAuditKey(facility = selectedFacility, hostelName = selectedHostelName) {
    if (facility === 'Hostels') {
        return hostelName.trim() ? `Hostels:${hostelName.trim().toLocaleLowerCase()}` : '';
    }
    return facility;
}

function currentAuditLabel(record) {
    return record.facilityId === 'Hostels' && record.hostelName
        ? `Hostels - ${record.hostelName}`
        : record.facilityId;
}

function reportAuditLabel(record) {
    const label = currentAuditLabel(record);
    if (!isReportAdministrator() || !record.id) return label;
    const owner = record.auditorName || record.auditorEmail;
    if (!owner) return label;
    return `${label} — ${record.auditorName || owner}${
        record.auditorName && record.auditorEmail ? ` (${record.auditorEmail})` : ''
    }`;
}

function findReportAudit(selection) {
    if (selection.startsWith('audit:')) {
        return audits.find(audit => String(audit.id) === selection.slice('audit:'.length));
    }
    if (selection.startsWith('facility:')) {
        const key = selection.slice('facility:'.length);
        const records = isReportAdministrator() ? getAdminReportAudits() : audits;
        return records.find(audit => audit.key === key);
    }
    return audits.find(audit => audit.key === selection);
}

function normalizeHostelName(name) {
    const trimmedName = String(name || '').trim();
    return ['hostel A', 'hostel B', 'ngeria hostels'].includes(trimmedName.toLocaleLowerCase())
        ? 'NGERIA HOSTELS'
        : trimmedName;
}

function initializeReportFacilitySelector() {
    const selector = document.getElementById('reportFacilitySelector');
    if (!selector) return;
    const previousSelection = selectedReportAuditValue || selector.value;
    selector.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    const reportAudits = (isReportAdministrator() ? getAdminReportAudits() : audits)
        .filter(audit => isReportAdministrator() || (Array.isArray(audit.inventory) && audit.inventory.length))
        .slice()
        .sort((a, b) => reportAuditLabel(a).localeCompare(reportAuditLabel(b), 'en', {
            numeric: true,
            sensitivity: 'base'
        }));
    placeholder.textContent = reportAudits.length
        ? 'Select a facility...'
        : 'No audits with equipment available';
    selector.appendChild(placeholder);

    if (reportAudits.length) {
        const allFacilities = document.createElement('option');
        allFacilities.value = ALL_FACILITIES_REPORT;
        allFacilities.textContent = isReportAdministrator() ? 'All facilities and audits' : 'All facilities';
        selector.appendChild(allFacilities);
    }
    reportAudits.forEach(audit => {
        const option = document.createElement('option');
        option.value = reportAuditOptionValue(audit);
        option.textContent = reportAuditLabel(audit);
        selector.appendChild(option);
    });

    const previousSelectionExists = reportAudits.some(audit =>
        reportAuditOptionValue(audit) === previousSelection
    );
    const activeAudit = getCurrentAudit(false);
    const activeAuditValue = activeAudit &&
        (isReportAdministrator() || activeAudit.inventory.length)
        ? reportAuditOptionValue(activeAudit)
        : '';
    selector.value = previousSelectionExists
        ? previousSelection
        : (previousSelection === ALL_FACILITIES_REPORT && reportAudits.length
            ? ALL_FACILITIES_REPORT
            : activeAuditValue);
    selectedReportAuditValue = selector.value;
    document.getElementById('generateAuditReportButton').disabled = reportAudits.length === 0;
}

function normalizeHostelAudits() {
    if (isReportAdministrator()) return;

    const normalizedAudits = [];
    const hostelAuditsByKey = new Map();

    audits.forEach(audit => {
        if (audit.facilityId === 'Hostels' && audit.hostelName) {
            audit.hostelName = normalizeHostelName(audit.hostelName);
            if (audit.hostelName === 'NGERIA HOSTELS') {
                audit.facilityId = 'NGERIA HOSTELS';
                audit.hostelName = '';
                audit.key = 'NGERIA HOSTELS';
            } else {
                audit.key = currentAuditKey('Hostels', audit.hostelName);
            }
        } else if (audit.facilityId === 'NGERIA HOSTELS') {
            audit.key = 'NGERIA HOSTELS';
            audit.hostelName = '';
        } else {
            normalizedAudits.push(audit);
            return;
        }

        const existing = hostelAuditsByKey.get(audit.key);
        if (!existing) {
            hostelAuditsByKey.set(audit.key, audit);
            normalizedAudits.push(audit);
            return;
        }

        existing.inventory.push(...audit.inventory);
        const historyByMonth = new Map(
            [...existing.historicalData, ...audit.historicalData].map(entry => [entry.month, entry])
        );
        existing.historicalData = Array.from(historyByMonth.values());
        existing.photos.push(...audit.photos);
        const mergedFacilityInfo = { ...audit.facilityInfo };
        Object.entries(existing.facilityInfo).forEach(([key, value]) => {
            if (value !== '' && value !== null && value !== undefined) {
                mergedFacilityInfo[key] = value;
            }
        });
        existing.facilityInfo = mergedFacilityInfo;
        existing.report = '';
        existing.reportGeneratedAt = '';
    });

    audits = normalizedAudits;
}

function createEmptyFacilityInfo() {
    return {
        facilityLocation: '',
        floorArea: '',
        authorName: '',
        energySources: '',
        auditDate: new Date().toISOString().slice(0, 10)
    };
}

function getCurrentAudit(create = true) {
    if (currentUser && currentUser.role === 'admin') {
        const selectedId = typeof selectedAdminAuditId === 'undefined' ? '' : selectedAdminAuditId;
        return audits.find(audit => audit.id && String(audit.id) === String(selectedId)) || null;
    }
    const key = currentAuditKey();
    if (!key) return null;
    let record = audits.find(audit => audit.key === key);
    if (!record && create) {
        record = {
            key,
            facilityId: selectedFacility,
            hostelName: selectedFacility === 'Hostels' ? selectedHostelName.trim() : '',
            facilityInfo: createEmptyFacilityInfo(),
            energySettings: createDefaultEnergySettings(),
            inventory: [],
            historicalData: [],
            photos: [],
            report: '',
            reportGeneratedAt: ''
        };
        audits.push(record);
    }
    return record || null;
}

function initializeFacilitySelector() {
    const selector = document.getElementById('facilitySelector');
    const printSelector = document.getElementById('printFacilitySelector');
    selector.innerHTML = '';
    printSelector.innerHTML = '';
    const facilityPlaceholder = document.createElement('option');
    facilityPlaceholder.value = '';
    facilityPlaceholder.textContent = 'Select a facility...';
    selector.appendChild(facilityPlaceholder);
    const printPlaceholder = document.createElement('option');
    printPlaceholder.value = '';
    printPlaceholder.textContent = 'Select a facility...';
    printSelector.appendChild(printPlaceholder);
    if (isAdministrator()) {
        const adminAudits = audits
            .filter(audit => audit.id)
            .slice()
            .sort((a, b) => reportAuditLabel(a).localeCompare(reportAuditLabel(b), 'en', {
                numeric: true,
                sensitivity: 'base'
            }));
        facilityPlaceholder.textContent = adminAudits.length
            ? 'Select an audit...'
            : 'No facility audits available';
        adminAudits.forEach(audit => {
            const option = document.createElement('option');
            option.value = String(audit.id);
            option.textContent = `${reportAuditLabel(audit)} · ${audit.status}`;
            selector.appendChild(option);
            const printOption = document.createElement('option');
            printOption.value = String(audit.id);
            printOption.textContent = option.textContent;
            printSelector.appendChild(printOption);
        });
        selector.value = selectedAdminAuditId;
        printSelector.value = selectedAdminAuditId;
        document.getElementById('hostelNameGroup').style.display = selectedFacility === 'Hostels' ? 'flex' : 'none';
        document.getElementById('hostelName').value = selectedHostelName;
        initializeReportFacilitySelector();
        return;
    }

    const hostelAudits = audits
        .filter(audit => audit.facilityId === 'Hostels' && audit.hostelName)
        .sort((a, b) =>
            a.hostelName.trim().localeCompare(b.hostelName.trim(), 'en', {
                numeric: true,
                sensitivity: 'base'
            }) || a.key.localeCompare(b.key)
        );
    facilityNames.forEach(name => {
        if (name === 'Hostels') {
            const hostelGroup = document.createElement('optgroup');
            hostelGroup.label = 'Hostels';
            hostelAudits.forEach(audit => {
                const namedHostelOption = document.createElement('option');
                namedHostelOption.value = audit.key;
                namedHostelOption.textContent = audit.hostelName;
                hostelGroup.appendChild(namedHostelOption);
            });
            const addHostelOption = document.createElement('option');
            addHostelOption.value = ADD_HOSTEL_OPTION;
            addHostelOption.textContent = 'Add Hostel...';
            if (!isAdministrator()) hostelGroup.appendChild(addHostelOption);
            selector.appendChild(hostelGroup);
            const printHostelGroup = document.createElement('optgroup');
            printHostelGroup.label = 'Hostels';
            hostelAudits.forEach(audit => {
                const namedHostelOption = document.createElement('option');
                namedHostelOption.value = audit.key;
                namedHostelOption.textContent = audit.hostelName;
                printHostelGroup.appendChild(namedHostelOption);
            });
            printSelector.appendChild(printHostelGroup);
            return;
        }

        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selector.appendChild(option);
        const printOption = document.createElement('option');
        printOption.value = name;
        printOption.textContent = name;
        printSelector.appendChild(printOption);
    });
    const activeValue = selectedFacility === 'Hostels'
        ? (selectedHostelName ? currentAuditKey() : ADD_HOSTEL_OPTION)
        : selectedFacility;
    selector.value = activeValue;
    printSelector.value = selectedFacility === 'Hostels' && !selectedHostelName
        ? ''
        : activeValue;
    document.getElementById('hostelNameGroup').style.display = selectedFacility === 'Hostels' ? 'flex' : 'none';
    document.getElementById('hostelName').value = selectedHostelName;
    initializeReportFacilitySelector();
}

function handlePrintFacilitySelection() {
    const printSelection = document.getElementById('printFacilitySelector').value;
    const hostelAudit = audits.find(audit => audit.key === printSelection && audit.facilityId === 'Hostels');
    if (hostelAudit) {
        selectedFacility = 'Hostels';
        selectedHostelName = hostelAudit.hostelName;
        document.getElementById('facilitySelector').value = 'Hostels';
        document.getElementById('hostelName').value = selectedHostelName;
        document.getElementById('hostelNameGroup').style.display = 'flex';
        loadActiveAudit();
        return;
    }
    document.getElementById('facilitySelector').value = printSelection;
    handleFacilitySelection();
}

function handleReportFacilitySelection() {
    const selection = document.getElementById('reportFacilitySelector').value;
    selectedReportAuditValue = selection;
    if (selection === ALL_FACILITIES_REPORT) {
        document.getElementById('aiReportContent').textContent =
            'All facilities selected. Generate the comprehensive report to view combined results.';
        document.getElementById('reportPhotoGallery').innerHTML = '';
        return;
    }
    const record = findReportAudit(selection);
    const canSelectEmptyAudit = isReportAdministrator();
    if (!record) {
        if (selection) alert('Select a facility audit available to your account.');
        initializeReportFacilitySelector();
        return;
    }
    if (!canSelectEmptyAudit && (!Array.isArray(record.inventory) || !record.inventory.length)) {
        alert('Select a facility audit that contains equipment before generating a report.');
        initializeReportFacilitySelector();
        return;
    }
    selectedFacility = record.facilityId;
    selectedHostelName = record.hostelName || '';
    document.getElementById('facilitySelector').value = record.key;
    document.getElementById('hostelName').value = selectedHostelName;
    document.getElementById('hostelNameGroup').style.display = selectedFacility === 'Hostels' ? 'flex' : 'none';
    if (canSelectEmptyAudit) {
        const report = document.getElementById('aiReportContent');
        report.textContent = Array.isArray(record.inventory) && record.inventory.length
            ? `${reportAuditLabel(record)} selected. Generate its report to view the audit details.`
            : `${reportAuditLabel(record)} has no equipment recorded. Generate a report to view its current audit status.`;
        document.getElementById('reportPhotoGallery').innerHTML = '';
        return;
    }
    loadActiveAudit();
}

function handleFacilitySelection() {
    const selectedValue = document.getElementById('facilitySelector').value;
    if (!selectedValue) {
        selectedFacility = '';
        selectedHostelName = '';
        selectedAdminAuditId = '';
        document.getElementById('printFacilitySelector').value = '';
        document.getElementById('hostelNameGroup').style.display = 'none';
        document.getElementById('hostelName').value = '';
        loadActiveAudit();
        updateSubmissionStatus();
        return;
    }
    if (isAdministrator()) {
        const selectedAudit = audits.find(audit => String(audit.id) === selectedValue);
        if (!selectedAudit) {
            alert('Select a facility audit available to your account.');
            initializeFacilitySelector();
            return;
        }
        selectedAdminAuditId = String(selectedAudit.id);
        selectedFacility = selectedAudit.facilityId;
        selectedHostelName = selectedAudit.hostelName || '';
        document.getElementById('printFacilitySelector').value = selectedAdminAuditId;
        document.getElementById('hostelName').value = selectedHostelName;
        document.getElementById('hostelNameGroup').style.display = selectedFacility === 'Hostels' ? 'flex' : 'none';
        loadActiveAudit();
        return;
    }
    if (selectedValue === ADD_HOSTEL_OPTION) {
        startNewHostel();
        return;
    }
    const hostelAudit = audits.find(audit => audit.key === selectedValue && audit.facilityId === 'Hostels');
    selectedFacility = hostelAudit ? 'Hostels' : selectedValue;
    selectedHostelName = hostelAudit ? hostelAudit.hostelName : '';
    if (isAdministrator()) {
        const selectedAudit = hostelAudit || audits.find(audit => audit.key === selectedValue && audit.id);
        selectedAdminAuditId = selectedAudit ? String(selectedAudit.id) : '';
    }
    document.getElementById('printFacilitySelector').value = selectedFacility === 'Hostels' && selectedHostelName
        ? currentAuditKey(selectedFacility, selectedHostelName)
        : selectedFacility;
    document.getElementById('hostelName').value = selectedHostelName;
    document.getElementById('hostelNameGroup').style.display = selectedFacility === 'Hostels' ? 'flex' : 'none';
    if (selectedFacility !== 'Hostels') {
        getCurrentAudit();
        loadActiveAudit();
    } else {
        loadActiveAudit();
    }
}

function startNewHostel() {
    if (isAdministrator()) return;
    const currentRecord = getCurrentAudit(false);
    if (currentRecord) {
        currentRecord.inventory = inventory;
        currentRecord.facilityInfo = { ...facilityInfo };
        currentRecord.historicalData = historicalData;
        currentRecord.photos = auditPhotos;
        saveAudits();
    }

    selectedFacility = 'Hostels';
    selectedHostelName = '';
    document.getElementById('facilitySelector').value = ADD_HOSTEL_OPTION;
    document.getElementById('hostelNameGroup').style.display = 'flex';
    document.getElementById('hostelName').value = '';
    loadActiveAudit();
}

function selectHostelAudit() {
    if (isAdministrator()) return;
    const input = document.getElementById('hostelName');
    const previousHostelName = selectedHostelName;
    const correctedHostelName = normalizeHostelName(input.value);
    if (!correctedHostelName) {
        input.value = previousHostelName;
        if (!previousHostelName) loadActiveAudit();
        return;
    }

    const previousKey = previousHostelName ? currentAuditKey('Hostels', previousHostelName) : '';
    const hostelAudit = previousKey
        ? audits.find(audit => audit.key === previousKey && audit.facilityId === 'Hostels')
        : null;
    const correctedKey = currentAuditKey('Hostels', correctedHostelName);
    const duplicateAudit = audits.find(audit =>
        audit.key === correctedKey && audit !== hostelAudit
    );
    if (duplicateAudit) {
        if (!hostelAudit && duplicateAudit.facilityId === 'Hostels') {
            selectedHostelName = duplicateAudit.hostelName;
            input.value = selectedHostelName;
            initializeFacilitySelector();
            loadActiveAudit();
            return;
        }
        alert('A hostel with that name already exists. Select it from the facility list instead.');
        input.value = previousHostelName;
        return;
    }

    if (hostelAudit) {
        hostelAudit.inventory = inventory;
        hostelAudit.facilityInfo = { ...facilityInfo };
        hostelAudit.historicalData = historicalData;
        hostelAudit.photos = auditPhotos;
        hostelAudit.hostelName = correctedHostelName;
        hostelAudit.key = correctedKey;
        hostelAudit.report = '';
        hostelAudit.reportGeneratedAt = '';
    }

    selectedHostelName = correctedHostelName;
    input.value = correctedHostelName;
    getCurrentAudit();
    initializeFacilitySelector();
    loadActiveAudit();
}

function saveFacilityDetails() {
    if (isAdministrator()) return;
    facilityInfo.facilityLocation = document.getElementById('facilityLocation').value.trim();
    if (currentUser && !isAdministrator()) facilityInfo.authorName = currentUser.name;
    facilityInfo.energySources = document.getElementById('energySources').value.trim();
    facilityInfo.auditDate = document.getElementById('auditDate').value;

    if (currentUser) {
        const record = getCurrentAudit();
        if (record) {
            record.facilityInfo = { ...facilityInfo };
            record.historicalData = historicalData;
            record.photos = auditPhotos;
            record.report = '';
            record.reportGeneratedAt = '';
            saveAudits();
        }
    }
    document.getElementById('authorName').value = facilityInfo.authorName || '';
    updateFacilityLabels();
    updateAuditReportDisplay();
    updateSubmissionStatus();
}

function loadActiveAudit() {
    const record = getCurrentAudit();
    inventory = record ? record.inventory : [];
    adminCalculationItems = [];
    facilityInfo = record ? { ...createEmptyFacilityInfo(), ...record.facilityInfo } : createEmptyFacilityInfo();
    if (!selectedFacility) facilityInfo.auditDate = '';
    if (currentUser && !isAdministrator()) facilityInfo.authorName = currentUser.name;
    historicalData = record && Array.isArray(record.historicalData) ? record.historicalData : [];
    auditPhotos = record && Array.isArray(record.photos) ? record.photos : [];
    document.getElementById('facilityLocation').value = facilityInfo.facilityLocation || '';
    document.getElementById('authorName').value = facilityInfo.authorName || '';
    document.getElementById('energySources').value = facilityInfo.energySources || '';
    document.getElementById('auditDate').value = facilityInfo.auditDate || (selectedFacility ? new Date().toISOString().slice(0, 10) : '');
    const energySettings = record && record.energySettings
        ? { ...createDefaultEnergySettings(), ...record.energySettings }
        : createDefaultEnergySettings();
    document.getElementById('tariffRate').value = energySettings.tariffRate;
    document.getElementById('emissionFactor').value = energySettings.emissionFactor;
    renderHistoricalData(historicalData);
    renderAuditPhotos(auditPhotos);
    renderAdminFacilityInventory();
    renderAdminCalculationResults();
    setFacilityReadOnly();
    updateFacilityLabels();
    calculateAll();
    updateAuditReportDisplay();
    initializeReportFacilitySelector();
}

function renderAdminFacilityInventory() {
    const container = document.getElementById('adminFacilityInventory');
    const body = document.getElementById('adminFacilityInventoryBody');
    if (!container || !body) return;
    const adminView = isAdministrator();
    container.hidden = !adminView;
    if (!adminView) return;

    body.innerHTML = '';
    if (!inventory.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.className = 'empty-state';
        cell.textContent = 'No equipment recorded for this facility.';
        row.appendChild(cell);
        body.appendChild(row);
        return;
    }
    inventory.forEach(item => {
        const row = document.createElement('tr');
        [item.category || 'General', item.name, `${item.watts} W`, item.qty, `${item.hours} hrs`]
            .forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
        body.appendChild(row);
    });
}

function setFacilityReadOnly() {
    const adminView = isAdministrator();
    const page = document.getElementById('pageFacilities');
    if (!page) return;
    const facilitySelector = document.getElementById('facilitySelector');
    const auditForm = document.getElementById('auditForm');
    const adminCalculator = document.getElementById('adminEquipmentCalculator');
    page.querySelectorAll('input, select, textarea, button').forEach(control => {
        control.disabled = adminView &&
            control !== facilitySelector &&
            !(auditForm && auditForm.contains(control)) &&
            !(adminCalculator && adminCalculator.contains(control));
    });
    if (facilitySelector) facilitySelector.disabled = false;
    document.getElementById('administratorFacilityNotice').hidden = !adminView;
    auditForm.hidden = false;
    document.getElementById('adminEquipmentCalculator').hidden = !adminView;
    document.getElementById('auditPhotoUpload').hidden = adminView;
    document.getElementById('auditSubmissionPanel').hidden = adminView;
    document.getElementById('historyActionHeader').hidden = adminView;
    const hostelSaveButton = document.querySelector('#hostelNameGroup button');
    if (hostelSaveButton) hostelSaveButton.hidden = adminView;
    document.getElementById('equipmentSubmitButton').textContent = adminView
        ? 'Calculate only'
        : 'Calculate and Add Inventory';
}

function resetFacilityEntryAfterSubmission() {
    selectedFacility = '';
    selectedHostelName = '';
    initializeFacilitySelector();
    loadActiveAudit();
    switchPage('facilities');
}

function updateFacilityLabels() {
    const bName = selectedFacility === 'Hostels' && selectedHostelName
        ? `Hostels - ${selectedHostelName}`
        : selectedFacility;
    const fLoc = facilityInfo.facilityLocation || 'Not Specified';
    const aName = facilityInfo.authorName || (currentUser ? currentUser.name : 'Not Specified');

    document.getElementById('lblBuilding').textContent = bName;
    document.getElementById('lblLocation').textContent = fLoc;
    document.getElementById('lblAuthor').textContent = aName;

    if(facilityInfo.authorName) {
        document.getElementById('printHeaderUserName').textContent = facilityInfo.authorName;
    } else if (currentUser && currentUser.name) {
        document.getElementById('printHeaderUserName').textContent = currentUser.name;
    }
}

function persistCurrentAuditEvidence() {
    const record = getCurrentAudit();
    if (!record) return;
    record.facilityInfo = { ...facilityInfo };
    record.historicalData = historicalData;
    record.photos = auditPhotos;
    record.report = '';
    record.reportGeneratedAt = '';
    saveAudits();
    updateAuditReportDisplay();
    updateSubmissionStatus();
}

async function loadFacilityCatalog() {
    try {
        const { facilities } = await apiRequest('/api/facilities');
        const names = (Array.isArray(facilities) ? facilities : [])
            .map(facility => facility && facility.name)
            .filter(name => typeof name === 'string' && name.trim());
        if (names.length) {
            facilityNames.length = 0;
            facilityNames.push(...names);
        }
    } catch (error) {
        console.error('Unable to load the facility catalogue; using the built-in list.', error);
    }
}

async function loadUserData() {
    if (!currentUser) return;
    await loadFacilityCatalog();
    const response = await apiRequest('/api/audits');
    const serverAudits = response.audits;
    auditsRevision = null;
    if (Array.isArray(serverAudits) && serverAudits.length) {
        try {
            audits = serverAudits.map(audit => ({
                id: audit.id || null,
                status: audit.status || 'draft',
                submittedAt: audit.submittedAt || '',
                reviewedAt: audit.reviewedAt || '',
                reviewedBy: audit.reviewedBy || '',
                auditorEmail: audit.auditorEmail || currentUser.email,
                auditorName: audit.auditorName || currentUser.name,
                key: audit.key || audit.facilityId,
                facilityId: audit.facilityId || 'Admin',
                hostelName: audit.hostelName || '',
                facilityInfo: { ...createEmptyFacilityInfo(), ...(audit.facilityInfo || {}) },
                inventory: Array.isArray(audit.inventory) ? audit.inventory : [],
                historicalData: Array.isArray(audit.historicalData) ? audit.historicalData : [],
                photos: Array.isArray(audit.photos) ? audit.photos.map(photo => ({
                    ...photo,
                    dataUrl: photo.url ? `${API_BASE}${photo.url}` : photo.dataUrl
                })) : [],
                energySettings: {
                    tariffRate: Number(audit.tariffRate) || DEFAULT_TARIFF_RATE,
                    emissionFactor: Number.isFinite(Number(audit.emissionFactor))
                        ? Number(audit.emissionFactor)
                        : DEFAULT_EMISSION_FACTOR
                },
                report: audit.report || '',
                reportGeneratedAt: audit.reportGeneratedAt || '',
                reportVersion: audit.report ? AUDIT_REPORT_VERSION : 0,
                findings: audit.findings || '',
                recommendations: Array.isArray(audit.recommendations) ? audit.recommendations : []
            }));
        } catch (error) {
            console.error('Unable to load saved facility audits.', error);
            alert('Saved audit data could not be read. The app will open with empty facility audits.');
            audits = [];
        }
    } else {
        audits = [];
    }

    normalizeHostelAudits();
    facilityNames.filter(name => name !== 'Hostels').forEach(name => {
        if (!audits.some(audit => audit.key === name)) {
            audits.push({
                id: null,
                status: 'draft',
                key: name,
                facilityId: name,                    hostelName: '',
                    facilityInfo: createEmptyFacilityInfo(),
                    energySettings: createDefaultEnergySettings(),
                    inventory: [],
                historicalData: [],
                photos: [],
                report: '',
                reportGeneratedAt: ''
            });
        }
    });

    const populatedAudit = isAdministrator()
        ? audits.find(audit => audit.id) || null
        : audits.find(audit => audit.inventory.length > 0);
    selectedAdminAuditId = isAdministrator() && populatedAudit ? String(populatedAudit.id) : '';
    selectedFacility = populatedAudit ? populatedAudit.facilityId : 'Admin';
    selectedHostelName = populatedAudit && populatedAudit.facilityId === 'Hostels' ? populatedAudit.hostelName : '';
    initializeFacilitySelector();
    loadActiveAudit();
}

function saveUserData() {
    if (!currentUser) return;
    const record = getCurrentAudit();
    if (record) {
        record.inventory = inventory;
        saveAudits();
    }
    updateUniversitySummary();
    updateSubmissionStatus();
}

function addEquipment() {
    if (isAdministrator()) {
        calculateAdminEquipment();
        return;
    }
    if (selectedFacility === 'Hostels' && !selectedHostelName) {
        alert('Enter the hostel name before adding its equipment.');
        return;
    }
    const category = document.getElementById('equipmentCategory').value;
    const name = document.getElementById('equipment').value.trim();
    const watts = parseFloat(document.getElementById('wattage').value);
    const pf = 1;
    const qty = parseInt(document.getElementById('availableNumber').value);
    const hours = parseFloat(document.getElementById('operatingHours').value);

    if (!name || !Number.isFinite(watts) || watts <= 0 || !Number.isInteger(qty) || qty < 1 || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
        alert('Enter a valid equipment name, positive power, whole-number quantity, and daily operating hours from 0 to 24.');
        return;
    }

    const item = { id: Date.now(), category, name, watts, pf, qty, hours };
    inventory.push(item);
    const record = getCurrentAudit();
    if (record) {
        record.report = '';
        record.reportGeneratedAt = '';
    }
    saveUserData();

    document.getElementById('auditForm').reset();
    calculateAll();
    updateAuditReportDisplay();
    handleFacilitySelection();
}

function calculateAdminEquipment() {
    const category = document.getElementById('equipmentCategory').value;
    const name = document.getElementById('equipment').value.trim();
    const watts = Number(document.getElementById('wattage').value);
    const qty = Number(document.getElementById('availableNumber').value);
    const hours = Number(document.getElementById('operatingHours').value);

    if (!name || !Number.isFinite(watts) || watts <= 0 ||
        !Number.isInteger(qty) || qty < 1 ||
        !Number.isFinite(hours) || hours <= 0 || hours > 24) {
        alert('Enter a valid equipment name, positive power, whole-number quantity, and daily operating hours from 0 to 24.');
        return;
    }

    adminCalculationItems.push({
        id: `temporary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        category,
        name,
        watts,
        pf: 1,
        qty,
        hours
    });
    renderAdminCalculationResults();
    document.getElementById('auditForm').reset();
}

function clearAdminEquipmentCalculations() {
    adminCalculationItems = [];
    renderAdminCalculationResults();
}

function renderAdminCalculationResults() {
    const container = document.getElementById('adminEquipmentCalculator');
    const body = document.getElementById('adminCalculationBody');
    const summary = document.getElementById('adminCalculationSummary');
    if (!container || !body || !summary) return;

    container.hidden = !isAdministrator();
    body.innerHTML = '';
    if (!adminCalculationItems.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 8;
        cell.className = 'empty-state';
        cell.textContent = 'No temporary equipment calculated.';
        row.appendChild(cell);
        body.appendChild(row);
        summary.textContent = 'No temporary equipment calculated.';
        return;
    }

    const totals = calculateInventoryTotals(
        adminCalculationItems,
        currentTariffRate(),
        currentEmissionFactor()
    );
    adminCalculationItems.forEach(item => {
        const row = document.createElement('tr');
        [
            item.category,
            item.name,
            `${item.watts} W`,
            item.qty,
            `${item.hours} hrs`,
            item.monthlyKwh.toFixed(2),
            item.monthlyCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            item.monthlyCarbon.toFixed(2)
        ].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        body.appendChild(row);
    });
    const format = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    summary.textContent = `${adminCalculationItems.length} temporary item(s) · ${format(totals.monthlyKwh)} kWh/month · KES ${format(totals.monthlyCost)}/month · ${format(totals.monthlyCarbon)} kg CO₂e/month`;
}

async function deleteItem(id) {
    if (isAdministrator()) return;
    const record = getCurrentAudit(false);
    try {
        await loadSharedSubmissions();
    } catch (error) {
        reportApiError(error);
        return;
    }
    if (isAuditLockedAsApproved(record)) {
        updateSubmissionStatus();
        alert('Equipment in an approved audit cannot be deleted.');
        return;
    }
    inventory = inventory.filter(i => i.id !== id);
    const activeRecord = getCurrentAudit();
    if (activeRecord) {
        activeRecord.report = '';
        activeRecord.reportGeneratedAt = '';
    }
    saveUserData();
    calculateAll();
    updateAuditReportDisplay();
}
