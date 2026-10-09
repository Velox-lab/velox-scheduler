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

  /** Classify a raw error into a typed SubmissionError for RetryHandler. */
  classifyError(error: unknown): SubmissionError {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('not due yet')) {
        return { code: 'NOT_DUE', message: error.message, retryable: false };
      }

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
