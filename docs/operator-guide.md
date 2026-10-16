# Operator Running Guide

This guide provides instructions for configuring, funding, and running the scheduler node in production on the Stellar network.

---

## 1. Creating and Funding the Operator Account
The scheduler requires a dedicated account to sign and execute transactions.

* **Generate Keypair:** Create an independent Stellar keypair for this node. The secret key starts with `S`.
* **Funding (Testnet):** Fund the public key using the Stellar Friendbot faucet.
* **Funding (Mainnet):** Maintain a native XLM balance to cover transaction fees and base reserves.
* **Token Approvals:** Senders must explicitly approve each schedule on the targeted token contract before execution.

---

## 2. Finding the VeloxRegistry Contract ID
The scheduler tracks a registry contract to verify automation schedules.

* **Locating the ID:** Find the active contract ID (starts with `C`) in your local deployment logs or obtain it from your network administrator. Do not check `ARCHITECTURE.md`, as it does not contain deployment addresses.
* **Variable:** Set this value as `REGISTRY_CONTRACT_ID` in your environment.

---

## 3. Choosing a Soroban RPC Provider
The node requires access to standard network endpoints to communicate with the ledger.

* **Endpoints:** Configure the `SOROBAN_RPC_URL` environment variable. 
* **Providers:** Use public endpoints from the Stellar Development Foundation (SDF) or a dedicated infrastructure provider. Note that Horizon endpoints are no longer utilized by the scheduler.

---

## 4. Running in Production

### Option A: Process Manager (PM2)
Ensure you compile the TypeScript source files before starting the process manager.

```bash
# Install PM2 globally
npm install pm2 -g 

# Build the project to generate the dist/ directory
npm run build

# Start the scheduler node
pm2 start dist/index.js --name "velox-scheduler" 

# Configure PM2 to launch on system boot
pm2 startup 
pm2 save
```

### Option B: Docker (Coming Soon)
*Note: Docker infrastructure is currently tracked under issue #2 ("Add Dockerfile and docker-compose for running the scheduler") and is not yet merged into the repository. The instructions below serve as a preview for when the Dockerfile is available.*

```bash
# Build the image (Once Dockerfile is added)
docker build -t velox-scheduler:latest .

# Run the container (Ensure no trailing spaces exist after the backslashes)
docker run -d \
  --name velox-scheduler \
  --restart unless-stopped \
  -e STELLAR_NETWORK="testnet" \
  -e OPERATOR_SECRET_KEY="your_secret_key_here" \
  -e SOROBAN_RPC_URL="your_soroban_rpc_url_here" \
  -e REGISTRY_CONTRACT_ID="your_registry_contract_id_here" \
  velox-scheduler:latest
```

---

## 5. Reading System Logs

* **PM2 Logs:**
  ```bash
  pm2 logs velox-scheduler
  ```
* **Docker Logs:**
  ```bash
  docker logs -f velox-scheduler
  ```
