import * as StellarSdk from '@stellar/stellar-sdk';
import { ChainPoller } from '../poller/ChainPoller';
import { ExecutionQueue } from '../queue/ExecutionQueue';
import { PaymentExecutor } from '../executor/PaymentExecutor';
import { RetryHandler } from '../executor/RetryHandler';
import { ExecutionLogger } from '../logger/ExecutionLogger';
import { SchedulerMetrics } from '../metrics/SchedulerMetrics';
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
  metrics: SchedulerMetrics;
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
  private readonly metrics: SchedulerMetrics;
  private readonly operatorKeypair: StellarSdk.Keypair;
  private readonly pollIntervalMs: number;

  private running: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private retryTimers: Set<NodeJS.Timeout> = new Set();
  /** Schedules being executed or waiting on a retry. Never picked up twice. */
  private inFlight: Set<string> = new Set();

  constructor(deps: SchedulerEngineDeps) {
    this.poller = deps.poller;
    this.queue = deps.queue;
    this.executor = deps.executor;
    this.retryHandler = deps.retryHandler;
    this.logger = deps.logger;
    this.metrics = deps.metrics;
    this.operatorKeypair = deps.operatorKeypair;
    this.pollIntervalMs = deps.pollIntervalMs;
  }

  /** Start the scheduler daemon. Runs the first cycle immediately. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextCycle(0);
  }

  /** Gracefully stop the scheduler daemon, cancel pending retries, and clear the queue. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.retryTimers.forEach((t) => clearTimeout(t));
    this.retryTimers.clear();
    this.inFlight.clear();
    this.queue.clear();
  }

  /** Return true if the schedule is currently executing or waiting on a retry. */
  isInFlight(scheduleId: string): boolean {
    return this.inFlight.has(scheduleId);
  }

  /** Execute one full poll → enqueue → dequeue → execute cycle. */
  async runCycle(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    const dueSchedules = await this.poller.fetchDueSchedules(now);
    dueSchedules
      .filter((s) => !this.inFlight.has(s.scheduleId))
      .forEach((s) => this.queue.enqueue(s));

    const toExecute = this.queue.dequeueDue(now);
    toExecute.forEach((s) => this.inFlight.add(s.scheduleId));

    await Promise.allSettled(
      toExecute.map((schedule) => this.executeSchedule(schedule))
    );

    this.metrics.recordCycle(now);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Execute a single scheduled payment with retry on failure. */
  private async executeSchedule(schedule: Schedule): Promise<void> {
    try {
      const tx = await this.executor.buildTransaction(schedule, this.operatorKeypair);
      const signed = this.executor.signTransaction(tx, this.operatorKeypair);
      const result = await this.executor.submitTransaction(signed);
      const outcome = this.executor.handleSubmissionResult(result);
      const timestamp = Math.floor(Date.now() / 1000);

      if (outcome === 'success') {
        this.metrics.recordSuccess();
        this.logger.logSuccess(schedule.scheduleId, result.hash, timestamp);
      } else {
        this.metrics.recordFailure();
        this.logger.logFailure(
          schedule.scheduleId,
          new Error(`transaction ${result.hash} failed on-chain`),
          timestamp
        );
      }
      this.release(schedule.scheduleId);
    } catch (err) {
      this.handleExecutionError(schedule, err);
    }
  }

  /** Handle a failed execution — retry if eligible, otherwise log as failed. */
  private handleExecutionError(schedule: Schedule, err: unknown): void {
    const error = this.executor.classifyError(err);
    const timestamp = Math.floor(Date.now() / 1000);

    // Local clock ran ahead of ledger time; the next cycle will pick it up again
    if (error.code === 'NOT_DUE') {
      this.release(schedule.scheduleId);
      return;
    }

    const canRetry =
      this.retryHandler.shouldRetry(error) &&
      !this.retryHandler.hasExceededMaxRetries(schedule.scheduleId);

    if (canRetry) {
      this.retryHandler.incrementAttempt(schedule.scheduleId);
      const attempt = this.retryHandler.getAttemptCount(schedule.scheduleId);
      this.metrics.recordRetry();
      this.logger.logRetry(schedule.scheduleId, attempt, timestamp);
      this.scheduleRetry(schedule, attempt);
    } else {
      this.metrics.recordFailure();
      this.logger.logFailure(schedule.scheduleId, new Error(error.message), timestamp);
      this.release(schedule.scheduleId);
    }
  }

  /** Schedule a retry for a failed payment after exponential backoff delay. */
  private scheduleRetry(schedule: Schedule, attemptNumber: number): void {
    const delay = this.retryHandler.getNextRetryDelayMs(attemptNumber);
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      if (this.running) {
        void this.executeSchedule(schedule);
      }
    }, delay);
    this.retryTimers.add(timer);
  }

  /** Mark a schedule as finished so later cycles can pick it up again. */
  private release(scheduleId: string): void {
    this.retryHandler.resetAttempts(scheduleId);
    this.inFlight.delete(scheduleId);
  }

  /** Schedule the next polling cycle. A failed cycle is logged and never stops the loop. */
  private scheduleNextCycle(delayMs: number = this.pollIntervalMs): void {
    if (!this.running) return;

    this.timer = setTimeout(async () => {
      try {
        await this.runCycle();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.logCycleError(error, Math.floor(Date.now() / 1000));
      }
      this.scheduleNextCycle();
    }, delayMs);
  }
}
