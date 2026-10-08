import * as StellarSdk from '@stellar/stellar-sdk';
import { PaymentExecutor, SubmissionServer } from '../../src/executor/PaymentExecutor';
import { Schedule } from '../../src/types';

const SCHEDULE_ID = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 7));
const operator = StellarSdk.Keypair.random();

function makeSchedule(): Schedule {
  return {
    scheduleId: SCHEDULE_ID,
    scheduleType: 'recurring',
    sender: 'G_SENDER',
    recipient: 'G_RECIPIENT',
    token: 'C_TOKEN',
    nextPaymentTime: 1000,
    status: 'active',
  };
}

function makeServer(overrides: Partial<Record<keyof SubmissionServer, jest.Mock>> = {}) {
  const server = {
    getAccount: jest.fn(async (id: string) => new StellarSdk.Account(id, '1')),
    prepareTransaction: jest.fn(async (tx: StellarSdk.Transaction) => tx),
    sendTransaction: jest.fn(async () => ({ status: 'PENDING', hash: 'tx_hash' })),
    pollTransaction: jest.fn(async () => ({ status: 'SUCCESS' })),
    ...overrides,
  };
  return server;
}

function makeExecutor(server: ReturnType<typeof makeServer>) {
  return new PaymentExecutor(
    server as unknown as SubmissionServer,
    StellarSdk.Networks.TESTNET
  );
}

async function buildSigned(executor: PaymentExecutor) {
  const tx = await executor.buildTransaction(makeSchedule(), operator);
  return executor.signTransaction(tx, operator);
}

describe('PaymentExecutor', () => {
  describe('buildTransaction', () => {
    it('loads the operator account and prepares a single contract invocation', async () => {
      const server = makeServer();
      const tx = await makeExecutor(server).buildTransaction(makeSchedule(), operator);

      expect(server.getAccount).toHaveBeenCalledWith(operator.publicKey());
      expect(server.prepareTransaction).toHaveBeenCalledTimes(1);
      expect(tx.source).toBe(operator.publicKey());
      expect(tx.operations).toHaveLength(1);
      expect(tx.operations[0].type).toBe('invokeHostFunction');
    });

    it('propagates a simulation failure from prepareTransaction', async () => {
      const server = makeServer({
        prepareTransaction: jest.fn().mockRejectedValue(new Error('payment is not due yet')),
      });
      await expect(
        makeExecutor(server).buildTransaction(makeSchedule(), operator)
      ).rejects.toThrow('payment is not due yet');
    });
  });

  describe('signTransaction', () => {
    it('adds the operator signature', async () => {
      const executor = makeExecutor(makeServer());
      const signed = await buildSigned(executor);
      expect(signed.signatures).toHaveLength(1);
    });
  });

  describe('submitTransaction', () => {
    it('returns a successful result once the transaction succeeds', async () => {
      const server = makeServer();
      const executor = makeExecutor(server);

      const result = await executor.submitTransaction(await buildSigned(executor));

      expect(result).toEqual({ hash: 'tx_hash', successful: true });
      expect(server.pollTransaction).toHaveBeenCalledWith('tx_hash', expect.any(Object));
    });

    it('returns an unsuccessful result when the transaction fails on-chain', async () => {
      const server = makeServer({ pollTransaction: jest.fn(async () => ({ status: 'FAILED' })) });
      const executor = makeExecutor(server);

      const result = await executor.submitTransaction(await buildSigned(executor));

      expect(result).toEqual({ hash: 'tx_hash', successful: false });
    });

    it('throws a retryable error when the network rejects the sequence number', async () => {
      const server = makeServer({
        sendTransaction: jest.fn(async () => ({
          status: 'ERROR',
          hash: 'tx_hash',
          errorResult: { result: { type: 'txBadSeq' } },
        })),
      });
      const executor = makeExecutor(server);

      const err = await executor
        .submitTransaction(await buildSigned(executor))
        .catch((e: Error) => e);

      expect((err as Error).message).toBe('transaction rejected: txBadSeq');
      expect(executor.classifyError(err)).toMatchObject({
        code: 'SEQUENCE_MISMATCH',
        retryable: true,
      });
    });

    it('throws a retryable error when asked to try again later', async () => {
      const server = makeServer({
        sendTransaction: jest.fn(async () => ({ status: 'TRY_AGAIN_LATER', hash: 'tx_hash' })),
      });
      const executor = makeExecutor(server);

      const err = await executor
        .submitTransaction(await buildSigned(executor))
        .catch((e: Error) => e);

      expect(executor.classifyError(err)).toMatchObject({ code: 'RATE_LIMIT', retryable: true });
    });

    it('throws a retryable timeout when the transaction is never found', async () => {
      const server = makeServer({
        pollTransaction: jest.fn(async () => ({ status: 'NOT_FOUND' })),
      });
      const executor = makeExecutor(server);

      const err = await executor
        .submitTransaction(await buildSigned(executor))
        .catch((e: Error) => e);

      expect((err as Error).message).toContain('timeout waiting for transaction tx_hash');
      expect(executor.classifyError(err)).toMatchObject({
        code: 'NETWORK_ERROR',
        retryable: true,
      });
    });
  });

  describe('handleSubmissionResult', () => {
    const executor = makeExecutor(makeServer());

    it('maps a successful result to success', () => {
      expect(executor.handleSubmissionResult({ hash: 'h', successful: true })).toBe('success');
    });

    it('maps an unsuccessful result to failed', () => {
      expect(executor.handleSubmissionResult({ hash: 'h', successful: false })).toBe('failed');
    });
  });

  describe('classifyError', () => {
    const executor = makeExecutor(makeServer());

    it('treats a not-due contract panic as non-retryable NOT_DUE', () => {
      expect(
        executor.classifyError(new Error('HostError: "payment is not due yet"'))
      ).toMatchObject({ code: 'NOT_DUE', retryable: false });
    });

    it('treats an exhausted allowance as non-retryable', () => {
      expect(
        executor.classifyError(new Error('Error(Contract, #9): allowance is not enough'))
      ).toMatchObject({ code: 'INSUFFICIENT_FUNDS', retryable: false });
    });

    it('treats an unrecognised error as non-retryable', () => {
      expect(executor.classifyError('boom')).toMatchObject({
        code: 'UNKNOWN_ERROR',
        message: 'boom',
        retryable: false,
      });
    });
  });
});
