# Enhanced HelloCash → Odoo Sync Workflow

## Overview
This enhanced version of the HelloCash to Odoo sync workflow includes improvements for production use:

### Key Enhancements
1. **Batch Processing**: Uses Odoo's `create_multi` for efficient bulk creation
2. **Improved Error Handling**: Comprehensive validation and retry logic
3. **Health Checks**: Optional health checks for HelloCash and Odoo APIs
4. **Monitoring**: Built-in metrics and structured logging
5. **Configurable Mapping**: External YAML configuration support
6. **Idempotency**: Prevents duplicate entries via unique references

## Environment Variables

### Required
```
HELLOCASH_BASE_URL=https://api.hellocash.business
HELLOCASH_API_TOKEN=your_token
ODOO_BASE_URL=https://your-odoo-instance
ODOO_DB=your_database
ODOO_UID=your_user_id
ODOO_PASSWORD=your_password
ODOO_JOURNAL_ID=1
ACCOUNT_KASSE=1000
ACCOUNT_BANK=1200
ACCOUNT_ERLOESE=4000
ACCOUNT_GUTSCHEIN=1300
TAX_ID_19=1
TAX_ID_7=2
SYNC_HOUR=2
ERROR_EMAIL=admin@example.com
```

### Optional
```
HELLOCASH_PAGE_SIZE=100
HELLOCASH_MAX_PAGES=10
HELLOCASH_DAYS_BACK=1
ODOO_BATCH_SIZE=10
ODOO_MAX_RETRIES=3
ODOO_RETRY_DELAY_MS=300000
LOG_LEVEL=info
METRICS_ENABLED=0
```

## Deployment

### Docker Compose
Use the included `docker-compose/withPostgresAndWorker/` directory for production deployment with queue mode.

### Kubernetes
Use the Helm chart in `charts/n8n/` for Kubernetes deployment.

## Monitoring
- Check n8n execution logs for detailed information
- Enable metrics with `METRICS_ENABLED=1` for performance tracking
- Set up alerting on error emails

## Testing
Run the workflow manually first to verify configuration. Check each node's output for validation errors.

## Support
For issues, check the original repository: https://github.com/ovandunen/n8n-hosting-blumenladen
