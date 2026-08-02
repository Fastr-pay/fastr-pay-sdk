class FastrPay {
    constructor({ apiKey, baseUrl = 'http://localhost:3000' }) {
        if (!apiKey) throw new Error('apiKey is required')
        this.apiKey = apiKey
        this.baseUrl = baseUrl
    }

    async _request(path, method, body) {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
            },
            body: body ? JSON.stringify(body) : undefined,
        })
        const data = await res.json()
        if (!res.ok) {
            throw new Error(data.error || 'Request failed')
        }
        return data
    }

    async pay({ payeeWalletAddress, fiatAmount, fiatCurrency, purpose, orderId, paymentId, signature, method }) {
        return this._request('/payin', 'POST', {
            payeeWalletAddress, fiatAmount, fiatCurrency, purpose, orderId, paymentId, signature, method,
        })
    }

    async getBalance(ownerLabel) {
        return this._request(`/wallet/balance/${encodeURIComponent(ownerLabel)}`, 'GET')
    }

    async createPaymentLink({ payeeWalletAddress, amount, currency, purpose }) {
        return this._request('/payment-link/create', 'POST', {
            payeeWalletAddress, amount, currency, purpose,
        })
    }

    async fulfillPaymentLink(linkId, { orderId, paymentId, signature, method }) {
        return this._request(`/pay/${linkId}`, 'POST', {
            orderId, paymentId, signature, method,
        })
    }

    async withdraw({ receiverId, bankAccountId, amount }) {
        return this._request('/withdraw', 'POST', {
            receiverId,
            bankAccountId,
            amount,
        })
    }

    async createWallet({ ownerLabel }) {
        return this._request('/wallet/create', 'POST', { ownerLabel })
    }

    async getWallets() {
        return this._request('/wallets', 'GET')
    }

    async payForAccess({ recipientAddress, amount, purpose }) {
        return this._request('/agent-pay', 'POST', {
            recipientAddress,
            amount: Math.round(amount * 1_000_000),
            purpose,
        })
    }

    async runPayroll(payrollList) {
        const convertedList = payrollList.map(w => ({
            ...w,
            salary: Math.round(w.salary * 1_000_000),
        }))
        return this._request('/payroll/run', 'POST', {
            payrollList: convertedList,
        })
    }

    async callPaidEndpoint(url, { recipientAddress, amount, purpose, senderAddress }) {
        const payment = await this.payForAccess({
            recipientAddress,
            amount,
            purpose,
        })
        const res = await fetch(url, {
            headers: {
                'x-api-key': this.apiKey,
                'X-Payment-Id': payment.paymentId,
                'X-Payer-Address': senderAddress,
            },
        })
        const result = await res.json()

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
        return this._request('/agent/enable', 'POST', {
            maxAmountPerTx: Math.round(maxAmountPerTx * 1_000_000),
            dailyLimit: Math.round(dailyLimit * 1_000_000),
        })
    }

    async revokeAgent() {
        return this._request('/agent/revoke', 'POST', {})
    }

    async setAgentPolicy({ maxAmountPerTx, dailyLimit }) {
        return this._request('/agent/policy', 'POST', {
            maxAmountPerTx: Math.round(maxAmountPerTx * 1_000_000),
            dailyLimit: Math.round(dailyLimit * 1_000_000),
        })
    }

    async disableMyAccount() {
        return this._request('/business/disable-self', 'POST', {})
    }
}

module.exports = FastrPay