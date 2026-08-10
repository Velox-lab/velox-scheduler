// ── Core domain types for velox-scheduler ────────────────────────────────────

export type ScheduleType = 'stream' | 'recurring';

export type ScheduleStatus = 'active' | 'cancelled' | 'completed';

export interface Schedule {
  scheduleId: string;
  scheduleType: ScheduleType;
  sender: string;
  recipient: string;
  token: string;
  nextPaymentTime: number; // Unix timestamp in seconds
  status: ScheduleStatus;
}

export interface ExecutionResult {
  scheduleId: string;
  success: boolean;
  txHash?: string;
  error?: SubmissionError;
  timestamp: number;
}

export interface SubmissionError {
  code: string;
  message: string;
  retryable: boolean;
}

export type ExecutionOutcome = 'success' | 'retry' | 'failed';

export interface ExecutionRecord {
  scheduleId: string;
  outcome: ExecutionOutcome;
  txHash?: string;
  errorMessage?: string;
  attemptNumber: number;
  timestamp: number;
}

export interface SchedulerConfig {
  stellarNetwork: 'testnet' | 'mainnet';
  horizonUrl: string;
  sorobanRpcUrl: string;
  operatorSecretKey: string;
  registryContractId: string;
  pollIntervalMs: number;
  maxRetryAttempts: number;
  logLevel: string;
}
