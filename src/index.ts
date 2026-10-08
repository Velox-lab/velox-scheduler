import * as StellarSdk from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
import { SchedulerEngine } from './engine/SchedulerEngine';
import { ChainPoller } from './poller/ChainPoller';
import { ExecutionQueue } from './queue/ExecutionQueue';
import { PaymentExecutor } from './executor/PaymentExecutor';
import { RetryHandler } from './executor/RetryHandler';
import { ExecutionLogger } from './logger/ExecutionLogger';
import { SchedulerMetrics } from './metrics/SchedulerMetrics';
import { ConfigValidator } from './config/ConfigValidator';
import { SchedulerConfig } from './types';

dotenv.config();

function loadConfig(): SchedulerConfig {
  const required = [
    'STELLAR_NETWORK',
    'SOROBAN_RPC_URL',
    'OPERATOR_SECRET_KEY',
    'REGISTRY_CONTRACT_ID',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const config: SchedulerConfig = {
    stellarNetwork: (process.env.STELLAR_NETWORK as 'testnet' | 'mainnet') ?? 'testnet',
    sorobanRpcUrl: process.env.SOROBAN_RPC_URL!,
    operatorSecretKey: process.env.OPERATOR_SECRET_KEY!,
    registryContractId: process.env.REGISTRY_CONTRACT_ID!,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '10000', 10),
    maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS ?? '3', 10),
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };

  const { valid, errors } = new ConfigValidator().validate(config);
  if (!valid) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return config;
}

function buildEngine(config: SchedulerConfig): SchedulerEngine {
  const networkPassphrase =
    config.stellarNetwork === 'mainnet'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;

  const server = new StellarSdk.rpc.Server(config.sorobanRpcUrl);
  const operatorKeypair = StellarSdk.Keypair.fromSecret(config.operatorSecretKey);
  const logger = new ExecutionLogger(config.logLevel);

  return new SchedulerEngine({
    poller: new ChainPoller(
      server,
      config.registryContractId,
      networkPassphrase,
      operatorKeypair.publicKey(),
      (scheduleId, error) =>
        logger.logReadError(scheduleId, error, Math.floor(Date.now() / 1000))
    ),
    queue: new ExecutionQueue(),
    executor: new PaymentExecutor(server, networkPassphrase),
    retryHandler: new RetryHandler(config.maxRetryAttempts),
    logger,
    metrics: new SchedulerMetrics(),
    operatorKeypair,
    pollIntervalMs: config.pollIntervalMs,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const engine = buildEngine(config);

  process.on('SIGINT', () => {
    console.log('Shutting down velox-scheduler...');
    engine.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    engine.stop();
    process.exit(0);
  });

  console.log(`velox-scheduler starting on ${config.stellarNetwork}...`);
  engine.start();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
