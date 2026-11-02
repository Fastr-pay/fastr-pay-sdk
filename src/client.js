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
 * One method per business-facing backend route: getBalance(), createPaymentLink(),
 * createWallet(), getWallets(),
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

const crypto = require('crypto')
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
    constructor({
        apiKey,
        baseUrl = 'http://localhost:3000',
        timeoutMs = 120000,
        txTimeoutMs = 120000,
    }) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new FastrPayValidationError('apiKey is required and must be a string')
        }
        this.apiKey = apiKey
        this.baseUrl = baseUrl
        this.timeoutMs = timeoutMs
        this.txTimeoutMs = txTimeoutMs
        this._sessionCookie = null
        this.beneficiaries = Object.freeze({
            create: (input) => this.createBeneficiary(input),
            update: (id, input) => this.updateBeneficiary(id, input),
            list: () => this.listBeneficiaries(),
        })
        this.payouts = Object.freeze({
            quote: (input) => this.quotePayout(input),
            create: (input) => this.createPayout(input),
            get: (id) => this.getPayout(id),
            list: () => this.listPayouts(),
        })
    }

    async _request(path, method, body, extraHeaders = {}) {
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
                    ...extraHeaders,
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            })
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new FastrPayNetworkError(`Request timed out after ${this.timeoutMs}ms`, {
                    path,
                })
            }
            throw new FastrPayNetworkError('Could not reach FastrPay server', {
                path,
                cause: err.message,
            })
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
            throw new FastrPayError('Server returned a non-JSON response', {
                status: res.status,
                code: 'BAD_RESPONSE',
            })
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

    _validateUsdcAmount(value, name = 'usdcAmount') {
        if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) {
            throw new FastrPayValidationError(
                `${name} must be a decimal string with up to 6 places`,
            )
        }
        if (BigInt(value.replace('.', '').replace(/^0+(?=\d)/, '')) === 0n) {
            throw new FastrPayValidationError(`${name} must be greater than zero`)
        }
    }

    _validateIdempotencyKey(value) {
        if (
            typeof value !== 'string' ||
            value.length < 16 ||
            value.length > 200 ||
            !/^[\x21-\x7e]+$/.test(value)
        ) {
            throw new FastrPayValidationError(
                'idempotencyKey must be 16–200 printable ASCII characters',
            )
        }
    }

    _beneficiaryPayload(input = {}) {
        const { displayName, currency, bankName, bankDetails } = input
        this._requireString(displayName, 'displayName')
        this._requireString(currency, 'currency')
        if (!['USD', 'EUR', 'INR'].includes(currency.trim().toUpperCase())) {
            throw new FastrPayValidationError('currency must be USD, EUR, or INR')
        }
        if (bankName !== undefined && bankName !== null) {
            this._requireString(bankName, 'bankName')
        }
        if (!bankDetails || typeof bankDetails !== 'object' || Array.isArray(bankDetails)) {
            throw new FastrPayValidationError('bankDetails must be an object')
        }

        const normalizedCurrency = currency.trim().toUpperCase()
        const expectedBankKeys = {
            USD: ['routingNumber', 'accountNumber'],
            EUR: ['iban'],
            INR: ['ifsc', 'accountNumber'],
        }[normalizedCurrency]
        if (Object.keys(bankDetails).some((key) => !expectedBankKeys.includes(key))) {
            throw new FastrPayValidationError(
                `bankDetails contains fields unsupported for ${normalizedCurrency}`,
            )
        }
        if (normalizedCurrency === 'USD') {
            if (
                typeof bankDetails.routingNumber !== 'string' ||
                typeof bankDetails.accountNumber !== 'string' ||
                !/^\d{9}$/.test(bankDetails.routingNumber.trim()) ||
                !/^\d{4,17}$/.test(bankDetails.accountNumber.trim())
            ) {
                throw new FastrPayValidationError(
                    'USD bankDetails require a 9-digit routing number and 4–17 digit account number',
                )
            }
        } else if (normalizedCurrency === 'EUR') {
            if (
                typeof bankDetails.iban !== 'string' ||
                !/^[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30}$/.test(bankDetails.iban.replace(/\s+/g, ''))
            ) {
                throw new FastrPayValidationError('EUR bankDetails require a valid IBAN')
            }
        } else if (
            typeof bankDetails.ifsc !== 'string' ||
            typeof bankDetails.accountNumber !== 'string' ||
            !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(bankDetails.ifsc.trim()) ||
            !/^\d{6,18}$/.test(bankDetails.accountNumber.trim())
        ) {
            throw new FastrPayValidationError(
                'INR bankDetails require an IFSC code and 6–18 digit account number',
            )
        }

        return {
            displayName: displayName.trim(),
            currency: normalizedCurrency,
            ...(typeof bankName === 'string' && bankName.trim()
                ? { bankName: bankName.trim() }
                : {}),
            bankDetails,
        }
    }

    async createBeneficiary(input = {}) {
        return this._request('/beneficiaries', 'POST', this._beneficiaryPayload(input))
    }

    async updateBeneficiary(beneficiaryId, input = {}) {
        this._requireString(beneficiaryId, 'beneficiaryId')
        return this._request(
            `/beneficiaries/${encodeURIComponent(beneficiaryId)}`,
            'PUT',
            this._beneficiaryPayload(input),
        )
    }

    async listBeneficiaries() {
        return this._request('/beneficiaries', 'GET')
    }

    async quotePayout({ beneficiaryId, usdcAmount, sourceWallet = 'company treasury' } = {}) {
        this._requireString(beneficiaryId, 'beneficiaryId')
        this._validateUsdcAmount(usdcAmount)
        this._requireString(sourceWallet, 'sourceWallet')
        return this._request('/payouts/quote', 'POST', { beneficiaryId, usdcAmount, sourceWallet })
    }

    async createPayout({ quoteToken, idempotencyKey = crypto.randomUUID() } = {}) {
        this._requireString(quoteToken, 'quoteToken')
        this._validateIdempotencyKey(idempotencyKey)
        return this._request(
            '/payouts',
            'POST',
            { quoteToken },
            { 'Idempotency-Key': idempotencyKey },
        )
    }

    async getPayout(payoutId) {
        this._requireString(payoutId, 'payoutId')
        return this._request(`/payouts/${encodeURIComponent(payoutId)}`, 'GET')
    }

    async listPayouts() {
        return this._request('/payouts', 'GET')
    }

    async getBalance(ownerLabel) {
        this._requireString(ownerLabel, 'ownerLabel')
        return this._request(`/wallet/balance/${encodeURIComponent(ownerLabel)}`, 'GET')
    }

    async createPaymentLink({ payeeWalletAddress, amount, currency, purpose }) {
        this._requireString(payeeWalletAddress, 'payeeWalletAddress')
        this._requirePositiveNumber(amount, 'amount')
        this._requireString(currency, 'currency')
        return this._request('/payment-link/create', 'POST', {
            payeeWalletAddress,
            amount,
            currency,
            purpose,
        })
    }

    async createCardPlan({
        name,
        amount,
        currency,
        period,
        interval = 1,
        idempotencyKey = crypto.randomUUID(),
    }) {
        this._requireString(name, 'name')
        this._requirePositiveNumber(amount, 'amount')
        this._requireString(currency, 'currency')
        if (!['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(period)) {
            throw new FastrPayValidationError(
                'period must be daily, weekly, monthly, quarterly, or yearly',
            )
        }
        if (
            !Number.isSafeInteger(interval) ||
            interval < 1 ||
            (period === 'daily' && interval < 7)
        ) {
            throw new FastrPayValidationError(
                'interval must be a positive integer; daily plans require at least 7',
            )
        }
        if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                idempotencyKey,
            )
        ) {
            throw new FastrPayValidationError('idempotencyKey must be a UUID')
        }

        return this._request(
            '/cards/plans',
            'POST',
            {
                name: name.trim(),
                amount,
                currency: currency.trim().toUpperCase(),
                period,
                interval,
            },
            { 'Idempotency-Key': idempotencyKey },
        )
    }

    async createPaywall({ payeeWalletAddress, amount, currency, purpose }) {
        this._requireString(payeeWalletAddress, 'payeeWalletAddress')
        this._requirePositiveNumber(amount, 'amount')
        this._requireString(currency, 'currency')
        return this._request('/paywall/create', 'POST', {
            payeeWalletAddress,
            amount,
            currency,
            purpose,
        })
    }

    async deletePaywall(paywallId) {
        this._requireString(paywallId, 'paywallId')
        return this._request(`/paywall/${paywallId}/delete`, 'POST', {})
    }

    async collectPaywall(paywallId, { orderId, paymentId, signature, method, amount }) {
        this._requireString(paywallId, 'paywallId')
        this._requireString(orderId, 'orderId')
        this._requireString(paymentId, 'paymentId')
        this._requireString(signature, 'signature')
        this._requireString(method, 'method')
        return this._request(`/paywall/${paywallId}/collect`, 'POST', {
            orderId,
            paymentId,
            signature,
            method,
            amount,
        })
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
        return this._request('/agent-pay', 'POST', {
            recipientAddress,
            amount: Math.round(amount * 1_000_000),
            purpose,
        })
    }

    async runPayroll(employeeIds, { idempotencyKey = crypto.randomUUID() } = {}) {
        if (employeeIds !== undefined) {
            if (
                !Array.isArray(employeeIds) ||
                employeeIds.length === 0 ||
                employeeIds.length > 100
            ) {
                throw new FastrPayValidationError(
                    'employeeIds must be a non-empty array of at most 100 ids',
                )
            }
            employeeIds.forEach((id, i) => {
                this._requireString(id, `employeeIds[${i}]`)
            })
        }
        this._requireString(idempotencyKey, 'idempotencyKey')
        if (idempotencyKey.length > 256 || /[\r\n\u0000-\u001f]/.test(idempotencyKey)) {
            throw new FastrPayValidationError(
                'idempotencyKey must be at most 256 characters and contain no control characters',
            )
        }
        return this._request(
            '/payroll/run',
            'POST',
            employeeIds === undefined ? {} : { employeeIds },
            { 'Idempotency-Key': idempotencyKey },
        )
    }

    async addEmployee({ name, email, salary, bankAccount }) {
        this._requireString(name, 'name')
        this._requireString(email, 'email')
        this._requirePositiveNumber(salary, 'salary')
        if (!/^\d+(?:\.\d{1,6})?$/.test(String(salary))) {
            throw new FastrPayValidationError('salary must have no more than 6 decimal places')
        }

        if (!bankAccount || typeof bankAccount !== 'object' || Array.isArray(bankAccount)) {
            throw new FastrPayValidationError('bankAccount must be an object')
        }

        const { countryCode, currency, paymentRail, bankName, accountLast4, details } = bankAccount
        this._requireString(countryCode, 'bankAccount.countryCode')
        this._requireString(currency, 'bankAccount.currency')
        this._requireString(paymentRail, 'bankAccount.paymentRail')
        this._requireString(accountLast4, 'bankAccount.accountLast4')

        if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
            throw new FastrPayValidationError('email must be a valid email address')
        }
        if (!/^[A-Za-z]{2}$/.test(countryCode.trim())) {
            throw new FastrPayValidationError(
                'bankAccount.countryCode must be a 2-letter country code',
            )
        }
        if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
            throw new FastrPayValidationError(
                'bankAccount.currency must be a 3-letter currency code',
            )
        }
        if (paymentRail.trim().length > 64) {
            throw new FastrPayValidationError(
                'bankAccount.paymentRail must be 64 characters or fewer',
            )
        }
        if (!/^[A-Za-z0-9]{4}$/.test(accountLast4.trim())) {
            throw new FastrPayValidationError(
                'bankAccount.accountLast4 must contain the last 4 account characters',
            )
        }
        if (!details || typeof details !== 'object' || Array.isArray(details)) {
            throw new FastrPayValidationError('bankAccount.details must be an object')
        }

        return this._request('/employee/add', 'POST', {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            salary,
            bankAccount: {
                countryCode: countryCode.trim().toUpperCase(),
                currency: currency.trim().toUpperCase(),
                paymentRail: paymentRail.trim(),
                ...(typeof bankName === 'string' && bankName.trim()
                    ? { bankName: bankName.trim() }
                    : {}),
                accountLast4: accountLast4.trim(),
                details,
            },
        })
    }

    async removeEmployee(employeeId) {
        this._requireString(employeeId, 'employeeId')
        return this._request('/employee/remove', 'POST', { employeeId })
    }

    async getEmployeeStatus() {
        return this._request('/employee/status', 'GET')
    }

    async callPaidEndpoint(url, { recipientAddress, amount, purpose, senderAddress }) {
        this._requireString(url, 'url')
        const payment = await this.payForAccess({ recipientAddress, amount, purpose })

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
        let res
        try {
            res = await fetch(url, {
                headers: {
                    'x-api-key': this.apiKey,
                    'X-Payment-Id': payment.paymentId,
                    'X-Payer-Address': senderAddress,
                },
                signal: controller.signal,
            })
        } catch (err) {
            throw new FastrPayNetworkError('Could not reach the paid endpoint', {
                url,
                cause: err.message,
            })
        } finally {
            clearTimeout(timeout)
        }

        let result
        try {
            result = await res.json()
        } catch {
            throw new FastrPayError('Paid endpoint returned a non-JSON response', {
                status: res.status,
            })
        }

        if (!res.ok) {
            throw buildError(result, res.status)
        }

        return {
            ...result,
            paymentReceipt: {
                paymentId: payment.paymentId,
                txHash: payment.txHash,
                amountPaid: amount,
                purpose,
            },
        }
    }

    async enableAgent({ maxAmountPerTx, dailyLimit }) {
        this._requirePositiveNumber(maxAmountPerTx, 'maxAmountPerTx')
        this._requirePositiveNumber(dailyLimit, 'dailyLimit')
        return this._request('/agent/enable', 'POST', {
            maxAmountPerTx: Math.round(maxAmountPerTx * 1_000_000),
            dailyLimit: Math.round(dailyLimit * 1_000_000),
        })
    }

    async fundAgent({ token = 'USDC', amount }) {
        if (token !== 'USDC') {
            throw new FastrPayValidationError('fundAgent supports USDC only')
        }
        this._requirePositiveNumber(amount, 'amount')
        const normalized = String(amount)
        if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
            throw new FastrPayValidationError('amount must have at most six decimal places')
        }
        const [whole, fraction = ''] = normalized.split('.')
        const raw = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
        return this._request('/agent/fund', 'POST', { token, amount: raw.toString() })
    }

    async revokeAgent() {
        return this._request('/agent/revoke', 'POST', {})
    }

    async setAgentPolicy({ maxAmountPerTx, dailyLimit }) {
        this._requirePositiveNumber(maxAmountPerTx, 'maxAmountPerTx')
        this._requirePositiveNumber(dailyLimit, 'dailyLimit')
        return this._request('/agent/policy', 'POST', {
            maxAmountPerTx: Math.round(maxAmountPerTx * 1_000_000),
            dailyLimit: Math.round(dailyLimit * 1_000_000),
        })
    }

    async login() {
        return this._request('/auth/login', 'POST', {})
    }

    async logout() {
        const data = await this._request('/auth/logout', 'POST', {})
        this._sessionCookie = null
        return data
    }

    async logoutAll() {
        const data = await this._request('/auth/logout-all', 'POST', {})
        this._sessionCookie = null
        return data
    }

    async approveYield({ amount }) {
        this._requirePositiveNumber(amount, 'amount')
        const raw = BigInt(Math.round(amount)) * 10n ** 6n
        return this._request('/yield/approve', 'POST', { amount: raw.toString() })
    }

    async deployYield({ amount }) {
        this._requirePositiveNumber(amount, 'amount')
        const raw = BigInt(Math.round(amount)) * 10n ** 6n
        return this._request('/yield/deploy', 'POST', { amount: raw.toString() })
    }

    async undeployYield({ amount }) {
        this._requirePositiveNumber(amount, 'amount')
        const raw = BigInt(Math.round(amount)) * 10n ** 6n
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
