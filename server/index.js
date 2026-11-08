'use strict';

require('dotenv').config();
const app = require('./app');
const pool = require('./db/pool');

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
    console.log(`EnerTrack is listening on http://localhost:${port}`);
});

async function shutdown(signal) {
    console.log(`Received ${signal}; shutting down.`);
    server.close(async error => {
        if (error) console.error('HTTP server shutdown failed.', error);
        await pool.end();
        process.exit(error ? 1 : 0);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
