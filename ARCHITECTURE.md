# Architecture — velox-scheduler

This document describes the architectural design of the `velox-scheduler` repository: the off-chain execution daemon of the Velox protocol.

---

## Overview

`velox-scheduler` is a stateless, event-driven daemon written in TypeScript. It runs continuously, polling the Stellar network for payment obligations that are due, and submitting the corresponding on-chain transactions.

The architecture is deliberately modular. Each module has a single responsibility and communicates through well-defined interfaces. This makes every module independently testable and replaceable without touching the rest of the system.

---

## System Context

```
┌──────────────────────────────────────────────────────────────┐
│                        velox-scheduler                        │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │                  SchedulerEngine                     │   │
│   │  (orchestrates the full poll → execute → log cycle) │   │
│   └────────┬──────────────┬──────────────────────────────┘   │
│            │              │                                  │
│   ┌────────▼───┐   ┌──────▼────────┐   ┌────────────────┐   │
│   │ChainPoller │   │ExecutionQueue │   │ExecutionLogger │   │
│   └────────┬───┘   └──────┬────────┘   └────────────────┘   │
│            │              │                                  │
│   ┌────────▼──────────────▼──────┐   ┌────────────────────┐ │
│   │       PaymentExecutor        │   │    RetryHandler    │ │
│   └──────────────────────────────┘   └────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
  Stellar Horizon RPC      VeloxRegistry (on-chain)
```

---

## Module Map

```
velox-scheduler/src/
│
├── engine/
│   └── SchedulerEngine.ts      # Main loop orchestrator
│
├── poller/
│   └── ChainPoller.ts          # Reads on-chain state
│
├── queue/
│   └── ExecutionQueue.ts       # Priority queue of due payments
│
├── executor/
│   ├── PaymentExecutor.ts      # Builds and submits transactions
│   └── RetryHandler.ts         # Retry logic with exponential backoff
│
├── logger/
│   └── ExecutionLogger.ts      # Structured audit logging
│
├── types/
│   └── index.ts                # Shared TypeScript interfaces
│
└── index.ts                    # Entry point — boots SchedulerEngine
```

---

## Module Responsibilities

### SchedulerEngine

**Responsibility:** Orchestrate the full execution cycle. Nothing more.

`SchedulerEngine` is the conductor. It calls each module in the correct order and passes results between them. It contains no business logic of its own.

```
SchedulerEngine.run_cycle():
  1. ChainPoller.fetch_due_schedules(now)        → Schedule[]
  2. ExecutionQueue.enqueue(schedules)
  3. ExecutionQueue.dequeue_due(now)             → Schedule[]
  4. For each schedule:
       PaymentExecutor.build_transaction(schedule)   → Transaction
       PaymentExecutor.sign_transaction(tx, keypair) → SignedTx
       PaymentExecutor.submit_transaction(signedTx)  → Result
       ExecutionLogger.log_success | log_failure(result)
  5. Sleep(POLL_INTERVAL_MS)
  6. Repeat
```

The engine does not know how polling works, how transactions are built, or how retries are handled. It only knows the sequence.

---

### ChainPoller

**Responsibility:** Read state from the Stellar network. Never write.

`ChainPoller` is the eyes of the scheduler. It queries `VeloxRegistry` and individual contract state via Stellar's Horizon and Soroban RPC endpoints.

- `fetchDueSchedules(currentTime: number): Promise<Schedule[]>`
- `fetchStreamStatus(streamId: string): Promise<StreamStatus>`
- `fetchRegistrySnapshot(): Promise<Schedule[]>`

It returns plain data objects. It has no knowledge of queues, executors, or loggers.

**Interface contract:**

```typescript
interface IChainPoller {
  fetchDueSchedules(currentTime: number): Promise<Schedule[]>
  fetchStreamStatus(streamId: string): Promise<StreamStatus>
  fetchRegistrySnapshot(): Promise<Schedule[]>
}
```

This interface allows the real Horizon-backed implementation to be swapped with a mock in tests.

---

### ExecutionQueue

**Responsibility:** Maintain an ordered queue of upcoming payments sorted by execution time.

`ExecutionQueue` is a min-heap priority queue. The schedule with the earliest `nextPaymentTime` is always at the front.

- `enqueue(schedule: Schedule): void`
- `dequeueDue(currentTime: number): Schedule[]`
- `peekNext(): Schedule | null`
- `clear(): void`

It has no knowledge of the network, transactions, or logging. It is a pure data structure.

```
Queue state (sorted by nextPaymentTime):
  [ Schedule(t=1000), Schedule(t=1500), Schedule(t=2000) ]

dequeueDue(now=1600):
  → returns [ Schedule(t=1000), Schedule(t=1500) ]
  → queue is now [ Schedule(t=2000) ]
```

---

### PaymentExecutor

**Responsibility:** Build, sign, and submit a single Stellar transaction for a due payment.

`PaymentExecutor` is the hands of the scheduler. It interacts with the Stellar SDK and Horizon RPC to construct and submit transactions.

- `buildTransaction(schedule: Schedule): Promise<Transaction>`
- `signTransaction(tx: Transaction, keypair: Keypair): SignedTransaction`
- `submitTransaction(signedTx: SignedTransaction): Promise<SubmissionResult>`
- `handleSubmissionResult(result: SubmissionResult): ExecutionOutcome`

Each method does exactly one step of the submission pipeline. They are composable and independently testable.

```
buildTransaction()
    │
    ▼
signTransaction()
    │
    ▼
submitTransaction()
    │
    ▼
handleSubmissionResult()
```

---

### RetryHandler

**Responsibility:** Decide whether and when to retry a failed transaction submission.

`RetryHandler` encapsulates all retry logic. It uses exponential backoff with a configurable maximum attempt count.

- `shouldRetry(error: SubmissionError): boolean`
- `getNextRetryTime(attemptNumber: number): number`
- `incrementAttempt(scheduleId: string): void`
- `hasExceededMaxRetries(scheduleId: string): boolean`
- `resetAttempts(scheduleId: string): void`

**Retry decision logic:**

```
Error type           → Retryable?
─────────────────────────────────
Network timeout      → Yes
Rate limit (429)     → Yes
Sequence mismatch    → Yes (rebuild tx)
Insufficient funds   → No
Contract error       → No
```

**Backoff formula:**

```
delay = BASE_DELAY_MS * (2 ^ attemptNumber)
max_delay = 60_000ms (1 minute cap)
```

---

### ExecutionLogger

**Responsibility:** Record every execution event with structured, queryable context.

`ExecutionLogger` writes structured JSON logs using Winston. Every payment attempt — success or failure — is recorded with enough context to reconstruct what happened.

- `logSuccess(scheduleId: string, txHash: string, timestamp: number): void`
- `logFailure(scheduleId: string, error: Error, timestamp: number): void`
- `logRetry(scheduleId: string, attemptNumber: number, timestamp: number): void`
- `getExecutionHistory(scheduleId: string): ExecutionRecord[]`

**Log format (JSON):**

```json
{
  "level": "info",
  "event": "payment_success",
  "scheduleId": "abc123",
  "txHash": "0x...",
  "timestamp": 1720000000,
  "network": "testnet"
}
```

---

## Data Flow: Full Execution Cycle

```
┌─────────────────────────────────────────────────────┐
│  Every POLL_INTERVAL_MS milliseconds:               │
│                                                     │
│  1. ChainPoller fetches due schedules from chain    │
│  2. Schedules are enqueued in ExecutionQueue        │
│  3. Due schedules are dequeued                      │
│  4. For each due schedule:                          │
│     a. PaymentExecutor builds the transaction       │
│     b. Transaction is signed with operator keypair  │
│     c. Transaction is submitted to Horizon          │
│     d. On success → ExecutionLogger.logSuccess()   │
│     e. On failure → RetryHandler.shouldRetry()?    │
│        - Yes → schedule re-enqueue with backoff    │
│        - No  → ExecutionLogger.logFailure()        │
└─────────────────────────────────────────────────────┘
```

---

## Interface-Driven Design

Every module is defined by a TypeScript interface before it is implemented. This enforces the Dependency Inversion Principle and makes mocking trivial in tests.

```typescript
// SchedulerEngine depends on abstractions, not implementations
class SchedulerEngine {
  constructor(
    private poller: IChainPoller,
    private queue: IExecutionQueue,
    private executor: IPaymentExecutor,
    private retryHandler: IRetryHandler,
    private logger: IExecutionLogger
  ) {}
}
```

In tests, each dependency is replaced with a mock. The engine's logic is tested in complete isolation from the network, the queue, and the logger.

---

## Configuration

All runtime configuration is injected via environment variables. No hardcoded values anywhere in the codebase.

| Variable | Description | Default |
|----------|-------------|---------|
| `STELLAR_NETWORK` | `testnet` or `mainnet` | `testnet` |
| `HORIZON_URL` | Horizon RPC endpoint | testnet URL |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint | testnet URL |
| `OPERATOR_SECRET_KEY` | Signing keypair secret | required |
| `POLL_INTERVAL_MS` | Milliseconds between cycles | `10000` |
| `MAX_RETRY_ATTEMPTS` | Max retries per schedule | `3` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |

---

## Testing Strategy

Following strict TDD — every module's tests are written before its implementation.

| Module | Test approach |
|--------|--------------|
| `SchedulerEngine` | Full cycle tested with all mocked dependencies |
| `ChainPoller` | Mocked Horizon/RPC responses |
| `ExecutionQueue` | Pure unit tests — no external dependencies |
| `PaymentExecutor` | Mocked SDK and Horizon submission |
| `RetryHandler` | Pure unit tests — deterministic backoff math |
| `ExecutionLogger` | Output format and field validation |

Target coverage: **95%+**

---

## Error Handling Philosophy

- No silent failures — every error is caught, logged, and handled
- Errors are categorised: retryable vs. terminal
- The scheduler never crashes on a single payment failure — it logs, retries or skips, and continues
- Unhandled exceptions at the engine level are caught, logged as fatal, and trigger a graceful restart

---

## Statelessness

`velox-scheduler` is intentionally stateless between restarts. All source-of-truth data lives on-chain in `VeloxRegistry`. On startup, the scheduler rebuilds its execution queue from the current chain state.

This means:
- Multiple scheduler instances can run in parallel (operators can self-host)
- Restarts have no data loss risk
- No database required

---

> One module, one job. One method, one action. The scheduler is reliable because it is simple.
