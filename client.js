'use strict';

(function () {
    const apiBase = String(window.ENERTRACK_API_BASE_URL || '').replace(/\/$/, '');
    let accountCache = [];
    let administratorExists = false;
    let canClaimAdministrator = false;
    let auditSaveQueue = Promise.resolve();
    let auditSaveError = null;
    let pendingAuditSaves = 0;
    let dashboardTimer = null;
    let recommendationSaveTimer = null;
    let downloadButton;

    async function apiRequest(path, options = {}) {
        const response = await fetch(`${apiBase}/api${path}`, {
            credentials: 'include',
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {})
            }
        });
        if (response.status === 204) return null;
        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json') ? await response.json() : null;
        if (!response.ok) {
            const error = new Error(payload && payload.error ? payload.error : `EnerTrack request failed (${response.status}).`);
            error.status = response.status;
            error.details = payload && payload.details;
            throw error;
        }
        return payload;
    }

    function showError(error, fallback = 'The requested action could not be completed.') {
        console.error(fallback, error);
        const status = document.getElementById('submissionStatus');
        if (status && currentUser) status.textContent = `${fallback} ${error.message}`;
        else alert(`${fallback} ${error.message}`);
    }

    function hasAuditContent(record) {
        return !!(record && (
            record.inventory.length ||
            record.historicalData.length ||
            record.photos.length ||
            record.report ||
            record.reportReference ||
            record.findings ||
            (Array.isArray(record.recommendations) && record.recommendations.length) ||
            Object.entries(record.facilityInfo || {}).some(([key, value]) =>
                key !== 'auditDate' && key !== 'savingsTarget' && value !== '' && value !== null
            )
        ));
    }

    function hasData(record) {
        return !!(record && (record.id || hasAuditContent(record)));
    }

    function createAuditId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        return [...bytes].map((byte, index) =>
            [4, 6, 8, 10].includes(index) ? `-${byte.toString(16).padStart(2, '0')}` : byte.toString(16).padStart(2, '0')
        ).join('');
    }

    function toAuditPayload(record) {
        const tariffRate = Number(record.tariffRate ?? document.getElementById('tariffRate').value);
        const emissionFactor = Number(record.emissionFactor ?? document.getElementById('emissionFactor').value);
        return {
            facilityId: record.facilityId,
            hostelName: record.hostelName || '',
            facilityInfo: { ...createEmptyFacilityInfo(), ...(record.facilityInfo || {}) },
            inventory: (record.inventory || []).map(item => ({
                id: String(item.id ?? createAuditId()),
                category: item.category,
                name: item.name,
                watts: Number(item.watts),
                qty: Number(item.qty),
                hours: Number(item.hours)
            })),
            historicalData: (record.historicalData || []).map(entry => ({
                month: entry.month,
                kwh: Number(entry.kwh),
                cost: Number(entry.cost)
            })),
            photos: (record.photos || []).map(photo => ({
                ...(photo.id ? { id: photo.id } : {}),
                name: photo.name || 'Audit photo',
                ...(photo.dataUrl ? { dataUrl: photo.dataUrl } : {})
            })),
            findings: record.findings || '',
            recommendations: Array.isArray(record.recommendations) ? record.recommendations : [],
            tariffRate: Number.isFinite(tariffRate) ? tariffRate : 12,
            emissionFactor: Number.isFinite(emissionFactor) ? emissionFactor : 0.05,
            report: record.report || '',
            reportReference: record.reportReference || ''
        };
    }

    async function persistRecord(record) {
        const photosBeforeSave = JSON.stringify(record.photos || []);
        if (!record.id) {
            const created = await apiRequest('/audits', {
                method: 'POST',
                body: JSON.stringify({
                    facilityId: record.facilityId,
                    hostelName: record.hostelName || ''
                })
            });
            record.id = created.audit.id;
        }
        const result = await apiRequest(`/audits/${record.id}`, {
            method: 'PUT',
            body: JSON.stringify(toAuditPayload(record))
        });
        record.id = result.audit.id;
        record.status = result.audit.status;
        record.updatedAt = result.audit.updatedAt;
        record.submittedAt = result.audit.submittedAt;
        record.reviewedAt = result.audit.reviewedAt;
        record.reviewedBy = result.audit.reviewedBy;
        const submissionIndex = sharedSubmissions.findIndex(item => item.id === record.id);
        if (submissionIndex >= 0) sharedSubmissions[submissionIndex] = result.audit;
        if (JSON.stringify(record.photos || []) === photosBeforeSave) {
            record.photos = result.audit.photos;
            if (getCurrentAudit(false) === record) {
                auditPhotos = record.photos;
                renderAuditPhotos(auditPhotos);
            }
        }
    }

    async function reloadAccountCache() {
        if (!currentUser || currentUser.role !== 'admin') {
            accountCache = currentUser ? [currentUser] : [];
            return;
        }
        const result = await apiRequest('/admin/users');
        accountCache = result.users;
    }

    async function refreshAuditCollection() {
        if (!currentUser) return;
        const result = currentUser.role === 'admin'
            ? await apiRequest('/admin/audits')
            : await apiRequest('/audits');
        sharedSubmissions = result.audits;
        renderProfiles();
        updateSubmissionStatus();
        updateUniversitySummary();
    }

    function normalizeLocalAudit(audit) {
        const facilityId = audit.facilityId || 'Admin';
        const hostelName = audit.hostelName || '';
        return {
            ...audit,
            id: audit.id || null,
            key: audit.key || (facilityId === 'Hostels' && hostelName
                ? `Hostels:${hostelName.toLocaleLowerCase()}`
                : facilityId),
            facilityId,
            hostelName,
            facilityInfo: { ...createEmptyFacilityInfo(), ...(audit.facilityInfo || {}) },
            inventory: Array.isArray(audit.inventory) ? audit.inventory : [],
            historicalData: Array.isArray(audit.historicalData) ? audit.historicalData : [],
            photos: Array.isArray(audit.photos) ? audit.photos : [],
            findings: audit.findings || '',
            recommendations: Array.isArray(audit.recommendations) ? audit.recommendations : [],
            report: audit.report || '',
            reportGeneratedAt: audit.reportGeneratedAt || '',
            tariffRate: Number(audit.tariffRate) || 12,
            emissionFactor: Number(audit.emissionFactor) || 0.05
        };
    }

    function mergeLocalAudit(serverAudits, localAudit) {
        const local = normalizeLocalAudit(localAudit);
        const existing = serverAudits.find(item => item.key === local.key);
        if (!existing) return local;
        const existingHasValues = hasAuditContent(existing);
        if (existingHasValues) return existing;
        return { ...local, id: existing.id, status: existing.status };
    }

    function setCurrentUser(user) {
        currentUser = user;
        document.getElementById('userNameDisplay').textContent = user ? user.name : 'Auditor';
        document.getElementById('printHeaderUserName').textContent = user ? user.name : 'Auditor';
        document.getElementById('authOverlay').style.display = user ? 'none' : 'flex';
    }

    function photoUrl(photo) {
        const url = photo.url || photo.dataUrl || '';
        return url.startsWith('/') ? `${apiBase}${url}` : url;
    }

    async function initializeSignedInUser(user) {
        setCurrentUser(user);
        await loadUserData();
        await loadSharedSubmissions();
        await loadAuditorComments();
        const setup = await apiRequest('/auth/setup-status');
        administratorExists = setup.adminExists;
        canClaimAdministrator = setup.canClaimAdmin;
        await reloadAccountCache();
        try {
            const oldUsers = JSON.parse(localStorage.getItem('g12_audit_users') || '{}');
            let changedLegacyAccounts = false;
            Object.values(oldUsers).forEach(account => {
                if (account && account.email === user.email && Object.hasOwn(account, 'password')) {
                    delete account.password;
                    changedLegacyAccounts = true;
                }
            });
            if (changedLegacyAccounts) localStorage.setItem('g12_audit_users', JSON.stringify(oldUsers));
        } catch (error) {
            console.error('Legacy browser account data could not be sanitized.', error);
        }
        renderProfiles();
        updateUniversitySummary();
    }

    window.getRegisteredAccounts = function () {
        return { users: {}, accounts: accountCache };
    };

    window.hasAdministrator = function () {
        return administratorExists || accountCache.some(account => account.role === 'admin');
    };

    window.isAdministrator = function () {
        return !!currentUser && currentUser.role === 'admin';
    };

    window.saveAudits = function () {
        if (!currentUser) return auditSaveQueue;
        const record = getCurrentAudit(false);
        if (!hasData(record)) return auditSaveQueue;
        const target = record;
        const saveOperation = auditSaveQueue.catch(() => undefined).then(() => persistRecord(target)).then(() => {
            auditSaveError = null;
            updateSubmissionStatus();
            updateUniversitySummary();
            return true;
        }).catch(error => {
            auditSaveError = error;
            showError(error, 'Audit changes could not be saved to the server.');
            return false;
        });
        auditSaveQueue = saveOperation;
        pendingAuditSaves += 1;
        saveOperation.finally(() => { pendingAuditSaves = Math.max(0, pendingAuditSaves - 1); });
        return auditSaveQueue;
    };

    window.loadUserData = async function () {
        if (!currentUser) return;
        const serverData = await apiRequest('/audits');
        audits = serverData.audits.map(normalizeLocalAudit);
        const legacyKey = `g12_audits_${currentUser.email}`;
        let legacyAudits = [];
        try {
            const stored = localStorage.getItem(legacyKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (!Array.isArray(parsed)) throw new Error('Legacy audit data is not an array.');
                legacyAudits = parsed;
            } else {
                const oldItems = JSON.parse(localStorage.getItem(`g12_inventory_${currentUser.email}`) || '[]');
                const oldInfo = JSON.parse(localStorage.getItem(`g12_facility_${currentUser.email}`) || '{}');
                if (oldItems.length || Object.keys(oldInfo).length) {
                    legacyAudits.push({
                        facilityId: facilityNames.find(name => name.toLowerCase() === String(oldInfo.buildingName || '').toLowerCase()) || 'Admin',
                        facilityInfo: {
                            facilityLocation: oldInfo.facilityLocation || '',
                            authorName: oldInfo.authorName || ''
                        },
                        inventory: oldItems
                    });
                }
            }
        } catch (error) {
            console.error('Existing browser audit data could not be read.', error);
            alert('Your previous browser-stored audit data is invalid and was not imported.');
        }

        if (legacyAudits.length) {
            const recordsToImport = [];
            for (const legacyAudit of legacyAudits) {
                const local = normalizeLocalAudit(legacyAudit);
                const index = audits.findIndex(item => item.key === local.key);
                if (index < 0) {
                    local.id = null;
                    audits.push(local);
                    if (hasData(local)) recordsToImport.push(local);
                    continue;
                }
                const merged = mergeLocalAudit(audits, local);
                if (merged !== audits[index]) {
                    audits[index] = merged;
                    if (hasData(merged)) recordsToImport.push(merged);
                }
            }
            for (const record of recordsToImport) await persistRecord(record);
            if (recordsToImport.length) {
                localStorage.removeItem(legacyKey);
                localStorage.removeItem(`g12_inventory_${currentUser.email}`);
                localStorage.removeItem(`g12_facility_${currentUser.email}`);
            }
        }

        facilityNames.filter(name => name !== 'Hostels').forEach(name => {
            if (!audits.some(audit => audit.key === name)) {
                audits.push(normalizeLocalAudit({
                    key: name,
                    facilityId: name,
                    facilityInfo: createEmptyFacilityInfo(),
                    inventory: [],
                    historicalData: [],
                    photos: [],
                    report: ''
                }));
            }
        });
        const populatedAudit = audits.find(audit => audit.inventory.length > 0);
        selectedFacility = populatedAudit ? populatedAudit.facilityId : 'Admin';
        selectedHostelName = populatedAudit && populatedAudit.facilityId === 'Hostels' ? populatedAudit.hostelName : '';
        initializeFacilitySelector();
        loadActiveAudit();
    };

    window.loadSharedSubmissions = async function () {
        await refreshAuditCollection();
    };

    window.saveSharedSubmissions = function () {
        renderProfiles();
        updateUniversitySummary();
        updateSubmissionStatus();
    };

    window.updateSubmissionStatus = function () {
        const status = document.getElementById('submissionStatus');
        if (!status || !currentUser) return;
        const record = getCurrentAudit(false);
        const submission = record && sharedSubmissions.find(item => item.key === record.key);
        if (!submission || !submission.status || submission.status === 'draft') {
            status.textContent = 'Submit this facility audit for administrator review and approval.';
            return;
        }
        const state = submission.status === 'approved' ? 'Approved' :
            submission.status === 'discarded' ? 'Discarded' : 'Pending administrator review';
        status.textContent = `${state}${submission.submittedAt ? ` — last submitted ${new Date(submission.submittedAt).toLocaleString()}.` : '.'}`;
    };

    window.updateUniversitySummary = function () {
        if (!currentUser || dashboardTimer) return;
        dashboardTimer = setTimeout(async () => {
            dashboardTimer = null;
            try {
                if (!currentUser) return;
                const result = await apiRequest('/dashboard');
                const number = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                document.getElementById('universityKwh').textContent = `${number(result.totals.monthlyKwh)} kWh`;
                document.getElementById('universityCost').textContent = `KES ${number(result.totals.monthlyCost)}`;
                document.getElementById('universityCarbon').textContent = `${number(result.totals.monthlyCarbon)} kg CO₂e`;
                document.getElementById('dashboardUniversityKwh').textContent = `${number(result.totals.monthlyKwh)} kWh`;
                document.getElementById('dashboardUniversityCost').textContent = `KES ${number(result.totals.monthlyCost)}`;
                document.getElementById('dashboardFacilityCount').textContent =
                    `${result.totals.facilitiesAudited} / ${facilityNames.length + result.facilities.filter(item => item.facilityId === 'Hostels').length}`;
                const personal = result.personal;
                document.getElementById('dashboardAuditCount').textContent = personal.totals.auditCount.toLocaleString('en-US');
                document.getElementById('dashboardRecordedKwh').textContent = `${number(personal.totals.recordedKwh)} kWh`;
                document.getElementById('dashboardRecordedCost').textContent = `KES ${number(personal.totals.recordedCost)}`;
                const recentBody = document.getElementById('dashboardRecentAudits');
                recentBody.replaceChildren();
                personal.recentAudits.forEach(audit => {
                    const row = document.createElement('tr');
                    [
                        audit.label,
                        audit.status,
                        audit.equipmentItems,
                        `${number(audit.recordedKwh)} kWh`,
                        new Date(audit.updatedAt).toLocaleDateString()
                    ].forEach(value => {
                        const cell = document.createElement('td');
                        cell.textContent = value;
                        row.appendChild(cell);
                    });
                    recentBody.appendChild(row);
                });
                if (!personal.recentAudits.length) {
                    const row = document.createElement('tr');
                    const cell = document.createElement('td');
                    cell.colSpan = 5;
                    cell.className = 'empty-state';
                    cell.textContent = 'No saved audits yet.';
                    row.appendChild(cell);
                    recentBody.appendChild(row);
                }
                const reportsBody = document.getElementById('dashboardReports');
                reportsBody.replaceChildren();
                personal.reports.forEach(audit => {
                    const row = document.createElement('tr');
                    const facility = document.createElement('td');
                    facility.textContent = audit.label;
                    row.appendChild(facility);
                    const status = document.createElement('td');
                    status.textContent = audit.reportGenerated ? 'Generated for current audit version' : 'Ready to generate';
                    row.appendChild(status);
                    const downloadCell = document.createElement('td');
                    const download = document.createElement('a');
                    download.href = `${apiBase}/api/audits/${encodeURIComponent(audit.id)}/report.pdf`;
                    download.textContent = 'Download PDF';
                    downloadCell.appendChild(download);
                    row.appendChild(downloadCell);
                    reportsBody.appendChild(row);
                });
                if (!personal.reports.length) {
                    const row = document.createElement('tr');
                    const cell = document.createElement('td');
                    cell.colSpan = 3;
                    cell.className = 'empty-state';
                    cell.textContent = 'No audit reports available yet.';
                    row.appendChild(cell);
                    reportsBody.appendChild(row);
                }
                const tbody = document.getElementById('universityFacilityBody');
                tbody.innerHTML = '';
                result.facilities.forEach(facility => {
                    const row = document.createElement('tr');
                    [facility.label, facility.equipmentItems, `${number(facility.monthlyKwh)} kWh`, `KES ${number(facility.monthlyCost)}`]
                        .forEach(value => {
                            const cell = document.createElement('td');
                            cell.textContent = value;
                            row.appendChild(cell);
                        });
                    tbody.appendChild(row);
                });
                if (!result.facilities.length) {
                    const row = document.createElement('tr');
                    row.innerHTML = '<td colspan="4" class="empty-state">No approved facility audit data yet.</td>';
                    tbody.appendChild(row);
                }
                const canvas = document.getElementById('universityChart');
                if (universityChartInstance) universityChartInstance.destroy();
                if (canvas && typeof Chart !== 'undefined') {
                    universityChartInstance = new Chart(canvas.getContext('2d'), {
                        type: 'bar',
                        data: {
                            labels: result.facilities.map(item => item.label),
                            datasets: [{
                                label: 'Monthly Energy (kWh)',
                                data: result.facilities.map(item => item.monthlyKwh),
                                backgroundColor: '#04e617',
                                borderRadius: 6
                            }]
                        },
                        options: { responsive: true, maintainAspectRatio: false }
                    });
                } else if (canvas) showChartUnavailable(canvas);
            } catch (error) {
                showError(error, 'University dashboard data could not be loaded.');
            }
        }, 150);
    };

    window.setAccountRole = async function (email, role) {
        try {
            const user = accountCache.find(account => account.email === email);
            if (!user) throw new Error('Account not found.');
            await apiRequest(`/admin/users/${user.id}/role`, {
                method: 'PATCH',
                body: JSON.stringify({ role })
            });
            if (role === 'admin') administratorExists = true;
            else if (accountCache.filter(account => account.role === 'admin').length <= 1) administratorExists = false;
            await reloadAccountCache();
            renderProfiles();
            return true;
        } catch (error) {
            showError(error, 'The account role could not be changed.');
            return false;
        }
    };

    const originalRenderProfiles = window.renderProfiles;
    window.renderProfiles = function () {
        originalRenderProfiles();
        if (!currentUser) return;
        const hint = document.getElementById('adminSetupHint');
        const claim = document.getElementById('claimAdminButton');
        if (currentUser.role === 'admin') {
            hint.textContent = 'Administrator access is enabled for this profile.';
            claim.style.display = 'none';
        } else if (administratorExists) {
            hint.textContent = 'This profile can submit audits and track administrator review status.';
            claim.style.display = 'none';
        } else if (canClaimAdministrator) {
            hint.textContent = 'No administrator is set up yet. This initial account can set up the first administrator.';
            claim.style.display = 'inline-block';
        } else {
            hint.textContent = 'No administrator is set up yet. The initial administrator must be configured before additional accounts are registered.';
            claim.style.display = 'none';
        }
    };

    window.claimAdministratorAccess = async function () {
        if (!confirm('Set up this account as the first EnerTrack administrator?')) return;
        try {
            const result = await apiRequest('/auth/claim-admin', { method: 'POST' });
            setCurrentUser(result.user);
            administratorExists = true;
            canClaimAdministrator = false;
            await reloadAccountCache();
            renderProfiles();
            alert('Administrator access is now active for this account.');
        } catch (error) {
            showError(error, 'Administrator access could not be enabled.');
        }
    };

    window.submitCurrentAudit = async function () {
        const record = getCurrentAudit(false);
        if (!record || !record.inventory.length) {
            alert('Add at least one equipment item before submitting this facility audit.');
            return;
        }
        try {
            if (!(await saveAudits()) || auditSaveError) throw auditSaveError || new Error('Save the audit before submitting it.');
            const result = await apiRequest(`/audits/${record.id}/submit`, { method: 'POST' });
            Object.assign(record, result.audit);
            await refreshAuditCollection();
            alert('Facility audit submitted for administrator approval.');
        } catch (error) {
            showError(error, 'The facility audit could not be submitted.');
        }
    };

    function collectAdminAudit(submission, card) {
        const readField = name => card.querySelector(`[data-edit-field="${name}"]`).value.trim();
        const inventory = [...card.querySelectorAll('.submission-equipment')].map((row, index) => {
            const value = name => row.querySelector(`[data-equipment-field="${name}"]`).value.trim();
            return {
                id: row.dataset.itemId || createAuditId(),
                category: value('category'),
                name: value('name'),
                watts: Number(value('watts')),
                qty: Number(value('qty')),
                hours: Number(value('hours'))
            };
        });
        const historicalData = [];
        for (const [index, line] of readField('historicalData').split(/\r?\n/).entries()) {
            if (!line.trim()) continue;
            const [month, kwh, cost] = line.split(',').map(value => value.trim());
            if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(Number(kwh)) || Number(kwh) < 0 ||
                !Number.isFinite(Number(cost)) || Number(cost) < 0) {
                throw new Error(`Historical bill line ${index + 1} must be formatted as YYYY-MM,kWh,KES bill.`);
            }
            historicalData.push({ month, kwh: Number(kwh), cost: Number(cost) });
        }
        return {
            facilityId: readField('facilityId'),
            hostelName: readField('hostelName'),
            facilityInfo: {
                facilityLocation: readField('facilityLocation'),
                authorName: submission.auditorName,
                operatingHours: readField('operatingHours'),
                occupants: readField('occupants'),
                energySources: readField('energySources'),
                auditDate: readField('auditDate'),
                savingsTarget: Number(readField('savingsTarget')),
                background: readField('background')
            },
            inventory,
            historicalData,
            photos: submission.photos,
            findings: submission.findings || '',
            recommendations: Array.isArray(submission.recommendations) ? submission.recommendations : [],
            tariffRate: submission.tariffRate,
            emissionFactor: submission.emissionFactor,
            report: '',
            reportReference: submission.reportReference || ''
        };
    }

    async function reviewSubmission(id, card, action) {
        if (!isAdministrator()) return;
        try {
            const submission = sharedSubmissions.find(item => item.id === id);
            if (!submission) throw new Error('This audit is no longer available for review.');
            const audit = collectAdminAudit(submission, card);
            if (!audit.inventory.length) throw new Error('Keep at least one equipment row before saving or approving.');
            if (audit.facilityId === 'Hostels' && !audit.hostelName) throw new Error('Enter the hostel name before continuing.');
            if (!Number.isFinite(audit.facilityInfo.savingsTarget) || audit.facilityInfo.savingsTarget < 0 ||
                audit.facilityInfo.savingsTarget > 100) throw new Error('Savings target must be between 0 and 100 percent.');
            const result = await apiRequest(`/admin/audits/${id}/review`, {
                method: 'PATCH',
                body: JSON.stringify({ action, audit })
            });
            const index = sharedSubmissions.findIndex(item => item.id === id);
            if (index >= 0) sharedSubmissions[index] = result.audit;
            await refreshAuditCollection();
            alert(action === 'approve' ? 'Audit approved and included in university totals.' :
                action === 'save' ? 'Edits saved. The audit is pending approval.' : 'Audit discarded.');
        } catch (error) {
            showError(error, 'The audit review could not be completed.');
        }
    }

    window.saveSubmissionEdits = (id, card) => reviewSubmission(id, card, 'save');
    window.approveSubmission = (id, card) => reviewSubmission(id, card, 'approve');
    window.discardSubmission = async function (id) {
        if (!isAdministrator() || !confirm('Discard this audit submission? It will be excluded from university totals.')) return;
        try {
            await apiRequest(`/admin/audits/${id}/review`, {
                method: 'PATCH',
                body: JSON.stringify({ action: 'discard' })
            });
            await refreshAuditCollection();
        } catch (error) {
            showError(error, 'The audit could not be discarded.');
        }
    };

    window.loadAuditorComments = async function () {
        if (!currentUser) return;
        try {
            const result = await apiRequest('/recommendations');
            loadRecommendations = result.recommendations.length ? result.recommendations : loadRecommendations;
            renderLoadRecommendationBoxes();
        } catch (error) {
            showError(error, 'Auditor recommendations could not be loaded.');
        }
    };

    window.saveAuditorComments = function () {
        if (!currentUser) return;
        if (recommendationSaveTimer) clearTimeout(recommendationSaveTimer);
        recommendationSaveTimer = setTimeout(async () => {
            recommendationSaveTimer = null;
            try {
                await apiRequest('/recommendations', {
                    method: 'PUT',
                    body: JSON.stringify({ recommendations: loadRecommendations })
                });
            } catch (error) {
                showError(error, 'Auditor recommendations could not be saved.');
            }
        }, 250);
    };

    window.handleRegister = async function () {
        const input = {
            name: document.getElementById('regName').value.trim(),
            regNo: document.getElementById('regRegNo').value.trim(),
            email: document.getElementById('regEmail').value.trim(),
            password: document.getElementById('regPass').value
        };
        try {
            const result = await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(input) });
            await initializeSignedInUser(result.user);
            document.getElementById('authorName').value = result.user.name;
            saveFacilityDetails();
        } catch (error) {
            showError(error, 'Account registration failed.');
        }
    };

    window.handleLogin = async function () {
        try {
            const result = await apiRequest('/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    identifier: document.getElementById('loginEmail').value.trim(),
                    password: document.getElementById('loginPass').value
                })
            });
            await initializeSignedInUser(result.user);
        } catch (error) {
            showError(error, 'Sign-in failed.');
        }
    };

    window.handleResetPassword = async function () {
        const email = document.getElementById('forgotEmail').value.trim();
        const token = document.getElementById('forgotResetToken').value.trim() ||
            new URLSearchParams(location.search).get('resetToken') || '';
        try {
            if (!token) {
                const result = await apiRequest('/auth/password-reset/request', {
                    method: 'POST',
                    body: JSON.stringify({ email })
                });
                alert(result.message);
                return;
            }
            const result = await apiRequest('/auth/password-reset/complete', {
                method: 'POST',
                body: JSON.stringify({ token, password: document.getElementById('forgotNewPass').value })
            });
            alert(result.message);
            history.replaceState(null, '', location.pathname);
            toggleAuthView('login');
        } catch (error) {
            showError(error, 'Password reset failed.');
        }
    };

    window.loginUser = async function (user) {
        await initializeSignedInUser(user);
    };

    window.handleLogout = async function () {
        try {
            await apiRequest('/auth/logout', { method: 'POST' });
        } catch (error) {
            if (error.status !== 401) showError(error, 'Sign-out failed.');
        }
        setCurrentUser(null);
        audits = [];
        inventory = [];
        sharedSubmissions = [];
        accountCache = [];
        renderInventoryTable();
        updateKPIs(0, 0, 0, 0, 0, 0);
        updateCharts();
        updateUniversitySummary();
    };

    window.checkSession = async function () {
        try {
            if (new URLSearchParams(location.search).has('resetToken')) {
                setCurrentUser(null);
                return;
            }
            const result = await apiRequest('/auth/me');
            if (result.user) {
                await initializeSignedInUser(result.user);
            } else {
                setCurrentUser(null);
            }
        } catch (error) {
            setCurrentUser(null);
            showError(error, 'EnerTrack could not connect to its API. Start the server and database, then reload.');
        }
    };

    window.handleFacilitySelection = function () {
        selectedFacility = document.getElementById('facilitySelector').value;
        selectedHostelName = '';
        document.getElementById('hostelName').value = '';
        document.getElementById('hostelNameGroup').style.display = selectedFacility === 'Hostels' ? 'flex' : 'none';
        loadActiveAudit();
    };

    window.deleteCurrentAudit = async function () {
        const record = getCurrentAudit(false);
        if (!currentUser || !record || !record.id) return;
        if (!confirm('Permanently delete this audit and its saved readings, equipment, recommendations, photos, and reports? This cannot be undone.')) return;
        try {
            const saveResult = await auditSaveQueue;
            if (saveResult === false || auditSaveError) {
                throw auditSaveError || new Error('Resolve the pending audit save before deleting this audit.');
            }
            await apiRequest(`/audits/${record.id}`, { method: 'DELETE' });
            audits = audits.filter(audit => audit.id !== record.id);
            sharedSubmissions = sharedSubmissions.filter(audit => audit.id !== record.id);
            window.loadActiveAudit();
            await refreshAuditCollection();
        } catch (error) {
            showError(error, 'The audit could not be deleted.');
        }
    };

    window.selectHostelAudit = function () {
        selectedHostelName = document.getElementById('hostelName').value.trim();
        loadActiveAudit();
    };

    const originalLoadActiveAudit = window.loadActiveAudit;
    window.loadActiveAudit = function () {
        originalLoadActiveAudit();
        const record = getCurrentAudit(false);
        const deleteButton = document.getElementById('deleteAuditButton');
        if (deleteButton) deleteButton.hidden = !record || !record.id;
        document.getElementById('tariffRate').value = record && Number.isFinite(Number(record.tariffRate)) ? record.tariffRate : 12;
        document.getElementById('emissionFactor').value = record && Number.isFinite(Number(record.emissionFactor)) ? record.emissionFactor : 0.05;
        calculateAll();
    };

    const originalHandleAuditSettingChange = window.handleAuditSettingChange;
    window.handleAuditSettingChange = function () {
        const record = getCurrentAudit(false);
        if (record) {
            record.tariffRate = Number(document.getElementById('tariffRate').value);
            record.emissionFactor = Number(document.getElementById('emissionFactor').value);
        }
        originalHandleAuditSettingChange();
    };

    window.updateAuditReportDisplay = function () {
        const report = document.getElementById('aiReportContent');
        if (!report) return;
        const record = getCurrentAudit(false);
        report.textContent = record && record.report
            ? record.report
            : 'Select a facility and add equipment, then generate an audit report.';
        const gallery = document.getElementById('reportPhotoGallery');
        if (!gallery) return;
        gallery.innerHTML = '';
        (record && record.photos ? record.photos : []).forEach(photo => {
            const image = document.createElement('img');
            if (apiBase) image.crossOrigin = 'use-credentials';
            image.className = 'report-photo';
            image.src = photoUrl(photo);
            image.alt = photo.name || 'Audit photo';
            gallery.appendChild(image);
        });
        if (downloadButton) downloadButton.disabled = !(record && record.report);
    };

    const originalRenderAuditPhotos = window.renderAuditPhotos;
    window.renderAuditPhotos = function (photos) {
        originalRenderAuditPhotos(photos);
        document.querySelectorAll('#auditPhotoGallery img').forEach((image, index) => {
            const photo = photos[index];
            if (photo) {
                if (apiBase) image.crossOrigin = 'use-credentials';
                image.src = photoUrl(photo);
            }
        });
    };

    const originalRenderAdminReviewQueue = window.renderAdminReviewQueue;
    window.renderAdminReviewQueue = function () {
        const visible = sharedSubmissions;
        sharedSubmissions = visible.filter(item => item.status && item.status !== 'draft' && item.status !== 'discarded');
        originalRenderAdminReviewQueue();
        sharedSubmissions = visible;
        document.querySelectorAll('#adminReviewQueue .audit-photo-grid img').forEach((image, index) => {
            const photo = visible.flatMap(item => item.photos || [])[index];
            if (photo) {
                if (apiBase) image.crossOrigin = 'use-credentials';
                image.src = photoUrl(photo);
            }
        });
    };

    window.addEventListener('DOMContentLoaded', () => {
        document.querySelector('#forgotFormView input[type="password"]').setAttribute('minlength', '12');
        const passwordForm = document.querySelector('#forgotFormView form');
        const tokenField = document.createElement('input');
        tokenField.type = 'text';
        tokenField.id = 'forgotResetToken';
        tokenField.autocomplete = 'one-time-code';
        tokenField.placeholder = 'Reset token from email link (leave blank to request a link)';
        const tokenGroup = document.createElement('div');
        tokenGroup.className = 'form-group';
        tokenGroup.style.marginBottom = '0.8rem';
        tokenGroup.style.display = 'none';
        const tokenLabel = document.createElement('label');
        tokenLabel.htmlFor = tokenField.id;
        tokenLabel.textContent = 'Password reset token';
        tokenGroup.append(tokenLabel, tokenField);
        passwordForm.insertBefore(tokenGroup, passwordForm.querySelector('button'));
        const token = new URLSearchParams(location.search).get('resetToken');
        if (token) {
            tokenField.value = token;
            document.getElementById('forgotEmail').closest('.form-group').style.display = 'none';
            document.getElementById('forgotEmail').removeAttribute('required');
            document.getElementById('resetPasswordInstructions').textContent = 'Choose a new password for your account.';
            document.getElementById('resetPasswordGroup').style.display = 'block';
            document.getElementById('forgotNewPass').setAttribute('minlength', '12');
            document.getElementById('forgotNewPass').setAttribute('required', '');
            document.getElementById('resetPasswordSubmit').textContent = 'Update password';
            toggleAuthView('forgot');
        } else {
            document.getElementById('forgotNewPass').removeAttribute('required');
        }
        const registrationPassword = document.getElementById('regPass');
        if (registrationPassword) registrationPassword.setAttribute('minlength', '12');
        const reportPanel = document.querySelector('.ai-report-panel > div');
        downloadButton = document.createElement('button');
        downloadButton.type = 'button';
        downloadButton.className = 'btn-action';
        downloadButton.textContent = 'Download PDF';
        downloadButton.disabled = true;
        downloadButton.addEventListener('click', async () => {
            try {
                await saveAudits();
                const record = getCurrentAudit(false);
                if (!record || !record.id || !record.report) throw new Error('Generate and save the report before downloading its PDF.');
                const response = await fetch(`${apiBase}/api/audits/${record.id}/report.pdf`, { credentials: 'include' });
                if (!response.ok) {
                    let message = `PDF download failed (${response.status}).`;
                    try { message = (await response.json()).error || message; } catch (error) { console.error('Could not read PDF error response.', error); }
                    throw new Error(message);
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `EnerTrack-${record.reportReference || record.id}.pdf`;
                anchor.click();
                URL.revokeObjectURL(url);
            } catch (error) {
                showError(error, 'The audit PDF could not be downloaded.');
            }
        });
        reportPanel.appendChild(downloadButton);
        window.addEventListener('beforeunload', event => {
            if (pendingAuditSaves && currentUser) {
                event.preventDefault();
                event.returnValue = '';
            }
        });
    });
})();
