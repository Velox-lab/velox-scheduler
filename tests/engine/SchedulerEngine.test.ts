import * as StellarSdk from '@stellar/stellar-sdk';
import { SchedulerEngine } from '../../src/engine/SchedulerEngine';
import { ChainPoller } from '../../src/poller/ChainPoller';
import { ExecutionQueue } from '../../src/queue/ExecutionQueue';
import { PaymentExecutor, SubmissionServer } from '../../src/executor/PaymentExecutor';
import { RetryHandler } from '../../src/executor/RetryHandler';
import { ExecutionLogger } from '../../src/logger/ExecutionLogger';
import { SchedulerMetrics } from '../../src/metrics/SchedulerMetrics';
import { Schedule } from '../../src/types';

const POLL_INTERVAL_MS = 10_000;

function makeSchedule(id: string): Schedule {
  return {
    scheduleId: id,
    scheduleType: 'recurring',
    sender: 'G_SENDER',
    recipient: 'G_RECIPIENT',
    token: 'C_TOKEN',
    nextPaymentTime: 0,
    status: 'active',
  };
}

/** Build an engine with real queue/retry/metrics/logger and mocked chain access. */
function setup() {
  const poller = { fetchDueSchedules: jest.fn() } as unknown as jest.Mocked<ChainPoller>;
  const executor = new PaymentExecutor({} as SubmissionServer, StellarSdk.Networks.TESTNET);
  const fakeTx = {} as StellarSdk.Transaction;
  const build = jest.spyOn(executor, 'buildTransaction').mockResolvedValue(fakeTx);
  jest.spyOn(executor, 'signTransaction').mockReturnValue(fakeTx);
  const submit = jest
    .spyOn(executor, 'submitTransaction')
    .mockResolvedValue({ hash: 'tx_hash', successful: true });

  const logger = new ExecutionLogger('silent');
  const metrics = new SchedulerMetrics();
  const engine = new SchedulerEngine({
    poller,
    queue: new ExecutionQueue(),
    executor,
    retryHandler: new RetryHandler(3),
    logger,
    metrics,
    operatorKeypair: StellarSdk.Keypair.random(),
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  return { engine, poller, build, submit, logger, metrics };
}

describe('SchedulerEngine', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('runCycle', () => {
    it('executes each due schedule and logs success', async () => {
      const { engine, poller, submit, logger, metrics } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1'), makeSchedule('s2')]);

      await engine.runCycle();

      expect(submit).toHaveBeenCalledTimes(2);
      expect(logger.getExecutionHistory('s1')[0].outcome).toBe('success');
      expect(logger.getExecutionHistory('s1')[0].txHash).toBe('tx_hash');
      expect(metrics.getTotalSuccessCount()).toBe(2);
      expect(metrics.getTotalCycleCount()).toBe(1);
      expect(engine.isInFlight('s1')).toBe(false);
    });

    it('logs a failure when the transaction fails on-chain', async () => {
      const { engine, poller, submit, logger, metrics } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      submit.mockResolvedValue({ hash: 'tx_hash', successful: false });

      await engine.runCycle();

      const history = logger.getExecutionHistory('s1');
      expect(history[0].outcome).toBe('failed');
      expect(history[0].errorMessage).toContain('tx_hash failed on-chain');
      expect(metrics.getTotalFailureCount()).toBe(1);
      expect(engine.isInFlight('s1')).toBe(false);
    });

    it('logs a failure without retrying a non-retryable error', async () => {
      const { engine, poller, build, logger, metrics } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      build.mockRejectedValue(new Error('allowance is not enough'));

      await engine.runCycle();

      expect(logger.getExecutionHistory('s1').map((r) => r.outcome)).toEqual(['failed']);
      expect(metrics.getTotalRetryCount()).toBe(0);
      expect(engine.isInFlight('s1')).toBe(false);
    });

    it('releases a schedule the contract says is not due yet, without logging a failure', async () => {
      const { engine, poller, build, logger, metrics } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      build.mockRejectedValue(new Error('payment is not due yet'));

      await engine.runCycle();

      expect(logger.getExecutionHistory('s1')).toEqual([]);
      expect(metrics.getTotalFailureCount()).toBe(0);
      expect(engine.isInFlight('s1')).toBe(false);
    });
  });

  describe('retries', () => {
    it('retries a retryable error after backoff and does not re-execute it in between', async () => {
      jest.useFakeTimers();
      const { engine, poller, submit, logger, metrics } = setup();
      engine.start();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      submit
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValue({ hash: 'tx_hash', successful: true });

      // First cycle runs immediately and fails with a retryable error
      await jest.advanceTimersByTimeAsync(0);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(engine.isInFlight('s1')).toBe(true);
      expect(metrics.getTotalRetryCount()).toBe(1);

      // A cycle before the retry fires must not pick the schedule up again
      // (retry delay for attempt 1 is 4s; run a cycle directly at 1s)
      await jest.advanceTimersByTimeAsync(1_000);
      await engine.runCycle();
      expect(submit).toHaveBeenCalledTimes(1);

      // Retry fires and succeeds
      await jest.advanceTimersByTimeAsync(3_000);
      expect(submit).toHaveBeenCalledTimes(2);
      expect(engine.isInFlight('s1')).toBe(false);
      expect(logger.getExecutionHistory('s1').map((r) => r.outcome)).toEqual([
        'retry',
        'success',
      ]);

      engine.stop();
    });

    it('logs a failure once max retries are exhausted', async () => {
      jest.useFakeTimers();
      const { engine, poller, submit, logger, metrics } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      submit.mockRejectedValue(new Error('network timeout'));
      engine.start();

      // Initial attempt + 3 retries (delays 4s, 8s, 16s)
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(4_000);
      await jest.advanceTimersByTimeAsync(8_000);
      await jest.advanceTimersByTimeAsync(16_000);

      const outcomes = logger.getExecutionHistory('s1').map((r) => r.outcome);
      expect(outcomes.slice(0, 4)).toEqual(['retry', 'retry', 'retry', 'failed']);
      expect(metrics.getTotalRetryCount()).toBeGreaterThanOrEqual(3);
      expect(metrics.getTotalFailureCount()).toBeGreaterThanOrEqual(1);

      engine.stop();
    });

    it('cancels pending retries on stop', async () => {
      jest.useFakeTimers();
      const { engine, poller, submit } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      submit.mockRejectedValue(new Error('network timeout'));
      engine.start();

      await jest.advanceTimersByTimeAsync(0);
      expect(submit).toHaveBeenCalledTimes(1);

      engine.stop();
      await jest.advanceTimersByTimeAsync(60_000);

      expect(submit).toHaveBeenCalledTimes(1);
      expect(engine.isInFlight('s1')).toBe(false);
    });
  });

  describe('polling loop', () => {
    it('runs the first cycle immediately and then every poll interval', async () => {
      jest.useFakeTimers();
      const { engine, poller } = setup();
      poller.fetchDueSchedules.mockResolvedValue([]);

      engine.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(poller.fetchDueSchedules).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(poller.fetchDueSchedules).toHaveBeenCalledTimes(2);

      engine.stop();
    });

    it('keeps polling after a cycle throws', async () => {
      jest.useFakeTimers();
      const { engine, poller, logger } = setup();
      const logCycleError = jest.spyOn(logger, 'logCycleError');
      poller.fetchDueSchedules
        .mockRejectedValueOnce(new Error('rpc unavailable'))
        .mockResolvedValue([]);

      engine.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(logCycleError).toHaveBeenCalledWith(expect.any(Error), expect.any(Number));

      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(poller.fetchDueSchedules).toHaveBeenCalledTimes(2);

      engine.stop();
    });

    it('stops polling after stop', async () => {
      jest.useFakeTimers();
      const { engine, poller } = setup();
      poller.fetchDueSchedules.mockResolvedValue([]);

      engine.start();
      await jest.advanceTimersByTimeAsync(0);
      engine.stop();
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

      expect(poller.fetchDueSchedules).toHaveBeenCalledTimes(1);
    });
  });
});
