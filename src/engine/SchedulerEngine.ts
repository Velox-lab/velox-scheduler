import * as StellarSdk from '@stellar/stellar-sdk';
import { ChainPoller } from '../poller/ChainPoller';
import { ExecutionQueue } from '../queue/ExecutionQueue';
import { PaymentExecutor } from '../executor/PaymentExecutor';
import { RetryHandler } from '../executor/RetryHandler';
import { ExecutionLogger } from '../logger/ExecutionLogger';
import { Schedule } from '../types';

/**
 * Dependencies injected into SchedulerEngine.
 * Defined as an interface so each can be mocked independently in tests.
 */
export interface SchedulerEngineDeps {
  poller: ChainPoller;
  queue: ExecutionQueue;
  executor: PaymentExecutor;
  retryHandler: RetryHandler;
  logger: ExecutionLogger;
  operatorKeypair: StellarSdk.Keypair;
  pollIntervalMs: number;
}

/**
 * SchedulerEngine — the main loop of the velox-scheduler daemon.
 *
 * Orchestrates the full poll → enqueue → execute → log cycle.
 * Contains no business logic of its own — delegates everything to
 * injected modules. All dependencies are injected via constructor,
 * making this class fully testable without a live network.
 */
export class SchedulerEngine {
  private readonly poller: ChainPoller;
  private readonly queue: ExecutionQueue;
  private readonly executor: PaymentExecutor;
  private readonly retryHandler: RetryHandler;
  private readonly logger: ExecutionLogger;
  private readonly operatorKeypair: StellarSdk.Keypair;
  private readonly pollIntervalMs: number;

  private running: boolean = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: SchedulerEngineDeps) {
    this.poller = deps.poller;
    this.queue = deps.queue;
    this.executor = deps.executor;
    this.retryHandler = deps.retryHandler;
    this.logger = deps.logger;
    this.operatorKeypair = deps.operatorKeypair;
    this.pollIntervalMs = deps.pollIntervalMs;
  }

  /** Start the scheduler daemon. Begins the polling loop immediately. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextCycle();
  }

  /** Gracefully stop the scheduler daemon and clear the queue. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue.clear();
  }

  /** Execute one full poll → enqueue → dequeue → execute cycle. */
  async runCycle(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    const dueSchedules = await this.poller.fetchDueSchedules(now);
    dueSchedules.forEach((s) => this.queue.enqueue(s));

    const toExecute = this.queue.dequeueDue(now);

    await Promise.allSettled(
      toExecute.map((schedule) => this.executeSchedule(schedule))
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Execute a single scheduled payment with retry on failure. */
  private async executeSchedule(schedule: Schedule): Promise<void> {
    try {
      const tx = await this.executor.buildTransaction(schedule, this.operatorKeypair);
      const signed = this.executor.signTransaction(tx, this.operatorKeypair);
      const result = await this.executor.submitTransaction(signed);
      const outcome = this.executor.handleSubmissionResult(result);

      if (outcome === 'success') {
        this.retryHandler.resetAttempts(schedule.scheduleId);
        this.logger.logSuccess(
          schedule.scheduleId,
          result.hash,
          Math.floor(Date.now() / 1000)
        );
      }
    } catch (err) {
      this.handleExecutionError(schedule, err);
    }
  }

  /** Handle a failed execution — retry if eligible, otherwise log as failed. */
  private handleExecutionError(schedule: Schedule, err: unknown): void {
    const error = this.executor.classifyError(err);
    const timestamp = Math.floor(Date.now() / 1000);

    const canRetry =
      this.retryHandler.shouldRetry(error) &&
      !this.retryHandler.hasExceededMaxRetries(schedule.scheduleId);

    if (canRetry) {
      this.retryHandler.incrementAttempt(schedule.scheduleId);
      const attempt = this.retryHandler.getAttemptCount(schedule.scheduleId);
      this.logger.logRetry(schedule.scheduleId, attempt, timestamp);
      this.scheduleRetry(schedule, attempt);
    } else {
      this.logger.logFailure(schedule.scheduleId, new Error(error.message), timestamp);
    }
  }

  /** Schedule a retry for a failed payment after exponential backoff delay. */
  private scheduleRetry(schedule: Schedule, attemptNumber: number): void {
    const delay = this.retryHandler.getNextRetryDelayMs(attemptNumber);
    setTimeout(() => this.executeSchedule(schedule), delay);
  }

  /** Schedule the next polling cycle after pollIntervalMs. */
  private scheduleNextCycle(): void {
    if (!this.running) return;

    this.timer = setTimeout(async () => {
      await this.runCycle();
      this.scheduleNextCycle();
    }, this.pollIntervalMs);
  }
}
