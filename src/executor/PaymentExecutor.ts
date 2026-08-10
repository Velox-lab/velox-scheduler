import * as StellarSdk from '@stellar/stellar-sdk';
import { Schedule, SubmissionError, ExecutionOutcome } from '../types';

/**
 * PaymentExecutor — builds, signs, and submits a Stellar transaction
 * for a single due payment.
 *
 * Each method handles exactly one step of the submission pipeline.
 * No logging or retry logic lives here — those are separate concerns.
 */
export class PaymentExecutor {
  private readonly server: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(horizonUrl: string, networkPassphrase: string) {
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.networkPassphrase = networkPassphrase;
  }

  /** Build a Stellar transaction envelope for the due payment. */
  async buildTransaction(
    schedule: Schedule,
    operatorKeypair: StellarSdk.Keypair
  ): Promise<StellarSdk.Transaction> {
    const account = await this.server.loadAccount(operatorKeypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        // Invoke the contract's execute_payment function
        StellarSdk.Operation.invokeContractFunction({
          contract: schedule.scheduleId,
          function: 'execute_payment',
          args: [],
        })
      )
      .setTimeout(30)
      .build();

    return transaction;
  }

  /** Sign a built transaction with the operator keypair. */
  signTransaction(
    tx: StellarSdk.Transaction,
    keypair: StellarSdk.Keypair
  ): StellarSdk.Transaction {
    tx.sign(keypair);
    return tx;
  }

  /** Submit a signed transaction to the Stellar network. */
  async submitTransaction(
    signedTx: StellarSdk.Transaction
  ): Promise<StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse> {
    return this.server.submitTransaction(signedTx);
  }

  /** Interpret a submission response and return a typed execution outcome. */
  handleSubmissionResult(
    result: StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse
  ): ExecutionOutcome {
    if (result.successful) {
      return 'success';
    }
    return 'failed';
  }

  /** Classify a raw error into a typed SubmissionError for RetryHandler. */
  classifyError(error: unknown): SubmissionError {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('timeout') || message.includes('network')) {
        return { code: 'NETWORK_ERROR', message: error.message, retryable: true };
      }

      if (message.includes('429') || message.includes('rate limit')) {
        return { code: 'RATE_LIMIT', message: error.message, retryable: true };
      }

      if (message.includes('sequence')) {
        return { code: 'SEQUENCE_MISMATCH', message: error.message, retryable: true };
      }

      if (message.includes('insufficient')) {
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
