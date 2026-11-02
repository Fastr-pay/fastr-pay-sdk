const test = require('node:test')
const assert = require('node:assert/strict')
const FastrPay = require('../src/client')

const originalFetch = global.fetch

test.after(() => {
    global.fetch = originalFetch
})

test('SDK payout methods use API-key server routes and preserve idempotency keys', async () => {
    const requests = []
    global.fetch = async (url, options) => {
        requests.push({ url: String(url), options })
        const payload = requests.at(-1).url.endsWith('/payouts/quote')
            ? { status: 'success', quoteToken: 'signed-quote', quote: { simulated: true } }
            : { status: 'success', payout: { id: 'payout-1', status: 'pending' } }
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })
    }

    const client = new FastrPay({
        apiKey: 'server-only-test-key',
        baseUrl: 'http://localhost:3000',
    })
    const quote = await client.payouts.quote({
        beneficiaryId: 'beneficiary-1',
        usdcAmount: '1.250001',
    })
    const result = await client.payouts.create({
        quoteToken: quote.quoteToken,
        idempotencyKey: 'withdrawal-retry-key-001',
    })

    assert.equal(requests[0].url, 'http://localhost:3000/payouts/quote')
    assert.equal(requests[0].options.headers['x-api-key'], 'server-only-test-key')
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        beneficiaryId: 'beneficiary-1',
        usdcAmount: '1.250001',
        sourceWallet: 'company treasury',
    })
    assert.equal(requests[1].options.headers['Idempotency-Key'], 'withdrawal-retry-key-001')
    assert.deepEqual(JSON.parse(requests[1].options.body), { quoteToken: 'signed-quote' })
    assert.equal(result.payout.id, 'payout-1')
})

test('SDK beneficiary method validates bank fields before sending them', async () => {
    let requests = 0
    global.fetch = async () => {
        requests += 1
        return new Response(JSON.stringify({ status: 'success', beneficiary: { last4: '9012' } }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
        })
    }
    const client = new FastrPay({ apiKey: 'server-only-test-key' })

    await assert.rejects(
        client.beneficiaries.create({
            displayName: 'Demo account',
            currency: 'INR',
            bankDetails: {
                ifsc: 'HDFC0001234',
                accountNumber: '123456789',
                cardNumber: '4111111111111111',
            },
        }),
        /unsupported for INR/,
    )
    assert.equal(requests, 0)

    const result = await client.beneficiaries.create({
        displayName: 'Demo account',
        currency: 'INR',
        bankDetails: { ifsc: 'HDFC0001234', accountNumber: '123456789' },
    })
    assert.equal(result.beneficiary.last4, '9012')
    assert.equal(requests, 1)
})

test('SDK rejects zero, float, and over-precision USDC amounts', async () => {
    const client = new FastrPay({ apiKey: 'server-only-test-key' })
    for (const usdcAmount of ['0', '0.000000', '01', '1.0000001', 1.5]) {
        await assert.rejects(
            client.payouts.quote({ beneficiaryId: 'beneficiary-1', usdcAmount }),
            /decimal string|greater than zero/,
        )
    }
})

test('SDK updates the existing business beneficiary without creating another', async () => {
    let request
    global.fetch = async (url, options) => {
        request = { url: String(url), options }
        return new Response(
            JSON.stringify({ status: 'success', beneficiary: { id: 'bank-1', last4: '9012' } }),
            {
                status: 200,
                headers: { 'content-type': 'application/json' },
            },
        )
    }
    const client = new FastrPay({
        apiKey: 'server-only-test-key',
        baseUrl: 'http://localhost:3000',
    })
    const result = await client.beneficiaries.update('bank-1', {
        displayName: 'Treasury bank',
        currency: 'INR',
        bankDetails: { ifsc: 'HDFC0001234', accountNumber: '123456789012' },
    })

    assert.equal(request.url, 'http://localhost:3000/beneficiaries/bank-1')
    assert.equal(request.options.method, 'PUT')
    assert.equal(JSON.parse(request.options.body).bankDetails.accountNumber, '123456789012')
    assert.equal(result.beneficiary.last4, '9012')
})
