const ALL_FACILITIES_REPORT = '__all_facilities__';

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

function normalizeHostelName(name) {
    const trimmedName = String(name || '').trim();
    return ['hostel A', 'hostel B', 'ngeria hostels'].includes(trimmedName.toLocaleLowerCase())
        ? 'NGERIA HOSTELS'
        : trimmedName;
}

function initializeReportFacilitySelector() {
    const selector = document.getElementById('reportFacilitySelector');
    if (!selector) return;
    selector.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = audits.some(audit => Array.isArray(audit.inventory) && audit.inventory.length)
        ? 'Select a facility...'
        : 'No audits with equipment available';
    selector.appendChild(placeholder);

    const reportAudits = audits
        .filter(audit => Array.isArray(audit.inventory) && audit.inventory.length)
        .slice()
        .sort((a, b) => currentAuditLabel(a).localeCompare(currentAuditLabel(b), 'en', {
            numeric: true,
            sensitivity: 'base'
        }));
    if (reportAudits.length) {
        const allFacilities = document.createElement('option');
        allFacilities.value = ALL_FACILITIES_REPORT;
        allFacilities.textContent = 'All facilities';
        selector.appendChild(allFacilities);
    }
    reportAudits.forEach(audit => {
        const option = document.createElement('option');
        option.value = audit.key;
        option.textContent = currentAuditLabel(audit);
        selector.appendChild(option);
    });

    const activeAudit = getCurrentAudit(false);
    selector.value = activeAudit && activeAudit.inventory.length ? activeAudit.key : '';
    document.getElementById('generateAuditReportButton').disabled = reportAudits.length === 0;
}

function normalizeHostelAudits() {
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
        auditDate: new Date().toISOString().slice(0, 10),
        auditPurpose: '',
        scope: ''
    };
}

function getCurrentAudit(create = true) {
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
            hostelGroup.appendChild(addHostelOption);
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
    if (selection === ALL_FACILITIES_REPORT) {
        document.getElementById('aiReportContent').textContent =
            'All facilities selected. Generate the comprehensive report to view combined results.';
        document.getElementById('reportPhotoGallery').innerHTML = '';
        return;
    }
    const record = audits.find(audit => audit.key === selection &&
        Array.isArray(audit.inventory) && audit.inventory.length);
    if (!record) {
        if (selection) alert('Select a facility audit that contains equipment before generating a report.');
        initializeReportFacilitySelector();
        return;
    }
    selectedFacility = record.facilityId;
    selectedHostelName = record.hostelName || '';
    document.getElementById('facilitySelector').value = record.key;
    document.getElementById('hostelName').value = selectedHostelName;
    document.getElementById('hostelNameGroup').style.display = selectedFacility === 'Hostels' ? 'flex' : 'none';
    loadActiveAudit();
}

function handleFacilitySelection() {
    const selectedValue = document.getElementById('facilitySelector').value;
    if (!selectedValue) {
        selectedFacility = '';
        selectedHostelName = '';
        document.getElementById('printFacilitySelector').value = '';
        document.getElementById('hostelNameGroup').style.display = 'none';
        document.getElementById('hostelName').value = '';
        loadActiveAudit();
        updateSubmissionStatus();
        return;
    }
    if (selectedValue === ADD_HOSTEL_OPTION) {
        startNewHostel();
        return;
    }
    const hostelAudit = audits.find(audit => audit.key === selectedValue && audit.facilityId === 'Hostels');
    selectedFacility = hostelAudit ? 'Hostels' : selectedValue;
    selectedHostelName = hostelAudit ? hostelAudit.hostelName : '';
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
    facilityInfo.facilityLocation = document.getElementById('facilityLocation').value.trim();
    if (currentUser) facilityInfo.authorName = currentUser.name;
    facilityInfo.energySources = document.getElementById('energySources').value.trim();
    facilityInfo.auditDate = document.getElementById('auditDate').value;
    facilityInfo.auditPurpose = document.getElementById('auditPurpose').value.trim();
    facilityInfo.scope = document.getElementById('auditScope').value.trim();

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
    facilityInfo = record ? { ...createEmptyFacilityInfo(), ...record.facilityInfo } : createEmptyFacilityInfo();
    if (!selectedFacility) facilityInfo.auditDate = '';
    if (currentUser) facilityInfo.authorName = currentUser.name;
    historicalData = record && Array.isArray(record.historicalData) ? record.historicalData : [];
    auditPhotos = record && Array.isArray(record.photos) ? record.photos : [];
    document.getElementById('facilityLocation').value = facilityInfo.facilityLocation || '';
    document.getElementById('authorName').value = facilityInfo.authorName || '';
    document.getElementById('energySources').value = facilityInfo.energySources || '';
    document.getElementById('auditDate').value = facilityInfo.auditDate || (selectedFacility ? new Date().toISOString().slice(0, 10) : '');
    document.getElementById('auditPurpose').value = facilityInfo.auditPurpose || '';
    document.getElementById('auditScope').value = facilityInfo.scope || '';
    const energySettings = record && record.energySettings
        ? { ...createDefaultEnergySettings(), ...record.energySettings }
        : createDefaultEnergySettings();
    document.getElementById('tariffRate').value = energySettings.tariffRate;
    document.getElementById('emissionFactor').value = energySettings.emissionFactor;
    renderHistoricalData(historicalData);
    renderAuditPhotos(auditPhotos);
    updateFacilityLabels();
    calculateAll();
    updateAuditReportDisplay();
    initializeReportFacilitySelector();
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

    const populatedAudit = audits.find(audit => audit.inventory.length > 0);
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
        alert('Administrator accounts cannot add equipment to audits.');
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
