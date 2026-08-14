import { SchedulerConfig } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * ConfigValidator — validates the scheduler configuration before startup.
 *
 * Single responsibility: check config fields and return a result.
 * No side effects, no logging, no network calls.
 */
export class ConfigValidator {
  /** Validate the full scheduler config. Returns all errors found. */
  validate(config: SchedulerConfig): ValidationResult {
    const errors: string[] = [];

    this.validateNetwork(config.stellarNetwork, errors);
    this.validateUrl('horizonUrl', config.horizonUrl, errors);
    this.validateUrl('sorobanRpcUrl', config.sorobanRpcUrl, errors);
    this.validateSecretKey(config.operatorSecretKey, errors);
    this.validateContractId(config.registryContractId, errors);
    this.validatePositiveInteger('pollIntervalMs', config.pollIntervalMs, errors);
    this.validatePositiveInteger('maxRetryAttempts', config.maxRetryAttempts, errors);

    return { valid: errors.length === 0, errors };
  }

  /** Check that network is either testnet or mainnet. */
  private validateNetwork(network: string, errors: string[]): void {
    if (network !== 'testnet' && network !== 'mainnet') {
      errors.push(`stellarNetwork must be 'testnet' or 'mainnet', got '${network}'`);
    }
  }

  /** Check that a URL field is a non-empty string starting with https. */
  private validateUrl(field: string, value: string, errors: string[]): void {
    if (!value || value.trim() === '') {
      errors.push(`${field} is required`);
      return;
    }
    if (!value.startsWith('https://')) {
      errors.push(`${field} must start with https://`);
    }
  }

  /** Check that the secret key is a non-empty string starting with S. */
  private validateSecretKey(key: string, errors: string[]): void {
    if (!key || key.trim() === '') {
      errors.push('operatorSecretKey is required');
      return;
    }
    if (!key.startsWith('S')) {
      errors.push('operatorSecretKey must be a valid Stellar secret key starting with S');
    }
  }

  /** Check that a contract ID is a non-empty string starting with C. */
  private validateContractId(id: string, errors: string[]): void {
    if (!id || id.trim() === '') {
      errors.push('registryContractId is required');
      return;
    }
    if (!id.startsWith('C')) {
      errors.push('registryContractId must be a valid Stellar contract ID starting with C');
    }
  }

  /** Check that a numeric field is a positive integer. */
  private validatePositiveInteger(field: string, value: number, errors: string[]): void {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${field} must be a positive integer, got ${value}`);
    }
  }
}
