const ALL_FACILITIES_REPORT = '__all_facilities__';
let selectedReportAuditValue = '';

function isReportAdministrator() {
    return !!currentUser && currentUser.role === 'admin';
}

function reportAuditOptionValue(audit) {
    return audit.id ? `audit:${audit.id}` : `facility:${audit.key}`;
}

function getAdminReportAudits() {
    const reportAudits = audits.filter(audit => !audit.id || audit.status !== 'draft');
    facilityNames.forEach(name => {
        const alreadyListed = audits.some(audit =>
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

function currentLocalDate() {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

function createEmptyFacilityInfo() {
    return {
        facilityLocation: '',
        floorArea: '',
        authorName: '',
        energySources: '',
        auditDate: currentLocalDate()
    };
}

function initializeAuditorFacilitySelector() {
    const selector = document.getElementById('auditorFacilitySelector');
    if (!selector) return;

    const selectedName = facilityNames.find(name =>
        String(name).toLocaleLowerCase() === String(selectedFacility).toLocaleLowerCase()
    ) || '';
    selector.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a facility...';
    selector.appendChild(placeholder);

    const names = facilityNames.filter(name => name !== 'Admin');
    names.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selector.appendChild(option);
    });

    const addFacilityOption = document.createElement('option');
    addFacilityOption.value = ADD_FACILITY_OPTION;
    addFacilityOption.textContent = '＋ Add a new facility...';
    selector.appendChild(addFacilityOption);
    selector.value = selectedName && selectedName !== 'Admin' ? selectedName : '';
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
    initializeAuditorFacilitySelector();
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
            .filter(audit => audit.id && audit.status !== 'draft')
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

    const currentRecord = getCurrentAudit(false);
    const printOptions = new Map();
    facilityNames.filter(name => name !== 'Hostels').forEach(name => printOptions.set(name, name));
    audits.forEach(audit => printOptions.set(audit.key, currentAuditLabel(audit)));
    printOptions.forEach((label, value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        printSelector.appendChild(option);
    });
    printSelector.value = currentRecord ? currentRecord.key : (selectedFacility || '');
    document.getElementById('hostelNameGroup').style.display = selectedFacility === 'Hostels' ? 'flex' : 'none';
    document.getElementById('hostelName').value = selectedHostelName;
    initializeReportFacilitySelector();
}

function handlePrintFacilitySelection() {
    const printSelection = document.getElementById('printFacilitySelector').value;
    if (!isAdministrator()) {
        const record = audits.find(audit => audit.key === printSelection);
        const selector = document.getElementById('auditorFacilitySelector');
        selector.value = record ? record.facilityId : printSelection;
        startFacilityAudit(record ? record.key : '');
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
    if (isAdministrator()) {
        selectedAdminAuditId = record.id ? String(record.id) : '';
        const facilitySelector = document.getElementById('facilitySelector');
        const printSelector = document.getElementById('printFacilitySelector');
        if (facilitySelector) facilitySelector.value = selectedAdminAuditId;
        if (printSelector) printSelector.value = selectedAdminAuditId;
    } else {
        const printSelector = document.getElementById('printFacilitySelector');
        const auditorSelector = document.getElementById('auditorFacilitySelector');
        if (auditorSelector) auditorSelector.value = record.facilityId;
        if (printSelector) printSelector.value = record.key;
    }
    document.getElementById('hostelName').value = selectedHostelName;
    document.getElementById('hostelNameGroup').style.display = selectedFacility === 'Hostels' ? 'flex' : 'none';
    loadActiveAudit();
    if (canSelectEmptyAudit) {
        const report = document.getElementById('aiReportContent');
        report.textContent = Array.isArray(record.inventory) && record.inventory.length
            ? `${reportAuditLabel(record)} selected. Generate its report to view the audit details.`
            : `${reportAuditLabel(record)} has no equipment recorded. Generate a report to view its current audit status.`;
        document.getElementById('reportPhotoGallery').innerHTML = '';
        return;
    }
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
        syncReportFacilityToCurrentAudit();
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
        syncReportFacilityToCurrentAudit();
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
    syncReportFacilityToCurrentAudit();
}

function isFacilitySubmittedInCatalog(name) {
    if (!name || typeof facilityCatalog === 'undefined' || !Array.isArray(facilityCatalog)) return false;
    const match = facilityCatalog.find(item =>
        String(item.name || '').toLocaleLowerCase() === String(name).toLocaleLowerCase()
    );
    return !!(match && match.isSubmitted);
}

function markFacilitySubmittedInCatalog(name, isSubmitted = true) {
    if (!name || typeof facilityCatalog === 'undefined' || !Array.isArray(facilityCatalog)) return;
    const match = facilityCatalog.find(item =>
        String(item.name || '').toLocaleLowerCase() === String(name).toLocaleLowerCase()
    );
    if (match) match.isSubmitted = Boolean(isSubmitted);
}

function isSelectedFacilityCatalogLocked(facilityName = selectedFacility) {
    if (!facilityName) return false;
    if (isFacilitySubmittedInCatalog(facilityName)) return true;
    const lower = String(facilityName).toLocaleLowerCase();
    if (Array.isArray(audits) && audits.some(audit =>
        String(audit.facilityId || '').toLocaleLowerCase() === lower &&
        audit.status && audit.status !== 'draft'
    )) {
        return true;
    }
    if (typeof sharedSubmissions !== 'undefined' && Array.isArray(sharedSubmissions) && sharedSubmissions.some(item =>
        String(item.facilityId || '').toLocaleLowerCase() === lower &&
        item.status && item.status !== 'draft'
    )) {
        return true;
    }
    return false;
}

function isCurrentAuditLocked(record = getCurrentAudit(false)) {
    if (!record && selectedFacility && selectedFacility !== 'Hostels') {
        return isSelectedFacilityCatalogLocked(selectedFacility);
    }
    if (!record) return false;
    if (record.status && record.status !== 'draft') return true;
    if (typeof isAuditSubmittedForApproval === 'function' && isAuditSubmittedForApproval(record)) return true;
    if (typeof isAuditLockedAsApproved === 'function' && isAuditLockedAsApproved(record)) return true;
    if (record.facilityId && record.facilityId !== 'Hostels' && isFacilitySubmittedInCatalog(record.facilityId)) {
        return true;
    }
    return false;
}

function resetTransientFacilityEntryInputs() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const auditForm = document.getElementById('auditForm');
    if (auditForm && typeof auditForm.reset === 'function') auditForm.reset();
    ['historyMonth', 'historyKwh', 'historyCost', 'auditPhotos'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = '';
    });
}

function flushActiveAuditToRecord(record) {
    if (!record || isCurrentAuditLocked(record)) return;
    record.inventory = typeof inventory !== 'undefined' ? inventory : (record.inventory || []);
    if (typeof facilityInfo !== 'undefined') record.facilityInfo = { ...facilityInfo };
    if (typeof historicalData !== 'undefined') record.historicalData = historicalData;
    if (typeof auditPhotos !== 'undefined') record.photos = auditPhotos;
    if (typeof readEnergySettingsFromForm === 'function') {
        record.energySettings = readEnergySettingsFromForm();
    }
    if (typeof saveAudits === 'function') saveAudits();
}

function handleAuditorFacilitySelection() {
    if (isAdministrator()) return;
    const selector = document.getElementById('auditorFacilitySelector');
    const newFacilityEntry = document.getElementById('newFacilityEntry');
    const newFacilityNameInput = document.getElementById('newFacilityNameInput');
    if (selector && selector.value === ADD_FACILITY_OPTION) {
        flushActiveAuditToRecord(getCurrentAudit(false));
        cancelEditFacility();
        selectedFacility = '';
        selectedHostelName = '';
        selectedAdminAuditId = '';
        resetTransientFacilityEntryInputs();
        if (typeof loadActiveAudit === 'function') loadActiveAudit();
        if (typeof initializeFacilitySelector === 'function') initializeFacilitySelector();
        if (typeof syncReportFacilityToCurrentAudit === 'function') syncReportFacilityToCurrentAudit();
        if (typeof updateSubmissionStatus === 'function') updateSubmissionStatus();
        if (newFacilityEntry) newFacilityEntry.hidden = false;
        if (newFacilityNameInput) newFacilityNameInput.focus();
        return;
    }
    if (newFacilityEntry) newFacilityEntry.hidden = true;
    if (newFacilityNameInput) newFacilityNameInput.value = '';
    cancelEditFacility();
    startFacilityAudit();
}

function startEditFacility() {
    if (isAdministrator()) return;
    if (!selectedFacility) {
        alert('Select a facility before editing.');
        return;
    }
    if (isSelectedFacilityCatalogLocked(selectedFacility)) {
        alert('Submitted facilities cannot be edited.');
        setFacilityReadOnly();
        return;
    }
    const newEntry = document.getElementById('newFacilityEntry');
    if (newEntry) newEntry.hidden = true;
    const editEntry = document.getElementById('editFacilityEntry');
    const editInput = document.getElementById('editFacilityNameInput');
    if (editEntry && editInput) {
        editInput.value = selectedFacility;
        editEntry.hidden = false;
        editInput.focus();
    }
}

function cancelEditFacility() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const editEntry = document.getElementById('editFacilityEntry');
    const editInput = document.getElementById('editFacilityNameInput');
    if (editInput) editInput.value = '';
    if (editEntry) editEntry.hidden = true;
}

async function saveEditedFacility() {
    if (isAdministrator()) return;
    const targetFacility = selectedFacility;
    if (!targetFacility) {
        alert('Select a facility before editing.');
        return;
    }
    if (isSelectedFacilityCatalogLocked(targetFacility)) {
        alert('Submitted facilities cannot be edited.');
        cancelEditFacility();
        setFacilityReadOnly();
        return;
    }
    const input = document.getElementById('editFacilityNameInput');
    const updatedName = input ? input.value.trim() : '';
    if (!updatedName) {
        alert('Enter a facility name.');
        if (input && typeof input.focus === 'function') input.focus();
        return;
    }
    if (updatedName === targetFacility) {
        cancelEditFacility();
        return;
    }
    if (updatedName.toLocaleLowerCase() !== targetFacility.toLocaleLowerCase() &&
        typeof facilityNames !== 'undefined' && Array.isArray(facilityNames) &&
        facilityNames.some(existing => existing.toLocaleLowerCase() === updatedName.toLocaleLowerCase())) {
        alert('A facility with this name already exists.');
        if (input && typeof input.focus === 'function') input.focus();
        return;
    }

    const saveButton = document.getElementById('saveEditedFacilityButton');
    const cancelButton = document.getElementById('cancelEditFacilityButton');
    if (saveButton) saveButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
    try {
        if (typeof auditSaveTimer !== 'undefined') clearTimeout(auditSaveTimer);
        const response = await apiRequest(`/api/facilities/${encodeURIComponent(targetFacility)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: updatedName })
        });
        const facility = response && response.facility;
        if (!facility || typeof facility.name !== 'string' || !facility.name.trim()) {
            throw new Error('The updated facility was not returned by the server.');
        }
        const savedName = facility.name;
        if (typeof facilityNames !== 'undefined' && Array.isArray(facilityNames)) {
            const nameIndex = facilityNames.findIndex(existing =>
                existing.toLocaleLowerCase() === targetFacility.toLocaleLowerCase()
            );
            if (nameIndex >= 0) facilityNames[nameIndex] = savedName;
            else facilityNames.push(savedName);
        }
        if (typeof facilityCatalog !== 'undefined' && Array.isArray(facilityCatalog)) {
            const catalogIndex = facilityCatalog.findIndex(existing =>
                String(existing.name || '').toLocaleLowerCase() === targetFacility.toLocaleLowerCase()
            );
            const entry = {
                id: facility.id || savedName,
                name: savedName,
                sort_order: facility.sort_order ?? 0,
                isSubmitted: Boolean(facility.isSubmitted)
            };
            if (catalogIndex >= 0) facilityCatalog[catalogIndex] = entry;
            else facilityCatalog.push(entry);
        }
        if (Array.isArray(audits)) {
            audits.forEach(audit => {
                if (String(audit.facilityId || '').toLocaleLowerCase() === targetFacility.toLocaleLowerCase()) {
                    audit.facilityId = savedName;
                    audit.key = savedName === 'Hostels' && audit.hostelName
                        ? `Hostels:${audit.hostelName.trim().toLocaleLowerCase()}`
                        : savedName;
                    audit.report = '';
                    audit.reportGeneratedAt = '';
                }
            });
        }

        selectedFacility = savedName;
        cancelEditFacility();
        initializeAuditorFacilitySelector();
        const selector = document.getElementById('auditorFacilitySelector');
        if (selector) selector.value = savedName;
        if (typeof initializeFacilitySelector === 'function') initializeFacilitySelector();
        if (typeof loadActiveAudit === 'function') loadActiveAudit();
        if (typeof syncReportFacilityToCurrentAudit === 'function') syncReportFacilityToCurrentAudit();
        if (typeof updateSubmissionStatus === 'function') updateSubmissionStatus();
        if (typeof saveAudits === 'function') saveAudits();
    } catch (error) {
        console.error('Unable to update the facility.', error);
        alert(error.message || 'Unable to update the facility. Please try again.');
    } finally {
        if (saveButton) saveButton.disabled = false;
        if (cancelButton) cancelButton.disabled = false;
    }
}

async function deleteSelectedFacility() {
    if (isAdministrator()) return;
    const targetFacility = selectedFacility;
    if (!targetFacility) {
        alert('Select a facility before deleting.');
        return;
    }
    if (isSelectedFacilityCatalogLocked(targetFacility)) {
        alert('Submitted facilities cannot be deleted.');
        setFacilityReadOnly();
        return;
    }
    if (typeof confirm === 'function' &&
        !confirm(`Delete facility "${targetFacility}" and any unsubmitted draft data for it?`)) {
        return;
    }

    const deleteButton = document.getElementById('deleteFacilityButton');
    const editButton = document.getElementById('editFacilityButton');
    if (deleteButton) deleteButton.disabled = true;
    if (editButton) editButton.disabled = true;
    try {
        if (typeof auditSaveTimer !== 'undefined') clearTimeout(auditSaveTimer);
        await apiRequest(`/api/facilities/${encodeURIComponent(targetFacility)}`, {
            method: 'DELETE'
        });

        if (typeof facilityNames !== 'undefined' && Array.isArray(facilityNames)) {
            for (let index = facilityNames.length - 1; index >= 0; index -= 1) {
                if (facilityNames[index].toLocaleLowerCase() === targetFacility.toLocaleLowerCase()) {
                    facilityNames.splice(index, 1);
                }
            }
        }
        if (typeof facilityCatalog !== 'undefined' && Array.isArray(facilityCatalog)) {
            for (let index = facilityCatalog.length - 1; index >= 0; index -= 1) {
                if (String(facilityCatalog[index].name || '').toLocaleLowerCase() === targetFacility.toLocaleLowerCase()) {
                    facilityCatalog.splice(index, 1);
                }
            }
        }
        if (Array.isArray(audits)) {
            audits = audits.filter(audit =>
                String(audit.facilityId || '').toLocaleLowerCase() !== targetFacility.toLocaleLowerCase() ||
                (audit.status && audit.status !== 'draft')
            );
        }

        selectedFacility = '';
        selectedHostelName = '';
        selectedAdminAuditId = '';
        cancelEditFacility();
        resetTransientFacilityEntryInputs();
        initializeAuditorFacilitySelector();
        const selector = document.getElementById('auditorFacilitySelector');
        if (selector) selector.value = '';
        if (typeof initializeFacilitySelector === 'function') initializeFacilitySelector();
        if (typeof loadActiveAudit === 'function') loadActiveAudit();
        if (typeof syncReportFacilityToCurrentAudit === 'function') syncReportFacilityToCurrentAudit();
        if (typeof updateSubmissionStatus === 'function') updateSubmissionStatus();
        if (typeof loadPersonalDashboard === 'function') await loadPersonalDashboard();
    } catch (error) {
        console.error('Unable to delete the facility.', error);
        alert(error.message || 'Unable to delete the facility. Please try again.');
        if (typeof setFacilityReadOnly === 'function') setFacilityReadOnly();
    }
}

async function saveNewFacility() {
    if (isAdministrator()) return;
    const input = document.getElementById('newFacilityNameInput');
    const name = input.value.trim();
    if (!name) {
        alert('Enter a facility name.');
        input.focus();
        return;
    }

    const button = document.querySelector('#newFacilityEntry button');
    if (button) button.disabled = true;
    try {
        const response = await apiRequest('/api/facilities', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        const facility = response && response.facility;
        if (!facility || typeof facility.name !== 'string' || !facility.name.trim()) {
            throw new Error('The saved facility was not returned by the server.');
        }
        if (!facilityNames.some(existing =>
            existing.toLocaleLowerCase() === facility.name.toLocaleLowerCase()
        )) {
            facilityNames.push(facility.name);
        }
        if (typeof facilityCatalog !== 'undefined' && Array.isArray(facilityCatalog) &&
            !facilityCatalog.some(existing =>
                String(existing.name || '').toLocaleLowerCase() === facility.name.toLocaleLowerCase()
            )) {
            facilityCatalog.push({
                id: facility.id || facility.name,
                name: facility.name,
                sort_order: facility.sort_order ?? 0,
                isSubmitted: Boolean(facility.isSubmitted)
            });
        }
        input.value = '';
        document.getElementById('newFacilityEntry').hidden = true;
        cancelEditFacility();
        initializeAuditorFacilitySelector();
        document.getElementById('auditorFacilitySelector').value = facility.name;
        startFacilityAudit();
    } catch (error) {
        console.error('Unable to save the new facility.', error);
        alert(error.message || 'Unable to save the new facility. Please try again.');
    } finally {
        if (button) button.disabled = false;
    }
}

function startFacilityAudit(auditKey = '') {
    if (isAdministrator()) return;
    const selector = document.getElementById('auditorFacilitySelector');
    const selectedValue = selector.value;
    if (selectedValue === ADD_FACILITY_OPTION) {
        handleAuditorFacilitySelection();
        return;
    }

    flushActiveAuditToRecord(getCurrentAudit(false));
    cancelEditFacility();
    resetTransientFacilityEntryInputs();

    const selectedAudit = auditKey ? audits.find(audit => audit.key === auditKey) : null;
    const existing = selectedAudit || audits.find(audit =>
        String(audit.facilityId).toLocaleLowerCase() === selectedValue.toLocaleLowerCase() &&
        (selectedValue.toLocaleLowerCase() !== 'hostels' || !audit.hostelName)
    );
    selectedFacility = existing ? existing.facilityId : selectedValue;
    selectedHostelName = existing ? existing.hostelName || '' : '';
    selectedAdminAuditId = '';
    getCurrentAudit();
    loadActiveAudit();
    initializeFacilitySelector();
    if (typeof syncReportFacilityToCurrentAudit === 'function') syncReportFacilityToCurrentAudit();
    updateSubmissionStatus();
}

function syncReportFacilityToCurrentAudit() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const selector = document.getElementById('reportFacilitySelector');
    if (!selector) return;
    const record = getCurrentAudit(false);
    const selection = record ? reportAuditOptionValue(record) : '';
    const matchingOption = Array.from(selector.options || []).some(option => option.value === selection);
    selector.value = matchingOption ? selection : '';
    selectedReportAuditValue = selector.value;
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
    if (isCurrentAuditLocked()) {
        alert('Submitted or approved facility audits cannot be modified.');
        input.value = previousHostelName;
        return;
    }
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
            if (typeof syncReportFacilityToCurrentAudit === 'function') syncReportFacilityToCurrentAudit();
            if (typeof updateSubmissionStatus === 'function') updateSubmissionStatus();
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
    if (typeof syncReportFacilityToCurrentAudit === 'function') syncReportFacilityToCurrentAudit();
    if (typeof updateSubmissionStatus === 'function') updateSubmissionStatus();
}

function saveFacilityDetails() {
    if (isAdministrator()) return;
    if (!selectedFacility || isCurrentAuditLocked()) return;
    facilityInfo.facilityLocation = document.getElementById('facilityLocation').value.trim();
    if (currentUser && !isAdministrator()) facilityInfo.authorName = currentUser.name;
    facilityInfo.energySources = document.getElementById('energySources').value.trim();
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
    else if (!facilityInfo.auditDate) facilityInfo.auditDate = currentLocalDate();
    if (currentUser && !isAdministrator()) facilityInfo.authorName = currentUser.name;
    historicalData = record && Array.isArray(record.historicalData) ? record.historicalData : [];
    auditPhotos = record && Array.isArray(record.photos) ? record.photos : [];
    document.getElementById('facilityLocation').value = facilityInfo.facilityLocation || '';
    document.getElementById('authorName').value = facilityInfo.authorName || '';
    document.getElementById('energySources').value = facilityInfo.energySources || '';
    document.getElementById('auditDate').value = facilityInfo.auditDate;
    const energySettings = record && record.energySettings
        ? { ...createDefaultEnergySettings(), ...record.energySettings }
        : createDefaultEnergySettings();
    document.getElementById('tariffRate').value = energySettings.tariffRate;
    document.getElementById('emissionFactor').value = energySettings.emissionFactor;
    renderHistoricalData(historicalData);
    renderAuditPhotos(auditPhotos);
    renderAdminCalculationResults();
    setFacilityReadOnly();
    updateFacilityLabels();
    calculateAll();
    updateAuditReportDisplay();
    initializeReportFacilitySelector();
}

function setFacilityReadOnly() {
    const adminView = isAdministrator();
    const page = document.getElementById('pageFacilities');
    if (!page) return;
    const facilitySelector = document.getElementById('facilitySelector');
    const auditorSelector = document.getElementById('auditorFacilitySelector');
    const newEntry = document.getElementById('newFacilityEntry');
    const editEntry = document.getElementById('editFacilityEntry');
    const manageActions = document.getElementById('facilityManageActions');
    const editFacilityButton = document.getElementById('editFacilityButton');
    const deleteFacilityButton = document.getElementById('deleteFacilityButton');
    const lockHint = document.getElementById('facilityLockHint');
    const isAdding = !adminView && !!(auditorSelector && auditorSelector.value === ADD_FACILITY_OPTION);
    const hasFacility = !adminView && Boolean(selectedFacility) && !isAdding;
    const activeRecord = hasFacility ? getCurrentAudit(false) : null;
    const catalogLocked = hasFacility && isSelectedFacilityCatalogLocked(selectedFacility);
    const auditLocked = hasFacility && isCurrentAuditLocked(activeRecord);
    const disableAuditorEntry = !adminView && (!hasFacility || auditLocked);

    document.getElementById('auditorFacilityEntry').hidden = adminView;
    document.getElementById('adminFacilitySelection').hidden = !adminView;
    document.getElementById('facilityAuditDetails').hidden = adminView
        ? !selectedAdminAuditId
        : !hasFacility;

    if (adminView) {
        if (manageActions) manageActions.hidden = true;
        if (newEntry) newEntry.hidden = true;
        if (editEntry) editEntry.hidden = true;
        if (lockHint) lockHint.hidden = true;
    } else {
        if (manageActions) manageActions.hidden = !hasFacility;
        if (editFacilityButton) editFacilityButton.disabled = catalogLocked;
        if (deleteFacilityButton) deleteFacilityButton.disabled = catalogLocked;
        if (lockHint) {
            if (isAdding) {
                lockHint.hidden = true;
                lockHint.textContent = '';
            } else if (!hasFacility) {
                lockHint.hidden = false;
                lockHint.textContent = 'Select a saved facility or add a new one to begin.';
            } else if (catalogLocked || auditLocked) {
                lockHint.hidden = false;
                lockHint.textContent = activeRecord && activeRecord.status === 'approved'
                    ? 'Approved — this facility audit is locked and cannot be edited or deleted.'
                    : 'Submitted for approval — this facility is locked and cannot be edited or deleted.';
            } else {
                lockHint.hidden = false;
                lockHint.textContent = 'Not submitted yet — you can edit or delete this facility before submission.';
            }
        }
        if (catalogLocked || !hasFacility) cancelEditFacility();
    }

    const auditForm = document.getElementById('auditForm');
    const adminCalculator = document.getElementById('adminEquipmentCalculator');
    page.querySelectorAll('input, select, textarea, button').forEach(control => {
        if (adminView) {
            control.disabled =
                control !== facilitySelector &&
                control.id !== 'beginAuditRecommendationsButton' &&
                !(auditForm && auditForm.contains(control)) &&
                !(adminCalculator && adminCalculator.contains(control));
            return;
        }
        const isSelectorOrManageControl =
            control === auditorSelector ||
            control === editFacilityButton ||
            control === deleteFacilityButton ||
            (newEntry && newEntry.contains(control)) ||
            (editEntry && editEntry.contains(control));
        if (isSelectorOrManageControl) return;
        control.disabled = disableAuditorEntry;
    });
    if (facilitySelector) facilitySelector.disabled = false;
    if (auditorSelector && !adminView) auditorSelector.disabled = false;
    if (editFacilityButton && !adminView) editFacilityButton.disabled = !hasFacility || catalogLocked;
    if (deleteFacilityButton && !adminView) deleteFacilityButton.disabled = !hasFacility || catalogLocked;

    document.getElementById('administratorFacilityNotice').hidden = !adminView;
    auditForm.hidden = false;
    document.getElementById('adminEquipmentCalculator').hidden = !adminView;
    document.getElementById('auditPhotoUpload').hidden = adminView || disableAuditorEntry;
    document.getElementById('auditSubmissionPanel').hidden = false;
    document.getElementById('historyActionHeader').hidden = adminView || disableAuditorEntry;
    const hostelSaveButton = document.querySelector('#hostelNameGroup button');
    if (hostelSaveButton) hostelSaveButton.hidden = adminView || disableAuditorEntry;
    document.getElementById('equipmentSubmitButton').textContent = adminView
        ? 'Calculate only'
        : 'Calculate and Add Inventory';
}

function resetFacilityEntryAfterSubmission() {
    selectedFacility = '';
    selectedHostelName = '';
    cancelEditFacility();
    resetTransientFacilityEntryInputs();
    initializeFacilitySelector();
    loadActiveAudit();
    if (typeof syncReportFacilityToCurrentAudit === 'function') syncReportFacilityToCurrentAudit();
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
        const entries = (Array.isArray(facilities) ? facilities : [])
            .filter(facility => facility && typeof facility.name === 'string' && facility.name.trim())
            .map(facility => ({
                id: facility.id || facility.name,
                name: facility.name,
                sort_order: facility.sort_order ?? 0,
                isSubmitted: Boolean(facility.isSubmitted)
            }));
        facilityNames.length = 0;
        facilityNames.push(...entries.map(entry => entry.name));
        if (typeof facilityCatalog !== 'undefined' && Array.isArray(facilityCatalog)) {
            facilityCatalog.length = 0;
            facilityCatalog.push(...entries);
        }
    } catch (error) {
        console.error('Unable to load the facility catalogue; using the currently loaded list.', error);
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

    const populatedAudit = isAdministrator()
        ? audits.find(audit => audit.id && audit.status !== 'draft') || null
        : audits.find(audit => audit.inventory.length > 0 &&
            facilityNames.some(name => name.toLocaleLowerCase() === audit.facilityId.toLocaleLowerCase()));
    selectedAdminAuditId = isAdministrator() && populatedAudit ? String(populatedAudit.id) : '';
    selectedFacility = populatedAudit ? populatedAudit.facilityId : '';
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

async function addEquipment() {
    if (isAdministrator()) {
        calculateAdminEquipment();
        return;
    }
    if (!selectedFacility) {
        alert('Select a facility before adding equipment.');
        document.getElementById('auditorFacilitySelector').focus();
        return;
    }
    if (selectedFacility === 'Hostels' && !selectedHostelName) {
        alert('Enter the hostel name before adding its equipment.');
        return;
    }
    if (!await ensureAuditNotApproved(getCurrentAudit(false))) return;
    if (typeof isAuditSubmittedForApproval === 'function' && isAuditSubmittedForApproval(getCurrentAudit(false))) {
        alert('Equipment cannot be added after an audit has been submitted for approval.');
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
    if (typeof initializeReportFacilitySelector === 'function') initializeReportFacilitySelector();
    if (typeof syncReportFacilityToCurrentAudit === 'function') syncReportFacilityToCurrentAudit();
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
    if (isAuditSubmittedForApproval(record)) {
        updateSubmissionStatus();
        alert('Equipment in an audit submitted for approval cannot be deleted.');
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
