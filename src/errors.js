/**
 * errors.js
 *
 * Typed error hierarchy for the FastrPay SDK. Every error thrown by a
 * failed API call is an instance of FastrPayError (or a more specific
 * subclass), never a plain Error — so consumers can use `instanceof` to
 * handle specific failure modes instead of parsing error message strings.
 *
 * FastrPayError is the base class every other error extends. It always
 * carries a `code` (matches the backend's error code, e.g.
 * WALLET_NOT_AUTHORIZED), a `status` (HTTP status if the error came from
 * a response), and `details` (the raw response body, for debugging).
 *
 * FastrPayNetworkError   - the request itself failed: server unreachable,
 *                           DNS failure, or it timed out before responding
 * FastrPayValidationError - a bad argument was caught client-side, before
 *                           any request was sent (e.g. missing/wrong-typed
 *                           field) — never reaches the network
 * InvalidApiKeyError      - the API key is missing, invalid, or belongs to
 *                           a disabled business
 * InvalidSignatureError   - the payment gateway signature failed verification
 * WalletNotAuthorizedError - the wallet address in the request doesn't
 *                           belong to the calling business
 * InsufficientAllowanceError - an on-chain token allowance was too low to
 *                           complete the operation
 * DuplicatePaymentError    - this payment reference has already been
 *                           processed (idempotency guard)
 *
 * client.js's buildError() maps a response's `code` field to the matching
 * class here, falling back to the generic FastrPayError for any code it
 * doesn't recognize — so a new backend error code never crashes the SDK,
 * it just surfaces as a less-specific error until a class is added for it.
*/

class FastrPayError extends Error {
    constructor(message, { code, status, details } = {}) {
        super(message)
        this.name = 'FastrPayError'
        this.code = code || 'UNKNOWN_ERROR'
        this.status = status || null
        this.details = details || null
    }
}

class FastrPayNetworkError extends FastrPayError {
    constructor(message, details) {
        super(message, { code: 'NETWORK_ERROR', details })
        this.name = 'FastrPayNetworkError'
    }
}

class FastrPayValidationError extends FastrPayError {
    constructor(message, details) {
        super(message, { code: 'VALIDATION_ERROR', details })
        this.name = 'FastrPayValidationError'
    }
}

class InvalidApiKeyError extends FastrPayError {
    constructor(message, details) {
        super(message, { code: 'INVALID_API_KEY', status: 401, details })
        this.name = 'InvalidApiKeyError'
    }
}

class InvalidSignatureError extends FastrPayError {
    constructor(message, details) {
        super(message, { code: 'INVALID_SIGNATURE', status: 400, details })
        this.name = 'InvalidSignatureError'
    }
}

class WalletNotAuthorizedError extends FastrPayError {
    constructor(message, details) {
        super(message, { code: 'WALLET_NOT_AUTHORIZED', status: 403, details })
        this.name = 'WalletNotAuthorizedError'
    }
}

class InsufficientAllowanceError extends FastrPayError {
    constructor(message, details) {
        super(message, { code: 'INSUFFICIENT_ALLOWANCE', status: 400, details })
        this.name = 'InsufficientAllowanceError'
    }
}

class DuplicatePaymentError extends FastrPayError {
    constructor(message, details) {
        super(message, { code: 'DUPLICATE_PAYMENT', status: 409, details })
        this.name = 'DuplicatePaymentError'
    }
}

module.exports = {
    FastrPayError,
    FastrPayNetworkError,
    FastrPayValidationError,
    InvalidApiKeyError,
    InvalidSignatureError,
    WalletNotAuthorizedError,
    InsufficientAllowanceError,
    DuplicatePaymentError,
}