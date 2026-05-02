# GitHub App Setup

1. Go to GitHub Settings > Developer settings > GitHub Apps > New GitHub App
2. Name: CodeNexus
3. Webhook URL: https://your-domain.com/api/webhooks/github
4. Webhook Secret: [generate and set CNX_GITHUB_WEBHOOK_SECRET env var]
5. Permissions:
   - Pull requests: Read & Write
   - Checks: Read & Write
   - Contents: Read-only
   - Issues: Read & Write
   - Metadata: Read-only
6. Events: Pull request, Pull request review, Issue comment, Check suite
7. Generate private key > download > set GITHUB_APP_PRIVATE_KEY
8. Set env vars: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID
