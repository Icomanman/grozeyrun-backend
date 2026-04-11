
const express = require('express');
const env = require('dotenv');
const services = require('./services.cjs');


(function main() {
    env.config({ path: './.env' });
    const app = express();
    const PORT = 8080 || process.env.PORT;
    const url = `http://localhost:${PORT}`;

    global.HOST = 'localhost:' + PORT;
    global.SERVER = app.listen(PORT, () => {
        console.log(`> Server on ${url}`);
    });

    app.use(express.json());

    app.all('/', (req, res) => {
        res.status(301).redirect('/api');
    });
    app.use(/.api/, services()); // services would handle the /api.
    app.use(/.*/, (req, res) => { res.status(400).end('Bad server request.') });
}());