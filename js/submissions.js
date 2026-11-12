async function loadSharedSubmissions() {
    try {
        const path = isAdministrator() ? '/api/admin/audits' : '/api/audits';
        const { audits: submissions } = await apiRequest(path);
        if (!Array.isArray(submissions)) throw new Error('Server audits must be an array.');
        sharedSubmissions = submissions.filter(item => item.status !== 'draft').map(item => {
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
    const record = getCurrentAudit(false);
    const submission = findSubmissionForAudit(record);
    renderInventoryTable();
    if (!submission) {
        status.textContent = 'Submit this facility audit for administrator review and approval.';
        return;
    }
    const label = submission.status === 'approved' ? 'Approved' : submission.status === 'discarded' ? 'Discarded' : 'Pending administrator review';
    const hasUnsubmittedChanges = auditHasUnsubmittedChanges(record, submission);
    status.textContent = hasUnsubmittedChanges
        ? `${label} — this audit has new local changes since submission. Submit again to send the latest version for approval.`
        : `${label} — last submitted ${new Date(submission.submittedAt).toLocaleString()}.`;
}

function auditHasUnsubmittedChanges(record, submission) {
    const snapshot = submission.auditorSnapshot || {
        facilityInfo: submission.facilityInfo,
        inventory: submission.inventory
    };
    return JSON.stringify(record.facilityInfo) !== JSON.stringify(snapshot.facilityInfo) ||
        JSON.stringify(record.inventory) !== JSON.stringify(snapshot.inventory) ||
        JSON.stringify(record.historicalData || []) !== JSON.stringify(snapshot.historicalData || []) ||
        JSON.stringify(record.photos || []) !== JSON.stringify(snapshot.photos || []);
}

function isAuditLockedAsApproved(record) {
    const submission = findSubmissionForAudit(record);
    return submission?.status === 'approved' && !auditHasUnsubmittedChanges(record, submission);
}

function findSubmissionForAudit(record) {
    if (!record) return null;
    return sharedSubmissions.find(item =>
        item.id === record.id || item.auditKey === record.key || item.sourceAuditKey === record.key
    ) || null;
}

async function submitCurrentAudit() {
    if (!currentUser) return;
    const record = getCurrentAudit(false);
    if (!record || !record.inventory.length) {
        alert('Add at least one equipment item before submitting this facility audit.');
        return;
    }
    record.facilityInfo.authorName = currentUser.name;
    facilityInfo.authorName = currentUser.name;
    if (!confirm('Submit this facility audit for administrator review and approval?')) {
        alert('Submission cancelled.');
        return;
    }

    try {
        clearTimeout(auditSaveTimer);
        await persistAuditRecord(record);
        const { audit } = await apiRequest(`/api/audits/${encodeURIComponent(record.id)}/submit`, {
            method: 'POST'
        });
        replaceSubmission({
            ...audit,
            auditKey: audit.key || audit.facilityId,
            auditorSnapshot: {
                facilityInfo: { ...audit.facilityInfo },
                inventory: audit.inventory || [],
                historicalData: audit.historicalData || [],
                photos: audit.photos || []
            }
        });
        saveSharedSubmissions();
        alert('Facility audit submitted for administrator approval.');
    } catch (error) {
        reportApiError(error);
    }
}
