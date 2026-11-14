async function loadSharedSubmissions() {
    try {
        const path = isAdministrator() ? '/api/admin/audits' : '/api/audits';
        const { audits: submissions } = await apiRequest(path);
        if (!Array.isArray(submissions)) throw new Error('Server audits must be an array.');
        sharedSubmissions = submissions.filter(item => isAdministrator() || item.status !== 'draft').map(item => {
            const photos = Array.isArray(item.photos) ? item.photos.map(photo => ({
                ...photo,
                dataUrl: photo.url ? `${API_BASE}${photo.url}` : photo.dataUrl
            })) : [];
            const facilityInfo = { ...createEmptyFacilityInfo(), ...(item.facilityInfo || {}) };
            const inventory = Array.isArray(item.inventory) ? item.inventory : [];
            const historicalData = Array.isArray(item.historicalData) ? item.historicalData : [];
            return {
                ...item,
                auditKey: item.key || item.facilityId,
                facilityInfo,
                inventory,
                historicalData,
                photos,
                auditorSnapshot: { facilityInfo, inventory, historicalData, photos }
            };
        });
    } catch (error) {
        console.error('Unable to load shared audit submissions.', error);
        throw error;
    }
}

function saveSharedSubmissions() {
    updateUniversitySummary();
    renderProfiles();
    updateSubmissionStatus();
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isAdministrator() {
    return !!currentUser && currentUser.role === 'admin';
}

function updateSubmissionStatus() {
    const status = document.getElementById('submissionStatus');
    if (!status || !currentUser) return;
    renderInventoryTable();
    status.textContent = 'To submit this audit for approval, add at least one equipment recommendation.';
}

function createAuditorSnapshot(record) {
    return {
        facilityInfo: { ...record.facilityInfo },
        inventory: record.inventory.map(item => ({ ...item })),
        historicalData: record.historicalData.map(entry => ({ ...entry })),
        photos: record.photos.map(photo => ({ ...photo }))
    };
}

function isAuditLockedAsApproved(record) {
    const submission = findSubmissionForAudit(record);
    return record?.status === 'approved' || submission?.status === 'approved';
}

function isAuditSubmittedForApproval(record) {
    return findSubmissionForAudit(record)?.status === 'pending';
}

async function ensureAuditNotApproved(record) {
    if (isAuditLockedAsApproved(record)) {
        alert('Facility already approved');
        return false;
    }
    try {
        await loadSharedSubmissions();
    } catch (error) {
        reportApiError(error);
        return false;
    }
    if (isAuditLockedAsApproved(record)) {
        alert('Facility already approved');
        return false;
    }
    return true;
}

function findSubmissionForAudit(record) {
    if (!record) return null;
    return sharedSubmissions.find(item =>
        item.id === record.id || item.auditKey === record.key || item.sourceAuditKey === record.key
    ) || null;
}

function getAuditReadinessIssue() {
    const requiredFields = [
        ['facilitySelector', 'Select a facility.'],
        ['facilityLocation', 'Enter the facility location.'],
        ['authorName', 'Auditor name is missing from this profile.'],
        ['energySources', 'Enter the facility energy sources.'],
        ['auditDate', 'Enter the audit date.']
    ];
    for (const [id, message] of requiredFields) {
        const element = document.getElementById(id);
        if (!element || !String(element.value || '').trim()) return { message, element };
    }

    if (selectedFacility === 'Hostels') {
        const hostelInput = document.getElementById('hostelName');
        if (!selectedHostelName || !hostelInput || !hostelInput.value.trim()) {
            return { message: 'Enter the hostel name before continuing.', element: hostelInput };
        }
    }

    if (!Array.isArray(inventory) || !inventory.length) {
        return {
            message: 'Add at least one complete equipment item before continuing.',
            element: document.getElementById('equipment')
        };
    }
    const invalidEquipment = inventory.find(item =>
        !item.category || !item.name || !Number.isFinite(Number(item.watts)) || Number(item.watts) <= 0 ||
        !Number.isInteger(Number(item.qty)) || Number(item.qty) < 1 ||
        !Number.isFinite(Number(item.hours)) || Number(item.hours) <= 0 || Number(item.hours) > 24
    );
    if (invalidEquipment) {
        return {
            message: 'Complete every equipment item with a category, name, positive power rating, whole-number quantity, and operating hours from 0 to 24.',
            element: document.getElementById('equipment')
        };
    }
    return null;
}

function ensureAuditReady() {
    const issue = getAuditReadinessIssue();
    if (!issue) return true;
    alert(issue.message);
    if (issue.element && typeof issue.element.focus === 'function') issue.element.focus();
    return false;
}

function clearAuditEntryFields() {
    [
        'facilityLocation',
        'authorName',
        'energySources',
        'auditDate',
        'hostelName',
        'equipment',
        'wattage',
        'availableNumber',
        'operatingHours',
        'historyMonth',
        'historyKwh',
        'historyCost',
        'auditPhotos'
    ].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
    loadRecommendations = loadRecommendations.slice(0, 4).map(recommendation => ({
        ...recommendation,
        text: ''
    }));
    renderLoadRecommendationBoxes();
}

function beginAuditRecommendations() {
    if (!currentUser) {
        alert('Sign in before continuing with this audit.');
        return;
    }
    if (isAdministrator()) {
        alert('Administrator accounts cannot create or submit audits. Use Profiles & Reviews to supervise auditor submissions.');
        return;
    }
    if (selectedFacility === 'Hostels') {
        const hostelInput = document.getElementById('hostelName');
        if (hostelInput && hostelInput.value.trim() && hostelInput.value.trim() !== selectedHostelName) {
            selectHostelAudit();
        }
    }
    if (!ensureAuditReady()) return;

    saveFacilityDetails();
    switchPage('measures');
    const recommendationsPanel = document.getElementById('auditorRecommendationsPanel');
    if (recommendationsPanel) {
        recommendationsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        recommendationsPanel.focus({ preventScroll: true });
    }
}

async function submitCurrentAudit() {
    if (!currentUser) return;
    if (isAdministrator()) {
        alert('Administrator accounts cannot submit audits. Use Profiles & Reviews to approve or delete auditor submissions.');
        return;
    }
    if (selectedFacility === 'Hostels') {
        const hostelInput = document.getElementById('hostelName');
        if (hostelInput && hostelInput.value.trim() && hostelInput.value.trim() !== selectedHostelName) {
            selectHostelAudit();
        }
    }
    if (!await ensureAuditNotApproved(getCurrentAudit(false))) return;
    if (!ensureAuditReady()) return;

    const enteredRecommendations = loadRecommendations
        .filter(item => item.text && item.text.trim())
        .map(item => ({ loadType: item.loadType.trim(), text: item.text.trim() }));
    if (enteredRecommendations.some(item => !item.loadType)) {
        alert('Add a name for every equipment category that has a recommendation.');
        return;
    }
    if (!enteredRecommendations.length) {
        alert('Enter at least one equipment recommendation before submitting this audit.');
        const firstRecommendation = document.querySelector('#auditorCommentsContainer textarea');
        if (firstRecommendation) firstRecommendation.focus();
        return;
    }
    if (!confirm('Submit this facility audit and its recommendations for administrator review and approval?')) return;

    try {
        saveFacilityDetails();
        const record = getCurrentAudit(false);
        if (!record) throw new Error('The selected facility audit could not be found.');
        record.inventory = inventory;
        record.historicalData = historicalData;
        record.photos = auditPhotos;
        record.recommendations = enteredRecommendations.map(item => `${item.loadType}: ${item.text}`);

        clearTimeout(userDataSaveTimers.recommendations);
        await apiRequest('/api/recommendations', {
            method: 'PUT',
            body: JSON.stringify({ recommendations: loadRecommendations })
        });
        clearTimeout(auditSaveTimer);
        await persistAuditRecord(record);
        const { audit } = await apiRequest(`/api/audits/${encodeURIComponent(record.id)}/submit`, {
            method: 'POST'
        });
        replaceSubmission({
            ...audit,
            auditKey: audit.key || audit.facilityId,
            auditorSnapshot: createAuditorSnapshot(record)
        });
        saveSharedSubmissions();
        clearAuditEntryFields();
        resetFacilityEntryAfterSubmission();
        clearTimeout(userDataSaveTimers.recommendations);
        try {
            await apiRequest('/api/recommendations', {
                method: 'PUT',
                body: JSON.stringify({ recommendations: loadRecommendations })
            });
        } catch (error) {
            reportApiError(error);
        }
        alert('Facility audit submitted for administrator approval. Entry fields are cleared; select another facility to start the next audit.');
    } catch (error) {
        reportApiError(error);
    }
}
