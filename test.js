const FastrPay = require('./index')

const apiKey = process.env.FASTR_PAY_API_KEY
if (!apiKey) throw new Error('Set FASTR_PAY_API_KEY before running this manual test.')

const fastr = new FastrPay({
    apiKey,
    baseUrl: process.env.FASTR_PAY_BASE_URL || 'http://localhost:3000',
})

async function run() {
    const wallet = await fastr.createWallet({ ownerLabel: 'sdk test wallet' })
    console.log('Wallet created:', wallet)
}

async function testCreatePaymentLink() {
    const link = await fastr.createPaymentLink({
        payeeWalletAddress: '0xda9eb50e1C6cB003a7102B46A8A50741Ce1E67e4',
        amount: 2,
        currency: 'EUR',
        purpose: 'sdk payroll test',
    })
    console.log('Payment link created:', link)
}

async function testCreateCardPlan() {
    const plan = await fastr.createCardPlan({
        name: 'Monthly demo access',
        amount: 10,
        currency: 'USD',
        period: 'monthly',
    })
    console.log('Card plan created:', plan)
}

async function testBalance() {
    const result = await fastr.getBalance('0xda9eb50e1C6cB003a7102B46A8A50741Ce1E67e4')
    console.log('Balance result:', result)
}

async function testCallPaidEndpoint() {
    const result = await fastr.callPaidEndpoint('http://localhost:3000/api/market-data', {
        recipientAddress: '0x34Ce9F30Af643445c4b5499F184809cEdF9A273f',
        amount: 1000,
        purpose: 'market data access',
        senderAddress: '0xe23C9960A9B106f1C48C84D44f16b8bEAf3bD2c6',
    })
    console.log('Paid endpoint result:', result)
}

async function testAddEmployee() {
    const result = await fastr.addEmployee({
        name: 'Demo Employee',
        email: 'employee@example.test',
        salary: 1200,
        bankAccount: {
            countryCode: 'US',
            currency: 'USD',
            paymentRail: 'ACH',
            bankName: 'Demo Bank',
            accountLast4: '6789',
            details: {
                accountHolderName: 'Demo Employee',
                accountNumber: '000123456789',
                bankCode: '011000015',
            },
        },
    })
    console.log('Added demo employee:', result.employee.id)
}

testAddEmployee().catch(console.error)
