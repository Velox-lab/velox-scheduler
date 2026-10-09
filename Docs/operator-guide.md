# Operator Running Guide

This guide provides step-by-step instructions for operators to configure, fund, and run the scheduler node in production environments on the Stellar network.

---

## 1. Creating and Funding the Operator Account
The scheduler requires a dedicated operator account to sign and execute scheduled transactions.

1. **Generate a Keypair:** Create an independent, dedicated Stellar keypair for this operator node. Do not reuse deployment or administrative keys. Your secret key will begin with the character `S`.
2. **Fund the Address:**
   * **Testnet:** Use the public Stellar Friendbot faucet to fund your public key with testnet XLM.
   * **Mainnet:** Deposit native XLM into the operator address to maintain a sufficient balance for transaction gas fees.
   * *Note:* Senders interacting with the scheduler must explicitly approve each schedule on the targeted token contract before execution.

## 2. Finding the VeloxRegistry Contract ID
The scheduler listens to a specific registry contract to verify valid automation schedules.

* **Testnet:** Retrieve the active `VeloxRegistry` contract ID (beginning with `C`) explicitly listed in the project’s `ARCHITECTURE.md` file or deployment output logs.
* **Mainnet:** Reference the official production deployment logs or verified ledger records to locate the live contract address.

## 3. Choosing a Soroban RPC Provider
To reliably communicate with the ledger, the scheduler node requires access to standard network endpoints.

* **Network Endpoints:** Configure the `SOROBAN_RPC_URL` (e.g., `https://stellar.org`) alongside the corresponding `HORIZON_URL` provider URL.
* **Infrastructure Options:** Utilize official public endpoints from the Stellar Development Foundation (SDF) or high-availability infrastructure node providers.

## 4. Running in Production

### Option A: Using a Process Manager (PM2)
Deploy using PM2 to ensure automatic restarts and high uptime:

```bash
npm install pm2 -g 
pm2 start dist/index.js --name "velox-scheduler" 
pm2 startup 
pm2 save
```

### Option B: Using Docker (Recommended)
Containerize the runtime engine for structured deployments:

```bash
docker run -d \
  --name velox-scheduler \
  --restart unless-stopped \
  -e STELLAR_NETWORK="testnet" \
  -e OPERATOR_SECRET_KEY="your_secret_key_here" \
  -e SOROBAN_RPC_URL="your_soroban_rpc_url_here" \
  -e REGISTRY_CONTRACT_ID="your_registry_contract_id_here" \
  velox-scheduler:latest
```


## 5. Reading System Logs
Routine log inspection ensures the synchronization tasks are executing properly within the defined polling intervals.

* **When deployed via PM2:**
  ```bash
  pm2 logs velox-scheduler
  ```
* **When deployed via Docker:**
  ```bash
  docker logs -f velox-scheduler
  ```
