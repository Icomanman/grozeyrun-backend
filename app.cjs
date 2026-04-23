'use strict';

const env = require('dotenv');
env.config({ path: './.env' });

const express = require('express');
const services = require('./services.cjs');

// Maximum accepted request body size — rejects oversized sync payloads (R3 fix)
const MAX_PAYLOAD_SIZE = '1mb';

(function main() {
    const app = express();
    const PORT = process.env.PORT || 8080;
    const url = `http://localhost:${PORT}`;

    // Body parser with hard payload size cap applied globally
    app.use(express.json({ limit: MAX_PAYLOAD_SIZE }));
    app.use(express.urlencoded({ extended: true, limit: MAX_PAYLOAD_SIZE }));

    app.all('/', (_req, res) => res.status(301).redirect('/api'));
    app.use('/api', services());
    app.use(/.*/, (_req, res) => res.status(404).json({ success: false, message: 'Not found.' }));

    global.SERVER = app.listen(PORT, () => console.log(`> Server on ${url}`));
}());