# Local Development Guide

## Prerequisites
- Node.js >= 18
- npm install at project root

## Start Control Plane (Node.js Adapter)
```bash
cd control-plane
npm run dev:node
# OR: npx tsx src/node-adapter.ts
```

## Start Auth Service
```bash
cd auth-service
TEST_MODE=true npm run dev
# OR: npx tsx src/index.ts
```

## Verify
```bash
curl http://localhost:8787/health
# Expected: {"status":"ok","service":"control-plane","mode":"node-adapter",...}

curl http://localhost:9000/api/health
# Expected: {"status":"ok","service":"auth-service",...}
```

## Test Webhook
```bash
curl -X POST http://localhost:8787/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "x-github-event: pull_request" \
  -d '{"action":"opened","pull_request":{"number":1,"head":{"ref":"test"}},"repository":{"full_name":"test/repo"}}'

# Expected: {"message":"Webhook received, review initiated","sessionId":"run_...","deliveryId":"..."}
```
