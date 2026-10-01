import type { WorkspaceCountry } from './types';

export const countries: ReadonlyArray<{ code: WorkspaceCountry; name: string }> = [
  { code: 'GB', name: 'United Kingdom' }, { code: 'US', name: 'United States' },
  { code: 'AU', name: 'Australia' }, { code: 'CA', name: 'Canada' },
  { code: 'AT', name: 'Austria' }, { code: 'BE', name: 'Belgium' },
  { code: 'BG', name: 'Bulgaria' }, { code: 'HR', name: 'Croatia' },
  { code: 'CY', name: 'Cyprus' }, { code: 'EE', name: 'Estonia' },
  { code: 'FI', name: 'Finland' }, { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' }, { code: 'GR', name: 'Greece' },
  { code: 'IE', name: 'Ireland' }, { code: 'IT', name: 'Italy' },
  { code: 'LV', name: 'Latvia' }, { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' }, { code: 'MT', name: 'Malta' },
  { code: 'NL', name: 'Netherlands' }, { code: 'PT', name: 'Portugal' },
  { code: 'SK', name: 'Slovakia' }, { code: 'SI', name: 'Slovenia' },
  { code: 'ES', name: 'Spain' }, { code: 'AD', name: 'Andorra' },
  { code: 'MC', name: 'Monaco' }, { code: 'SM', name: 'San Marino' },
  { code: 'VA', name: 'Vatican City' }, { code: 'XK', name: 'Kosovo' },
  { code: 'ME', name: 'Montenegro' },
];

const euroAreaCodes = new Set<WorkspaceCountry>(['AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES']);
const euroStandardVatRates: Partial<Record<WorkspaceCountry, number>> = {
  AT: 20, BE: 21, BG: 20, HR: 25, CY: 19, EE: 24, FI: 25.5,
  FR: 20, DE: 19, GR: 24, IE: 23, IT: 22, LV: 21, LT: 21,
  LU: 17, MT: 18, NL: 21, PT: 23, SK: 23, SI: 22, ES: 21,
};

export function countryCurrency(country: WorkspaceCountry) {
  return country === 'GB' ? 'GBP' : country === 'US' ? 'USD' : country === 'AU' ? 'AUD' : country === 'CA' ? 'CAD' : 'EUR';
}

export function countryTaxLabel(country: WorkspaceCountry) {
  return country === 'GB' ? 'VAT' : country === 'US' ? 'Sales tax' : country === 'AU' ? 'GST' : country === 'CA' ? 'GST/HST' : euroAreaCodes.has(country) ? 'VAT' : 'Local tax';
}

export function countryTaxChoices(country: WorkspaceCountry): string[] {
  if (country === 'GB') return ['20% Standard', '5% Reduced', '0% Zero', 'Exempt', 'No VAT'];
  if (country === 'US') return ['Review sales tax', 'Exempt', 'No tax tracked'];
  if (country === 'AU') return ['Review GST', '10% GST', 'GST-free', 'Input taxed', 'No tax tracked'];
  if (country === 'CA') return ['Review GST/HST', '5% GST', 'Review provincial tax', 'Zero-rated', 'Exempt', 'No tax tracked'];
  const standardRate = euroStandardVatRates[country];
  return euroAreaCodes.has(country)
    ? ['Review local VAT', ...(standardRate ? [`${standardRate}% standard VAT (reference)`] : []), 'Zero-rated', 'Exempt', 'No tax tracked']
    : ['Review local tax', 'No tax tracked'];
}

export function countryDefaults(country: WorkspaceCountry) {
  return { baseCurrency: countryCurrency(country), defaultTaxRate: countryTaxChoices(country)[0], mileageRate: country === 'GB' ? 0.45 : 0 };
}
