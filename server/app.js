'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { rateLimit } = require('express-rate-limit');
const pool = require('./db/pool');
const authRoutes = require('./routes/auth');
const auditRoutes = require('./routes/audits');

const PgSession = connectPgSimple(session);
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters.');
}

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = new Set(
    (process.env.FRONTEND_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
);

app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && (allowedOrigins.has(origin) || origin === `${req.protocol}://${req.get('host')}`)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (origin && !allowedOrigins.has(origin) && origin !== `${req.protocol}://${req.get('host')}`) {
        return res.status(403).json({ error: 'This website origin is not allowed to use the EnerTrack API.' });
    }
    next();
});

app.use(express.json({ limit: process.env.MAX_JSON_BODY || '16mb' }));
app.use(session({
    store: new PgSession({
        pool,
        tableName: 'user_sessions',
        createTableIfMissing: true,
        pruneSessionInterval: 15 * 60
    }),
    name: 'enertrack.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: process.env.SESSION_SAME_SITE || 'lax',
        maxAge: 8 * 60 * 60 * 1000
    }
}));

app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false
}));

app.get('/api/health', async (req, res, next) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
        next(error);
    }
});

app.use('/api/auth', authRoutes.router);
app.use('/api', auditRoutes);

const frontendPath = path.resolve(__dirname, '..', 'index.html');
if (fs.existsSync(frontendPath)) {
    app.get(['/', '/index.html'], (req, res) => res.sendFile(frontendPath));
    app.get('/client.js', (req, res) => res.sendFile(path.resolve(__dirname, '..', 'client.js')));
    app.get('/api-config.js', (req, res) => res.sendFile(path.resolve(__dirname, '..', 'api-config.js')));
    app.get('/moi-university-campus.jpeg', (req, res) =>
        res.sendFile(path.resolve(__dirname, '..', 'moi-university-campus.jpeg'))
    );
}

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && error.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request is too large.' });
    }
    if (error && error.code === '23505') {
        return res.status(409).json({ error: 'A record with these details already exists.' });
    }
    if (error && error.name === 'ZodError') {
        return res.status(400).json({
            error: 'The submitted data is invalid.',
            details: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message }))
        });
    }
    console.error('Unhandled API error.', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
});

module.exports = app;
