/** Highest price the system accepts, in pesos. */
export const MAX_PRICE = 9_999_999_999;

/** A typed price is valid: pesos above zero, at most 2 decimals, not above MAX_PRICE. */
export function isValidPrice(text: string): boolean {
  return /^\d{1,10}(\.\d{1,2})?$/.test(text) && Number(text) > 0 && Number(text) <= MAX_PRICE;
}

/** "₱4,000.00" from a number or a decimal string. */
export function peso(amount: number | string): string {
  return `₱${Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
