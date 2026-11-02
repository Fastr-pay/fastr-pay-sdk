# fastr-pay-sdk

Node.js client for the Fastr Pay API — stablecoin settlement infrastructure
for creating hosted payment links, running agent-authorized payments and payroll,
and off-ramping to a bank account.

---

## Installation

```bash
npm install fastr-pay-sdk
```

---

## Quick start

```javascript
const { FastrPay } = require("fastr-pay-sdk");

const fastr = new FastrPay({
  apiKey: "fpk_your_api_key",
  baseUrl: "https://api.fastrpay.com", // or your own deployment
});

const link = await fastr.createPaymentLink({
  payeeWalletAddress: "0x...",
  amount: 100,
  currency: "INR",
  purpose: "order #1234",
});

console.log(link.paymentUrl); // Share this hosted checkout with your customer.
```

---

## Configuration

| Option      | Type   | Default                 | Description                     |
| ----------- | ------ | ----------------------- | ------------------------------- |
| `apiKey`    | string | required                | Your business API key           |
| `baseUrl`   | string | `http://localhost:3000` | Fastr Pay API base URL          |
| `timeoutMs` | number | `60000`                 | Request timeout in milliseconds |

---

## Error handling

Every failed call throws a typed error extending `FastrPayError`, so you can
branch on the specific failure instead of parsing message strings:

```javascript
const {
  FastrPay,
  WalletNotAuthorizedError,
  FastrPayValidationError,
} = require("fastr-pay-sdk");

try {
  await fastr.createPaymentLink({
    payeeWalletAddress,
    amount: 100,
    currency: "INR",
    purpose: "order #1234",
  });
} catch (err) {
  if (err instanceof FastrPayValidationError) {
    // A required field was missing or had the wrong type.
  } else {
    console.error(err.code, err.status, err.message);
  }
}
```

| Error class                  | Meaning                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `FastrPayValidationError`    | A bad argument was caught client-side before any request was sent        |
| `FastrPayNetworkError`       | The server was unreachable, or the request timed out                     |
| `InvalidApiKeyError`         | The API key is missing, invalid, or belongs to a disabled business       |
| `InvalidSignatureError`      | The payment gateway signature failed verification                        |
| `WalletNotAuthorizedError`   | The wallet address in the request doesn't belong to the calling business |
| `InsufficientAllowanceError` | An on-chain token allowance was too low to complete the operation        |
| `DuplicatePaymentError`      | This payment reference has already been processed                        |
| `FastrPayError`              | Base class — thrown for any error without a more specific class          |

Every error carries `code`, `status`, and `details` (the raw response body)
for debugging, regardless of which class it is.

---

## API reference

### Wallets

```javascript
await fastr.createWallet({ ownerLabel: "company treasury" });
await fastr.getWallets();
await fastr.getBalance("company treasury"); // 'company treasury' | 'payroll agent'
```

Every business gets exactly two fixed wallets — `company treasury` and
`payroll agent` — created once at onboarding and reused from then on.

### Hosted payment links

```javascript
const link = await fastr.createPaymentLink({
  payeeWalletAddress,
  amount,
  currency,
  purpose,
});

console.log(link.paymentUrl); // Share this with your customer.
```

The hosted checkout handles customer payment and verification. A business creates
and shares the link; it does not submit the customer's payment proof itself.

### Reusable paywalls

```javascript
const wall = await fastr.createPaywall({
  payeeWalletAddress,
  amount,
  currency,
  purpose,
});
await fastr.collectPaywall(wall.paywallId, {
  orderId,
  paymentId,
  signature,
  method,
});
```

The SDK methods remain authenticated for server-side callers and continue
sending the business API key. Customer-facing Razorpay checkout is handled
by the hosted paywall page, which creates an order and submits Razorpay's
payment proof without exposing the business API key in the browser.

### Recurring card plans

```javascript
const plan = await fastr.createCardPlan({
  name: "Monthly access",
  amount: 10,
  currency: "USD",
  period: "monthly",
});
```

This SDK call uses the business API key and is for trusted server-side code
only. Never bundle the SDK or an API key into a browser app. Browser dashboards
should use the authenticated dashboard session; customers use the returned
public plan ID through the hosted Fastr~Pay checkout page. Razorpay webhooks
confirm recurring payments; a browser checkout callback is not settlement proof.

### Business bank withdrawals (server-side only)

Configure a payout beneficiary from trusted Node.js code using the business API key.
The dashboard cannot add or change bank details; it receives only masked beneficiary
metadata. Keep bank details and the API key out of browser bundles and logs.

```javascript
const beneficiaryResult = await fastr.beneficiaries.create({
  displayName: "Demo EUR account",
  currency: "EUR",
  bankName: "Demo Bank",
  bankDetails: { iban: "DE89370400440532013000" },
});

const quote = await fastr.payouts.quote({
  beneficiaryId: beneficiaryResult.beneficiary.id,
  usdcAmount: "5.00",
});

const created = await fastr.payouts.create({
  quoteToken: quote.quoteToken,
  idempotencyKey: crypto.randomUUID(),
});

const payout = await fastr.payouts.get(created.payout.id);
const history = await fastr.payouts.list();
```

`fastr.payouts.quote()` returns a 60-second FX quote. `create()` submits USDC from
the business treasury to the testnet settlement contract. The mock provider
simulates the fiat leg; no real bank transfer takes place. The adapter can be
replaced only on the backend.

### Employee wallets and payroll

`fastr.addEmployee()` saves the employee record and encrypted bank details,
then provisions a Para EVM wallet. The employee address is returned on the
employee record; Para wallet references and raw bank details stay server-side.
Adding an employee does not send USDC. A payroll run sends each saved salary
in Sepolia USDC from the business payroll-agent wallet to ready employee wallets.

`fastr.fundAgent()` supports USDC only. Amounts are specified in whole USDC
units and converted to six-decimal base units by the SDK.

### Agent payments & payroll

```javascript
await fastr.enableAgent({ maxAmountPerTx: 2000, dailyLimit: 10000 });

const added = await fastr.addEmployee({
  name: "Jane Doe",
  email: "jane@example.test",
  salary: 1200,
  bankAccount: {
    countryCode: "US",
    currency: "USD",
    paymentRail: "ACH",
    bankName: "Demo Bank",
    accountLast4: "6789",
    details: {
      accountHolderName: "Jane Doe",
      accountNumber: "000123456789",
      bankCode: "011000015",
    },
  },
});

// Employee bank details are sent to the backend over HTTPS and encrypted
// before storage. Keep API keys server-side and never log these details.
// Wallet creation is separate from payroll; no funds are sent by addEmployee().

// Reuse the same key only when retrying this exact payroll run.
const runKey = crypto.randomUUID();
const payroll = await fastr.runPayroll(undefined, { idempotencyKey: runKey });
console.log(payroll.results);
```

`salary` is expressed in USDC units (for example, `1200` means 1200 USDC); the backend converts it to six-decimal units. Bank details remain encrypted for future payout rails and are not used for the employee wallet transfer. The payroll-agent wallet must have USDC and an active spending policy before a run can start.

### Pay-per-request (paywall)

```javascript
const result = await fastr.callPaidEndpoint(
  "https://api.example.com/market-data",
  {
    recipientAddress,
    amount: 1,
    purpose: "market data access",
    senderAddress,
  },
);
```

Pays for and calls a paywalled endpoint in one step, returning both the
endpoint's response and a payment receipt.

### Account security

```javascript
await fastr.disableMyAccount();
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
