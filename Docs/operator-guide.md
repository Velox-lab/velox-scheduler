# Operator Running Guide 
  
This guide provides instructions for configuring, funding, and running the scheduler node in production on the Stellar network. 
  
--- 
  
## 1. Creating and Funding the Operator Account 
The scheduler requires a dedicated account to sign and execute transactions. 
  
* **Generate Keypair:** Create an independent Stellar keypair for this node. The secret key starts with `S`. 
* **Funding (Testnet):** Fund the public key using the Stellar Friendbot faucet. 
* **Funding (Mainnet):** Maintain a native XLM balance to cover transaction fees and base reserves. 
* **Token Approvals:** Senders must explicitly approve each schedule on the targeted token contract before execution. 
  
## 2. Finding the VeloxRegistry Contract ID 
The scheduler tracks a registry contract to verify automation schedules. 
  
* **Testnet:** Locate the active contract ID (starts with `C`) in `ARCHITECTURE.md` or your deployment logs. 
* **Mainnet:** Reference official production deployment logs. 
* **Variable:** Set this value as `REGISTRY_CONTRACT_ID` in your environment.
  
## 3. Choosing a Soroban RPC Provider 
The node requires access to standard network endpoints to communicate with the ledger. 
  
* **Endpoints:** Configure `SOROBAN_RPC_URL` and `HORIZON_URL`. 
* **Providers:** Use public endpoints from the Stellar Development Foundation (SDF) or a dedicated infrastructure provider. 
  
## 4. Running in Production 
  
### Option A: Process Manager (PM2) 
```bash 
npm install pm2 -g  
pm2 start dist/index.js --name "velox-scheduler"  
pm2 startup  
pm2 save 
``` 
  
### Option B: Docker (Recommended) 
```bash 
# Build the image
docker build -t velox-scheduler:latest .

# Run the container
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
  
* **PM2 Logs:** 
   ```bash 
   pm2 logs velox-scheduler 
   ``` 
* **Docker Logs:** 
   ```bash 
   docker logs -f velox-scheduler 
   ```
