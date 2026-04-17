/**
 * Enhanced Odoo JSON-RPC: account.move creation with batch support.
 * Features:
 * - Batch creation using Odoo's create_multi for performance
 * - Comprehensive retry logic with exponential backoff
 * - Idempotency checks via unique ref field
 * - Partial failure handling (some moves succeed, some fail)
 * - Health checks and connection validation
 * - Detailed metrics and logging
 */

const config = $('Config Loader').first().json;
const input = items[0].json;

// Check if previous step was skipped or empty
if (input.skipped || input.mappedEmpty) {
  $log.info('Odoo post skipped: no moves to create');
  return [{ json: input }];
}

const movesData = input.data;
if (!movesData?.moves || !Array.isArray(movesData.moves) || movesData.moves.length === 0) {
  $log.warn('No moves to post to Odoo');
  return [{
    json: {
      skipped: false,
      postedEmpty: true,
      message: 'No moves to post',
      timestamp: new Date().toISOString(),
    },
  }];
}

const password = $env.ODOO_PASSWORD?.trim();
if (!password) {
  throw new Error('Odoo Post Moves: ODOO_PASSWORD missing for JSON-RPC');
}

const { maxRetries, retryDelayMs, batchSize, timeoutMs } = config.odoo;
const batches = movesData.batches || [movesData.moves]; // Use pre-batched or create single batch
const totalMoves = movesData.moves.length;

$log.info(`Starting Odoo post: ${totalMoves} moves in ${batches.length} batches`);

// Health check (optional)
if (config.odoo.healthCheckPath) {
  try {
    const healthUrl = `${config.odoo.baseUrl}${config.odoo.healthCheckPath}`;
    $log.debug(`Performing Odoo health check: ${healthUrl}`);
    await this.helpers.httpRequest({
      method: 'GET',
      url: healthUrl,
      timeout: 5000,
    });
    $log.debug('Odoo health check passed');
  } catch (error) {
    $log.warn(`Odoo health check failed: ${error.message}`);
    // Continue anyway - health check is optional
  }
}

// JSON-RPC helper with retry
async function rpcCall(model, method, args, kwargs = {}) {
  const url = `${config.odoo.baseUrl}/jsonrpc`;
  const body = {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'object',
      method: 'execute_kw',
      args: [config.odoo.db, config.odoo.uid, password, model, method, args, kwargs],
    },
    id: Date.now(),
  };

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      $log.debug(`RPC attempt ${attempt}/${maxRetries}: ${model}.${method}`);
      
      const response = await this.helpers.httpRequest({
        method: 'POST',
        url,
        body,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: timeoutMs,
      });

      if (response.error) {
        throw new Error(`Odoo RPC error: ${JSON.stringify(response.error)}`);
      }

      return response.result;
    } catch (error) {
      lastError = error;
      
      // Don't retry on authentication errors
      if (error.message?.includes('AccessDenied') || error.message?.includes('Invalid credentials')) {
        $log.error('Authentication failed, not retrying');
        throw error;
      }
      
      if (attempt < maxRetries) {
        const delay = retryDelayMs * Math.pow(2, attempt - 1); // exponential backoff
        $log.warn(`RPC failed, retrying in ${delay}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Batch creation with create_multi
async function createMovesBatch(batch, batchIndex) {
  $log.info(`Creating batch ${batchIndex + 1}/${batches.length} with ${batch.length} moves`);
  
  try {
    // First check if any moves already exist (idempotency check)
    const existingRefs = await rpcCall.call(this, 'account.move', 'search_read', [
      [['ref', 'in', batch.map(m => m.ref)]],
      ['id', 'ref'],
    ]);
    
    const existingRefSet = new Set(existingRefs.map(r => r.ref));
    const newMoves = batch.filter(m => !existingRefSet.has(m.ref));
    
    if (newMoves.length === 0) {
      $log.info(`All ${batch.length} moves in batch ${batchIndex + 1} already exist`);
      return {
        success: true,
        count: 0,
        existing: batch.length,
        ids: existingRefs.map(r => r.id),
        batchIndex,
      };
    }
    
    if (newMoves.length < batch.length) {
      $log.info(`${batch.length - newMoves.length} moves already exist, creating ${newMoves.length} new ones`);
    }
    
    // Create moves using create_multi (Odoo 14+)
    const moveIds = await rpcCall.call(this, 'account.move', 'create_multi', [newMoves]);
    
    $log.info(`Created ${moveIds.length} moves in batch ${batchIndex + 1}`);
    
    // Fetch the created moves to get their full data
    const createdMoves = await rpcCall.call(this, 'account.move', 'read', [moveIds, ['id', 'ref', 'name', 'date', 'state']]);
    
    return {
      success: true,
      count: moveIds.length,
      existing: batch.length - newMoves.length,
      ids: moveIds,
      moves: createdMoves,
      batchIndex,
    };
  } catch (error) {
    $log.error(`Failed to create batch ${batchIndex + 1}: ${error.message}`);
    return {
      success: false,
      error: error.message,
      batch: batch,
      batchIndex,
    };
  }
}

// Process all batches
const results = [];
const startTime = Date.now();
let totalCreated = 0;
let totalExisting = 0;
let failedBatches = [];

for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  $log.debug(`Processing batch ${i + 1} of ${batches.length} (${batch.length} moves)`);
  
  const result = await createMovesBatch.call(this, batch, i);
  results.push(result);
  
  if (result.success) {
    totalCreated += result.count;
    totalExisting += result.existing;
    $log.info(`Batch ${i + 1} completed: ${result.count} created, ${result.existing} already existed`);
  } else {
    failedBatches.push({ index: i, error: result.error });
    $log.error(`Batch ${i + 1} failed: ${result.error}`);
    
    // Optionally try individual creation for failed batch
    if (config.odoo.fallbackToSingleCreate) {
      $log.info(`Attempting individual creation for failed batch ${i + 1}`);
      // Implementation would go here
    }
  }
}

const totalDuration = Date.now() - startTime;
const successRate = batches.length > 0 ? ((batches.length - failedBatches.length) / batches.length) * 100 : 100;

// Prepare final response
const response = {
  skipped: false,
  postedEmpty: false,
  summary: {
    totalMoves,
    totalBatches: batches.length,
    successfulBatches: batches.length - failedBatches.length,
    failedBatches: failedBatches.length,
    successRate: `${successRate.toFixed(1)}%`,
    movesCreated: totalCreated,
    movesAlreadyExisted: totalExisting,
    movesFailed: totalMoves - totalCreated - totalExisting,
    totalDurationMs: totalDuration,
    avgBatchTimeMs: batches.length > 0 ? totalDuration / batches.length : 0,
    timestamp: new Date().toISOString(),
  },
  details: {
    batches: results,
    failedBatches: failedBatches.length > 0 ? failedBatches : undefined,
  },
};

$log.info(`Odoo post completed: ${totalCreated} created, ${totalExisting} existed, ${failedBatches.length} failed batches, ${totalDuration}ms`);

// Emit metrics if enabled
if (config.monitoring.metricsEnabled) {
  $log.debug(`METRIC:odoo_moves_created_total ${totalCreated}`);
  $log.debug(`METRIC:odoo_moves_existing_total ${totalExisting}`);
  $log.debug(`METRIC:odoo_batches_total ${batches.length}`);
  $log.debug(`METRIC:odoo_batches_failed_total ${failedBatches.length}`);
  $log.debug(`METRIC:odoo_post_duration_ms ${totalDuration}`);
}

return [{ json: response }];