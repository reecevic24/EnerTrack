'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const { requireAuth, requireAuditor } = require('./auth');
const { generateAuditReport } = require('../services/report');
const { buildAuditPdf } = require('../services/pdf');

const router = express.Router();
router.use(requireAuth);

function nullableNumber(minimum, maximum, integer = false) {
    const numberSchema = z.number().min(minimum).max(maximum);
    const stringSchema = z.string().trim().regex(/^\d+(?:\.\d+)?$/).transform(Number).pipe(numberSchema);
    const validated = integer ? numberSchema.int() : numberSchema;
    const validatedString = integer
        ? z.string().trim().regex(/^\d+$/).transform(Number).pipe(numberSchema.int())
        : stringSchema;
    return z.union([validated, validatedString, z.literal('')]);
}

const facilityInfoSchema = z.object({
    facilityLocation: z.string().max(300).optional().default(''),
    floorArea: nullableNumber(0, 1000000000).optional().default(''),
    authorName: z.string().max(160).optional().default(''),
    buildingType: z.string().max(120).optional().default(''),
    operatingHours: nullableNumber(0, 24).optional().default(''),
    occupants: nullableNumber(0, 1000000000, true).optional().default(''),
    energySources: z.string().max(500).optional().default(''),
    auditDate: z.string().max(10).refine(value =>
        value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    ).optional().default(''),
    savingsTarget: z.number().min(0).max(100).default(15),
    background: z.string().max(5000).optional().default('')
});
const equipmentSchema = z.array(z.object({
    id: z.union([z.string().max(100), z.number().safe()]).optional(),
    category: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    watts: z.number().positive().max(10000000),
    qty: z.number().int().positive().max(1000000),
    hours: z.number().positive().max(24)
})).max(500);
const historySchema = z.array(z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    kwh: z.number().nonnegative().max(1000000000),
    cost: z.number().nonnegative().max(100000000000)
})).max(240);
const photoSchema = z.array(z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(255),
    dataUrl: z.string().max(3_000_000).optional()
})).max(20);
const auditSchema = z.object({
    facilityId: z.string().min(1).max(120),
    hostelName: z.string().max(200).optional().default(''),
    facilityInfo: facilityInfoSchema,
    inventory: equipmentSchema,
    historicalData: historySchema,
    photos: photoSchema,
    findings: z.string().max(10000).optional(),
    recommendations: z.array(z.string().trim().min(1).max(10000)).max(100).optional(),
    tariffRate: z.number().nonnegative().max(100000).optional().default(12),
    emissionFactor: z.number().nonnegative().max(1000).optional().default(0.05),
    report: z.string().max(200000).optional().default(''),
    reportReference: z.string().max(100).optional().default('')
});
const uuidSchema = z.string().uuid();

function requireAdmin(req, res, next) {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' });
    next();
}

function parseNullableNumber(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function auditSummary(row) {
    return {
        id: row.id,
        key: row.facility_id === 'Hostels' ? `Hostels:${row.hostel_name.toLowerCase()}` : row.facility_id,
        facilityId: row.facility_id,
        hostelName: row.hostel_name,
        status: row.status,
        facilityInfo: {
            facilityLocation: row.location,
            floorArea: row.floor_area == null ? '' : String(row.floor_area),
            authorName: row.auditor_name,
            buildingType: row.building_type,
            operatingHours: row.operating_hours == null ? '' : String(row.operating_hours),
            occupants: row.occupants == null ? '' : String(row.occupants),
            energySources: row.energy_sources,
            auditDate: row.audit_date ? row.audit_date.toISOString().slice(0, 10) : '',
            savingsTarget: Number(row.savings_target),
            background: row.background
        },
        tariffRate: Number(row.tariff_rate),
        emissionFactor: Number(row.emission_factor),
        report: row.report_text || '',
        reportReference: row.report_reference || '',
        findings: row.findings || '',
        reportGeneratedAt: row.report_generated_at,
        submittedAt: row.submitted_at,
        reviewedAt: row.reviewed_at,
        reviewedBy: row.reviewer_name || '',
        auditorEmail: row.auditor_email,
        auditorName: row.auditor_name,
        version: row.version,
        updatedAt: row.updated_at
    };
}

async function getAudit(client, auditId, includePrivate = true) {
    const auditResult = await client.query(
        `SELECT a.*, f.display_name AS facility_name,
                owner.email AS auditor_email, owner.full_name AS auditor_name,
                reviewer.full_name AS reviewer_name
         FROM audits a
         JOIN facilities f ON f.id = a.facility_id
         JOIN users owner ON owner.id = a.auditor_id
         LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
         WHERE a.id = $1`,
        [auditId]
    );
    if (!auditResult.rowCount) return null;
    const summary = auditSummary(auditResult.rows[0]);
    const [equipment, history, photos, recommendations] = await Promise.all([
        client.query(
            `SELECT client_id, category, name, rated_watts, quantity, operating_hours
             FROM audit_equipment WHERE audit_id = $1 ORDER BY sort_order, created_at`,
            [auditId]
        ),
        client.query(
            `SELECT to_char(billing_month, 'YYYY-MM') AS month, consumption_kwh, bill_amount
             FROM audit_monthly_readings WHERE audit_id = $1 ORDER BY billing_month`,
            [auditId]
        ),
        client.query(
            `SELECT id, original_name, mime_type FROM audit_photos WHERE audit_id = $1 ORDER BY created_at`,
            [auditId]
        ),
        client.query(
            `SELECT id, category, recommendation, priority, timeline, estimated_monthly_savings_kwh
             FROM audit_recommendations WHERE audit_id = $1 ORDER BY created_at, id`,
            [auditId]
        )
    ]);
    summary.inventory = equipment.rows.map(item => ({
        id: item.client_id,
        category: item.category,
        name: item.name,
        watts: Number(item.rated_watts),
        qty: item.quantity,
        hours: Number(item.operating_hours),
        pf: 1
    }));
    summary.historicalData = history.rows.map(item => ({
        month: item.month,
        kwh: Number(item.consumption_kwh),
        cost: Number(item.bill_amount)
    }));
    summary.photos = photos.rows.map(photo => ({
        id: photo.id,
        name: photo.original_name,
        mimeType: photo.mime_type,
        url: `/api/audits/${auditId}/photos/${photo.id}`
    }));
    summary.recommendations = recommendations.rows.map(item => item.recommendation);
    if (includePrivate) {
        summary.ownerId = auditResult.rows[0].auditor_id;
        summary.comments = auditResult.rows[0].review_comments || '';
    }
    return summary;
}

async function saveAudit(client, userId, auditId, data, status = null) {
    const parsed = auditSchema.parse(data);
    if (parsed.facilityId === 'Hostels' && !parsed.hostelName.trim()) {
        const error = new Error('Enter the hostel name before saving this audit.');
        error.status = 400;
        throw error;
    }
    if (parsed.facilityId !== 'Hostels') parsed.hostelName = '';
    const facility = await client.query('SELECT id FROM facilities WHERE id = $1', [parsed.facilityId]);
    if (!facility.rowCount) {
        const error = new Error('Select one of the configured EnerTrack facilities.');
        error.status = 400;
        throw error;
    }
    const info = parsed.facilityInfo;
    const auditor = await client.query('SELECT full_name FROM users WHERE id = $1', [userId]);
    if (!auditor.rowCount) {
        const error = new Error('The auditor account for this audit no longer exists.');
        error.status = 404;
        throw error;
    }
    info.authorName = auditor.rows[0].full_name;
    const result = await client.query(
        `INSERT INTO audits (
            id, auditor_id, facility_id, hostel_name, status, location, floor_area,
            author_name, building_type, operating_hours, occupants, energy_sources,
            audit_date, savings_target, background, tariff_rate,
            emission_factor, report_reference, report_text, report_generated_at,
            submitted_at, version, updated_at, findings
         ) VALUES (
            $1, $2, $3, $4, COALESCE($5, 'draft'), $6, $7, $8, $9, $10, $11, $12,
            NULLIF($13, '')::date, $14, $15, $16, $17, NULLIF($18, ''),
            $19, CASE WHEN $19 = '' THEN NULL ELSE now() END, NULL, 1, now(), COALESCE($20, '')
         )
         ON CONFLICT (id) DO UPDATE SET
            facility_id = EXCLUDED.facility_id,
            hostel_name = EXCLUDED.hostel_name,
            status = COALESCE($5, audits.status),
            location = EXCLUDED.location,
            floor_area = EXCLUDED.floor_area,
            author_name = EXCLUDED.author_name,
            building_type = EXCLUDED.building_type,
            operating_hours = EXCLUDED.operating_hours,
            occupants = EXCLUDED.occupants,
            energy_sources = EXCLUDED.energy_sources,
            audit_date = EXCLUDED.audit_date,
            savings_target = EXCLUDED.savings_target,
            background = EXCLUDED.background,
            tariff_rate = EXCLUDED.tariff_rate,
            emission_factor = EXCLUDED.emission_factor,
            report_reference = EXCLUDED.report_reference,
            report_text = EXCLUDED.report_text,
            report_generated_at = CASE WHEN EXCLUDED.report_text = '' THEN NULL ELSE now() END,
            findings = CASE WHEN $20::text IS NULL THEN audits.findings ELSE EXCLUDED.findings END,
            submitted_at = CASE WHEN $5 = 'pending' THEN COALESCE(audits.submitted_at, now()) ELSE audits.submitted_at END,
            version = audits.version + 1,
            updated_at = now()
         WHERE audits.auditor_id = $2
         RETURNING id`,
        [
            auditId, userId, parsed.facilityId, parsed.hostelName.trim(), status,
            info.facilityLocation, parseNullableNumber(info.floorArea), info.authorName,
            info.buildingType, parseNullableNumber(info.operatingHours),
            parseNullableNumber(info.occupants), info.energySources, info.auditDate,
            info.savingsTarget, info.background, parsed.tariffRate, parsed.emissionFactor,
            parsed.reportReference, parsed.report, parsed.findings ?? null
        ]
    );
    if (!result.rowCount) {
        const error = new Error('This audit does not exist or is not owned by the current account.');
        error.status = 404;
        throw error;
    }

    await client.query('DELETE FROM audit_equipment WHERE audit_id = $1', [auditId]);
    for (const [index, item] of parsed.inventory.entries()) {
        await client.query(
            `INSERT INTO audit_equipment (audit_id, client_id, category, name, rated_watts, quantity, operating_hours, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [auditId, String(item.id ?? crypto.randomUUID()), item.category.trim(), item.name.trim(), item.watts, item.qty, item.hours, index]
        );
    }

    await client.query('DELETE FROM audit_monthly_readings WHERE audit_id = $1', [auditId]);
    for (const entry of parsed.historicalData) {
        await client.query(
            `INSERT INTO audit_monthly_readings (audit_id, billing_month, consumption_kwh, bill_amount)
             VALUES ($1, ($2 || '-01')::date, $3, $4)`,
            [auditId, entry.month, entry.kwh, entry.cost]
        );
    }

    if (parsed.recommendations !== undefined) {
        await client.query('DELETE FROM audit_recommendations WHERE audit_id = $1', [auditId]);
        for (const recommendation of parsed.recommendations) {
            await client.query(
                `INSERT INTO audit_recommendations (audit_id, category, recommendation)
                 VALUES ($1, 'Auditor-entered', $2)`,
                [auditId, recommendation]
            );
        }
    }

    const existingPhotos = await client.query('SELECT id FROM audit_photos WHERE audit_id = $1', [auditId]);
    const keepIds = parsed.photos.filter(photo => photo.id).map(photo => photo.id);
    const removeIds = existingPhotos.rows.map(photo => photo.id).filter(id => !keepIds.includes(id));
    if (removeIds.length) {
        await client.query('DELETE FROM audit_photos WHERE audit_id = $1 AND id = ANY($2::uuid[])', [auditId, removeIds]);
    }
    for (const photo of parsed.photos) {
        if (!photo.dataUrl) continue;
        const match = photo.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match) {
            const error = new Error(`Photo "${photo.name}" must be a JPEG, PNG, or WebP image.`);
            error.status = 400;
            throw error;
        }
        const image = Buffer.from(match[2], 'base64');
        if (!image.length || image.length > 2 * 1024 * 1024) {
            const error = new Error(`Photo "${photo.name}" exceeds the 2 MB upload limit.`);
            error.status = 413;
            throw error;
        }
        await client.query(
            `INSERT INTO audit_photos (audit_id, uploaded_by, original_name, mime_type, size_bytes, image_data)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [auditId, userId, photo.name, match[1], image.length, image]
        );
    }
    return getAudit(client, auditId);
}

function visibleAuditQuery(user, auditId) {
    if (user.role === 'admin') {
        return pool.query('SELECT id FROM audits WHERE id = $1', [auditId]);
    }
    return pool.query('SELECT id FROM audits WHERE id = $1 AND auditor_id = $2', [auditId, user.id]);
}

router.get('/facilities', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT id, display_name AS name, sort_order FROM facilities ORDER BY sort_order');
        res.json({ facilities: result.rows });
    } catch (error) {
        next(error);
    }
});

router.get('/audits', async (req, res, next) => {
    try {
        const result = req.session.user.role === 'admin'
            ? await pool.query('SELECT id FROM audits ORDER BY updated_at DESC')
            : await pool.query('SELECT id FROM audits WHERE auditor_id = $1 ORDER BY updated_at DESC', [req.session.user.id]);
        const audits = [];
        for (const row of result.rows) audits.push(await getAudit(pool, row.id));
        res.json({ audits });
    } catch (error) {
        next(error);
    }
});

router.post('/audits', requireAuditor, async (req, res, next) => {
    const createSchema = z.object({
        facilityId: z.string().min(1).max(120),
        hostelName: z.string().max(200).optional().default('')
    });
    try {
        const input = createSchema.parse(req.body);
        if (input.facilityId === 'Hostels' && !input.hostelName.trim()) {
            return res.status(400).json({ error: 'Enter the hostel name before creating its audit.' });
        }
        const auditId = crypto.randomUUID();
        const result = await pool.query(
            `INSERT INTO audits (id, auditor_id, facility_id, hostel_name)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [auditId, req.session.user.id, input.facilityId, input.facilityId === 'Hostels' ? input.hostelName.trim() : '']
        );
        res.status(201).json({ audit: await getAudit(pool, result.rows[0].id) });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'An audit already exists for this facility and account.' });
        if (error.code === '23503') return res.status(400).json({ error: 'Select one of the configured EnerTrack facilities.' });
        next(error);
    }
});

router.get('/audits/:auditId', async (req, res, next) => {
    try {
        const auditId = uuidSchema.parse(req.params.auditId);
        const visible = await visibleAuditQuery(req.session.user, auditId);
        if (!visible.rowCount) return res.status(404).json({ error: 'Audit not found.' });
        res.json({ audit: await getAudit(pool, auditId) });
    } catch (error) {
        next(error);
    }
});

router.put('/audits/:auditId', requireAuditor, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const auditId = uuidSchema.parse(req.params.auditId);
        await client.query('BEGIN');
        const current = await client.query(
            'SELECT status FROM audits WHERE id = $1 AND auditor_id = $2 FOR UPDATE',
            [auditId, req.session.user.id]
        );
        if (!current.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Audit not found.' });
        }
        if (current.rows[0].status === 'approved') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Facility already approved' });
        }
        const audit = await saveAudit(client, req.session.user.id, auditId, req.body);
        await client.query('COMMIT');
        res.json({ audit });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return res.status(409).json({ error: 'An audit for this facility already exists in this account.' });
        next(error);
    } finally {
        client.release();
    }
});

router.delete('/audits/:auditId', requireAuditor, async (req, res, next) => {
    try {
        const auditId = uuidSchema.parse(req.params.auditId);
        const result = await pool.query(
            "DELETE FROM audits WHERE id = $1 AND auditor_id = $2 AND status <> 'approved' RETURNING id",
            [auditId, req.session.user.id]
        );
        if (!result.rowCount) {
            const existing = await pool.query(
                'SELECT status FROM audits WHERE id = $1 AND auditor_id = $2',
                [auditId, req.session.user.id]
            );
            if (existing.rowCount && existing.rows[0].status === 'approved') {
                return res.status(409).json({ error: 'Facility already approved' });
            }
            return res.status(404).json({ error: 'Audit not found.' });
        }
        res.sendStatus(204);
    } catch (error) {
        next(error);
    }
});

router.post('/audits/:auditId/submit', requireAuditor, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const auditId = uuidSchema.parse(req.params.auditId);
        await client.query('BEGIN');
        const audit = await client.query(
            'SELECT status FROM audits WHERE id = $1 AND auditor_id = $2 FOR UPDATE',
            [auditId, req.session.user.id]
        );
        if (!audit.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Audit not found.' });
        }
        if (audit.rows[0].status === 'approved') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Facility already approved' });
        }
        const equipment = await client.query('SELECT count(*)::int AS count FROM audit_equipment WHERE audit_id = $1', [auditId]);
        if (!equipment.rows[0].count) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Add at least one equipment item before submitting the audit.' });
        }
        await client.query(
            `UPDATE audits SET status = 'pending', submitted_at = now(), reviewed_at = NULL, reviewed_by = NULL,
             report_text = '', report_generated_at = NULL, version = version + 1, updated_at = now()
             WHERE id = $1`,
            [auditId]
        );
        await client.query(
            `INSERT INTO audit_reviews (audit_id, reviewer_id, action, comments)
             VALUES ($1, $2, 'resubmitted', '')`,
            [auditId, req.session.user.id]
        );
        await client.query('COMMIT');
        res.json({ audit: await getAudit(pool, auditId) });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.get('/audits/:auditId/photos/:photoId', async (req, res, next) => {
    try {
        const auditId = uuidSchema.parse(req.params.auditId);
        const photoId = uuidSchema.parse(req.params.photoId);
        const visible = await visibleAuditQuery(req.session.user, auditId);
        if (!visible.rowCount) return res.status(404).json({ error: 'Audit photo not found.' });
        const photo = await pool.query(
            'SELECT original_name, mime_type, image_data FROM audit_photos WHERE id = $1 AND audit_id = $2',
            [photoId, auditId]
        );
        if (!photo.rowCount) return res.status(404).json({ error: 'Audit photo not found.' });
        res.setHeader('Content-Type', photo.rows[0].mime_type);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(photo.rows[0].original_name)}`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(photo.rows[0].image_data);
    } catch (error) {
        next(error);
    }
});

router.get('/dashboard', async (req, res, next) => {
    try {
        const [summary, ownerAudits] = await Promise.all([
            pool.query(
            `SELECT a.facility_id AS "facilityId",
                    CASE WHEN a.facility_id = 'Hostels' THEN a.facility_id || ' - ' || a.hostel_name ELSE a.facility_id END AS label,
                    count(DISTINCT e.id)::int AS "equipmentItems",
                    COALESCE(sum(e.rated_watts * e.quantity * e.operating_hours / 1000 * 30), 0)::float AS "monthlyKwh",
                    COALESCE(sum(e.rated_watts * e.quantity * e.operating_hours / 1000 * 30 * a.tariff_rate), 0)::float AS "monthlyCost",
                    COALESCE(sum(e.rated_watts * e.quantity * e.operating_hours / 1000 * 30 * a.emission_factor), 0)::float AS "monthlyCarbon"
             FROM audits a LEFT JOIN audit_equipment e ON e.audit_id = a.id
             WHERE a.status = 'approved'
             GROUP BY a.id, a.facility_id, a.hostel_name ORDER BY label`,
            []
            ),
            pool.query(
                `SELECT a.id,
                        CASE WHEN a.facility_id = 'Hostels' THEN a.facility_id || ' - ' || a.hostel_name ELSE a.facility_id END AS label,
                        a.status,
                        a.updated_at AS "updatedAt",
                        (SELECT count(*)::int FROM audit_equipment e WHERE e.audit_id = a.id) AS "equipmentItems",
                        (SELECT COALESCE(sum(r.consumption_kwh), 0)::float FROM audit_monthly_readings r WHERE r.audit_id = a.id) AS "recordedKwh",
                        (SELECT COALESCE(sum(r.bill_amount), 0)::float FROM audit_monthly_readings r WHERE r.audit_id = a.id) AS "recordedCost",
                        EXISTS (
                            SELECT 1 FROM audit_reports report
                            WHERE report.audit_id = a.id AND report.audit_version = a.version AND report.pdf_data IS NOT NULL
                        ) AS "reportGenerated"
                 FROM audits a
                 WHERE a.auditor_id = $1
                 ORDER BY a.updated_at DESC`,
                [req.session.user.id]
            )
        ]);
        const totals = summary.rows.reduce((sum, item) => ({
            monthlyKwh: sum.monthlyKwh + item.monthlyKwh,
            monthlyCost: sum.monthlyCost + item.monthlyCost,
            monthlyCarbon: sum.monthlyCarbon + item.monthlyCarbon,
            facilitiesAudited: sum.facilitiesAudited + (item.equipmentItems > 0 ? 1 : 0)
        }), { monthlyKwh: 0, monthlyCost: 0, monthlyCarbon: 0, facilitiesAudited: 0 });
        const userTotals = ownerAudits.rows.reduce((sum, audit) => ({
            auditCount: sum.auditCount + 1,
            recordedKwh: sum.recordedKwh + audit.recordedKwh,
            recordedCost: sum.recordedCost + audit.recordedCost
        }), { auditCount: 0, recordedKwh: 0, recordedCost: 0 });
        res.json({
            totals,
            facilities: summary.rows,
            personal: {
                totals: userTotals,
                recentAudits: ownerAudits.rows.slice(0, 5),
                reports: ownerAudits.rows
            }
        });
    } catch (error) {
        next(error);
    }
});

router.get('/admin/users', requireAdmin, async (req, res, next) => {
    try {
        const result = await pool.query(
            'SELECT id, full_name AS name, email, registration_number AS "regNo", role, is_active AS "isActive", created_at AS "createdAt" FROM users ORDER BY full_name'
        );
        res.json({ users: result.rows });
    } catch (error) {
        next(error);
    }
});

router.patch('/admin/users/:userId/role', requireAdmin, async (req, res, next) => {
    try {
        const userId = uuidSchema.parse(req.params.userId);
        const { role } = z.object({ role: z.enum(['admin', 'auditor']) }).parse(req.body);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const current = await client.query('SELECT role FROM users WHERE id = $1 AND is_active = true FOR UPDATE', [userId]);
            if (!current.rowCount) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Account not found.' });
            }
            if (current.rows[0].role === 'admin' && role === 'auditor') {
                const admins = await client.query("SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND is_active = true");
                if (admins.rows[0].count <= 1) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ error: 'At least one administrator account must remain.' });
                }
            }
            const updated = await client.query(
                'UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING id, full_name AS name, email, registration_number AS "regNo", role',
                [role, userId]
            );
            await client.query('COMMIT');
            res.json({ user: updated.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        next(error);
    }
});

router.get('/admin/audits', requireAdmin, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT a.id FROM audits a
             WHERE ($1::text IS NULL OR a.status = $1)
             ORDER BY a.submitted_at DESC NULLS LAST, a.updated_at DESC`,
            [req.query.status || null]
        );
        const audits = [];
        for (const row of result.rows) audits.push(await getAudit(pool, row.id));
        res.json({ audits });
    } catch (error) {
        next(error);
    }
});

router.delete('/admin/audits/:auditId', requireAdmin, async (req, res, next) => {
    try {
        const auditId = uuidSchema.parse(req.params.auditId);
        const result = await pool.query('DELETE FROM audits WHERE id = $1 RETURNING id', [auditId]);
        if (!result.rowCount) return res.status(404).json({ error: 'Audit not found.' });
        res.sendStatus(204);
    } catch (error) {
        next(error);
    }
});

router.patch('/admin/audits/:auditId/review', requireAdmin, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const auditId = uuidSchema.parse(req.params.auditId);
        const input = z.object({
            action: z.literal('approve'),
            comments: z.string().max(3000).optional().default('')
        }).parse(req.body);
        await client.query('BEGIN');
        const current = await client.query('SELECT id, status FROM audits WHERE id = $1 FOR UPDATE', [auditId]);
        if (!current.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Audit not found.' });
        }
        if (current.rows[0].status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Only pending audits can be approved.' });
        }
        const equipment = await client.query('SELECT count(*)::int AS count FROM audit_equipment WHERE audit_id = $1', [auditId]);
        if (!equipment.rows[0].count) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'An audit must include equipment before it can be approved.' });
        }
        const snapshot = await getAudit(client, auditId);
        await client.query(
            `UPDATE audits SET status = 'approved', reviewed_at = now(), reviewed_by = $2, updated_at = now()
             WHERE id = $1`,
            [auditId, req.session.user.id]
        );
        await client.query(
            'INSERT INTO audit_reviews (audit_id, reviewer_id, action, comments, snapshot) VALUES ($1, $2, $3, $4, $5)',
            [auditId, req.session.user.id, 'approved', input.comments, snapshot]
        );
        await client.query('COMMIT');
        res.json({ audit: await getAudit(pool, auditId) });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.get('/recommendations', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT recommendations FROM auditor_recommendation_sets WHERE user_id = $1', [req.session.user.id]);
        res.json({ recommendations: result.rows[0] ? result.rows[0].recommendations : [] });
    } catch (error) {
        next(error);
    }
});

router.put('/recommendations', requireAuditor, async (req, res, next) => {
    try {
        const recommendations = z.array(z.object({
            id: z.string().min(1).max(100),
            loadType: z.string().trim().min(1).max(100),
            text: z.string().max(10000)
        })).max(50).parse(req.body.recommendations);
        await pool.query(
            `INSERT INTO auditor_recommendation_sets (user_id, recommendations, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (user_id) DO UPDATE SET recommendations = EXCLUDED.recommendations, updated_at = now()`,
            [req.session.user.id, JSON.stringify(recommendations)]
        );
        res.json({ recommendations });
    } catch (error) {
        next(error);
    }
});

router.get('/audits/:auditId/report.pdf', async (req, res, next) => {
    try {
        const auditId = uuidSchema.parse(req.params.auditId);
        const visible = await visibleAuditQuery(req.session.user, auditId);
        if (!visible.rowCount) return res.status(404).json({ error: 'Audit report not found.' });
        const audit = await getAudit(pool, auditId);
        const reportText = generateAuditReport(audit);
        const photos = await pool.query(
            'SELECT original_name, mime_type, image_data FROM audit_photos WHERE audit_id = $1 ORDER BY created_at',
            [auditId]
        );
        const pdf = await buildAuditPdf(audit, reportText, photos.rows);
        await pool.query(
            `INSERT INTO audit_reports (audit_id, generated_by, audit_version, report_text, pdf_data)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (audit_id, audit_version) DO UPDATE SET
                generated_by = EXCLUDED.generated_by,
                report_text = EXCLUDED.report_text,
                pdf_data = EXCLUDED.pdf_data,
                created_at = now()`,
            [auditId, req.session.user.id, audit.version, reportText, pdf]
        );
        await pool.query('UPDATE audits SET report_text = $1, report_generated_at = now() WHERE id = $2', [reportText, auditId]);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="EnerTrack-${encodeURIComponent(audit.reportReference || auditId)}.pdf"`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
