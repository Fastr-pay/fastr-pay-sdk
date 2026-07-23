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

    async getBalance(address) {
        return this._request(`/wallet/balance/${address}`, 'GET')
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

    async createWallet({ ownerLabel }) {
        return this._request('/wallet/create', 'POST', { ownerLabel })
    }
}

module.exports = FastrPay