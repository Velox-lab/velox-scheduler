import { RetryHandler } from '../../src/executor/RetryHandler';
import { SubmissionError } from '../../src/types';

function retryableError(): SubmissionError {
  return { code: 'NETWORK_ERROR', message: 'timeout', retryable: true };
}

function terminalError(): SubmissionError {
  return { code: 'INSUFFICIENT_FUNDS', message: 'not enough funds', retryable: false };
}

describe('RetryHandler', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler(3);
  });

  describe('shouldRetry', () => {
    it('returns true for retryable errors', () => {
      expect(handler.shouldRetry(retryableError())).toBe(true);
    });

    it('returns false for terminal errors', () => {
      expect(handler.shouldRetry(terminalError())).toBe(false);
    });
  });

  describe('getNextRetryDelayMs', () => {
    it('returns half the capped exponential delay when random returns 0', () => {
      const deterministic = new RetryHandler(3, () => 0);
      expect(deterministic.getNextRetryDelayMs(0)).toBe(1000); // half of 2000
      expect(deterministic.getNextRetryDelayMs(1)).toBe(2000); // half of 4000
      expect(deterministic.getNextRetryDelayMs(2)).toBe(4000); // half of 8000
    });

    it('returns the full capped exponential delay when random returns 1', () => {
      const deterministic = new RetryHandler(3, () => 1);
      expect(deterministic.getNextRetryDelayMs(0)).toBe(2000);
      expect(deterministic.getNextRetryDelayMs(1)).toBe(4000);
      expect(deterministic.getNextRetryDelayMs(2)).toBe(8000);
    });

    it('never exceeds the 60000ms cap, even at high attempt numbers with maximal jitter', () => {
      const deterministic = new RetryHandler(3, () => 1);
      expect(deterministic.getNextRetryDelayMs(10)).toBe(60000);
      expect(deterministic.getNextRetryDelayMs(20)).toBe(60000);
    });

    it('never returns less than half the capped delay, even with minimal jitter', () => {
      const deterministic = new RetryHandler(3, () => 0);
      expect(deterministic.getNextRetryDelayMs(10)).toBe(30000); // half of the 60000 cap
    });

    it('varies the delay between calls for the same attempt number', () => {
      const random = jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(1);
      const deterministic = new RetryHandler(3, random);

      const first = deterministic.getNextRetryDelayMs(2);
      const second = deterministic.getNextRetryDelayMs(2);

      expect(first).not.toBe(second);
    });

    it('defaults to Math.random when no random source is injected', () => {
      const delay = handler.getNextRetryDelayMs(0);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(2000);
    });
  });

  describe('incrementAttempt / getAttemptCount', () => {
    it('starts at zero for a new schedule', () => {
      expect(handler.getAttemptCount('s1')).toBe(0);
    });

    it('increments the attempt count', () => {
      handler.incrementAttempt('s1');
      handler.incrementAttempt('s1');
      expect(handler.getAttemptCount('s1')).toBe(2);
    });

    it('tracks attempts independently per schedule', () => {
      handler.incrementAttempt('s1');
      handler.incrementAttempt('s1');
      handler.incrementAttempt('s2');

      expect(handler.getAttemptCount('s1')).toBe(2);
      expect(handler.getAttemptCount('s2')).toBe(1);
    });
  });

  describe('hasExceededMaxRetries', () => {
    it('returns false before max attempts are reached', () => {
      handler.incrementAttempt('s1');
      handler.incrementAttempt('s1');
      expect(handler.hasExceededMaxRetries('s1')).toBe(false);
    });

    it('returns true once max attempts are reached', () => {
      handler.incrementAttempt('s1');
      handler.incrementAttempt('s1');
      handler.incrementAttempt('s1');
      expect(handler.hasExceededMaxRetries('s1')).toBe(true);
    });
  });

  describe('resetAttempts', () => {
    it('resets the attempt count to zero', () => {
      handler.incrementAttempt('s1');
      handler.incrementAttempt('s1');
      handler.resetAttempts('s1');
      expect(handler.getAttemptCount('s1')).toBe(0);
    });

    it('does not affect other schedules', () => {
      handler.incrementAttempt('s1');
      handler.incrementAttempt('s2');
      handler.resetAttempts('s1');

      expect(handler.getAttemptCount('s1')).toBe(0);
      expect(handler.getAttemptCount('s2')).toBe(1);
    });
  });
});
