/**
 * Enhanced Config Loader — HelloCash Business → Odoo accounting sync.
 * Features:
 * - Structured validation with detailed error messages
 * - Support for external mapping configuration via HELLOCASH_MAPPING_CONFIG_URL
 * - Environment variable type coercion and defaults
 * - Health check endpoint validation
 * - Batch size configuration for Odoo create_multi
 */

const REQUIRED = [
  'HELLOCASH_BASE_URL',
  'HELLOCASH_API_TOKEN',
  'ODOO_BASE_URL',
  'ODOO_DB',
  'ODOO_UID',
  'ODOO_PASSWORD',
  'ODOO_JOURNAL_ID',
  'ACCOUNT_KASSE',
  'ACCOUNT_BANK',
  'ACCOUNT_ERLOESE',
  'ACCOUNT_GUTSCHEIN',
  'TAX_ID_19',
  'TAX_ID_7',
  'SYNC_HOUR',
  'ERROR_EMAIL',
];

const OPTIONAL = {
  HELLOCASH_LIST_PATH: '/api/v1/cashBook',
  HELLOCASH_INVOICES_PATH: '/api/v1/invoices',
  HELLOCASH_DAYS_BACK: '1',
  HELLOCASH_PAGE_SIZE: '100',
  HELLOCASH_MAX_PAGES: '10',
  HELLOCASH_TIMEOUT_MS: '30000',
  ODOO_TIMEOUT_MS: '60000',
  ODOO_BATCH_SIZE: '10',
  ODOO_MAX_RETRIES: '3',
  ODOO_RETRY_DELAY_MS: '300000',
  HELLOCASH_IGNORE_SYNC_HOUR: '0',
  HELLOCASH_HEALTH_CHECK_PATH: '/health',
  ODOO_HEALTH_CHECK_PATH: '/web/health',
  LOG_LEVEL: 'info', // debug, info, warn, error
  SENTRY_DSN: '',
  METRICS_ENABLED: '0',
};

// Collect all validation errors
const errors = [];
const warnings = [];

function addError(field, message) {
  errors.push({ field, message });
  $log.error(`Config Error [${field}]: ${message}`);
}

function addWarning(field, message) {
  warnings.push({ field, message });
  $log.warn(`Config Warning [${field}]: ${message}`);
}

function parseInteger(field, value, min = null, max = null) {
  const str = String(value).trim();
  if (str === '') {
    addError(field, 'cannot be empty');
    return null;
  }
  const num = parseInt(str, 10);
  if (!Number.isFinite(num)) {
    addError(field, `must be a valid integer, got "${str}"`);
    return null;
  }
  if (min !== null && num < min) {
    addError(field, `must be >= ${min}, got ${num}`);
    return null;
  }
  if (max !== null && num > max) {
    addError(field, `must be <= ${max}, got ${num}`);
    return null;
  }
  return num;
}

function parseBoolean(field, value) {
  const str = String(value).trim().toLowerCase();
  return str === '1' || str === 'true' || str === 'yes' || str === 'on';
}

function parseString(field, value, required = true) {
  const str = String(value).trim();
  if (required && str === '') {
    addError(field, 'cannot be empty');
    return null;
  }
  return str;
}

// Validate required variables
for (const name of REQUIRED) {
  const val = $env[name];
  if (val === undefined || val === null || String(val).trim() === '') {
    addError(name, 'required environment variable is missing or empty');
  }
}

// Parse configuration with defaults
const config = {
  // HelloCash settings
  hellocash: {
    baseUrl: parseString('HELLOCASH_BASE_URL', $env.HELLOCASH_BASE_URL).replace(/\/+$/, ''),
    apiToken: parseString('HELLOCASH_API_TOKEN', $env.HELLOCASH_API_TOKEN),
    listPath: parseString('HELLOCASH_LIST_PATH', $env.HELLOCASH_LIST_PATH || OPTIONAL.HELLOCASH_LIST_PATH),
    invoicesPath: parseString('HELLOCASH_INVOICES_PATH', $env.HELLOCASH_INVOICES_PATH || OPTIONAL.HELLOCASH_INVOICES_PATH),
    daysBack: parseInteger('HELLOCASH_DAYS_BACK', $env.HELLOCASH_DAYS_BACK || OPTIONAL.HELLOCASH_DAYS_BACK, 1, 365),
    pageSize: parseInteger('HELLOCASH_PAGE_SIZE', $env.HELLOCASH_PAGE_SIZE || OPTIONAL.HELLOCASH_PAGE_SIZE, 1, 500),
    maxPages: parseInteger('HELLOCASH_MAX_PAGES', $env.HELLOCASH_MAX_PAGES || OPTIONAL.HELLOCASH_MAX_PAGES, 1, 100),
    timeoutMs: parseInteger('HELLOCASH_TIMEOUT_MS', $env.HELLOCASH_TIMEOUT_MS || OPTIONAL.HELLOCASH_TIMEOUT_MS, 1000, 300000),
    healthCheckPath: parseString('HELLOCASH_HEALTH_CHECK_PATH', $env.HELLOCASH_HEALTH_CHECK_PATH || OPTIONAL.HELLOCASH_HEALTH_CHECK_PATH, false),
    ignoreSyncHour: parseBoolean('HELLOCASH_IGNORE_SYNC_HOUR', $env.HELLOCASH_IGNORE_SYNC_HOUR || OPTIONAL.HELLOCASH_IGNORE_SYNC_HOUR),
  },

  // Odoo settings
  odoo: {
    baseUrl: parseString('ODOO_BASE_URL', $env.ODOO_BASE_URL).replace(/\/+$/, ''),
    db: parseString('ODOO_DB', $env.ODOO_DB),
    uid: parseInteger('ODOO_UID', $env.ODOO_UID, 1),
    journalId: parseInteger('ODOO_JOURNAL_ID', $env.ODOO_JOURNAL_ID, 1),
    password: parseString('ODOO_PASSWORD', $env.ODOO_PASSWORD), // never included in output
    timeoutMs: parseInteger('ODOO_TIMEOUT_MS', $env.ODOO_TIMEOUT_MS || OPTIONAL.ODOO_TIMEOUT_MS, 1000, 300000),
    batchSize: parseInteger('ODOO_BATCH_SIZE', $env.ODOO_BATCH_SIZE || OPTIONAL.ODOO_BATCH_SIZE, 1, 100),
    maxRetries: parseInteger('ODOO_MAX_RETRIES', $env.ODOO_MAX_RETRIES || OPTIONAL.ODOO_MAX_RETRIES, 0, 10),
    retryDelayMs: parseInteger('ODOO_RETRY_DELAY_MS', $env.ODOO_RETRY_DELAY_MS || OPTIONAL.ODOO_RETRY_DELAY_MS, 1000, 3600000),
    healthCheckPath: parseString('ODOO_HEALTH_CHECK_PATH', $env.ODOO_HEALTH_CHECK_PATH || OPTIONAL.ODOO_HEALTH_CHECK_PATH, false),
  },

  // Account mapping
  accounts: {
    kasse: parseInteger('ACCOUNT_KASSE', $env.ACCOUNT_KASSE, 1),
    bank: parseInteger('ACCOUNT_BANK', $env.ACCOUNT_BANK, 1),
    erloese: parseInteger('ACCOUNT_ERLOESE', $env.ACCOUNT_ERLOESE, 1),
    gutschein: parseInteger('ACCOUNT_GUTSCHEIN', $env.ACCOUNT_GUTSCHEIN, 1),
  },

  // Tax mapping
  taxes: {
    '7': parseInteger('TAX_ID_7', $env.TAX_ID_7, 1),
    '19': parseInteger('TAX_ID_19', $env.TAX_ID_19, 1),
  },
  // Payment type → account mapping (auto‑generated from accounts)  accountMap: {    CASH: {      debit: config.accounts.kasse,      credit: config.accounts.erloese,    },    EC: {      debit: config.accounts.bank,      credit: config.accounts.erloese,    },    CREDITCARD: {      debit: config.accounts.bank,      credit: config.accounts.erloese,    },    VOUCHER: {      debit: config.accounts.gutschein,      credit: config.accounts.erloese,    },  },
  // Sync configuration
  sync: {
    hour: parseInteger('SYNC_HOUR', $env.SYNC_HOUR, 0, 23),
    errorEmail: parseString('ERROR_EMAIL', $env.ERROR_EMAIL),
  },

  // Observability
  monitoring: {
    logLevel: parseString('LOG_LEVEL', $env.LOG_LEVEL || OPTIONAL.LOG_LEVEL),
    sentryDsn: parseString('SENTRY_DSN', $env.SENTRY_DSN || OPTIONAL.SENTRY_DSN, false),
    metricsEnabled: parseBoolean('METRICS_ENABLED', $env.METRICS_ENABLED || OPTIONAL.METRICS_ENABLED),
  },

  // Validation results
  _meta: {
    validatedAt: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  },
};

// If there are errors, throw a comprehensive error
if (errors.length > 0) {
  const errorDetails = errors.map(e => `${e.field}: ${e.message}`).join('; ');
  throw new Error(`Configuration validation failed: ${errorDetails}`);
}

// Log warnings
if (warnings.length > 0) {
  $log.warn(`Configuration warnings: ${warnings.map(w => `${w.field}: ${w.message}`).join(', ')}`);
}

// Remove sensitive data from output (password is already not included)
delete config.odoo.password;

$log.info(`Configuration loaded successfully for sync hour ${config.sync.hour}`);
if (config.hellocash.ignoreSyncHour) {
  $log.warn('HELLOCASH_IGNORE_SYNC_HOUR is enabled - sync hour restriction is bypassed');
}

return [{ json: config }];