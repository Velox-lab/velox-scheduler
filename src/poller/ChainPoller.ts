import * as StellarSdk from '@stellar/stellar-sdk';
import { Schedule, ScheduleStatus } from '../types';

/** The subset of the Soroban RPC server the poller needs. Injected so tests can mock it. */
export type SimulationServer = Pick<StellarSdk.rpc.Server, 'simulateTransaction'>;

/** Called when a single schedule cannot be read. The rest of the snapshot is still returned. */
export type ReadErrorHandler = (scheduleId: string, error: Error) => void;

/** VeloxRegistry ScheduleEntry, as decoded from the contract. */
interface RegistryScheduleEntry {
  schedule_id: string;
  sender: string;
  recipient: string;
  registered_at: bigint;
}

/** RecurringPayment ScheduleInfo, as decoded from the contract. */
interface RawScheduleInfo {
  sender: string;
  recipient: string;
  token: string;
  amount: bigint;
  interval: bigint;
  next_payment_time: bigint;
  status: string[] | string;
}

/**
 * ChainPoller — reads on-chain state from VeloxRegistry and individual contracts.
 *
 * This module never writes to the chain. It is the read-only eyes of the scheduler.
 * Reads are simulated contract calls over Soroban RPC: nothing is signed or submitted.
 * All methods return plain domain objects — no raw SDK types are exposed upstream.
 */
export class ChainPoller {
  private readonly server: SimulationServer;
  private readonly registryContractId: string;
  private readonly networkPassphrase: string;
  private readonly sourcePublicKey: string;
  private readonly onReadError: ReadErrorHandler;

  constructor(
    server: SimulationServer,
    registryContractId: string,
    networkPassphrase: string,
    sourcePublicKey: string,
    onReadError: ReadErrorHandler = () => {}
  ) {
    this.server = server;
    this.registryContractId = registryContractId;
    this.networkPassphrase = networkPassphrase;
    this.sourcePublicKey = sourcePublicKey;
    this.onReadError = onReadError;
  }

  /**
   * Fetch all schedules from VeloxRegistry where nextPaymentTime <= currentTime.
   * These are the schedules that require execution in the current cycle.
   */
  async fetchDueSchedules(currentTime: number): Promise<Schedule[]> {
    const all = await this.fetchRegistrySnapshot();
    return all.filter(
      (s) => s.status === 'active' && s.nextPaymentTime <= currentTime
    );
  }

  /**
   * Fetch the full list of registered schedules with their current on-chain state.
   * Throws if the registry itself cannot be read. A schedule that cannot be read
   * is reported through onReadError and left out, so one bad entry cannot block the rest.
   */
  async fetchRegistrySnapshot(): Promise<Schedule[]> {
    const entries = await this.readContract<RegistryScheduleEntry[]>(
      this.registryContractId,
      'get_all_schedules'
    );

    const results = await Promise.allSettled(
      entries.map((entry) => this.fetchSchedule(entry.schedule_id))
    );

    const schedules: Schedule[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        schedules.push(result.value);
      } else {
        this.onReadError(entries[i].schedule_id, toError(result.reason));
      }
    });
    return schedules;
  }

  /** Fetch the full current state of a single RecurringPayment contract. */
  async fetchSchedule(scheduleId: string): Promise<Schedule> {
    const info = await this.readContract<RawScheduleInfo>(scheduleId, 'get_schedule_info');
    return {
      scheduleId,
      scheduleType: 'recurring',
      sender: info.sender,
      recipient: info.recipient,
      token: info.token,
      nextPaymentTime: Number(info.next_payment_time),
      status: parseStatus(info.status),
    };
  }

  /** Fetch the current status of a specific schedule contract. */
  async fetchScheduleStatus(scheduleId: string): Promise<ScheduleStatus> {
    const status = await this.readContract<string[] | string>(scheduleId, 'get_schedule_status');
    return parseStatus(status);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Simulate a read-only, no-argument contract call and decode its return value. */
  private async readContract<T>(contractId: string, method: string): Promise<T> {
    // Simulation does not check the sequence number, so no account lookup is needed
    const source = new StellarSdk.Account(this.sourcePublicKey, '0');
    const tx = new StellarSdk.TransactionBuilder(source, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(new StellarSdk.Contract(contractId).call(method))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if ('error' in sim && sim.error) {
      throw new Error(`simulation of ${method} on ${contractId} failed: ${sim.error}`);
    }

    const retval = 'result' in sim ? sim.result?.retval : undefined;
    if (!retval) {
      throw new Error(`simulation of ${method} on ${contractId} returned no value`);
    }
    return StellarSdk.scValToNative(retval) as T;
  }
}

/** Contract unit enums decode as a single-element array, e.g. ['Active']. */
function parseStatus(raw: string[] | string): ScheduleStatus {
  const name = (Array.isArray(raw) ? raw[0] : raw).toLowerCase();
  if (name === 'active' || name === 'cancelled' || name === 'completed') {
    return name;
  }
  throw new Error(`unknown schedule status: ${name}`);
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
