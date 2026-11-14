function saveAudits() {
    if (!currentUser || isAdministrator()) return;
    clearTimeout(auditSaveTimer);
    auditSaveTimer = setTimeout(() => putAudits(0), 300);
}

function auditHasContent(record) {
    const facilityDetails = Object.entries(record.facilityInfo || {}).some(([key, value]) =>
        key !== 'auditDate' && value !== '' && value !== null
    );
    const settings = record.energySettings || createDefaultEnergySettings();
    const hasCustomSettings = Number(settings.tariffRate) !== DEFAULT_TARIFF_RATE ||
        Number(settings.emissionFactor) !== DEFAULT_EMISSION_FACTOR;
    return !!(
        record.inventory.length ||
        record.historicalData.length ||
        record.photos.length ||
        record.report ||
        record.findings ||
        (Array.isArray(record.recommendations) && record.recommendations.length) ||
        hasCustomSettings ||
        facilityDetails
    );
}

function toAuditPayload(record) {
    const settings = record.energySettings || createDefaultEnergySettings();
    return {
        facilityId: record.facilityId,
        hostelName: record.hostelName || '',
        facilityInfo: { ...createEmptyFacilityInfo(), ...(record.facilityInfo || {}) },
        inventory: (record.inventory || []).map(item => ({
            id: String(item.id ?? ''),
            category: item.category,
            name: item.name,
            watts: Number(item.watts),
            qty: Number(item.qty),
            hours: Number(item.hours)
        })),
        historicalData: record.historicalData || [],
        photos: (record.photos || []).map(photo => ({
            ...(photo.id ? { id: photo.id } : {}),
            name: photo.name || 'Audit photo',
            ...(typeof photo.dataUrl === 'string' && photo.dataUrl.startsWith('data:')
                ? { dataUrl: photo.dataUrl }
                : {})
        })),
        findings: record.findings || '',
        recommendations: record.recommendations || [],
        tariffRate: Number(settings.tariffRate) || DEFAULT_TARIFF_RATE,
        emissionFactor: Number.isFinite(Number(settings.emissionFactor))
            ? Number(settings.emissionFactor)
            : DEFAULT_EMISSION_FACTOR,
        report: record.report || '',
        reportReference: record.reportReference || ''
    };
}

async function persistAuditRecord(record, adminAction) {
    if (!record.id) {
        const created = await apiRequest('/api/audits', {
            method: 'POST',
            body: JSON.stringify({
                facilityId: record.facilityId,
                hostelName: record.hostelName || ''
            })
        });
        record.id = created.audit.id;
    }

    const result = adminAction
        ? await apiRequest(`/api/admin/audits/${encodeURIComponent(record.id)}/review`, {
            method: 'PATCH',
            body: JSON.stringify({ action: adminAction, audit: toAuditPayload(record) })
        })
        : await apiRequest(`/api/audits/${encodeURIComponent(record.id)}`, {
            method: 'PUT',
            body: JSON.stringify(toAuditPayload(record))
        });
    Object.assign(record, result.audit);
    record.key = result.audit.key;
    record.energySettings = {
        tariffRate: result.audit.tariffRate,
        emissionFactor: result.audit.emissionFactor
    };
    record.reportVersion = result.audit.report ? AUDIT_REPORT_VERSION : 0;
    record.photos = (result.audit.photos || []).map(photo => ({
        ...photo,
        dataUrl: photo.url ? `${API_BASE}${photo.url}` : photo.dataUrl
    }));
    return result.audit;
}

async function putAudits(attempt) {
    if (!currentUser) return;
    try {
        for (const record of audits) {
            if (record.status === 'approved') continue;
            if (!record.id && !auditHasContent(record)) continue;
            try {
                await persistAuditRecord(record);
            } catch (error) {
                if (error.status === 409 && error.message === 'Facility already approved') {
                    record.status = 'approved';
                    alert(error.message);
                    continue;
                }
                throw error;
            }
        }
        await loadPersonalDashboard();
    } catch (error) {
        if (attempt < 1) {
            setTimeout(() => putAudits(attempt + 1), 1500);
            return;
        }
        reportApiError(error);
    }
}
