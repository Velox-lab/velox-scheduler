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
  private readonly random: () => number;

  /**
   * @param random Source of randomness for jitter, injectable so tests can use
   * a deterministic sequence instead of Math.random.
   */
  constructor(maxAttempts: number = 3, random: () => number = Math.random) {
    this.maxAttempts = maxAttempts;
    this.random = random;
  }

  /** Return true if the given error type is worth retrying. */
  shouldRetry(error: SubmissionError): boolean {
    return error.retryable;
  }

  /**
   * Return the delay in ms before the next retry attempt: exponential backoff
   * (capped at MAX_DELAY_MS) with "equal jitter" — half the capped delay, plus
   * a random amount up to the other half. Without jitter, many payments that
   * fail together (e.g. an RPC outage) would all retry at the exact same
   * moment; equal jitter spreads them out while still guaranteeing at least
   * half the backoff has elapsed, unlike full jitter which can retry
   * immediately.
   */
  getNextRetryDelayMs(attemptNumber: number): number {
    const cappedDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attemptNumber), MAX_DELAY_MS);
    const half = cappedDelay / 2;
    return Math.floor(half + this.random() * half);
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
