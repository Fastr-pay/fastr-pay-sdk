/**
 * index.js
 *
 * Public entry point for the fastr-pay-sdk package. Re-exports the
 * FastrPay client class from src/client.js and every error class from
 * src/errors.js as named exports, so consumers only ever need one import:
 *
 *   const { FastrPay, WalletNotAuthorizedError } = require('fastr-pay-sdk')
 *
 * Kept deliberately thin — this file has no logic of its own. All actual
 * implementation lives in src/, split by concern (client.js for the HTTP
 * client and methods, errors.js for the error hierarchy) so each stays
 * focused and independently testable.
*/

const FastrPay = require('./src/client')
const errors = require('./src/errors')

module.exports = { FastrPay, ...errors }