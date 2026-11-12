let accountCache = [];
let administratorExists = false;
let canClaimAdministrator = false;

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
        ? 'Administrator access is enabled for this profile.'
        : administratorExists
            ? 'This profile can submit audits and track administrator review status.'
            : canClaimAdministrator
                ? 'No administrator is set up yet. This initial account can set up the first administrator.'
                : 'No administrator is set up yet. The initial administrator must be configured before additional accounts are registered.';
    document.getElementById('claimAdminButton').style.display =
        !administratorExists && canClaimAdministrator ? 'inline-block' : 'none';
    document.getElementById('adminAccountsPanel').style.display = admin ? 'block' : 'none';
    document.getElementById('adminReviewPanel').style.display = admin ? 'block' : 'none';
    renderAccountList();

    const mine = document.getElementById('mySubmissionList');
    mine.innerHTML = '';
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
            details.textContent = `Submitted ${new Date(item.submittedAt).toLocaleString()}${item.reviewedBy ? ` · Reviewed by ${item.reviewedBy}` : ''}`;
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

    accountCache.forEach(account => {
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
        if (type === 'number') input.step = 'any';
        row.appendChild(input);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-delete';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => row.remove());
    row.appendChild(remove);
    return row;
}

function renderAdminReviewQueue() {
    const queue = document.getElementById('adminReviewQueue');
    if (!queue) return;
    queue.innerHTML = '';
    if (!isAdministrator()) return;

    const submissions = sharedSubmissions;
    if (!submissions.length) {
        queue.textContent = 'There are no submitted audits to review.';
        return;
    }

    submissions.slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)).forEach(submission => {
        const card = document.createElement('article');
        card.className = 'submission-card';
        const heading = document.createElement('h5');
        if (submission.status === 'approved' || submission.status === 'discarded') {
            heading.textContent = `${currentAuditLabel(submission)} · ${submission.status.toUpperCase()} - ${submission.auditorName || submission.auditorEmail}`;
            card.appendChild(heading);
            if (submission.status === 'approved') {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'btn-clear-all';
                remove.textContent = 'Remove';
                remove.addEventListener('click', () => removeApprovedSubmission(submission.id, remove));
                const actions = document.createElement('div');
                actions.className = 'action-row';
                actions.appendChild(remove);
                card.appendChild(actions);
            } else {
                if (normalizeEmail(submission.auditorEmail) === normalizeEmail(currentUser.email)) {
                    const remove = document.createElement('button');
                    remove.type = 'button';
                    remove.className = 'btn-delete';
                    remove.textContent = 'Delete';
                    remove.addEventListener('click', () => deleteDiscardedSubmission(submission.id, remove));
                    const actions = document.createElement('div');
                    actions.className = 'action-row';
                    actions.appendChild(remove);
                    card.appendChild(actions);
                }
            }
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

        metadata.appendChild(createReviewInput('Audit purpose', submission.facilityInfo.auditPurpose, 'text', 'auditPurpose'));

        metadata.appendChild(createReviewInput('Audit scope', submission.facilityInfo.scope, 'text', 'scope'));
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
            const removePhoto = document.createElement('button');
            removePhoto.type = 'button';
            removePhoto.className = 'btn-delete';
            removePhoto.textContent = 'Remove photo';
            removePhoto.addEventListener('click', () => {
                submission.photos.splice(photoIndex, 1);
                figure.remove();
                photoHeading.textContent = `Audit photos (${submission.photos.length})`;
            });
            figure.append(image, caption, removePhoto);
            photoGallery.appendChild(figure);
        });
        const equipmentHeading = document.createElement('h5');
        equipmentHeading.textContent = 'Equipment (category, name, watts, quantity, hours/day)';
        const equipmentRows = document.createElement('div');
        equipmentRows.className = 'review-equipment-list';
        (submission.inventory || []).forEach(item => equipmentRows.appendChild(createEquipmentReviewRow(item)));
        const addEquipment = document.createElement('button');
        addEquipment.type = 'button';
        addEquipment.className = 'btn-action';
        addEquipment.textContent = 'Add equipment row';
        addEquipment.addEventListener('click', () => equipmentRows.appendChild(createEquipmentReviewRow()));
        const actions = document.createElement('div');
        actions.className = 'action-row';
        actions.style.marginTop = '1rem';

        const save = document.createElement('button');
        save.className = 'btn-action';
        save.textContent = 'Save edits';
        save.addEventListener('click', () => saveSubmissionEdits(submission.id, card));
        const approve = document.createElement('button');
        approve.className = 'btn-action';
        approve.textContent = 'Approve';
        approve.addEventListener('click', () => approveSubmission(submission.id, card));
        const discard = document.createElement('button');
        discard.className = 'btn-clear-all';
        discard.textContent = 'Discard';
        discard.addEventListener('click', () => discardSubmission(submission.id));
        actions.append(save, approve, discard);
        card.append(metadata, photoHeading, photoGallery, equipmentHeading, equipmentRows, addEquipment, actions);
        queue.appendChild(card);
    });
}

function collectSubmissionEdits(id, card) {
    const submission = sharedSubmissions.find(item => item.id === id);
    if (!submission || !card || !isAdministrator()) return null;
    const readField = name => card.querySelector(`[data-edit-field="${name}"]`).value.trim();
    const facilityId = readField('facilityId');
    const hostelName = readField('hostelName');
    const rows = [...card.querySelectorAll('.submission-equipment')];
    const inventory = [];
    for (const row of rows) {
        const readEquipment = name => row.querySelector(`[data-equipment-field="${name}"]`).value.trim();
        const category = readEquipment('category');
        const name = readEquipment('name');
        const watts = Number(readEquipment('watts'));
        const qty = Number(readEquipment('qty'));
        const hours = Number(readEquipment('hours'));
        if (!name || !category || !Number.isFinite(watts) || watts <= 0 || !Number.isInteger(qty) || qty < 1 ||
            !Number.isFinite(hours) || hours <= 0 || hours > 24) {
            alert('Each equipment row needs a category, name, positive wattage, whole-number quantity, and daily operating hours from 0 to 24.');
            return null;
        }
        inventory.push({
            id: Number(row.dataset.itemId) || Date.now() + inventory.length,
            category,
            name,
            watts,
            qty,
            hours,
            pf: 1
        });
    }
    if (!inventory.length) {
        alert('Keep at least one equipment row in the audit before saving or approving it.');
        return null;
    }
    if (facilityId === 'Hostels' && !hostelName) {
        alert('Enter the hostel name before saving or approving this audit.');
        return null;
    }
    const historicalData = [];
    const historyText = readField('historicalData');
    for (const [index, line] of historyText.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        const [month, kwhText, costText] = line.split(',').map(value => value.trim());
        const kwh = Number(kwhText);
        const cost = Number(costText);
        if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(kwh) || kwh < 0 || !Number.isFinite(cost) || cost < 0) {
            alert(`Historical bill line ${index + 1} must be formatted as YYYY-MM,kWh,KES bill.`);
            return null;
        }
        historicalData.push({ month, kwh, cost });
    }

    const newAuditKey = facilityId === 'Hostels' ? `Hostels:${hostelName.toLocaleLowerCase()}` : facilityId;
    const conflictingSubmission = sharedSubmissions.find(item =>
        item.auditKey === newAuditKey && item.id !== submission.id && item.status !== 'discarded'
    );
    if (conflictingSubmission) {
        alert('Another audit already exists for this facility. Resolve that submission before changing this facility name.');
        return null;
    }
    if (newAuditKey !== submission.auditKey) {
        submission.sourceAuditKey = submission.sourceAuditKey || submission.auditKey;
        submission.auditKey = newAuditKey;
    }

    submission.facilityId = facilityId;
    submission.hostelName = facilityId === 'Hostels' ? hostelName : '';
    submission.facilityInfo = {
        facilityLocation: readField('facilityLocation'),
        floorArea: readField('floorArea'),
        authorName: readField('authorName'),
        energySources: readField('energySources'),
        auditDate: readField('auditDate'),
        auditPurpose: readField('auditPurpose'),
        scope: readField('scope')
    };
    submission.inventory = inventory;
    submission.historicalData = historicalData;
    submission.findings = readField('findings');
    submission.recommendations = readField('recommendations').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    submission.report = '';
    submission.reviewedAt = '';
    submission.reviewedBy = '';
    return submission;
}

async function saveSubmissionEdits(id, card) {
    if (!isAdministrator()) return;
    const submission = collectSubmissionEdits(id, card);
    if (!submission) return;
    submission.status = 'pending';
    submission.lastEditedBy = currentUser.name;
    try {
        const { audit: savedSubmission } = await apiRequest(`/api/admin/audits/${encodeURIComponent(id)}/review`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'save', audit: toAuditPayload(submission) })
        });
        replaceSubmission(savedSubmission);
        saveSharedSubmissions();
        alert('Edits saved. The audit is pending approval.');
    } catch (error) {
        reportApiError(error);
    }
}

async function approveSubmission(id, card) {
    if (!isAdministrator()) return;
    if (!confirm('Approve this audit and include its data in university-wide totals?')) return;
    const submission = collectSubmissionEdits(id, card);
    if (!submission) return;
    try {
        const { audit: approvedSubmission } = await apiRequest(`/api/admin/audits/${encodeURIComponent(id)}/review`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'approve', audit: toAuditPayload(submission) })
        });
        replaceSubmission(approvedSubmission);
        renderInventoryTable();
        saveSharedSubmissions();
        alert('Audit approved. It is now included in university-wide totals.');
    } catch (error) {
        reportApiError(error);
    }
}

async function discardSubmission(id) {
    if (!isAdministrator()) return;
    if (!confirm('Discard this audit submission? It will be excluded from university totals.')) return;
    try {
        const { audit: submission } = await apiRequest(`/api/admin/audits/${encodeURIComponent(id)}/review`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'discard' })
        });
        replaceSubmission(submission);
        saveSharedSubmissions();
    } catch (error) {
        reportApiError(error);
    }
}

async function removeApprovedSubmission(id, button) {
    if (!isAdministrator()) return;
    if (!confirm('Remove this approved audit? It will be excluded from campus totals.')) return;
    button.disabled = true;
    button.textContent = 'Removing...';
    try {
        const { audit: submission } = await apiRequest(`/api/admin/audits/${encodeURIComponent(id)}/review`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'discard' })
        });
        replaceSubmission(submission);
        saveSharedSubmissions();
    } catch (error) {
        button.disabled = false;
        button.textContent = 'Remove';
        reportApiError(error);
    }
}

async function deleteDiscardedSubmission(id, button) {
    const submission = sharedSubmissions.find(item => item.id === id);
    if (!submission || submission.status !== 'discarded') return;
    const isOwner = normalizeEmail(submission.auditorEmail) === normalizeEmail(currentUser?.email);
    if (!isOwner) return;
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
