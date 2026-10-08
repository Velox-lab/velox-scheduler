import * as StellarSdk from '@stellar/stellar-sdk';
import { ChainPoller, SimulationServer } from '../../src/poller/ChainPoller';

const REGISTRY_ID = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));
const SCHEDULE_A = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 2));
const SCHEDULE_B = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 3));
const TOKEN_ID = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 4));
const SENDER = StellarSdk.Keypair.random().publicKey();
const RECIPIENT = StellarSdk.Keypair.random().publicKey();

const addr = (a: string) => StellarSdk.Address.fromString(a);
const u64 = (n: number) => StellarSdk.nativeToScVal(BigInt(n), { type: 'u64' });
const statusVal = (name: string) =>
  StellarSdk.nativeToScVal([StellarSdk.nativeToScVal(name, { type: 'symbol' })]);

/** Encode a VeloxRegistry get_all_schedules return value. */
function registryResponse(scheduleIds: string[]) {
  const entries = scheduleIds.map((id) =>
    StellarSdk.nativeToScVal({
      schedule_id: addr(id),
      sender: addr(SENDER),
      recipient: addr(RECIPIENT),
      registered_at: u64(1000),
    })
  );
  return { result: { retval: StellarSdk.nativeToScVal(entries) } };
}

/** Encode a RecurringPayment get_schedule_info return value. */
function scheduleInfoResponse(nextPaymentTime: number, status = 'Active') {
  return {
    result: {
      retval: StellarSdk.nativeToScVal({
        sender: addr(SENDER),
        recipient: addr(RECIPIENT),
        token: addr(TOKEN_ID),
        amount: StellarSdk.nativeToScVal(100n, { type: 'i128' }),
        interval: u64(604_800),
        next_payment_time: u64(nextPaymentTime),
        status: statusVal(status),
      }),
    },
  };
}

function makePoller(responses: object[], onReadError = jest.fn()) {
  const simulateTransaction = jest.fn();
  responses.forEach((r) => simulateTransaction.mockResolvedValueOnce(r));
  const server = { simulateTransaction } as unknown as SimulationServer;
  const poller = new ChainPoller(
    server,
    REGISTRY_ID,
    StellarSdk.Networks.TESTNET,
    SENDER,
    onReadError
  );
  return { poller, simulateTransaction, onReadError };
}

describe('ChainPoller', () => {
  describe('fetchRegistrySnapshot', () => {
    it('returns each registered schedule decoded into a domain object', async () => {
      const { poller } = makePoller([
        registryResponse([SCHEDULE_A]),
        scheduleInfoResponse(1_604_800),
      ]);

      const schedules = await poller.fetchRegistrySnapshot();

      expect(schedules).toEqual([
        {
          scheduleId: SCHEDULE_A,
          scheduleType: 'recurring',
          sender: SENDER,
          recipient: RECIPIENT,
          token: TOKEN_ID,
          nextPaymentTime: 1_604_800,
          status: 'active',
        },
      ]);
    });

    it('simulates the registry read and one read per schedule', async () => {
      const { poller, simulateTransaction } = makePoller([
        registryResponse([SCHEDULE_A, SCHEDULE_B]),
        scheduleInfoResponse(1000),
        scheduleInfoResponse(2000),
      ]);

      await poller.fetchRegistrySnapshot();

      expect(simulateTransaction).toHaveBeenCalledTimes(3);
    });

    it('returns an empty list when the registry has no schedules', async () => {
      const { poller } = makePoller([registryResponse([])]);
      expect(await poller.fetchRegistrySnapshot()).toEqual([]);
    });

    it('skips a schedule that cannot be read and reports it', async () => {
      const { poller, onReadError } = makePoller([
        registryResponse([SCHEDULE_A, SCHEDULE_B]),
        { error: 'contract not found' },
        scheduleInfoResponse(2000),
      ]);

      const schedules = await poller.fetchRegistrySnapshot();

      expect(schedules.map((s) => s.scheduleId)).toEqual([SCHEDULE_B]);
      expect(onReadError).toHaveBeenCalledWith(SCHEDULE_A, expect.any(Error));
      expect(onReadError.mock.calls[0][1].message).toContain('contract not found');
    });

    it('throws when the registry itself cannot be read', async () => {
      const { poller } = makePoller([{ error: 'registry unavailable' }]);
      await expect(poller.fetchRegistrySnapshot()).rejects.toThrow('registry unavailable');
    });
  });

  describe('fetchDueSchedules', () => {
    it('returns only active schedules whose payment time has arrived', async () => {
      const { poller } = makePoller([
        registryResponse([SCHEDULE_A, SCHEDULE_B, REGISTRY_ID]),
        scheduleInfoResponse(1000),
        scheduleInfoResponse(5000),
        scheduleInfoResponse(1000, 'Cancelled'),
      ]);

      const due = await poller.fetchDueSchedules(2000);

      expect(due.map((s) => s.scheduleId)).toEqual([SCHEDULE_A]);
    });
  });

  describe('fetchScheduleStatus', () => {
    it('decodes the contract status enum', async () => {
      const { poller } = makePoller([{ result: { retval: statusVal('Cancelled') } }]);
      expect(await poller.fetchScheduleStatus(SCHEDULE_A)).toBe('cancelled');
    });

    it('throws on an unknown status', async () => {
      const { poller } = makePoller([{ result: { retval: statusVal('Paused') } }]);
      await expect(poller.fetchScheduleStatus(SCHEDULE_A)).rejects.toThrow(
        'unknown schedule status: paused'
      );
    });
  });
});
