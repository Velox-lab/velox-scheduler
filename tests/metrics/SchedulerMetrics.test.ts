import { SchedulerMetrics } from '../../src/metrics/SchedulerMetrics';

describe('SchedulerMetrics', () => {
  let metrics: SchedulerMetrics;

  beforeEach(() => {
    metrics = new SchedulerMetrics();
  });

  describe('initial state', () => {
    it('starts with all counts at zero', () => {
      expect(metrics.getTotalSuccessCount()).toBe(0);
      expect(metrics.getTotalFailureCount()).toBe(0);
      expect(metrics.getTotalRetryCount()).toBe(0);
      expect(metrics.getTotalCycleCount()).toBe(0);
    });

    it('starts with null lastCycleTimestamp', () => {
      expect(metrics.getLastCycleTimestamp()).toBeNull();
    });

    it('starts with success rate of zero', () => {
      expect(metrics.getSuccessRate()).toBe(0);
    });
  });

  describe('recordSuccess', () => {
    it('increments success count', () => {
      metrics.recordSuccess();
      metrics.recordSuccess();
      expect(metrics.getTotalSuccessCount()).toBe(2);
    });
  });

  describe('recordFailure', () => {
    it('increments failure count', () => {
      metrics.recordFailure();
      expect(metrics.getTotalFailureCount()).toBe(1);
    });
  });

  describe('recordRetry', () => {
    it('increments retry count', () => {
      metrics.recordRetry();
      metrics.recordRetry();
      metrics.recordRetry();
      expect(metrics.getTotalRetryCount()).toBe(3);
    });
  });

  describe('recordCycle', () => {
    it('increments cycle count', () => {
      metrics.recordCycle(1000);
      metrics.recordCycle(2000);
      expect(metrics.getTotalCycleCount()).toBe(2);
    });

    it('updates lastCycleTimestamp to the most recent value', () => {
      metrics.recordCycle(1000);
      metrics.recordCycle(2000);
      expect(metrics.getLastCycleTimestamp()).toBe(2000);
    });
  });

  describe('getSuccessRate', () => {
    it('returns 1 when all executions succeeded', () => {
      metrics.recordSuccess();
      metrics.recordSuccess();
      expect(metrics.getSuccessRate()).toBe(1);
    });

    it('returns 0.5 when half succeeded and half failed', () => {
      metrics.recordSuccess();
      metrics.recordFailure();
      expect(metrics.getSuccessRate()).toBe(0.5);
    });

    it('returns 0 when all executions failed', () => {
      metrics.recordFailure();
      metrics.recordFailure();
      expect(metrics.getSuccessRate()).toBe(0);
    });

    it('returns 0 when there are no executions', () => {
      expect(metrics.getSuccessRate()).toBe(0);
    });
  });

  describe('reset', () => {
    it('resets all counts to zero', () => {
      metrics.recordSuccess();
      metrics.recordFailure();
      metrics.recordRetry();
      metrics.recordCycle(1000);
      metrics.reset();

      expect(metrics.getTotalSuccessCount()).toBe(0);
      expect(metrics.getTotalFailureCount()).toBe(0);
      expect(metrics.getTotalRetryCount()).toBe(0);
      expect(metrics.getTotalCycleCount()).toBe(0);
      expect(metrics.getLastCycleTimestamp()).toBeNull();
    });
  });
});
