# fastr-pay-sdk

Node.js client for the Fastr Pay API — stablecoin settlement infrastructure
for accepting fiat payments, running agent-authorized payments and payroll,
and off-ramping to a bank account.

---

## Installation

```bash
npm install fastr-pay-sdk
```

---

## Quick start

```javascript
const { FastrPay } = require('fastr-pay-sdk')

const fastr = new FastrPay({
    apiKey: 'fpk_your_api_key',
    baseUrl: 'https://api.fastrpay.com', // or your own deployment
})

const result = await fastr.pay({
    payeeWalletAddress: '0x...',
    fiatAmount: 100,
    fiatCurrency: 'INR',
    purpose: 'order #1234',
    orderId: 'order_123',
    paymentId: 'pay_456',
    signature: '...',
    method: 'upi',
})
```

---

## Configuration

| Option      | Type   | Default                  | Description                              |
|-------------|--------|---------------------------|-------------------------------------------|
| `apiKey`    | string | required                  | Your business API key                     |
| `baseUrl`   | string | `http://localhost:3000`   | Fastr Pay API base URL                    |
| `timeoutMs` | number | `60000`                   | Request timeout in milliseconds           |

---

## Error handling

Every failed call throws a typed error extending `FastrPayError`, so you can
branch on the specific failure instead of parsing message strings:

```javascript
const { FastrPay, WalletNotAuthorizedError, FastrPayValidationError } = require('fastr-pay-sdk')

try {
    await fastr.pay({ payeeWalletAddress, fiatAmount, fiatCurrency, orderId, paymentId, signature, method })
} catch (err) {
    if (err instanceof WalletNotAuthorizedError) {
        // payeeWalletAddress doesn't belong to this business
    } else if (err instanceof FastrPayValidationError) {
        // a required field was missing or the wrong type — caught before any request was sent
    } else {
        console.error(err.code, err.status, err.message)
    }
}
```

| Error class                  | Meaning                                                         |
|-------------------------------|------------------------------------------------------------------|
| `FastrPayValidationError`     | A bad argument was caught client-side before any request was sent |
| `FastrPayNetworkError`        | The server was unreachable, or the request timed out             |
| `InvalidApiKeyError`          | The API key is missing, invalid, or belongs to a disabled business |
| `InvalidSignatureError`       | The payment gateway signature failed verification                |
| `WalletNotAuthorizedError`    | The wallet address in the request doesn't belong to the calling business |
| `InsufficientAllowanceError`  | An on-chain token allowance was too low to complete the operation |
| `DuplicatePaymentError`       | This payment reference has already been processed                |
| `FastrPayError`               | Base class — thrown for any error without a more specific class  |

Every error carries `code`, `status`, and `details` (the raw response body)
for debugging, regardless of which class it is.

---

## API reference

### Wallets

```javascript
await fastr.createWallet({ ownerLabel: 'company treasury' })
await fastr.getWallets()
await fastr.getBalance('company treasury') // 'company treasury' | 'payroll agent'
```

Every business gets exactly two fixed wallets — `company treasury` and
`payroll agent` — created once at onboarding and reused from then on.

### Payments in (payin)

```javascript
await fastr.pay({
    payeeWalletAddress, fiatAmount, fiatCurrency, purpose,
    orderId, paymentId, signature, method,
})
```

Settles a verified fiat payment as stablecoin to `payeeWalletAddress`.

### Payment links

```javascript
const link = await fastr.createPaymentLink({ payeeWalletAddress, amount, currency, purpose })
await fastr.fulfillPaymentLink(link.linkId, { orderId, paymentId, signature, method })
```

Generates a shareable link with a fixed amount/currency/destination;
fulfilling it runs the same settlement flow as `pay()`.

### Reusable paywalls

```javascript
const wall = await fastr.createPaywall({ payeeWalletAddress, amount, currency, purpose })
await fastr.collectPaywall(wall.paywallId, { orderId, paymentId, signature, method })
```

The SDK methods remain authenticated for server-side callers and continue
sending the business API key. Customer-facing Razorpay checkout is handled
by the hosted paywall page, which creates an order and submits Razorpay's
payment proof without exposing the business API key in the browser.

### Withdraw (off-ramp to bank)

```javascript
await fastr.withdraw({ receiverId, bankAccountId, amount })
```

Converts on-chain balance held in your treasury into a real bank payout.

### Agent payments & payroll

```javascript
await fastr.enableAgent({ maxAmountPerTx, dailyLimit })
await fastr.setAgentPolicy({ maxAmountPerTx, dailyLimit })
await fastr.revokeAgent()

await fastr.runPayroll([
    { name: 'Jane Doe', blindPayReceiverId, bankAccountId, salary: 1200 },
])
```

`runPayroll()` settles an on-chain payment per worker (capped by your
agent's policy limits) and off-ramps it to their bank account.
Amounts are in whole token units (e.g. `1200` for 1200 USDC) — the SDK
handles decimal conversion internally.

### Pay-per-request (paywall)

```javascript
const result = await fastr.callPaidEndpoint('https://api.example.com/market-data', {
    recipientAddress,
    amount: 1,
    purpose: 'market data access',
    senderAddress,
})
```

Pays for and calls a paywalled endpoint in one step, returning both the
endpoint's response and a payment receipt.

### Account security

```javascript
await fastr.disableMyAccount()
```

Immediately disables your API key — call this the moment you suspect it
has leaked. Only an admin can re-enable it or issue a replacement key.

---

## Notes

- All monetary amounts are passed as whole token/currency units (e.g. `100`
  for ₹100 or 100 USDC) — the SDK converts to the underlying 6-decimal raw
  units where needed.
- Wallet addresses you control (treasury, agent) are never passed as raw
  addresses to the API — they're referenced by `ownerLabel` and resolved
  server-side, so they can't be spoofed or swapped.
- This SDK targets the Fastr Pay testnet deployment (Sepolia / Base Sepolia).
  Mainnet support will follow the same interface.