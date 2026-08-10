import { SubmissionError } from '../types';

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

/**
 * RetryHandler — decides whether and when to retry a failed submission.
 *
 * Uses exponential backoff with a configurable max attempt ceiling.
 * This is a pure logic module with no network or logging dependencies.
 */
export class RetryHandler {
  private attempts: Map<string, number> = new Map();
  private readonly maxAttempts: number;

  constructor(maxAttempts: number = 3) {
    this.maxAttempts = maxAttempts;
  }

  /** Return true if the given error type is worth retrying. */
  shouldRetry(error: SubmissionError): boolean {
    return error.retryable;
  }

  /** Return the delay in ms before the next retry attempt. */
  getNextRetryDelayMs(attemptNumber: number): number {
    const delay = BASE_DELAY_MS * Math.pow(2, attemptNumber);
    return Math.min(delay, MAX_DELAY_MS);
  }

  /** Increment the attempt counter for a given schedule. */
  incrementAttempt(scheduleId: string): void {
    const current = this.attempts.get(scheduleId) ?? 0;
    this.attempts.set(scheduleId, current + 1);
  }

  /** Return true if the schedule has reached or exceeded the max retry limit. */
  hasExceededMaxRetries(scheduleId: string): boolean {
    return (this.attempts.get(scheduleId) ?? 0) >= this.maxAttempts;
  }

  /** Return the current attempt count for a schedule. */
  getAttemptCount(scheduleId: string): number {
    return this.attempts.get(scheduleId) ?? 0;
  }

  /** Reset the attempt counter for a schedule (called on success). */
  resetAttempts(scheduleId: string): void {
    this.attempts.delete(scheduleId);
  }
}
