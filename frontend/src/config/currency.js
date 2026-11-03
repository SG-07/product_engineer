/**
 * Currency configuration.
 * The backend stores amounts in INR and does all conversion and rounding
 * (GET ...?currency=). This file only holds display metadata; rates come from
 * GET /v1/currencies.
 */
export const BASE_CURRENCY = 'INR'

export const CURRENCIES = {
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', locale: 'en-IN', flag: '🇮🇳' },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US', flag: '🇺🇸' },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', locale: 'de-DE', flag: '🇪🇺' },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB', flag: '🇬🇧' },
}

export const CURRENCY_CODES = Object.keys(CURRENCIES)
