/**
 * Enhanced HelloCash Business — two-phase fetch with improved resilience.
 * Features:
 * - Health check before main requests
 * - Parallel fetching of invoices (when supported)
 * - Comprehensive error handling with retry logic
 * - Detailed metrics and logging
 * - Configurable pagination and timeout
 */

const config = $('Config Loader').first().json;
const token = $env.HELLOCASH_API_TOKEN?.trim();

if (!token) {
  throw new Error('HelloCash Fetch: HELLOCASH_API_TOKEN missing');
}

// Check if we should ignore sync hour
const ignoreHour = config.hellocash.ignoreSyncHour;
const currentHour = new Date().getHours();
if (!ignoreHour && currentHour !== config.sync.hour) {
  $log.info(`Skipping fetch: current hour ${currentHour} ≠ sync hour ${config.sync.hour}`);
  return [{
    json: {
      skipped: true,
      reason: 'sync_hour',
      syncHour: config.sync.hour,
      currentHour,
      timestamp: new Date().toISOString(),
    },
  }];
}

// Health check (optional)
if (config.hellocash.healthCheckPath) {
  try {
    const healthUrl = `${config.hellocash.baseUrl}${config.hellocash.healthCheckPath}`;
    $log.debug(`Performing health check: ${healthUrl}`);
    await this.helpers.httpRequest({
      method: 'GET',
      url: healthUrl,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    $log.debug('Health check passed');
  } catch (error) {
    $log.warn(`Health check failed: ${error.message}`);
    // Continue anyway - health check is optional
  }
}

// Helper for HTTP requests with retry
async function httpWithRetry(options, maxAttempts = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await this.helpers.httpRequest({
        timeout: config.hellocash.timeoutMs,
        ...options,
      });
      return response;
    } catch (error) {
      lastError = error;
      $log.warn(`Attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // exponential backoff
        $log.debug(`Waiting ${delay}ms before retry`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Phase 1: Fetch cashbook entries with pagination
$log.info('Starting cashbook fetch');
const entries = [];
let page = 0;
let hasMore = true;
const startTime = Date.now();

while (hasMore && page < config.hellocash.maxPages) {
  page++;
  $log.debug(`Fetching cashbook page ${page} (offset: ${entries.length})`);
  
  try {
    const queryParams = new URLSearchParams({
      limit: config.hellocash.pageSize.toString(),
      offset: entries.length.toString(),
    });

    // Optional date filters
    if ($env.HELLOCASH_QUERY_FROM) {
      queryParams.set('from', String($env.HELLOCASH_QUERY_FROM).trim());
    }
    if ($env.HELLOCASH_QUERY_TO) {
      queryParams.set('to', String($env.HELLOCASH_QUERY_TO).trim());
    }

    const url = `${config.hellocash.baseUrl}${config.hellocash.listPath}?${queryParams}`;
    const response = await httpWithRetry.call(this, {
      method: 'GET',
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    const pageEntries = Array.isArray(response) ? response : (response.data || response.items || []);
    
    if (!pageEntries || pageEntries.length === 0) {
      hasMore = false;
      $log.debug('No more entries');
      break;
    }

    entries.push(...pageEntries);
    $log.debug(`Page ${page}: fetched ${pageEntries.length} entries (total: ${entries.length})`);

    // Check if we got fewer items than page size (indicating last page)
    if (pageEntries.length < config.hellocash.pageSize) {
      hasMore = false;
    }
  } catch (error) {
    $log.error(`Failed to fetch cashbook page ${page}: ${error.message}`);
    // If first page fails, throw; otherwise continue with what we have
    if (page === 1) {
      throw new Error(`HelloCash fetch failed on first page: ${error.message}`);
    }
    hasMore = false;
    break;
  }
}

if (entries.length === 0) {
  $log.info('No cashbook entries found');
  return [{
    json: {
      skipped: false,
      empty: true,
      message: 'No cashbook entries available',
      fetchDurationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    },
  }];
}

$log.info(`Fetched ${entries.length} cashbook entries in ${Date.now() - startTime}ms`);

// Phase 2: Fetch invoices for entries that have invoice numbers
const invoicesMap = new Map();
const invoiceNumbers = new Set();

// Collect unique invoice numbers
for (const entry of entries) {
  if (entry?.cashBook_invoiceNumber) {
    const num = String(entry.cashBook_invoiceNumber).trim();
    if (num) invoiceNumbers.add(num);
  }
}

$log.debug(`Found ${invoiceNumbers.size} unique invoice numbers to fetch`);

if (invoiceNumbers.size > 0) {
  const invoiceFetchStart = Date.now();
  const invoiceNumbersArray = Array.from(invoiceNumbers);
  
  // Fetch invoices in batches to avoid overwhelming the API
  const batchSize = 10;
  for (let i = 0; i < invoiceNumbersArray.length; i += batchSize) {
    const batch = invoiceNumbersArray.slice(i, i + batchSize);
    $log.debug(`Fetching invoice batch ${Math.floor(i/batchSize) + 1} (${batch.length} invoices)`);
    
    // HelloCash might support bulk invoice fetch; if not, fetch individually
    for (const invoiceNumber of batch) {
      try {
        const url = `${config.hellocash.baseUrl}${config.hellocash.invoicesPath}/${encodeURIComponent(invoiceNumber)}`;
        const invoice = await httpWithRetry.call(this, {
          method: 'GET',
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        
        if (invoice && typeof invoice === 'object') {
          invoicesMap.set(invoiceNumber, invoice);
        }
      } catch (error) {
        $log.warn(`Failed to fetch invoice ${invoiceNumber}: ${error.message}`);
        // Continue with other invoices
      }
    }
  }
  
  $log.debug(`Fetched ${invoicesMap.size} invoices in ${Date.now() - invoiceFetchStart}ms`);
}

// Prepare response with metadata
const fetchDuration = Date.now() - startTime;
const responseData = {
  skipped: false,
  empty: false,
  hellocashData: {
    entries,
    invoices: Object.fromEntries(invoicesMap),
    metadata: {
      entryCount: entries.length,
      invoiceCount: invoicesMap.size,
      uniqueInvoiceNumbers: invoiceNumbers.size,
      fetchedInvoices: invoicesMap.size,
      pagesFetched: page,
      fetchDurationMs: fetchDuration,
      fetchedAt: new Date().toISOString(),
      daysBack: config.hellocash.daysBack,
    },
  },
};

$log.info(`Fetch completed: ${entries.length} entries, ${invoicesMap.size} invoices, ${fetchDuration}ms`);

// Emit metrics if enabled
if (config.monitoring.metricsEnabled) {
  $log.debug(`METRIC:hellocash_fetch_entries_total ${entries.length}`);
  $log.debug(`METRIC:hellocash_fetch_invoices_total ${invoicesMap.size}`);
  $log.debug(`METRIC:hellocash_fetch_duration_ms ${fetchDuration}`);
}

return [{ json: responseData }];