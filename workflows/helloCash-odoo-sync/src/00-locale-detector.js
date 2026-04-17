/**
 * Odoo Locale Detector — automatic detection of country, language, taxes, and accounts.
 * Runs after Config Loader, before HelloCash Fetch.
 * Features:
 * - Detects country, language, currency from Odoo company
 * - Automatically maps tax rates (e.g., 19% → correct Odoo tax ID)
 * - Suggests account mapping based on standard account names per locale
 * - Stores locale metadata in $flow for downstream nodes
 * - Fallback to environment variables when auto‑detection fails
 */

const config = $('Config Loader').first().json;
const password = $env.ODOO_PASSWORD?.trim();
if (!password) {
  throw new Error('Locale Detector: ODOO_PASSWORD missing for JSON-RPC');
}

// JSON‑RPC helper (adapted from Odoo Post Moves)
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

  try {
    const response = await this.helpers.httpRequest({
      method: 'POST',
      url,
      body,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: config.odoo.timeoutMs,
    });

    if (response.error) {
      throw new Error(`Odoo RPC error: ${JSON.stringify(response.error)}`);
    }

    return response.result;
  } catch (error) {
    $log.error(`Locale Detector RPC failed: ${error.message}`);
    throw error;
  }
}

async function detectLocale() {
  $log.info('Detecting Odoo locale...');

  // 1. Get current company
  const companies = await rpcCall.call(this, 'res.company', 'search_read', [[]], {
    fields: ['id', 'name', 'country_id', 'currency_id', 'lang'],
  });
  if (companies.length === 0) {
    throw new Error('No company found in Odoo');
  }
  const company = companies[0];
  $log.debug(`Company: ${company.name} (ID ${company.id})`);

  // 2. Get country details
  const country = company.country_id
    ? (await rpcCall.call(this, 'res.country', 'read', [[company.country_id[0]]], {
        fields: ['code', 'name', 'currency_id'],
      }))[0]
    : null;
  const countryCode = country?.code || 'DE';
  const countryName = country?.name || 'Germany';

  // 3. Get currency details
  const currency = company.currency_id
    ? (await rpcCall.call(this, 'res.currency', 'read', [[company.currency_id[0]]], {
        fields: ['name', 'symbol', 'rate'],
      }))[0]
    : null;
  const currencyName = currency?.name || 'EUR';
  const currencySymbol = currency?.symbol || '€';

  // 4. Detect language (company language or user context)
  const user = await rpcCall.call(this, 'res.users', 'read', [[config.odoo.uid]], {
    fields: ['lang', 'context_lang'],
  });
  const language = user[0]?.lang || company.lang || 'de_DE';
  const languageShort = language.split('_')[0];

  // 5. Fetch available tax rates (sales taxes)
  const taxes = await rpcCall.call(this, 'account.tax', 'search_read', [
    [['type_tax_use', '=', 'sale'], ['company_id', '=', company.id]],
  ], {
    fields: ['id', 'name', 'amount', 'description'],
  });

  // 6. Fetch account suggestions (standard accounts for cash, bank, revenue, voucher)
  const accounts = await rpcCall.call(this, 'account.account', 'search_read', [
    [['company_id', '=', company.id], ['deprecated', '=', false]],
  ], {
    fields: ['id', 'code', 'name', 'account_type'],
    limit: 1000,
  });

  // 7. Map tax rates to percentages
  const taxMap = {};
  taxes.forEach(tax => {
    // Extract percentage from name (e.g., "Umsatzsteuer 19%" → 19)
    const match = tax.name.match(/(\d+(\.\d+)?)\s*%/);
    if (match) {
      const percent = parseFloat(match[1]);
      taxMap[percent] = tax.id;
    }
    // Also map by exact amount
    taxMap[tax.amount] = tax.id;
  });

  // 8. Suggest accounts based on common naming patterns per locale
  const accountSuggestions = {
    kasse: null,
    bank: null,
    erloese: null,
    gutschein: null,
  };

  const patterns = {
    de: {
      kasse: /kasse|bar|barmittel|cash/i,
      bank: /bank|giro|kontokorrent/i,
      erloese: /erlöse|umsatz|einnahmen|revenue/i,
      gutschein: /gutschein|voucher|geschenk|gift/i,
    },
    en: {
      kasse: /cash|petty/i,
      bank: /bank|checking|current account/i,
      erloese: /revenue|sales|income/i,
      gutschein: /voucher|gift card|prepaid/i,
    },
    fr: {
      kasse: /caisse|espèces/i,
      bank: /banque|compte/i,
      erloese: /revenu|chiffre d'affaires/i,
      gutschein: /bon|cadeau|chèque cadeau/i,
    },
  };

  const localePattern = patterns[languageShort] || patterns.de;
  for (const [key, regex] of Object.entries(localePattern)) {
    const match = accounts.find(acc => regex.test(acc.name));
    if (match) {
      accountSuggestions[key] = match.id;
      $log.debug(`Suggested account for ${key}: ${match.name} (ID ${match.id})`);
    }
  }

  const locale = {
    country: {
      code: countryCode,
      name: countryName,
    },
    currency: {
      name: currencyName,
      symbol: currencySymbol,
    },
    language: {
      code: language,
      short: languageShort,
    },
    company: {
      id: company.id,
      name: company.name,
    },
    taxes: {
      available: taxes.map(t => ({ id: t.id, name: t.name, amount: t.amount })),
      mapping: taxMap, // e.g., { 19: 42, 7: 43 }
    },
    accounts: {
      available: accounts.length,
      suggestions: accountSuggestions,
    },
    detectedAt: new Date().toISOString(),
  };

  $log.info(`Locale detected: ${countryCode} (${currencyName}), language ${language}, ${taxes.length} tax rates, ${accounts.length} accounts`);
  return locale;
}

async function main() {
  try {
    const locale = await detectLocale.call(this);

    // Store in $flow for downstream nodes
    $flow.set('locale', locale);

    // Also output as JSON for this node
    return [{
      json: {
        locale,
        message: 'Locale detected successfully',
        timestamp: new Date().toISOString(),
      },
    }];
  } catch (error) {
    $log.error(`Locale detection failed: ${error.message}`);
    // Fallback: use environment variables (existing config)
    $log.warn('Falling back to environment variable configuration');
    $flow.set('locale', {
      country: { code: 'DE', name: 'Germany (fallback)' },
      currency: { name: 'EUR', symbol: '€' },
      language: { code: 'de_DE', short: 'de' },
      company: { id: null, name: 'Unknown' },
      taxes: { available: [], mapping: {} },
      accounts: { available: 0, suggestions: {} },
      detectedAt: null,
      fallback: true,
    });
    return [{
      json: {
        locale: $flow.get('locale'),
        message: 'Locale detection failed, using fallback',
        error: error.message,
        timestamp: new Date().toISOString(),
      },
    }];
  }
}

return await main.call(this);