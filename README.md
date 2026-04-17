# Enhanced HelloCash → Odoo Sync Workflow

## Overview
This is an enhanced version of the original HelloCash Business to Odoo accounting sync workflow from the [n8n-hosting-blumenladen](https://github.com/ovandunen/n8n-hosting-blumenladen) repository. The enhancements focus on production readiness, maintainability, and performance.

## What's New

### 1. **Batch Processing**
- Uses Odoo's `create_multi` API for bulk creation of account moves
- Configurable batch size via `ODOO_BATCH_SIZE` environment variable
- Significantly reduces API calls and improves performance

### 2. **Improved Error Handling**
- Comprehensive validation at each step
- Retry logic with exponential backoff for transient failures
- Partial failure handling (some moves can succeed while others fail)
- Detailed error logging with context

### 3. **Health Checks**
- Optional health checks for both HelloCash and Odoo APIs
- Early failure detection before processing data
- Configurable health check endpoints

### 4. **Enhanced Configuration**
- Structured validation of environment variables
- Default values for optional parameters
- Type coercion and range validation
- External mapping configuration support via YAML

### 5. **Monitoring & Observability**
- Structured logging with log levels
- Built-in metrics emission (when `METRICS_ENABLED=1`)
- Support for Sentry integration
- Execution timing and performance tracking

### 6. **Code Quality**
- Modular, well-documented source code
- Input validation and schema checking
- Idempotency guarantees (prevents duplicate entries)
- Test suite for mapping logic

## File Structure

```
workflows/helloCash-odoo-sync-enhanced/
├── src/
│   ├── 01-config-loader.js          # Enhanced configuration validation
│   ├── 02-hellocash-fetch.js        # Improved API fetching with pagination
│   ├── 03-map-to-odoo.js            # Enhanced mapping with batch support
│   └── 04-odoo-post-moves.js        # Batch creation using create_multi
├── mapping-config.yaml              # External configuration template
├── build-enhanced.mjs               # Enhanced build script with validation
├── helloCash-odoo-sync-enhanced.workflow.json  # Generated workflow
├── README-ENHANCED.md               # This documentation
└── tests/
    └── mapping.test.js              # Test suite for mapping logic
```

## Installation

### Option 1: Import into n8n
1. Download `helloCash-odoo-sync-enhanced.workflow.json`
2. In n8n, go to Workflows → Import from file
3. Select the JSON file
4. Configure environment variables

### Option 2: Build from source
```bash
cd workflows/helloCash-odoo-sync-enhanced
npm install
npm run build  # Generates the workflow JSON
```

## Configuration

### Required Environment Variables
See `README-ENHANCED.md` for complete list.

### Optional Features
- Set `METRICS_ENABLED=1` for performance metrics
- Set `LOG_LEVEL=debug` for detailed logging
- Configure `SENTRY_DSN` for error tracking
- Use `HELLOCASH_MAPPING_CONFIG_URL` for external configuration

## Performance Considerations

### Batch Size
- Default batch size: 10 moves
- Adjust based on Odoo performance and network latency
- Larger batches reduce API calls but increase memory usage

### Pagination
- Default page size: 100 entries
- Adjust `HELLOCASH_PAGE_SIZE` based on API limits
- Use `HELLOCASH_MAX_PAGES` to limit total fetched entries

### Retry Logic
- Default: 3 retries with exponential backoff
- Configurable via `ODOO_MAX_RETRIES` and `ODOO_RETRY_DELAY_MS`
- Authentication errors are not retried

## Monitoring

### Logs
- Check n8n execution logs for detailed output
- Use `LOG_LEVEL` to control verbosity
- Errors are logged with full context

### Metrics (when enabled)
- `hellocash_fetch_entries_total`: Number of entries fetched
- `hellocash_fetch_duration_ms`: Fetch execution time
- `mapping_moves_created`: Number of moves created
- `odoo_batches_total`: Number of batches processed
- `odoo_post_duration_ms`: Total Odoo post time

### Alerting
- Configure n8n to send error emails
- Set up monitoring on error rates
- Monitor sync hour compliance

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify `HELLOCASH_API_TOKEN` and `ODOO_PASSWORD`
   - Check token expiration
   - Verify Odoo user permissions

2. **Performance Issues**
   - Reduce batch size if timeouts occur
   - Increase timeouts for large datasets
   - Check network latency between services

3. **Duplicate Entries**
   - The workflow uses `ref` field for idempotency
   - Verify `cashBook_id` is unique and stable
   - Check for manual interventions in Odoo

4. **Tax Calculation Errors**
   - Verify `TAX_ID_19` and `TAX_ID_7` are correct Odoo tax IDs
   - Check HelloCash invoice tax rates
   - Validate account mappings

## Migration from Original Version

1. **Export existing workflow** from n8n
2. **Import enhanced workflow**
3. **Update environment variables** with new optional parameters
4. **Test thoroughly** with manual execution
5. **Monitor** for any issues during initial runs

## Contributing

### Adding New Features
1. Modify source files in `src/`
2. Update tests in `tests/`
3. Run `npm test` to verify changes
4. Run `npm run build` to generate updated workflow
5. Update documentation

### Reporting Issues
Please include:
- n8n version
- Error logs
- Environment configuration (redacted)
- Steps to reproduce

## License
Based on original work from [ovandunen/n8n-hosting-blumenladen](https://github.com/ovandunen/n8n-hosting-blumenladen).
Enhanced version licensed under MIT.

## Support
- For n8n issues: [n8n community](https://community.n8n.io/)
- For HelloCash API: [HelloCash documentation](https://developer.hellocash.business/)
- For Odoo: [Odoo documentation](https://www.odoo.com/documentation/)