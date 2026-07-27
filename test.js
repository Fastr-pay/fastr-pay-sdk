const FastrPay = require('./index')

const fastr = new FastrPay({
    apiKey: 'fpk_341b8145dadfa467a172eb8ad3f7ca536f87ebe9b3c0e87a',
    baseUrl: 'http://localhost:3000',
})

async function run() {
    const wallet = await fastr.createWallet({ ownerLabel: 'sdk test wallet' })
    console.log('Wallet created:', wallet)
}

async function testPay() {
    const result = await fastr.pay({
        payeeWalletAddress: '0x5b2d61c40dA8ca460CF158df62b4b25e7DE70867',
        fiatAmount: 100,
        fiatCurrency: 'INR',
        purpose: 'sdk pay test',
        orderId: 'mock_order_sdktest001',
        paymentId: 'test_payment_sdk001',
        signature: '4eb727d4b4a33280e203a090ce555d1056beb6354ab41cdea517564b60f27030',
        method: 'upi',
    })
    console.log('Pay result:', result)
}

async function testCreatePaymentLink() {
    const link = await fastr.createPaymentLink({
        payeeWalletAddress: '0x5b2d61c40dA8ca460CF158df62b4b25e7DE70867',
        amount: 2,
        currency: 'EUR',
        purpose: 'sdk payroll test',
    })
    console.log('Payment link created:', link)
}

async function testFulfillPaymentLink(linkId, signature) {
    const result = await fastr.fulfillPaymentLink(linkId, {
        orderId: 'mock_order_sdklinktest002',
        paymentId: 'test_payment_sdklink002',
        signature: signature,
        method: 'upi',
    })
    console.log('Fulfill result:', result)
}

async function testBalance() {
    const result = await fastr.getBalance('0x5b2d61c40dA8ca460CF158df62b4b25e7DE70867')
    console.log('Balance result:', result)
}

async function testWithdraw() {
    const result = await fastr.withdraw({
        receiverId: 're_3Wq8t3k8Vo9t',
        bankAccountId: 'ba_QCbu48wzSEtm',
        amount: 1000, // 1000 = $10
        senderWalletAddress: '0xeca0dd4d9fbaba0f54ce4142965724643d05e262',
    })
    console.log('Withdraw result:', result)
}

async function testCallPaidEndpoint() {
    const result = await fastr.callPaidEndpoint('http://localhost:3000/api/market-data', {
        recipientAddress: '0x34Ce9F30Af643445c4b5499F184809cEdF9A273f',
        amount: 1000,
        purpose: 'market data access',
        senderAddress: '0x34Ce9F30Af643445c4b5499F184809cEdF9A273f',
    })
    console.log('Paid endpoint result:', result)
}

testCallPaidEndpoint().catch(console.error)