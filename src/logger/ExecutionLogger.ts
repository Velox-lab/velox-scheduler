import winston from 'winston';
import { ExecutionRecord, ExecutionOutcome } from '../types';

/**
 * ExecutionLogger — structured audit logger for all payment execution events.
 *
 * Every payment attempt (success, failure, retry) is recorded with
 * enough context to reconstruct exactly what happened and when.
 */
export class ExecutionLogger {
  private logger: winston.Logger;
  private history: Map<string, ExecutionRecord[]> = new Map();

  constructor(logLevel: string = 'info') {
    this.logger = winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [new winston.transports.Console()],
    });
  }

  /** Log a successful payment execution. */
  logSuccess(scheduleId: string, txHash: string, timestamp: number): void {
    const record: ExecutionRecord = {
      scheduleId,
      outcome: 'success',
      txHash,
      attemptNumber: this.getAttemptCount(scheduleId),
      timestamp,
    };

    this.logger.info({
      event: 'payment_success',
      scheduleId,
      txHash,
      timestamp,
    });

    this.appendToHistory(scheduleId, record);
  }

  /** Log a failed payment execution. */
  logFailure(scheduleId: string, error: Error, timestamp: number): void {
    const record: ExecutionRecord = {
      scheduleId,
      outcome: 'failed',
      errorMessage: error.message,
      attemptNumber: this.getAttemptCount(scheduleId),
      timestamp,
    };

    this.logger.error({
      event: 'payment_failed',
      scheduleId,
      error: error.message,
      timestamp,
    });

    this.appendToHistory(scheduleId, record);
  }

  /** Log a payment retry attempt. */
  logRetry(scheduleId: string, attemptNumber: number, timestamp: number): void {
    const record: ExecutionRecord = {
      scheduleId,
      outcome: 'retry',
      attemptNumber,
      timestamp,
    };

    this.logger.warn({
      event: 'payment_retry',
      scheduleId,
      attemptNumber,
      timestamp,
    });

    this.appendToHistory(scheduleId, record);
  }

  /** Return the full execution history for a given schedule. */
  getExecutionHistory(scheduleId: string): ExecutionRecord[] {
    return this.history.get(scheduleId) ?? [];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private appendToHistory(scheduleId: string, record: ExecutionRecord): void {
    const existing = this.history.get(scheduleId) ?? [];
    this.history.set(scheduleId, [...existing, record]);
  }

  private getAttemptCount(scheduleId: string): number {
    return (this.history.get(scheduleId) ?? []).length + 1;
  }
}
