/**
 * Currency configuration.
 * The backend stores every amount in INR (decimal rupees). The frontend converts
 * to the user's preferred display currency using the fixed rates below.
 * Update RATES_FROM_INR / RATES_UPDATED_AT to refresh the rates.
 */
export const BASE_CURRENCY = 'INR'

export const CURRENCIES = {
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', locale: 'en-IN', flag: '🇮🇳' },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US', flag: '🇺🇸' },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', locale: 'de-DE', flag: '🇪🇺' },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB', flag: '🇬🇧' },
}

export const CURRENCY_CODES = Object.keys(CURRENCIES)

/** 1 INR = X <currency> */
export const RATES_FROM_INR = {
  INR: 1,
  USD: 0.012,
  EUR: 0.011,
  GBP: 0.0095,
}

export const RATES_UPDATED_AT = '2026-11-01'
