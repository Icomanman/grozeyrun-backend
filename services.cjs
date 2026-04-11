
const db = require('./db');
const express = require('express');
// locals
const validations = require('./validations.cjs');

const signIn = async (req, res) => {
    await res.status(200).json({ message: 'Login successful!' });
};
const signOut = async (req, res) => {
    await res.status(200).json({ message: 'Sign out successful!' });
}
const signUp = async (req, res) => {
    await res.status(201).json({ message: 'Registration successful!' });
};
const syncUserData = (req, res) => {
    res.status(200).json({ message: 'User data synchronized!' });
}

function serviceHandler() {
    const router = express.Router();
    router.use(express.urlencoded({ extended: true }));
    router.use(express.json());

    router.get('/signout', signOut);

    router.post('/login', signIn);
    router.post('/register', signUp);

    router.post('/sync', syncUserData);

    router.use(/.*/, (req, res) => { res.status(400).end('Bad request') });
    return router;
}

module.exports = serviceHandler;