'use strict';

const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { z } = require('zod');
const pool = require('../db/pool');

const router = express.Router();
const registerSchema = z.object({
    name: z.string().trim().min(1).max(160),
    regNo: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
    password: z.string().min(12).max(128)
});
const credentialsSchema = z.object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(128)
});
const publicUser = row => ({
    id: row.id,
    name: row.full_name,
    email: row.email,
    regNo: row.registration_number,
    role: row.role
});

function requireAuth(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Please log in to continue.' });
    pool.query(
        'SELECT id, full_name, email, registration_number, role FROM users WHERE id = $1 AND is_active = true',
        [req.session.user.id]
    ).then(result => {
        if (!result.rowCount) {
            return req.session.destroy(() => res.status(401).json({ error: 'This account is no longer active.' }));
        }
        req.session.user = publicUser(result.rows[0]);
        next();
    }).catch(next);
}

router.get('/me', (req, res, next) => {
    if (!req.session.user) return res.json({ user: null });
    requireAuth(req, res, () => res.json({ user: req.session.user }));
});

router.get('/setup-status', async (req, res, next) => {
    try {
        const result = await pool.query("SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND is_active = true) AS admin_exists");
        res.json({ adminExists: result.rows[0].admin_exists });
    } catch (error) {
        next(error);
    }
});

router.post('/register', async (req, res, next) => {
    try {
        const input = registerSchema.parse(req.body);
        const passwordHash = await bcrypt.hash(input.password, 12);
        const result = await pool.query(
            `INSERT INTO users (full_name, registration_number, email, password_hash)
             VALUES ($1, $2, $3, $4)
             RETURNING id, full_name, email, registration_number, role`,
            [input.name, input.regNo, input.email, passwordHash]
        );
        const user = publicUser(result.rows[0]);
        req.session.regenerate(error => {
            if (error) return next(error);
            req.session.user = user;
            req.session.save(saveError => {
                if (saveError) return next(saveError);
                res.status(201).json({ user });
            });
        });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'That email or registration number is already registered.' });
        next(error);
    }
});

router.post('/login', async (req, res, next) => {
    try {
        const input = credentialsSchema.parse(req.body);
        const identifier = input.identifier.toLowerCase();
        const result = await pool.query(
            `SELECT id, full_name, email, registration_number, role, password_hash
             FROM users
             WHERE is_active = true AND (email = $1 OR registration_number = $2)
             LIMIT 1`,
            [identifier, input.identifier]
        );
        const account = result.rows[0];
        if (!account || !(await bcrypt.compare(input.password, account.password_hash))) {
            return res.status(401).json({ error: 'Invalid credentials. Please verify your login details.' });
        }
        const user = publicUser(account);
        req.session.regenerate(error => {
            if (error) return next(error);
            req.session.user = user;
            req.session.save(saveError => {
                if (saveError) return next(saveError);
                res.json({ user });
            });
        });
    } catch (error) {
        next(error);
    }
});

router.post('/logout', requireAuth, (req, res, next) => {
    req.session.destroy(error => {
        if (error) return next(error);
        res.clearCookie('enertrack.sid', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.SESSION_SAME_SITE || 'lax'
        });
        res.sendStatus(204);
    });
});

router.post('/claim-admin', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [80421001]);
        const count = await client.query("SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND is_active = true");
        if (count.rows[0].count > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'An administrator account has already been set up.' });
        }
        const update = await client.query(
            "UPDATE users SET role = 'admin', updated_at = now() WHERE id = $1 AND is_active = true RETURNING id, full_name, email, registration_number, role",
            [req.session.user.id]
        );
        if (!update.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'The current account is no longer active.' });
        }
        await client.query('COMMIT');
        req.session.user = publicUser(update.rows[0]);
        res.json({ user: req.session.user });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.post('/password-reset/request', async (req, res, next) => {
    try {
        const email = z.string().trim().email().max(254).parse(req.body.email).toLowerCase();
        const smtpHost = process.env.SMTP_HOST;
        const smtpUser = process.env.SMTP_USER;
        const smtpPassword = process.env.SMTP_PASSWORD;
        if (!smtpHost || !smtpUser || !smtpPassword) {
            return res.status(503).json({ error: 'Password reset email is not configured. Contact an EnerTrack administrator.' });
        }
        const account = await pool.query(
            'SELECT id, email FROM users WHERE email = $1 AND is_active = true',
            [email]
        );
        if (account.rowCount) {
            const token = crypto.randomBytes(32).toString('base64url');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            await pool.query(
                'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 minutes\')',
                [account.rows[0].id, tokenHash]
            );
            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port: Number(process.env.SMTP_PORT || 587),
                secure: process.env.SMTP_SECURE === 'true',
                auth: { user: smtpUser, pass: smtpPassword }
            });
            const resetUrl = new URL('/?resetToken=' + encodeURIComponent(token), process.env.PUBLIC_APP_URL || 'http://localhost:3000');
            await transporter.sendMail({
                from: process.env.SMTP_FROM || smtpUser,
                to: account.rows[0].email,
                subject: 'Reset your EnerTrack password',
                text: `Use this link within 30 minutes to reset your EnerTrack password: ${resetUrl}`
            });
        }
        res.json({ message: 'If an active account uses that email, a password reset link has been sent.' });
    } catch (error) {
        next(error);
    }
});

router.post('/password-reset/complete', async (req, res, next) => {
    const schema = z.object({
        token: z.string().min(32).max(128),
        password: z.string().min(12).max(128)
    });
    const client = await pool.connect();
    try {
        const input = schema.parse(req.body);
        const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');
        const passwordHash = await bcrypt.hash(input.password, 12);
        await client.query('BEGIN');
        const tokenResult = await client.query(
            `SELECT id, user_id FROM password_reset_tokens
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
             FOR UPDATE`,
            [tokenHash]
        );
        if (!tokenResult.rowCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'This password reset link is invalid or expired.' });
        }
        const reset = tokenResult.rows[0];
        await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, reset.user_id]);
        await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [reset.user_id]);
        await client.query('COMMIT');
        res.json({ message: 'Password updated. Please log in.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

module.exports = { router, requireAuth, publicUser };
