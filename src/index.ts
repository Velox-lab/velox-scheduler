import dotenv from 'dotenv';
import { SchedulerEngine } from './engine/SchedulerEngine';
import { SchedulerConfig } from './types';

dotenv.config();

function loadConfig(): SchedulerConfig {
  const required = [
    'STELLAR_NETWORK',
    'HORIZON_URL',
    'SOROBAN_RPC_URL',
    'OPERATOR_SECRET_KEY',
    'REGISTRY_CONTRACT_ID',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  return {
    stellarNetwork: (process.env.STELLAR_NETWORK as 'testnet' | 'mainnet') ?? 'testnet',
    horizonUrl: process.env.HORIZON_URL!,
    sorobanRpcUrl: process.env.SOROBAN_RPC_URL!,
    operatorSecretKey: process.env.OPERATOR_SECRET_KEY!,
    registryContractId: process.env.REGISTRY_CONTRACT_ID!,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '10000', 10),
    maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS ?? '3', 10),
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const engine = new SchedulerEngine(config);

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
