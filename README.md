# velox-scheduler

> Off-chain scheduler daemon that monitors the Stellar network and triggers on-chain payment streams at precisely the right time.

---

## What Is This?

`velox-scheduler` is the execution engine of the Velox protocol. It is a lightweight, reliable daemon that runs off-chain and is responsible for one thing: watching the blockchain for scheduled payment obligations and triggering the corresponding on-chain transactions at the correct time.

Blockchains are stateless by nature — they react to inputs but cannot initiate actions on their own. `velox-scheduler` bridges that gap. It is the heartbeat of recurring payments in the Velox ecosystem.

---

## Why It Exists

Soroban contracts on Stellar cannot schedule themselves. A recurring payment contract knows *when* a payment should happen, but it cannot wake itself up to execute it. Something off-chain must do that.

`velox-scheduler` is that something — purpose-built, tested, and designed to be run by anyone (node operators, DAOs, or individual maintainers) to keep the payment network alive and on time.

---

## How It Works

```
┌──────────────────────────────────────────────────┐
│                 velox-scheduler                  │
│                                                  │
│  1. Poll VeloxRegistry (on-chain) for due jobs   │
│  2. Filter by next_payment_time <= now           │
│  3. Build and sign the Stellar transaction       │
│  4. Submit to Stellar Horizon RPC                │
│  5. Record execution result                      │
│  6. Sleep → Repeat                               │
└──────────────────────────────────────────────────┘
```

The scheduler maintains a local queue of upcoming payments, sorted by execution time, and processes them with precision. It is stateless between restarts — all source-of-truth data lives on-chain.

---

## Core Modules

### `SchedulerEngine`
The main loop. Orchestrates the polling, filtering, execution, and logging cycle.

- `start()` — boots the daemon and begins the main loop
- `stop()` — gracefully shuts down the daemon
- `run_cycle()` — executes one full poll → filter → execute → log cycle

### `ChainPoller`
Reads on-chain state from the Velox contracts via Stellar's Horizon RPC.

- `fetch_due_schedules(current_time)` — returns all schedules where payment is due
- `fetch_stream_status(stream_id)` — checks if a stream is still active
- `fetch_registry_snapshot()` — pulls all registered jobs from `VeloxRegistry`

### `PaymentExecutor`
Builds, signs, and submits Stellar transactions for due payments.

- `build_transaction(schedule)` — constructs the XDR transaction envelope
- `sign_transaction(tx, keypair)` — signs with the operator keypair
- `submit_transaction(signed_tx)` — submits to Horizon and returns result
- `handle_submission_result(result)` — handles success, retry, or failure

### `ExecutionQueue`
An in-memory priority queue of upcoming payments, sorted by execution time.

- `enqueue(schedule)` — adds a schedule to the queue
- `dequeue_due(current_time)` — pops all schedules due at or before now
- `peek_next()` — returns the next due item without removing it
- `clear()` — resets the queue (used on restart)

### `ExecutionLogger`
Records every payment attempt, success, and failure with full context.

- `log_success(schedule_id, tx_hash, timestamp)`
- `log_failure(schedule_id, error, timestamp)`
- `log_retry(schedule_id, attempt_number, timestamp)`
- `get_execution_history(schedule_id)`

### `RetryHandler`
Manages retry logic for failed payment submissions with exponential backoff.

- `should_retry(error)` — determines if an error is retryable
- `get_next_retry_time(attempt_number)` — calculates backoff delay
- `increment_attempt(schedule_id)` — tracks attempt count per schedule
- `has_exceeded_max_retries(schedule_id)` — flags permanently failed jobs

---

## Architecture

```
velox-scheduler
├── SchedulerEngine          ← Main loop orchestrator
│   ├── ChainPoller          ← Reads on-chain state
│   ├── ExecutionQueue       ← Priority queue of due payments
│   ├── PaymentExecutor      ← Builds & submits transactions
│   ├── RetryHandler         ← Handles failures and backoff
│   └── ExecutionLogger      ← Audit trail of all executions
```

---

## Development Principles

### Test-Driven Development (TDD)
Every module is written test-first. The behavior of `ChainPoller`, `PaymentExecutor`, and `RetryHandler` is fully specified in tests before any implementation is written.

```
Write a failing test → Write minimum code to pass → Refactor → Repeat
```

Mocking is used extensively so the scheduler can be tested without a live Stellar node.

### SOLID Principles
- **Single Responsibility** — `ChainPoller` only reads. `PaymentExecutor` only submits. `ExecutionLogger` only logs. No module wears two hats.
- **Open/Closed** — New chain integrations or execution strategies can be added without modifying existing modules.
- **Liskov Substitution** — Any poller implementation can be substituted (e.g., swap Horizon for Soroban RPC) without breaking the engine.
- **Interface Segregation** — Each module exposes only the interface its consumers need.
- **Dependency Inversion** — `SchedulerEngine` depends on abstractions (interfaces), not concrete implementations. This makes testing trivial.

### Clean Code Standards
- Every method name describes exactly what it does
- No method does more than one thing
- No silent failures — every error is logged and handled explicitly
- Configuration is externalised — no hardcoded URLs, keys, or intervals

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| TypeScript | Implementation language |
| Node.js | Runtime |
| `@stellar/stellar-sdk` | Stellar network interaction |
| Jest | Testing framework |
| Winston | Structured logging |
| dotenv | Environment configuration |

---

## Getting Started

### Prerequisites

```bash
node >= 18.0.0
npm >= 9.0.0
```

### Clone & Install

```bash
git clone https://github.com/Velox-lab/velox-scheduler.git
cd velox-scheduler
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
OPERATOR_SECRET_KEY=S...
POLL_INTERVAL_MS=10000
MAX_RETRY_ATTEMPTS=3
LOG_LEVEL=info
```

### Run

```bash
npm run start
```

### Run Tests

```bash
npm test
```

### Run Tests (single pass, no watch)

```bash
npm run test:run
```

---

## Project Structure

```
velox-scheduler/
├── src/
│   ├── engine/
│   │   └── SchedulerEngine.ts
│   ├── poller/
│   │   └── ChainPoller.ts
│   ├── executor/
│   │   ├── PaymentExecutor.ts
│   │   └── RetryHandler.ts
│   ├── queue/
│   │   └── ExecutionQueue.ts
│   ├── logger/
│   │   └── ExecutionLogger.ts
│   ├── types/
│   │   └── index.ts
│   └── index.ts
├── tests/
│   ├── engine/
│   ├── poller/
│   ├── executor/
│   ├── queue/
│   └── logger/
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## Contributing

This repository is part of the **Velox** open-source project on the Stellar ecosystem. Contributions are welcome and rewarded through the Stellar Wave Program.

**Before you contribute:**
1. Read the [Contributing Guide](CONTRIBUTING.md)
2. Check open issues labeled `good first issue` or `help wanted`
3. Follow the TDD workflow — write your test before your implementation
4. Ensure `npm test` passes before submitting a PR
5. One concern per PR — keep it focused

**Good first issues include:**
- Implementing `peek_next` in `ExecutionQueue`
- Writing unit tests for `RetryHandler.get_next_retry_time`
- Adding structured log fields to `ExecutionLogger`
- Implementing the `stop()` method in `SchedulerEngine` with graceful shutdown

---

## Roadmap

- [x] Project scaffold and architecture design
- [ ] `ExecutionQueue` — priority queue implementation
- [ ] `ChainPoller` — Horizon RPC integration
- [ ] `PaymentExecutor` — transaction builder and submitter
- [ ] `RetryHandler` — exponential backoff logic
- [ ] `ExecutionLogger` — structured logging
- [ ] `SchedulerEngine` — main loop
- [ ] Full test coverage (target: 95%+)
- [ ] Docker support
- [ ] Monitoring & alerting integration

---

## License

MIT — free to use, modify, and build upon.

---

> The heartbeat of the Velox protocol. Precise. Reliable. Open.
