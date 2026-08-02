const {
    FastrPayError,
    FastrPayNetworkError,
    FastrPayValidationError,
    InvalidApiKeyError,
    InvalidSignatureError,
    WalletNotAuthorizedError,
    InsufficientAllowanceError,
    DuplicatePaymentError,
} = require('./errors')

const ERROR_CODE_MAP = {
    INVALID_API_KEY: InvalidApiKeyError,
    MISSING_API_KEY: InvalidApiKeyError,
    INVALID_SIGNATURE: InvalidSignatureError,
    WALLET_NOT_AUTHORIZED: WalletNotAuthorizedError,
    WALLET_NOT_FOUND: FastrPayError,
    DUPLICATE_PAYMENT: DuplicatePaymentError,
    INSUFFICIENT_ALLOWANCE: InsufficientAllowanceError,
}

function buildError(data, status) {
    const code = data.code || `HTTP_${status}`
    const ErrorClass = ERROR_CODE_MAP[code] || FastrPayError
    return new ErrorClass(data.error || 'Request failed', { status, code, details: data })
}

class FastrPay {
    constructor({ apiKey, baseUrl = 'http://localhost:3000', timeoutMs = 60000, txTimeoutMs = 60000 }) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new FastrPayValidationError('apiKey is required and must be a string')
        }
        this.apiKey = apiKey
        this.baseUrl = baseUrl
        this.timeoutMs = timeoutMs
        this.txTimeoutMs = txTimeoutMs
    }

    async _request(path, method, body) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

        let res
        try {
            res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            })
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new FastrPayNetworkError(`Request timed out after ${this.timeoutMs}ms`, { path })
            }
            throw new FastrPayNetworkError('Could not reach FastrPay server', { path, cause: err.message })
        } finally {
            clearTimeout(timeout)
        }

        let data
        try {
            data = await res.json()
        } catch {
            throw new FastrPayError('Server returned a non-JSON response', { status: res.status, code: 'BAD_RESPONSE' })
        }

        if (!res.ok) {
            throw buildError(data, res.status)
        }

        return data
    }

    _requireString(value, name) {
        if (!value || typeof value !== 'string') {
            throw new FastrPayValidationError(`${name} is required and must be a string`)
        }
    }
    _requirePositiveNumber(value, name) {
        if (typeof value !== 'number' || value <= 0 || Number.isNaN(value)) {
            throw new FastrPayValidationError(`${name} must be a positive number`)
        }
    }

    async pay({ payeeWalletAddress, fiatAmount, fiatCurrency, purpose, orderId, paymentId, signature, method }) {
        this._requireString(payeeWalletAddress, 'payeeWalletAddress')
        this._requirePositiveNumber(fiatAmount, 'fiatAmount')
        this._requireString(fiatCurrency, 'fiatCurrency')
        this._requireString(orderId, 'orderId')
        this._requireString(paymentId, 'paymentId')
        this._requireString(signature, 'signature')
        this._requireString(method, 'method')
        return this._request('/payin', 'POST', { payeeWalletAddress, fiatAmount, fiatCurrency, purpose, orderId, paymentId, signature, method })
    }

    async getBalance(ownerLabel) {
        this._requireString(ownerLabel, 'ownerLabel')
        return this._request(`/wallet/balance/${encodeURIComponent(ownerLabel)}`, 'GET')
    }

    async createPaymentLink({ payeeWalletAddress, amount, currency, purpose }) {
        this._requireString(payeeWalletAddress, 'payeeWalletAddress')
        this._requirePositiveNumber(amount, 'amount')
        this._requireString(currency, 'currency')
        return this._request('/payment-link/create', 'POST', { payeeWalletAddress, amount, currency, purpose })
    }

    async fulfillPaymentLink(linkId, { orderId, paymentId, signature, method }) {
        this._requireString(linkId, 'linkId')
        this._requireString(orderId, 'orderId')
        this._requireString(paymentId, 'paymentId')
        this._requireString(signature, 'signature')
        this._requireString(method, 'method')
        return this._request(`/pay/${linkId}`, 'POST', { orderId, paymentId, signature, method })
    }

    async withdraw({ receiverId, bankAccountId, amount }) {
        this._requireString(receiverId, 'receiverId')
        this._requireString(bankAccountId, 'bankAccountId')
        this._requirePositiveNumber(amount, 'amount')
        return this._request('/withdraw', 'POST', { receiverId, bankAccountId, amount })
    }

    async createWallet({ ownerLabel }) {
        this._requireString(ownerLabel, 'ownerLabel')
        return this._request('/wallet/create', 'POST', { ownerLabel })
    }

    async getWallets() {
        return this._request('/wallets', 'GET')
    }

    async payForAccess({ recipientAddress, amount, purpose }) {
        this._requireString(recipientAddress, 'recipientAddress')
        this._requirePositiveNumber(amount, 'amount')
        return this._request('/agent-pay', 'POST', { recipientAddress, amount: Math.round(amount * 1_000_000), purpose })
    }

    async runPayroll(payrollList) {
        if (!Array.isArray(payrollList) || payrollList.length === 0) {
            throw new FastrPayValidationError('payrollList must be a non-empty array')
        }
        payrollList.forEach((w, i) => {
            this._requireString(w.name, `payrollList[${i}].name`)
            this._requireString(w.blindPayReceiverId, `payrollList[${i}].blindPayReceiverId`)
            this._requireString(w.bankAccountId, `payrollList[${i}].bankAccountId`)
            this._requirePositiveNumber(w.salary, `payrollList[${i}].salary`)
        })
        const convertedList = payrollList.map(w => ({ ...w, salary: Math.round(w.salary * 1_000_000) }))
        return this._request('/payroll/run', 'POST', { payrollList: convertedList })
    }

    async callPaidEndpoint(url, { recipientAddress, amount, purpose, senderAddress }) {
        this._requireString(url, 'url')
        const payment = await this.payForAccess({ recipientAddress, amount, purpose })

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
        let res
        try {
            res = await fetch(url, {
                headers: { 'x-api-key': this.apiKey, 'X-Payment-Id': payment.paymentId, 'X-Payer-Address': senderAddress },
                signal: controller.signal,
            })
        } catch (err) {
            throw new FastrPayNetworkError('Could not reach the paid endpoint', { url, cause: err.message })
        } finally {
            clearTimeout(timeout)
        }

        let result
        try {
            result = await res.json()
        } catch {
            throw new FastrPayError('Paid endpoint returned a non-JSON response', { status: res.status })
        }

        if (!res.ok) {
            throw buildError(result, res.status)
        }

        return { ...result, paymentReceipt: { paymentId: payment.paymentId, txHash: payment.txHash, amountPaid: amount, purpose } }
    }

    async enableAgent({ maxAmountPerTx, dailyLimit }) {
        this._requirePositiveNumber(maxAmountPerTx, 'maxAmountPerTx')
        this._requirePositiveNumber(dailyLimit, 'dailyLimit')
        return this._request('/agent/enable', 'POST', { maxAmountPerTx: Math.round(maxAmountPerTx * 1_000_000), dailyLimit: Math.round(dailyLimit * 1_000_000) })
    }

    async revokeAgent() {
        return this._request('/agent/revoke', 'POST', {})
    }

    async setAgentPolicy({ maxAmountPerTx, dailyLimit }) {
        this._requirePositiveNumber(maxAmountPerTx, 'maxAmountPerTx')
        this._requirePositiveNumber(dailyLimit, 'dailyLimit')
        return this._request('/agent/policy', 'POST', { maxAmountPerTx: Math.round(maxAmountPerTx * 1_000_000), dailyLimit: Math.round(dailyLimit * 1_000_000) })
    }

    async disableMyAccount() {
        return this._request('/business/disable-self', 'POST', {})
    }
}

module.exports = FastrPay