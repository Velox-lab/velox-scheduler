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
    amount: 100n,
    nextPaymentTime: 0,
    status: 'active',
  };
}

/** Build an engine with real queue/retry/metrics/logger and mocked chain access. */
function setup() {
  const poller = {
    fetchDueSchedules: jest.fn(),
    getLedgerTime: jest.fn().mockResolvedValue(Math.floor(Date.now() / 1000)),
    checkFunding: jest.fn().mockResolvedValue({ sufficient: true, allowance: 1000n, balance: 1000n }),
  } as unknown as jest.Mocked<ChainPoller>;
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
      build.mockRejectedValue(new Error('HostError: Error(Contract, #6)'));

      await engine.runCycle();

      expect(logger.getExecutionHistory('s1')).toEqual([]);
      expect(metrics.getTotalFailureCount()).toBe(0);
      expect(engine.isInFlight('s1')).toBe(false);
    });

    it('releases a schedule cancelled between enqueue and execution, without logging a failure', async () => {
      const { engine, poller, build, logger, metrics } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      build.mockRejectedValue(new Error('HostError: Error(Contract, #5)'));

      await engine.runCycle();

      expect(logger.getExecutionHistory('s1')).toEqual([]);
      expect(metrics.getTotalFailureCount()).toBe(0);
      expect(engine.isInFlight('s1')).toBe(false);
    });
  });

  describe('ledger time', () => {
    it('selects due schedules using ledger time even when the local clock runs behind it', async () => {
      const { engine, poller } = setup();
      const localNow = Math.floor(Date.now() / 1000);
      // Local clock is 1 hour behind ledger time: a schedule due per ledger
      // time, but not yet due per the local clock, must still be selected.
      poller.getLedgerTime.mockResolvedValue(localNow + 3600);
      poller.fetchDueSchedules.mockResolvedValue([]);

      await engine.runCycle();

      expect(poller.fetchDueSchedules).toHaveBeenCalledWith(localNow + 3600);
    });

    it('selects due schedules using ledger time even when the local clock runs ahead of it', async () => {
      const { engine, poller } = setup();
      const localNow = Math.floor(Date.now() / 1000);
      // Local clock is 1 hour ahead of ledger time: a schedule the local clock
      // thinks is due must not be treated as due until the ledger agrees.
      poller.getLedgerTime.mockResolvedValue(localNow - 3600);
      poller.fetchDueSchedules.mockResolvedValue([]);

      await engine.runCycle();

      expect(poller.fetchDueSchedules).toHaveBeenCalledWith(localNow - 3600);
    });

    it('falls back to the local clock and logs when ledger time cannot be fetched', async () => {
      const { engine, poller, logger } = setup();
      const logSpy = jest.spyOn(logger, 'logLedgerTimeFallback');
      poller.getLedgerTime.mockRejectedValue(new Error('RPC unreachable'));
      poller.fetchDueSchedules.mockResolvedValue([]);

      await engine.runCycle();

      expect(poller.fetchDueSchedules).toHaveBeenCalledTimes(1);
      const usedNow = poller.fetchDueSchedules.mock.calls[0][0];
      expect(typeof usedNow).toBe('number');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0].message).toBe('RPC unreachable');
    });
  });

  describe('funding check', () => {
    it('executes a schedule whose sender has sufficient allowance and balance', async () => {
      const { engine, poller, submit } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      poller.checkFunding.mockResolvedValue({ sufficient: true, allowance: 1000n, balance: 1000n });

      await engine.runCycle();

      expect(submit).toHaveBeenCalledTimes(1);
    });

    it('skips a schedule with insufficient allowance, logging and counting it, without executing', async () => {
      const { engine, poller, submit, logger, metrics } = setup();
      const schedule = makeSchedule('s1');
      poller.fetchDueSchedules.mockResolvedValue([schedule]);
      poller.checkFunding.mockResolvedValue({ sufficient: false, allowance: 50n, balance: 1000n });
      const logSpy = jest.spyOn(logger, 'logUnderfunded');

      await engine.runCycle();

      expect(submit).not.toHaveBeenCalled();
      expect(metrics.getTotalSkippedUnderfundedCount()).toBe(1);
      expect(logSpy).toHaveBeenCalledWith('s1', schedule.amount, 50n, 1000n, expect.any(Number));
      expect(engine.isInFlight('s1')).toBe(false);
    });

    it('skips a schedule with insufficient balance, logging and counting it, without executing', async () => {
      const { engine, poller, submit, metrics } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      poller.checkFunding.mockResolvedValue({ sufficient: false, allowance: 1000n, balance: 10n });

      await engine.runCycle();

      expect(submit).not.toHaveBeenCalled();
      expect(metrics.getTotalSkippedUnderfundedCount()).toBe(1);
    });

    it('checks funding for every due schedule independently', async () => {
      const { engine, poller, submit, metrics } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('funded'), makeSchedule('broke')]);
      poller.checkFunding.mockImplementation(async (schedule) =>
        schedule.scheduleId === 'funded'
          ? { sufficient: true, allowance: 1000n, balance: 1000n }
          : { sufficient: false, allowance: 0n, balance: 0n }
      );

      await engine.runCycle();

      expect(submit).toHaveBeenCalledTimes(1);
      expect(metrics.getTotalSkippedUnderfundedCount()).toBe(1);
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

      await engine.stop();
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

      await engine.stop();
    });

    it('cancels pending retries on stop', async () => {
      jest.useFakeTimers();
      const { engine, poller, submit } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      submit.mockRejectedValue(new Error('network timeout'));
      engine.start();

      await jest.advanceTimersByTimeAsync(0);
      expect(submit).toHaveBeenCalledTimes(1);

      await engine.stop();
      await jest.advanceTimersByTimeAsync(60_000);

      expect(submit).toHaveBeenCalledTimes(1);
      expect(engine.isInFlight('s1')).toBe(false);
    });
  });

  describe('stop', () => {
    it('waits for an execution already in flight to finish before resolving', async () => {
      const { engine, poller, build, submit, logger } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);

      const events: string[] = [];
      let resolveBuild!: () => void;
      build.mockImplementation(
        () =>
          new Promise<StellarSdk.Transaction>((resolve) => {
            resolveBuild = () => {
              events.push('build-resolved');
              resolve({} as StellarSdk.Transaction);
            };
          })
      );
      submit.mockImplementation(async () => {
        events.push('submitted');
        return { hash: 'tx_hash', successful: true };
      });

      const cyclePromise = engine.runCycle();
      // Let the cycle run far enough to call buildTransaction and suspend on it
      await new Promise((resolve) => setImmediate(resolve));
      expect(engine.isInFlight('s1')).toBe(true);

      const stopPromise = engine.stop().then(() => events.push('stop-resolved'));

      resolveBuild();
      await cyclePromise;
      await stopPromise;

      expect(events).toEqual(['build-resolved', 'submitted', 'stop-resolved']);
      expect(logger.getExecutionHistory('s1')[0].outcome).toBe('success');
    });

    it('resolves after its timeout even if an execution never finishes', async () => {
      jest.useFakeTimers();
      const { engine, poller, build } = setup();
      poller.fetchDueSchedules.mockResolvedValue([makeSchedule('s1')]);
      build.mockReturnValue(new Promise<StellarSdk.Transaction>(() => {})); // never settles

      void engine.runCycle();
      await jest.advanceTimersByTimeAsync(0);
      expect(engine.isInFlight('s1')).toBe(true);

      let stopResolved = false;
      const stopPromise = engine.stop(50).then(() => {
        stopResolved = true;
      });

      await jest.advanceTimersByTimeAsync(49);
      expect(stopResolved).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await stopPromise;

      expect(stopResolved).toBe(true);
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

      await engine.stop();
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

      await engine.stop();
    });

    it('stops polling after stop', async () => {
      jest.useFakeTimers();
      const { engine, poller } = setup();
      poller.fetchDueSchedules.mockResolvedValue([]);

      engine.start();
      await jest.advanceTimersByTimeAsync(0);
      await engine.stop();
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

      expect(poller.fetchDueSchedules).toHaveBeenCalledTimes(1);
    });
  });
});
