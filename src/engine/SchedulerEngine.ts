import * as StellarSdk from '@stellar/stellar-sdk';
import { ChainPoller } from '../poller/ChainPoller';
import { ExecutionQueue } from '../queue/ExecutionQueue';
import { PaymentExecutor } from '../executor/PaymentExecutor';
import { RetryHandler } from '../executor/RetryHandler';
import { ExecutionLogger } from '../logger/ExecutionLogger';
import { SchedulerConfig, Schedule } from '../types';

/**
 * SchedulerEngine — the main loop of the velox-scheduler daemon.
 *
 * Orchestrates the full poll → filter → execute → log cycle.
 * Contains no business logic of its own — delegates everything
 * to specialised modules.
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

  constructor(config: SchedulerConfig) {
    this.poller = new ChainPoller(config.horizonUrl, config.registryContractId);
    this.queue = new ExecutionQueue();
    this.executor = new PaymentExecutor(
      config.horizonUrl,
      config.stellarNetwork === 'mainnet'
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET
    );
    this.retryHandler = new RetryHandler(config.maxRetryAttempts);
    this.logger = new ExecutionLogger(config.logLevel);
    this.operatorKeypair = StellarSdk.Keypair.fromSecret(config.operatorSecretKey);
    this.pollIntervalMs = config.pollIntervalMs;
  }

  /** Start the scheduler daemon. Begins polling immediately. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextCycle();
  }

  /** Gracefully stop the scheduler daemon. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue.clear();
  }

  /** Execute one full poll → enqueue → execute → log cycle. */
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

  /** Execute a single scheduled payment with retry and logging. */
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
      const error = this.executor.classifyError(err);
      const timestamp = Math.floor(Date.now() / 1000);

      if (
        this.retryHandler.shouldRetry(error) &&
        !this.retryHandler.hasExceededMaxRetries(schedule.scheduleId)
      ) {
        this.retryHandler.incrementAttempt(schedule.scheduleId);
        const attempt = this.retryHandler.getAttemptCount(schedule.scheduleId);
        this.logger.logRetry(schedule.scheduleId, attempt, timestamp);

        const delay = this.retryHandler.getNextRetryDelayMs(attempt);
        setTimeout(() => this.executeSchedule(schedule), delay);
      } else {
        this.logger.logFailure(
          schedule.scheduleId,
          new Error(error.message),
          timestamp
        );
      }
    }
  }

  /** Schedule the next cycle after pollIntervalMs. */
  private scheduleNextCycle(): void {
    if (!this.running) return;

    this.timer = setTimeout(async () => {
      await this.runCycle();
      this.scheduleNextCycle();
    }, this.pollIntervalMs);
  }
}
