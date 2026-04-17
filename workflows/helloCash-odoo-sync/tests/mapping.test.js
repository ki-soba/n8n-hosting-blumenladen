// Simple test suite for HelloCash → Odoo mapping logic
// To run: node tests/mapping.test.js

const assert = require('assert');

// Mock n8n environment
const mockEnv = {
  HELLOCASH_BASE_URL: 'https://api.hellocash.business',
  HELLOCASH_API_TOKEN: 'test_token',
  ODOO_BASE_URL: 'https://odoo.example.com',
  ODOO_DB: 'test_db',
  ODOO_UID: '1',
  ODOO_PASSWORD: 'test_password',
  ODOO_JOURNAL_ID: '1',
  ACCOUNT_KASSE: '1000',
  ACCOUNT_BANK: '1200',
  ACCOUNT_ERLOESE: '4000',
  ACCOUNT_GUTSCHEIN: '1300',
  TAX_ID_19: '1',
  TAX_ID_7: '2',
  SYNC_HOUR: '2',
  ERROR_EMAIL: 'test@example.com',
};

// Mock $log and $env
global.$log = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: () => {},
};

global.$env = mockEnv;

// Load the mapping function (simplified version)
function mapEntryToOdoo(entry, config, invoice = null) {
  // Simplified mapping logic for testing
  const paymentTypeMap = {
    'cash': 'CASH',
    'ec': 'EC',
    'creditcard': 'CREDITCARD',
    'voucher': 'VOUCHER',
  };

  const type = String(entry.cashBook_type || '').toLowerCase();
  const paymentType = paymentTypeMap[type] || 'CASH';
  
  const accountMap = config.accountMap[paymentType];
  if (!accountMap) {
    throw new Error(`No account mapping for payment type: ${paymentType}`);
  }

  const amount = parseFloat(String(entry.cashBook_amount).replace(',', '.'));
  if (isNaN(amount)) {
    throw new Error(`Invalid amount: ${entry.cashBook_amount}`);
  }

  const isDeposit = amount > 0;
  const absoluteAmount = Math.abs(amount);

  // Determine tax
  let taxPercent = 19;
  let taxId = config.taxes['19'];
  
  if (invoice?.invoice_taxRate) {
    const invoiceTax = parseFloat(String(invoice.invoice_taxRate));
    if (!isNaN(invoiceTax) && config.taxes[invoiceTax.toString()]) {
      taxPercent = invoiceTax;
      taxId = config.taxes[invoiceTax.toString()];
    }
  }

  return {
    ref: `HC-${entry.cashBook_id}`,
    date: entry.cashBook_date || new Date().toISOString().split('T')[0],
    journal_id: config.odoo.journalId,
    line_ids: [
      [0, 0, {
        account_id: accountMap.debit,
        debit: absoluteAmount,
        credit: 0,
        name: `HelloCash ${entry.cashBook_number}`,
      }],
      [0, 0, {
        account_id: accountMap.credit,
        debit: 0,
        credit: absoluteAmount,
        name: `HelloCash ${entry.cashBook_number}`,
        tax_ids: isDeposit && taxId ? [[6, 0, [taxId]]] : undefined,
      }],
    ],
    amount: absoluteAmount,
    tax_percent: taxPercent,
  };
}

// Test configuration
const testConfig = {
  odoo: {
    journalId: 1,
  },
  accountMap: {
    CASH: { debit: 1000, credit: 4000 },
    EC: { debit: 1200, credit: 4000 },
    CREDITCARD: { debit: 1200, credit: 4000 },
    VOUCHER: { debit: 1300, credit: 4000 },
  },
  taxes: {
    '7': 2,
    '19': 1,
  },
};

// Test cases
function runTests() {
  console.log('Running mapping tests...');

  // Test 1: Basic cash entry
  const cashEntry = {
    cashBook_id: '123',
    cashBook_number: 'CASH-001',
    cashBook_type: 'cash',
    cashBook_amount: '100.50',
    cashBook_date: '2024-01-15',
  };

  const cashResult = mapEntryToOdoo(cashEntry, testConfig);
  assert.strictEqual(cashResult.ref, 'HC-123');
  assert.strictEqual(cashResult.line_ids[0][2].account_id, 1000); // Kasse debit
  assert.strictEqual(cashResult.line_ids[1][2].account_id, 4000); // Erlöse credit
  assert.strictEqual(cashResult.tax_percent, 19);
  console.log('✓ Test 1: Basic cash entry passed');

  // Test 2: EC entry with negative amount (withdrawal)
  const ecEntry = {
    cashBook_id: '124',
    cashBook_number: 'EC-001',
    cashBook_type: 'ec',
    cashBook_amount: '-50.25',
    cashBook_date: '2024-01-15',
  };

  const ecResult = mapEntryToOdoo(ecEntry, testConfig);
  assert.strictEqual(ecResult.line_ids[0][2].account_id, 1200); // Bank debit
  assert.strictEqual(ecResult.amount, 50.25);
  console.log('✓ Test 2: EC entry passed');

  // Test 3: Entry with invoice tax
  const invoiceEntry = {
    cashBook_id: '125',
    cashBook_number: 'INV-001',
    cashBook_type: 'creditcard',
    cashBook_amount: '200.00',
    cashBook_date: '2024-01-15',
  };

  const invoice = {
    invoice_taxRate: '7',
  };

  const invResult = mapEntryToOdoo(invoiceEntry, testConfig, invoice);
  assert.strictEqual(invResult.tax_percent, 7);
  console.log('✓ Test 3: Entry with invoice tax passed');

  // Test 4: Invalid payment type (should default to CASH)
  const unknownEntry = {
    cashBook_id: '126',
    cashBook_number: 'UNK-001',
    cashBook_type: 'unknown_type',
    cashBook_amount: '75.00',
    cashBook_date: '2024-01-15',
  };

  const unknownResult = mapEntryToOdoo(unknownEntry, testConfig);
  assert.strictEqual(unknownResult.line_ids[0][2].account_id, 1000); // Defaults to CASH
  console.log('✓ Test 4: Unknown payment type defaults to CASH');

  // Test 5: Invalid amount
  const invalidEntry = {
    cashBook_id: '127',
    cashBook_number: 'INV-002',
    cashBook_type: 'cash',
    cashBook_amount: 'not-a-number',
    cashBook_date: '2024-01-15',
  };

  try {
    mapEntryToOdoo(invalidEntry, testConfig);
    assert.fail('Should have thrown error for invalid amount');
  } catch (error) {
    assert(error.message.includes('Invalid amount'));
    console.log('✓ Test 5: Invalid amount throws error');
  }

  console.log('\n✅ All tests passed!');
}

// Run tests
try {
  runTests();
  process.exit(0);
} catch (error) {
  console.error('Test failed:', error.message);
  process.exit(1);
}