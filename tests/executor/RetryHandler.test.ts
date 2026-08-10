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
    it('returns 2000ms for attempt 0', () => {
      expect(handler.getNextRetryDelayMs(0)).toBe(2000);
    });

    it('returns 4000ms for attempt 1', () => {
      expect(handler.getNextRetryDelayMs(1)).toBe(4000);
    });

    it('returns 8000ms for attempt 2', () => {
      expect(handler.getNextRetryDelayMs(2)).toBe(8000);
    });

    it('caps delay at 60000ms', () => {
      expect(handler.getNextRetryDelayMs(10)).toBe(60000);
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
