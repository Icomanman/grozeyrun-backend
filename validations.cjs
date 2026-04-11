const { check, body } = require('express-validator');

/**
 * A middleware validation function
 * @param {String} endpoint route where the request comes in
 */
module.exports = function validations(endpoint = 'login') {
    const auth = [];
    const code_confirmation = [
        check('email').trim().isEmail().withMessage('Invalid email address'),
        check('password').trim().isLength({ min: 8 }).escape().withMessage('Password should be at least 8 characters'),
        check('pin_code').trim().escape().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code should be exactly 6 characters'),
    ];
    const confirm_password = [
        check('email').trim().isEmail().withMessage('Invalid email address'),
        check('new_password').trim().isLength({ min: 8 }).escape().withMessage('Password should be at least 8 characters'),
        check('pin_code').trim().escape().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code should be exactly 6 characters')
    ];
    const forgot_password = [
        check('email').trim().isEmail().withMessage('Invalid email address')
    ];
    const login = [
        check('email').trim().isEmail().withMessage('Invalid email address'),
        check('password').trim().isLength({ min: 8 }).escape().withMessage('Password should be at least 8 characters'),
    ];
    const refresh_token = [
        body('refresh_token').trim().isLength({ min: 254 }).withMessage('Invalid refresh token length')
    ];
    const register = [
        check('email').trim().isEmail().withMessage('Invalid email address'),
        check('given_name').trim().escape().isLength({ min: 2 }).isAlpha().withMessage('Invalid first name'),
        check('family_name').trim().escape().isLength({ min: 2 }).isAlpha().withMessage('Invalid last name'),
        check('phone_number').trim().escape().isLength({ min: 12 }).isNumeric().withMessage('Should be +15435671234'),
        check('password').trim().isLength({ min: 8 }).escape().withMessage('Password should be at least 8 characters'),
        check('user_type').trim().isLength({ min: 4 }).escape().withMessage('Invalid user type'),
    ];
    const resend_code = [
        check('email').trim().isEmail().withMessage('Invalid email address'),
        check('password').trim().isLength({ min: 8 }).escape().withMessage('Password should be at least 8 characters'),
    ];
    const reset_password = [
        check('email').trim().isEmail().withMessage('Invalid email address'),
        check('old_password').trim().isLength({ min: 8 }).escape().withMessage('Old password should be at least 8 characters'),
        check('new_password').trim().isLength({ min: 8 }).escape().withMessage('New password should be at least 8 characters'),
    ];

    const checks = { auth, code_confirmation, confirm_password, forgot_password, login, refresh_token, register, resend_code, reset_password };
    return checks[endpoint];
};