/**
 * client.js
 *
 * The FastrPay class — the actual HTTP client and public API surface of
 * the SDK. Every method here validates its own arguments client-side
 * (via _requireString/_requirePositiveNumber) before ever sending a
 * request, so a missing or wrong-typed field surfaces as a clear
 * FastrPayValidationError immediately instead of an opaque server error
 * a request-roundtrip later.
 *
 * _request() is the single place every HTTP call goes through: it
 * attaches the API key, enforces a timeout (via AbortController, so a
 * hung server can't block the caller forever), parses the JSON response,
 * and — on any non-2xx response — hands the body to buildError() (see
 * errors.js's ERROR_CODE_MAP) to throw the specific typed error the
 * backend's `code` maps to, rather than a generic Error.
 *
 * One method per backend route: pay(), getBalance(), createPaymentLink(),
 * fulfillPaymentLink(), withdraw(), createWallet(), getWallets(),
 * payForAccess(), runPayroll(), enableAgent(), revokeAgent(),
 * setAgentPolicy(), and disableMyAccount() for self-service key
 * compromise response. callPaidEndpoint() is a convenience wrapper for
 * the paywall flow — it pays via payForAccess() and then calls the
 * protected endpoint with the resulting payment proof in headers,
 * returning both the endpoint's response and a payment receipt together.
 *
 * Amounts are accepted from callers in whole token units (e.g. 10 for
 * 10 USDC) and converted to the contract's 6-decimal raw units
 * internally, so SDK consumers never have to think about decimals.
*/

const {
    FastrPayError,
    FastrPayNetworkError,
    FastrPayValidationError,
    InvalidApiKeyError,
    InvalidSignatureError,
    WalletNotAuthorizedError,
    InsufficientAllowanceError,
    DuplicatePaymentError,
    InvalidSessionError,
} = require('./errors')

const ERROR_CODE_MAP = {
    INVALID_API_KEY: InvalidApiKeyError,
    MISSING_API_KEY: InvalidApiKeyError,
    INVALID_SIGNATURE: InvalidSignatureError,
    WALLET_NOT_AUTHORIZED: WalletNotAuthorizedError,
    WALLET_NOT_FOUND: FastrPayError,
    DUPLICATE_PAYMENT: DuplicatePaymentError,
    INSUFFICIENT_ALLOWANCE: InsufficientAllowanceError,
    MISSING_SESSION: InvalidSessionError,
    INVALID_SESSION: InvalidSessionError,
    LOGIN_FAILED: FastrPayError,
}

function buildError(data, status) {
    const code = data.code || `HTTP_${status}`
    const ErrorClass = ERROR_CODE_MAP[code] || FastrPayError
    return new ErrorClass(data.error || 'Request failed', { status, code, details: data })
}

class FastrPay {
    constructor({ apiKey, baseUrl = 'http://localhost:3000', timeoutMs = 120000, txTimeoutMs = 120000 }) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new FastrPayValidationError('apiKey is required and must be a string')
        }
        this.apiKey = apiKey
        this.baseUrl = baseUrl
        this.timeoutMs = timeoutMs
        this.txTimeoutMs = txTimeoutMs
        this._sessionCookie = null
    }

    async _request(path, method, body) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

        let res
        try {
            res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    ...(this._sessionCookie ? { Cookie: this._sessionCookie } : {}),
                },
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

        const setCookie = res.headers.get('set-cookie')
        if (setCookie) {
            const match = setCookie.match(/session_token=([^;]+)/)
            if (match) this._sessionCookie = `session_token=${match[1]}`
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

    async runPayroll(employeeIds) {
        if (employeeIds !== undefined) {
            if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
                throw new FastrPayValidationError('employeeIds must be a non-empty array of ids')
            }
            employeeIds.forEach((id, i) => {
                this._requireString(id, `employeeIds[${i}]`)
            })
            return this._request('/payroll/run', 'POST', { employeeIds })
        }
        return this._request('/payroll/run', 'POST', {})
    }

    async addEmployee({ name, blindPayReceiverId, bankAccountId, salary }) {
        this._requireString(name, 'name')
        this._requireString(blindPayReceiverId, 'blindPayReceiverId')
        this._requireString(bankAccountId, 'bankAccountId')
        this._requirePositiveNumber(salary, 'salary')
        return this._request('/employee/add', 'POST', { name, blindPayReceiverId, bankAccountId, salary: Math.round(salary * 1_000_000) })
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

    async fundAgent({ token, amount }) {
        this._requireString(token, 'token')
        this._requirePositiveNumber(amount, 'amount')
        const decimals = token === 'USDB' ? 18 : 6
        const raw = BigInt(Math.round(amount)) * (10n ** BigInt(decimals))
        return this._request('/agent/fund', 'POST', { token, amount: raw.toString() })
    }

    async revokeAgent() {
        return this._request('/agent/revoke', 'POST', {})
    }

    async setAgentPolicy({ maxAmountPerTx, dailyLimit }) {
        this._requirePositiveNumber(maxAmountPerTx, 'maxAmountPerTx')
        this._requirePositiveNumber(dailyLimit, 'dailyLimit')
        return this._request('/agent/policy', 'POST', { maxAmountPerTx: Math.round(maxAmountPerTx * 1_000_000), dailyLimit: Math.round(dailyLimit * 1_000_000) })
    }

    async login() {
        return this._request('/auth/login', 'POST', {})
    }

    async logout() {
        const data = await this._request('/auth/logout', 'POST', {})
        this._sessionCookie = null
        return data
    }

    async approveYield({ amount }) {
        this._requirePositiveNumber(amount, 'amount')
        const raw = BigInt(Math.round(amount)) * (10n ** 6n)
        return this._request('/yield/approve', 'POST', { amount: raw.toString() })
    }

    async deployYield({ amount }) {
        this._requirePositiveNumber(amount, 'amount')
        const raw = BigInt(Math.round(amount)) * (10n ** 6n)
        return this._request('/yield/deploy', 'POST', { amount: raw.toString() })
    }

    async undeployYield({ amount }) {
        this._requirePositiveNumber(amount, 'amount')
        const raw = BigInt(Math.round(amount)) * (10n ** 6n)
        return this._request('/yield/undeploy', 'POST', { amount: raw.toString() })
    }

    async getYieldStatus() {
        return this._request('/yield/status', 'GET')
    }

    async disableMyAccount() {
        return this._request('/business/disable-self', 'POST', {})
    }
}

module.exports = FastrPay