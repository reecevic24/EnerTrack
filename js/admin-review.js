let accountCache = [];
let administratorExists = false;
let canClaimAdministrator = false;
let activeAccountView = '';
let activeAuditView = '';

function toggleProfileDropdown(section, view) {
    if (section === 'accounts') {
        activeAccountView = activeAccountView === view ? '' : view;
    } else if (section === 'audits') {
        activeAuditView = activeAuditView === view ? '' : view;
    } else {
        return;
    }
    renderProfiles();
}

async function loadAccountManagementState() {
    const setup = await apiRequest('/api/auth/setup-status');
    administratorExists = setup.adminExists;
    canClaimAdministrator = setup.canClaimAdmin;
    accountCache = currentUser.role === 'admin'
        ? (await apiRequest('/api/admin/users')).users
        : [];
}

function renderProfiles() {
    if (!currentUser) return;
    const admin = isAdministrator();

    document.getElementById('profileName').textContent = currentUser.name;
    const role = document.getElementById('profileRole');
    role.textContent = admin ? 'Administrator' : 'Auditor';
    role.className = `profile-role ${admin ? 'role-admin' : 'role-auditor'}`;
    document.getElementById('profileEmail').textContent = currentUser.email;
    document.getElementById('adminSetupHint').textContent = admin
        ? 'Administrator access is enabled. Review auditor submissions and supervise the application from this profile.'
        : administratorExists
            ? 'This profile can submit audits and track administrator review status.'
            : canClaimAdministrator
                ? 'No administrator is set up yet. This initial account can set up the first administrator.'
                : 'No administrator is set up yet. The initial administrator must be configured before additional accounts are registered.';
    document.getElementById('claimAdminButton').style.display =
        !administratorExists && canClaimAdministrator ? 'inline-block' : 'none';
    document.getElementById('adminAccountsPanel').style.display = admin ? 'block' : 'none';
    document.getElementById('adminReviewPanel').style.display = admin ? 'block' : 'none';
    document.getElementById('mySubmissionPanel').hidden = admin;
    document.getElementById('tabFacilities').hidden = false;
    document.getElementById('tabMeasures').hidden = admin;
    document.getElementById('dashboardFacilitiesButton').hidden = false;
    document.getElementById('dashboardFacilitiesButton').textContent = admin
        ? 'View Facilities'
        : 'Open Facilities & Equipment';
    document.getElementById('dashboardFacilityHint').textContent = admin
        ? 'Review facility audit information and monitor university-wide energy totals from this dashboard.'
        : 'Add equipment to a facility audit to include its measured consumption in the university total.';
    setFacilityReadOnly();
    const accountListPanel = document.getElementById('accountListPanel');
    accountListPanel.hidden = !admin || !activeAccountView;
    document.getElementById('addAdminsButton').setAttribute('aria-expanded', String(activeAccountView === 'auditors'));
    document.getElementById('seeAdminsButton').setAttribute('aria-expanded', String(activeAccountView === 'admins'));
    const reviewQueuePanel = document.getElementById('adminReviewQueuePanel');
    reviewQueuePanel.hidden = !admin || !activeAuditView;
    document.getElementById('approveAuditsButton').setAttribute('aria-expanded', String(activeAuditView === 'pending'));
    document.getElementById('auditStatusButton').setAttribute('aria-expanded', String(activeAuditView === 'status'));
    renderAccountList();

    const mine = document.getElementById('mySubmissionList');
    mine.innerHTML = '';
    if (admin) {
        mine.textContent = 'Administrators do not create or submit audits. Review auditor submissions in the approval queue.';
        renderAdminReviewQueue();
        return;
    }
    const mySubmissions = sharedSubmissions.filter(item => item.auditorEmail === currentUser.email);
    if (!mySubmissions.length) {
        mine.textContent = 'No facility audits have been submitted from this profile yet.';
    } else {
        mySubmissions.forEach(item => {
            const row = document.createElement('div');
            row.className = 'submission-card';
            const heading = document.createElement('h5');
            heading.textContent = `${currentAuditLabel(item)} — ${item.status}`;
            const details = document.createElement('p');
            details.className = 'facility-hint';
            details.textContent = item.submittedAt
                ? `Submitted ${new Date(item.submittedAt).toLocaleString()}${item.reviewedBy ? ` · Reviewed by ${item.reviewedBy}` : ''}`
                : 'Draft audit';
            row.append(heading, details);
            if (item.status === 'discarded') {
                const actions = document.createElement('div');
                actions.className = 'action-row';
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'btn-delete';
                remove.textContent = 'Delete';
                remove.addEventListener('click', () => deleteDiscardedSubmission(item.id, remove));
                actions.appendChild(remove);
                row.appendChild(actions);
            }
            mine.appendChild(row);
        });
    }

    renderAdminReviewQueue();
}

function renderAccountList() {
    const list = document.getElementById('accountList');
    list.innerHTML = '';
    if (!isAdministrator()) return;

    const role = activeAccountView === 'admins' ? 'admin' : 'auditor';
    const accounts = accountCache.filter(account => account.role === role);
    if (!activeAccountView) return;
    if (!accounts.length) {
        list.textContent = role === 'admin' ? 'There are no administrator accounts.' : 'There are no auditor accounts to promote.';
        return;
    }

    accounts.forEach(account => {
        const row = document.createElement('div');
        row.className = 'submission-card';
        const description = document.createElement('span');
        description.textContent = `${account.name} · ${account.email} · ${account.role === 'admin' ? 'Administrator' : 'Auditor'}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-action';
        button.textContent = account.role === 'admin' ? 'Return to auditor' : 'Approve as administrator';
        button.disabled = account.id === currentUser.id && account.role === 'admin';
        button.addEventListener('click', async () => {
            const role = account.role === 'admin' ? 'auditor' : 'admin';
            if (!confirm(`Change ${account.name}'s role to ${role === 'admin' ? 'administrator' : 'auditor'}?`)) return;
            await setAccountRole(account.id, role);
        });
        row.append(description, button);
        list.appendChild(row);
    });
}

async function setAccountRole(userId, role) {
    try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role })
        });
        await loadAccountManagementState();
        renderProfiles();
    } catch (error) {
        reportApiError(error);
    }
}

async function claimAdministratorAccess() {
    if (!confirm('Set up this account as the first EnerTrack administrator?')) return;
    try {
        const { user } = await apiRequest('/api/auth/claim-admin', { method: 'POST' });
        currentUser = user;
        await loadAccountManagementState();
        await loadSharedSubmissions();
        updateUniversitySummary();
        renderProfiles();
        alert('Administrator access is now active for this account.');
    } catch (error) {
        reportApiError(error);
    }
}

function createReviewInput(labelText, value, type = 'text', fieldName = '') {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    if (type !== 'textarea') input.type = type;
    input.value = value ?? '';
    input.dataset.editField = fieldName;
    input.readOnly = true;
    group.append(label, input);
    return group;
}

function createEquipmentReviewRow(item = {}) {
    const row = document.createElement('div');
    row.className = 'submission-equipment';
    row.dataset.itemId = item.id || '';
    const fields = [
        ['Category', 'category', item.category || 'General', 'text'],
        ['Equipment name', 'name', item.name || '', 'text'],
        ['Watts', 'watts', item.watts ?? '', 'number'],
        ['Quantity', 'qty', item.qty ?? '', 'number'],
        ['Hours/day', 'hours', item.hours ?? '', 'number']
    ];
    fields.forEach(([label, name, value, type]) => {
        const input = document.createElement('input');
        input.type = type;
        input.placeholder = label;
        input.title = label;
        input.dataset.equipmentField = name;
        input.value = value;
        input.readOnly = true;
        if (type === 'number') input.step = 'any';
        row.appendChild(input);
    });
    return row;
}

function renderAdminReviewQueue() {
    const queue = document.getElementById('adminReviewQueue');
    if (!queue) return;
    queue.innerHTML = '';
    if (!isAdministrator()) return;
    if (!activeAuditView) return;

    const submissions = sharedSubmissions.filter(submission =>
        activeAuditView === 'pending'
            ? submission.status === 'pending'
            : submission.status === 'approved' || submission.status === 'discarded' || submission.status === 'draft'
    );
    if (!submissions.length) {
        queue.textContent = activeAuditView === 'pending'
            ? 'There are no pending audits to approve.'
            : 'There are no audits to display.';
        return;
    }

    submissions.slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)).forEach(submission => {
        const card = document.createElement('article');
        card.className = 'submission-card';
        const heading = document.createElement('h5');
        if (activeAuditView === 'status') {
            heading.textContent = `${currentAuditLabel(submission)} · ${submission.status.toUpperCase()} - ${submission.auditorName || submission.auditorEmail}`;
            card.appendChild(heading);
            const details = document.createElement('p');
            details.className = 'facility-hint';
            details.textContent = submission.submittedAt
                ? `Submitted ${new Date(submission.submittedAt).toLocaleString()}${submission.reviewedBy ? ` · Reviewed by ${submission.reviewedBy}` : ''}`
                : 'Not submitted by the auditor yet.';
            card.appendChild(details);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-delete';
            remove.textContent = 'Delete audit';
            remove.addEventListener('click', () => deleteAdminSubmission(submission.id, remove));
            const actions = document.createElement('div');
            actions.className = 'action-row';
            actions.appendChild(remove);
            card.appendChild(actions);
            queue.appendChild(card);
            return;
        }
        heading.textContent = `${currentAuditLabel(submission)} · ${submission.status.toUpperCase()}`;
        const submitted = document.createElement('p');
        submitted.className = 'facility-hint';
        submitted.textContent = `Submitted by ${submission.auditorName} (${submission.auditorEmail}) on ${new Date(submission.submittedAt).toLocaleString()}`;
        card.append(heading, submitted);
        const metadata = document.createElement('div');
        metadata.className = 'form-grid';

        const facilityGroup = document.createElement('div');
        facilityGroup.className = 'form-group';
        const facilityLabel = document.createElement('label');
        facilityLabel.textContent = 'Facility';
        const facilitySelect = document.createElement('select');
        facilitySelect.dataset.editField = 'facilityId';
        facilityNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            facilitySelect.appendChild(option);
        });
        facilitySelect.value = submission.facilityId;
        facilitySelect.disabled = true;
        facilityGroup.append(facilityLabel, facilitySelect);
        metadata.appendChild(facilityGroup);
        metadata.appendChild(createReviewInput('Hostel name / identifier', submission.hostelName, 'text', 'hostelName'));
        metadata.appendChild(createReviewInput('Location', submission.facilityInfo.facilityLocation, 'text', 'facilityLocation'));
        metadata.appendChild(createReviewInput('Floor area (m²)', submission.facilityInfo.floorArea, 'number', 'floorArea'));
        const auditorNameField = createReviewInput('Auditor name', submission.facilityInfo.authorName || submission.auditorName, 'text', 'authorName');
        auditorNameField.querySelector('input').readOnly = true;
        metadata.appendChild(auditorNameField);
        metadata.appendChild(createReviewInput('Building type', submission.facilityInfo.buildingType, 'text', 'buildingType'));


        metadata.appendChild(createReviewInput('Energy sources', submission.facilityInfo.energySources, 'text', 'energySources'));
        metadata.appendChild(createReviewInput('Audit date', submission.facilityInfo.auditDate, 'date', 'auditDate'));
        metadata.appendChild(createReviewInput(
            'Historical bills (one month,kWh,KES bill per line)',
            (submission.historicalData || []).map(entry => `${entry.month},${entry.kwh},${entry.cost}`).join('\n'),
            'textarea',
            'historicalData'
        ));
        metadata.appendChild(createReviewInput('Audit findings', submission.findings || '', 'textarea', 'findings'));
        metadata.appendChild(createReviewInput(
            'Energy-saving recommendations (one per line)',
            (submission.recommendations || []).join('\n'),
            'textarea',
            'recommendations'
        ));

        const photoHeading = document.createElement('h5');
        photoHeading.textContent = `Audit photos (${(submission.photos || []).length})`;
        const photoGallery = document.createElement('div');
        photoGallery.className = 'audit-photo-grid';
        (submission.photos || []).forEach((photo, photoIndex) => {
            const figure = document.createElement('figure');
            figure.className = 'audit-photo-card';
            const image = document.createElement('img');
            if (photo.dataUrl && !photo.dataUrl.startsWith('data:')) image.crossOrigin = 'use-credentials';
            image.src = photo.dataUrl;
            image.alt = photo.name || 'Auditor site photo';
            const caption = document.createElement('figcaption');
            caption.textContent = photo.name || `Audit photo ${photoIndex + 1}`;
            figure.append(image, caption);
            photoGallery.appendChild(figure);
        });
        const equipmentHeading = document.createElement('h5');
        equipmentHeading.textContent = 'Equipment (category, name, watts, quantity, hours/day)';
        const equipmentRows = document.createElement('div');
        equipmentRows.className = 'review-equipment-list';
        (submission.inventory || []).forEach(item => equipmentRows.appendChild(createEquipmentReviewRow(item)));
        const actions = document.createElement('div');
        actions.className = 'action-row';
        actions.style.marginTop = '1rem';

        const approve = document.createElement('button');
        approve.className = 'btn-action';
        approve.textContent = 'Approve';
        approve.addEventListener('click', () => approveSubmission(submission.id));
        const remove = document.createElement('button');
        remove.className = 'btn-delete';
        remove.textContent = 'Delete audit';
        remove.addEventListener('click', () => deleteAdminSubmission(submission.id, remove));
        actions.append(approve, remove);
        card.append(metadata, photoHeading, photoGallery, equipmentHeading, equipmentRows, actions);
        queue.appendChild(card);
    });
}

async function approveSubmission(id) {
    if (!isAdministrator()) return;
    if (!confirm('Approve this audit and include its data in Gross Campus Monthly Energy?')) return;
    try {
        const { audit: approvedSubmission } = await apiRequest(`/api/admin/audits/${encodeURIComponent(id)}/review`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'approve' })
        });
        replaceSubmission(approvedSubmission);
        renderInventoryTable();
        saveSharedSubmissions();
        alert('Audit approved. It is now included in Gross Campus Monthly Energy.');
    } catch (error) {
        reportApiError(error);
    }
}

async function deleteAdminSubmission(id, button) {
    if (!isAdministrator() || !confirm('Permanently delete this audit and its photos, reports, and review history?')) return;
    button.disabled = true;
    button.textContent = 'Deleting...';
    try {
        await apiRequest(`/api/admin/audits/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadUserData();
        await loadSharedSubmissions();
        saveSharedSubmissions();
    } catch (error) {
        button.disabled = false;
        button.textContent = 'Delete audit';
        reportApiError(error);
    }
}

async function deleteDiscardedSubmission(id, button) {
    const submission = sharedSubmissions.find(item => item.id === id);
    if (!currentUser || currentUser.role !== 'auditor' || !submission ||
        submission.status !== 'discarded' ||
        normalizeEmail(submission.auditorEmail) !== normalizeEmail(currentUser.email)) return;
    if (!confirm('Permanently delete this discarded audit submission?')) return;

    button.disabled = true;
    button.textContent = 'Deleting...';
    try {
        await apiRequest(`/api/audits/${encodeURIComponent(id)}`, { method: 'DELETE' });
        sharedSubmissions = sharedSubmissions.filter(item => item.id !== id);
        saveSharedSubmissions();
    } catch (error) {
        button.disabled = false;
        button.textContent = 'Delete';
        reportApiError(error);
    }
}

function replaceSubmission(submission) {
    submission.auditKey = submission.key || submission.facilityId;
    submission.photos = (submission.photos || []).map(photo => ({
        ...photo,
        dataUrl: photo.url ? `${API_BASE}${photo.url}` : photo.dataUrl
    }));
    const index = sharedSubmissions.findIndex(item => item.id === submission.id);
    if (index >= 0) sharedSubmissions[index] = submission;
    else sharedSubmissions.push(submission);
}
