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