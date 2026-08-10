import * as StellarSdk from '@stellar/stellar-sdk';
import { Schedule, ScheduleStatus } from '../types';

/**
 * ChainPoller — reads on-chain state from VeloxRegistry and individual contracts.
 *
 * This module never writes to the chain. It is the read-only eyes of the scheduler.
 * All methods return plain domain objects — no raw SDK types are exposed upstream.
 */
export class ChainPoller {
  private readonly server: StellarSdk.Horizon.Server;
  private readonly registryContractId: string;

  constructor(horizonUrl: string, registryContractId: string) {
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.registryContractId = registryContractId;
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
   * Fetch the full list of registered schedules from VeloxRegistry.
   * Used on startup to rebuild the execution queue from on-chain state.
   */
  async fetchRegistrySnapshot(): Promise<Schedule[]> {
    // TODO: implement actual Soroban contract read via RPC
    // Contributor issue: "Implement ChainPoller.fetchRegistrySnapshot with Soroban RPC"
    //
    // Expected implementation:
    //   const rpc = new StellarSdk.SorobanRpc.Server(sorobanRpcUrl)
    //   const result = await rpc.getContractData(registryContractId, key)
    //   return parseRegistryEntries(result)
    return [];
  }

  /**
   * Fetch the current status of a specific stream or schedule contract.
   */
  async fetchScheduleStatus(scheduleId: string): Promise<ScheduleStatus> {
    // TODO: implement Soroban contract read for schedule status
    // Contributor issue: "Implement ChainPoller.fetchScheduleStatus"
    return 'active';
  }
}
