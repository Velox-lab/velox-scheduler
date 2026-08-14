/**
 * SchedulerMetrics — tracks aggregate execution statistics for the scheduler daemon.
 *
 * Single responsibility: count and expose metrics.
 * No logging, no network calls, no business logic.
 */
export class SchedulerMetrics {
  private successCount: number = 0;
  private failureCount: number = 0;
  private retryCount: number = 0;
  private cycleCount: number = 0;
  private lastCycleTimestamp: number | null = null;

  /** Record a successful payment execution. */
  recordSuccess(): void {
    this.successCount += 1;
  }

  /** Record a failed payment execution. */
  recordFailure(): void {
    this.failureCount += 1;
  }

  /** Record a retry attempt. */
  recordRetry(): void {
    this.retryCount += 1;
  }

  /** Record the completion of one full scheduler cycle. */
  recordCycle(timestamp: number): void {
    this.cycleCount += 1;
    this.lastCycleTimestamp = timestamp;
  }

  /** Return the total number of successful executions. */
  getTotalSuccessCount(): number {
    return this.successCount;
  }

  /** Return the total number of failed executions. */
  getTotalFailureCount(): number {
    return this.failureCount;
  }

  /** Return the total number of retry attempts. */
  getTotalRetryCount(): number {
    return this.retryCount;
  }

  /** Return the total number of cycles completed. */
  getTotalCycleCount(): number {
    return this.cycleCount;
  }

  /** Return the timestamp of the last completed cycle. Null if no cycle has run. */
  getLastCycleTimestamp(): number | null {
    return this.lastCycleTimestamp;
  }

  /** Return the success rate as a value between 0 and 1. Returns 0 if no executions. */
  getSuccessRate(): number {
    const total = this.successCount + this.failureCount;
    if (total === 0) return 0;
    return this.successCount / total;
  }

  /** Reset all metrics to zero. */
  reset(): void {
    this.successCount = 0;
    this.failureCount = 0;
    this.retryCount = 0;
    this.cycleCount = 0;
    this.lastCycleTimestamp = null;
  }
}
