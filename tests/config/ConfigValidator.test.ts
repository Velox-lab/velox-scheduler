import { ConfigValidator } from '../../src/config/ConfigValidator';
import { SchedulerConfig } from '../../src/types';

function validConfig(): SchedulerConfig {
  return {
    stellarNetwork: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    operatorSecretKey: 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    registryContractId: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    pollIntervalMs: 10000,
    maxRetryAttempts: 3,
    logLevel: 'info',
  };
}

describe('ConfigValidator', () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  it('returns valid for a correct config', () => {
    const result = validator.validate(validConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error for invalid network value', () => {
    const config = { ...validConfig(), stellarNetwork: 'devnet' as any };
    const result = validator.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("stellarNetwork must be 'testnet' or 'mainnet', got 'devnet'");
  });

  it('returns error when horizonUrl is empty', () => {
    const config = { ...validConfig(), horizonUrl: '' };
    const result = validator.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('horizonUrl'))).toBe(true);
  });

  it('returns error when horizonUrl does not start with https', () => {
    const config = { ...validConfig(), horizonUrl: 'http://horizon-testnet.stellar.org' };
    const result = validator.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('horizonUrl must start with https://');
  });

  it('returns error when operatorSecretKey is empty', () => {
    const config = { ...validConfig(), operatorSecretKey: '' };
    const result = validator.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('operatorSecretKey'))).toBe(true);
  });

  it('returns error when operatorSecretKey does not start with S', () => {
    const config = { ...validConfig(), operatorSecretKey: 'GXXXXXXX' };
    const result = validator.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'operatorSecretKey must be a valid Stellar secret key starting with S'
    );
  });

  it('returns error when registryContractId does not start with C', () => {
    const config = { ...validConfig(), registryContractId: 'GXXXXXXX' };
    const result = validator.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'registryContractId must be a valid Stellar contract ID starting with C'
    );
  });

  it('returns error when pollIntervalMs is zero', () => {
    const config = { ...validConfig(), pollIntervalMs: 0 };
    const result = validator.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('pollIntervalMs'))).toBe(true);
  });

  it('returns error when maxRetryAttempts is negative', () => {
    const config = { ...validConfig(), maxRetryAttempts: -1 };
    const result = validator.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('maxRetryAttempts'))).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const config = {
      ...validConfig(),
      stellarNetwork: 'bad' as any,
      horizonUrl: '',
      operatorSecretKey: '',
    };
    const result = validator.validate(config);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
