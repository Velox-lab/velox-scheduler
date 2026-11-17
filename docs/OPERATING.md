# Operator Guide

This covers what the README's Configure section doesn't: how to actually get
`velox-scheduler` running against a real network, as an operator rather than
a contributor running the test suite.

## 1. Create and fund the operator account

The operator account is the Stellar keypair the daemon signs every
`execute_payment` transaction with. It needs a small XLM balance to pay
transaction fees — it never holds or moves the money being streamed itself;
that moves directly between sender and recipient via the token's
`transfer_from`.

```bash
stellar keys generate velox-operator
stellar keys fund velox-operator --network testnet   # testnet only
```

`stellar keys fund` only works on test networks. For mainnet, send the
account some XLM yourself before starting the daemon. Either way, put its
secret key in `.env` as `OPERATOR_SECRET_KEY`. Treat it like any other
hot wallet: it can submit transactions on its own authority for
`execute_payment` (that call is permissionless by design — see
ARCHITECTURE.md), so don't fund it with more than you're comfortable
having drained if the host running the daemon is compromised.

## 2. Find the VeloxRegistry contract ID

`REGISTRY_CONTRACT_ID` in `.env` is `VeloxRegistry`'s address from the
`velox-contracts` deployment you're pointing at. If you deployed it
yourself, this is in the `deployed.<network>.env` file that
[`velox-contracts/scripts/deploy.sh`](https://github.com/Velox-lab/velox-contracts/blob/main/DEPLOYMENT.md)
writes out. If you're running against an existing deployment (e.g. the
project's own testnet instance), get the address from whoever maintains
it — it isn't hardcoded anywhere in this repo, deliberately, since the
scheduler is meant to work against any Velox deployment.

## 3. Choose an RPC provider

`SOROBAN_RPC_URL` points at the Soroban RPC endpoint the scheduler polls
and submits transactions through.

- **Testnet**: `https://soroban-testnet.stellar.org` (the value already in
  `.env.example`) is the public endpoint and fine for testing.
- **Mainnet**: the public endpoint has stricter rate limits than a daemon
  polling every `POLL_INTERVAL_MS` can comfortably live within for long.
  Use a dedicated RPC provider instead. This repo doesn't recommend a
  specific one; pick one that fits your operational needs (latency,
  reliability, rate limits) and keep an eye on `cycle_failed` log events
  (see below) for signs you're being throttled.

## 4. Run in production

Two straightforward options, in order of how much this repo directly
supports them:

**Docker** (see the README's "Run with Docker" section): build the image
once, then `docker compose up -d` with your `.env` in place. Restarts on
crash via `restart: unless-stopped` in `docker-compose.yml`. This is the
path most directly covered by what's in this repo.

**A process manager** (pm2, systemd, etc.) running `npm run build` once
and then `node dist/index.js` (or `npm start`) directly on the host. Give
it the same restart-on-crash behavior Docker gets for free — nothing in
the scheduler itself retries a full process crash, only individual
payment executions within a running process (see `RetryHandler`).

Either way, the daemon exits non-zero on a genuinely fatal startup error
(e.g. missing required `.env` values) rather than looping forever in a
broken state, so a restart policy that backs off on repeated crashes
(rather than hot-looping) is worth configuring.

## 5. Reading the logs

Logs are structured JSON via `winston` (`LOG_LEVEL` in `.env` controls
verbosity). Each line has an `event` field:

| Event | Level | Meaning |
|-------|-------|---------|
| `payment_success` | info | A scheduled payment executed and landed on-chain. |
| `payment_failed` | error | A payment failed and either wasn't retryable or exhausted its retries. |
| `payment_retry` | warn | A payment failed with a retryable error and will retry after backoff. |
| `cycle_failed` | error | An entire poll cycle failed before any payment was attempted (e.g. the RPC endpoint was unreachable). The next cycle still runs; this isn't fatal. |
| `schedule_read_failed` | warn | One schedule's on-chain state couldn't be read; it's skipped for that cycle, the rest of the registry snapshot still loads. |
| `ledger_time_fallback` | warn | Ledger close time couldn't be fetched for a cycle; the local clock was used instead for that cycle only. |
| `schedule_underfunded` | warn | A due schedule was skipped because the sender's token allowance or balance can't currently cover the payment (see the next section). |

`/health` and `/metrics` (on `METRICS_PORT`) give the same picture without
grepping logs — `/health` is a simple up/down check tied to how recently a
cycle completed, `/metrics` has the running counts behind each event above.

## Senders must approve each schedule on the token

`RecurringPayment` pulls each payment from the sender via the token's
`transfer_from`, which only works if the sender has `approve`d that
specific schedule contract as a spender. This is the sender's
responsibility, not the scheduler's or the operator's — `velox-frontend`'s
`createRecurringPayment` handles the approval automatically when a sender
creates a schedule through it, but a schedule created any other way (direct
contract call, a different frontend) needs that approval done separately or
every `execute_payment` call will fail with an allowance error. The
scheduler detects this ahead of time (`schedule_underfunded`, above) and
skips the schedule rather than wasting a submission on it, but it has no
way to fix the allowance itself.

## Testnet vs mainnet

- `STELLAR_NETWORK` and `SOROBAN_RPC_URL` must agree — pointing `STELLAR_NETWORK=mainnet`
  at a testnet RPC URL (or vice versa) will fail every transaction with a
  network-passphrase mismatch.
- `stellar keys fund` (step 1) only works on testnet; fund the mainnet
  operator account yourself.
- Mainnet transaction fees are real money, flowing from the operator
  account, not from senders or recipients. Budget for it — the
  operator pays a base fee per `execute_payment` call regardless of the
  streamed amount.
- Use a dedicated RPC provider on mainnet (step 3); the public endpoint
  is not meant for sustained polling traffic.
