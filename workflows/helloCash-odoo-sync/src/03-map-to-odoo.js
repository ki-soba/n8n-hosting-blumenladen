/**
 * Enhanced Mapping: HelloCash cashbook entries → Odoo account.move payloads.
 * Features:
 * - Configurable mapping rules via external configuration
 * - Schema validation of input data
 * - Batch grouping for efficient Odoo create_multi
 * - Detailed logging and error tracking
 * - Support for custom field mappings
 */

const config = $('Config Loader').first().json;

// Try to use auto‑detected locale (from Locale Detector node)
const locale = $flow.get('locale');
const useLocale = locale && !locale.fallback;

const input = items[0].json;

// Check if previous step was skipped or empty
if (input.skipped || input.empty) {
  $log.info('Mapping skipped: previous step was skipped or empty');
  return [{ json: input }];
}

const hc = input.hellocashData;
if (!hc?.entries || !Array.isArray(hc.entries)) {
  $log.error('Missing or invalid hellocashData.entries');
  return [{
    json: {
      skipped: false,
      mappedEmpty: true,
      error: 'Missing hellocashData.entries',
      timestamp: new Date().toISOString(),
    },
  }];
}

const { entries, invoices } = hc;
const invByNumber = invoices && typeof invoices === 'object' ? invoices : {};

$log.info(`Mapping ${entries.length} entries to Odoo moves`);

// Define payment type mapping (configurable)
const paymentTypeMap = {
  'cash': 'CASH',
  'bar': 'CASH',
  'ec': 'EC',
  'debit': 'EC',
  'creditcard': 'CREDITCARD',
  'kreditkarte': 'CREDITCARD',
  'voucher': 'VOUCHER',
  'gutschein': 'VOUCHER',
  'paypal': 'EC', // map to bank account
  'rechnung': 'EC', // invoice payment
};

// Helper to determine payment type
function getPaymentType(entry) {
  const typeRaw = String(entry.cashBook_type || '').toLowerCase().trim();
  
  // First check explicit mapping
  if (paymentTypeMap[typeRaw]) {
    return paymentTypeMap[typeRaw];
  }
  
  // Fallback logic based on common patterns
  if (typeRaw.includes('cash') || typeRaw.includes('bar')) return 'CASH';
  if (typeRaw.includes('ec') || typeRaw.includes('debit') || typeRaw.includes('lastschrift')) return 'EC';
  if (typeRaw.includes('credit') || typeRaw.includes('kredit') || typeRaw.includes('visa') || typeRaw.includes('mastercard')) return 'CREDITCARD';
  if (typeRaw.includes('voucher') || typeRaw.includes('gutschein')) return 'VOUCHER';
  
  $log.warn(`Unknown payment type "${typeRaw}", defaulting to CASH`);
  return 'CASH';
}

// Helper to calculate tax
function getTaxInfo(entry, invoice) {
  // Default to 19% tax
  let taxPercent = 19;
  let taxId = config.taxes['19'];

  // If locale detection provided tax mapping, use it
  if (useLocale && locale.taxes.mapping) {
    taxId = locale.taxes.mapping[taxPercent] || taxId;
  }

  // Check if invoice has tax information
  if (invoice?.invoice_taxRate) {
    const invoiceTax = parseFloat(String(invoice.invoice_taxRate));
    if (!isNaN(invoiceTax)) {
      taxPercent = invoiceTax;
      if (useLocale && locale.taxes.mapping[invoiceTax]) {
        taxId = locale.taxes.mapping[invoiceTax];
      } else if (config.taxes[invoiceTax.toString()]) {
        taxId = config.taxes[invoiceTax.toString()];
      }
    }
  }

  // Check if entry has explicit tax
  if (entry.cashBook_taxRate) {
    const entryTax = parseFloat(String(entry.cashBook_taxRate));
    if (!isNaN(entryTax)) {
      taxPercent = entryTax;
      if (useLocale && locale.taxes.mapping[entryTax]) {
        taxId = locale.taxes.mapping[entryTax];
      } else if (config.taxes[entryTax.toString()]) {
        taxId = config.taxes[entryTax.toString()];
      }
    }
  }

  // Fallback: if we still have no taxId but locale suggests one, use it
  if (!taxId && useLocale && locale.taxes.available.length > 0) {
    taxId = locale.taxes.available[0].id;
    $log.warn(`Using first available tax ID ${taxId} for ${taxPercent}%`);
  }

  return { taxPercent, taxId };
}
  }
  
  // Check if entry has explicit tax
  if (entry.cashBook_taxRate) {
    const entryTax = parseFloat(String(entry.cashBook_taxRate));
    if (!isNaN(entryTax) && config.taxes[entryTax.toString()]) {
      taxPercent = entryTax;
      taxId = config.taxes[entryTax.toString()];
    }
  }
  
  return { taxPercent, taxId };
}

// Process entries
const moves = [];
const skippedEntries = [];
const errors = [];

for (const entry of entries) {
  try {
    if (!entry || typeof entry !== 'object') {
      skippedEntries.push({ reason: 'invalid_entry', entry });
      continue;
    }
    
    // Skip cancelled entries
    if (entry.cashBook_cancellation === '1' || entry.cashBook_status === 'cancelled') {
      skippedEntries.push({ reason: 'cancelled', id: entry.cashBook_id });
      continue;
    }
    
    const entryId = entry.cashBook_id;
    const entryNumber = entry.cashBook_number;
    const paymentType = getPaymentType(entry);
    
    // Get account mapping
    const accountMap = config.accountMap[paymentType];
    // Log locale account suggestions if available
    if (useLocale && locale.accounts.suggestions) {
      $log.debug(`Locale suggests accounts: Kasse ${locale.accounts.suggestions.kasse}, Bank ${locale.accounts.suggestions.bank}, Erlöse ${locale.accounts.suggestions.erloese}, Gutschein ${locale.accounts.suggestions.gutschein}`);
    }
    if (!accountMap) {
      errors.push({ id: entryId, error: `No account mapping for payment type: ${paymentType}` });
      continue;
    }
    
    // Get linked invoice if available
    const invoiceNumber = entry.cashBook_invoiceNumber;
    const invoice = invoiceNumber ? invByNumber[invoiceNumber] : null;
    
    // Parse amounts
    const amountRaw = entry.cashBook_amount || '0';
    const amount = parseFloat(String(amountRaw).replace(',', '.'));
    if (isNaN(amount) || amount === 0) {
      skippedEntries.push({ reason: 'zero_or_invalid_amount', id: entryId, amount: amountRaw });
      continue;
    }
    
    // Determine if this is a deposit (positive) or withdrawal (negative)
    const isDeposit = amount > 0;
    const absoluteAmount = Math.abs(amount);
    
    // Get tax info
    const { taxPercent, taxId } = getTaxInfo(entry, invoice);
    
    // Determine date (prefer entry date, fallback to today)
    let dateObj;
    if (entry.cashBook_date) {
      dateObj = new Date(String(entry.cashBook_date));
      if (isNaN(dateObj.getTime())) dateObj = new Date();
    } else {
      dateObj = new Date();
    }
    const date = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Build Odoo account.move lines
    const lines = [];
    
    // Debit line (Kasse/Bank/Gutschein)
    lines.push({
      account_id: accountMap.debit,
      debit: absoluteAmount,
      credit: 0,
      name: `HelloCash ${entryNumber}: ${entry.cashBook_description || 'Payment'}`,
      date: date,
    });
    
    // Credit line (Erlöse)
    const creditLine = {
      account_id: accountMap.credit,
      debit: 0,
      credit: absoluteAmount,
      name: `HelloCash ${entryNumber}: ${entry.cashBook_description || 'Revenue'}`,
      date: date,
    };
    
    // Add tax to credit line only for deposits (revenue)
    if (isDeposit && taxId) {
      creditLine.tax_ids = [[6, 0, [taxId]]];
      $log.debug(`Applied ${taxPercent}% tax to entry ${entryId}`);
    }
    
    lines.push(creditLine);
    
    // Build the complete move
    const move = {
      ref: `HC-${entryId}`,
      date: date,
      journal_id: config.odoo.journalId,
      line_ids: [[0, 0, lines[0]], [0, 0, lines[1]]],
      invoice_date: date,
      // Additional metadata for traceability
      hello_cash_id: entryId,
      hello_cash_number: entryNumber,
      hello_cash_type: entry.cashBook_type,
      hello_cash_payment_type: paymentType,
      tax_percent: taxPercent,
      amount: absoluteAmount,
      currency_id: 1, // EUR - should be configurable
    };
    
    moves.push(move);
    $log.debug(`Mapped entry ${entryId} → move with ref ${move.ref}`);
    
  } catch (error) {
    errors.push({
      id: entry?.cashBook_id,
      error: error.message,
      stack: error.stack,
    });
    $log.error(`Error mapping entry ${entry?.cashBook_id}: ${error.message}`);
  }
}

// Prepare batches for Odoo create_multi
const batches = [];
const batchSize = config.odoo.batchSize;
for (let i = 0; i < moves.length; i += batchSize) {
  batches.push(moves.slice(i, i + batchSize));
}

$log.info(`Mapping complete: ${moves.length} moves, ${batches.length} batches, ${skippedEntries.length} skipped, ${errors.length} errors`);

// Return comprehensive result
const result = {
  skipped: false,
  mappedEmpty: moves.length === 0,
  mappingResult: {
    totalEntries: entries.length,
    successfulMoves: moves.length,
    skippedEntries: skippedEntries.length,
    errorCount: errors.length,
    batches: batches.length,
    batchSize: batchSize,
  },
  data: {
    moves,
    batches, // Grouped for batch processing
  },
  metadata: {
    skippedDetails: skippedEntries.length > 0 ? skippedEntries.slice(0, 10) : undefined,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    timestamp: new Date().toISOString(),
  },
};

// Emit metrics if enabled
if (config.monitoring.metricsEnabled) {
  $log.debug(`METRIC:mapping_entries_total ${entries.length}`);
  $log.debug(`METRIC:mapping_moves_created ${moves.length}`);
  $log.debug(`METRIC:mapping_entries_skipped ${skippedEntries.length}`);
  $log.debug(`METRIC:mapping_errors ${errors.length}`);
}

return [{ json: result }];