/** "₱4,000.00" from a number or a decimal string. */
export function peso(amount: number | string): string {
  return `₱${Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
