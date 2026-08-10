import { ExecutionLogger } from '../../src/logger/ExecutionLogger';

describe('ExecutionLogger', () => {
  let logger: ExecutionLogger;

  beforeEach(() => {
    logger = new ExecutionLogger('silent');
  });

  describe('logSuccess', () => {
    it('records a success entry in execution history', () => {
      logger.logSuccess('s1', 'txhash_abc', 1000);
      const history = logger.getExecutionHistory('s1');

      expect(history).toHaveLength(1);
      expect(history[0].outcome).toBe('success');
      expect(history[0].txHash).toBe('txhash_abc');
      expect(history[0].timestamp).toBe(1000);
    });
  });

  describe('logFailure', () => {
    it('records a failure entry in execution history', () => {
      logger.logFailure('s1', new Error('submission failed'), 2000);
      const history = logger.getExecutionHistory('s1');

      expect(history).toHaveLength(1);
      expect(history[0].outcome).toBe('failed');
      expect(history[0].errorMessage).toBe('submission failed');
    });
  });

  describe('logRetry', () => {
    it('records a retry entry in execution history', () => {
      logger.logRetry('s1', 1, 3000);
      const history = logger.getExecutionHistory('s1');

      expect(history).toHaveLength(1);
      expect(history[0].outcome).toBe('retry');
      expect(history[0].attemptNumber).toBe(1);
    });
  });

  describe('getExecutionHistory', () => {
    it('returns empty array for unknown schedule', () => {
      expect(logger.getExecutionHistory('unknown')).toEqual([]);
    });

    it('accumulates multiple entries in order', () => {
      logger.logRetry('s1', 1, 1000);
      logger.logRetry('s1', 2, 2000);
      logger.logSuccess('s1', 'txhash', 3000);

      const history = logger.getExecutionHistory('s1');
      expect(history).toHaveLength(3);
      expect(history[0].outcome).toBe('retry');
      expect(history[1].outcome).toBe('retry');
      expect(history[2].outcome).toBe('success');
    });

    it('keeps history separate per schedule', () => {
      logger.logSuccess('s1', 'tx1', 1000);
      logger.logFailure('s2', new Error('err'), 2000);

      expect(logger.getExecutionHistory('s1')).toHaveLength(1);
      expect(logger.getExecutionHistory('s2')).toHaveLength(1);
    });
  });
});
