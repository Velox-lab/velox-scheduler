import * as StellarSdk from '@stellar/stellar-sdk';
import { Schedule, SubmissionError, SubmissionResult, ExecutionOutcome } from '../types';

/** The subset of the Soroban RPC server the executor needs. Injected so tests can mock it. */
export type SubmissionServer = Pick<
  StellarSdk.rpc.Server,
  'getAccount' | 'prepareTransaction' | 'sendTransaction' | 'pollTransaction'
>;

/** How many times to poll (1s apart) for a submitted transaction before giving up. */
const POLL_ATTEMPTS = 30;

/**
 * PaymentExecutor — builds, signs, and submits a Soroban transaction
 * invoking execute_payment on a single due RecurringPayment contract.
 *
 * Each method handles exactly one step of the submission pipeline.
 * No logging or retry logic lives here — those are separate concerns.
 */
export class PaymentExecutor {
  private readonly server: SubmissionServer;
  private readonly networkPassphrase: string;

  constructor(server: SubmissionServer, networkPassphrase: string) {
    this.server = server;
    this.networkPassphrase = networkPassphrase;
  }

  /**
   * Build a transaction invoking execute_payment, then prepare it: simulation
   * adds the storage footprint and resource fees Soroban requires.
   * Throws if simulation fails, e.g. the payment is not due or the allowance is exhausted.
   */
  async buildTransaction(
    schedule: Schedule,
    operatorKeypair: StellarSdk.Keypair
  ): Promise<StellarSdk.Transaction> {
    const account = await this.server.getAccount(operatorKeypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(new StellarSdk.Contract(schedule.scheduleId).call('execute_payment'))
      .setTimeout(30)
      .build();

    return this.server.prepareTransaction(transaction);
  }

  /** Sign a built transaction with the operator keypair. */
  signTransaction(
    tx: StellarSdk.Transaction,
    keypair: StellarSdk.Keypair
  ): StellarSdk.Transaction {
    tx.sign(keypair);
    return tx;
  }

  /**
   * Submit a signed transaction and wait for its final on-chain result.
   * Throws if the network rejects it outright or it is not found in time.
   */
  async submitTransaction(signedTx: StellarSdk.Transaction): Promise<SubmissionResult> {
    const sent = await this.server.sendTransaction(signedTx);

    if (sent.status === 'ERROR') {
      const reason = sent.errorResult?.result.type ?? 'unknown';
      throw new Error(`transaction rejected: ${reason}`);
    }
    if (sent.status === 'TRY_AGAIN_LATER') {
      throw new Error('rate limit: try again later');
    }

    const final = await this.server.pollTransaction(sent.hash, { attempts: POLL_ATTEMPTS });
    if (final.status === StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND) {
      throw new Error(`timeout waiting for transaction ${sent.hash}`);
    }

    return {
      hash: sent.hash,
      successful: final.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS,
    };
  }

  /** Interpret a submission result and return a typed execution outcome. */
  handleSubmissionResult(result: SubmissionResult): ExecutionOutcome {
    if (result.successful) {
      return 'success';
    }
    return 'failed';
  }

  /**
   * Classify a raw error into a typed SubmissionError for RetryHandler.
   *
   * RecurringPayment.execute_payment returns a typed contract error (see its
   * `Error` enum), which surfaces here as "Error(Contract, #N)" in the thrown
   * message. Matching the numeric code is precise and independent of wording;
   * the substring checks below are a fallback for host- and network-level
   * failures, which are not typed contract errors.
   */
  classifyError(error: unknown): SubmissionError {
    if (error instanceof Error) {
      const contractError = classifyContractError(error.message);
      if (contractError) return contractError;

      const message = error.message.toLowerCase();

      if (message.includes('timeout') || message.includes('network')) {
        return { code: 'NETWORK_ERROR', message: error.message, retryable: true };
      }

      if (message.includes('429') || message.includes('rate limit')) {
        return { code: 'RATE_LIMIT', message: error.message, retryable: true };
      }

      if (message.includes('sequence') || message.includes('txbadseq')) {
        return { code: 'SEQUENCE_MISMATCH', message: error.message, retryable: true };
      }

      if (message.includes('insufficient') || message.includes('allowance')) {
        return { code: 'INSUFFICIENT_FUNDS', message: error.message, retryable: false };
      }
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    };
  }
}

/**
 * RecurringPayment's error codes, as declared in
 * contracts/recurring_payment/src/lib.rs. The scheduler only ever triggers
 * execute_payment, so only ScheduleNotActive and PaymentNotDue are expected
 * in practice; the others are included so an unexpected one is still
 * recognisable instead of falling through to UNKNOWN_ERROR.
 */
const RECURRING_PAYMENT_ERRORS: Record<number, SubmissionError['code']> = {
  1: 'ALREADY_INITIALIZED',
  2: 'INVALID_AMOUNT',
  3: 'INVALID_INTERVAL',
  4: 'FIRST_PAYMENT_IN_PAST',
  5: 'SCHEDULE_INACTIVE',
  6: 'NOT_DUE',
};

/** Match "Error(Contract, #N)" in a thrown message and map it to a typed SubmissionError. */
function classifyContractError(message: string): SubmissionError | null {
  const match = message.match(/Error\(Contract, #(\d+)\)/);
  if (!match) return null;

  const code = RECURRING_PAYMENT_ERRORS[Number(match[1])];
  if (!code) return null;

  // Neither case is worth retrying: NOT_DUE means our local clock ran ahead of
  // ledger time and the next poll will pick it up again; SCHEDULE_INACTIVE
  // means the schedule was cancelled between being enqueued and executed.
  return { code, message, retryable: false };
}
