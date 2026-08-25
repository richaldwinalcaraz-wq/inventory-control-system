export class InvalidBusinessDateError extends Error {}

/** Parses an optional `?date=YYYY-MM-DD` query param, defaulting to today. */
export function parseBusinessDateParam(dateParam: string | null): Date {
  const businessDate = dateParam ? new Date(dateParam) : new Date();
  if (Number.isNaN(businessDate.getTime())) {
    throw new InvalidBusinessDateError(`Invalid "date" query param: ${dateParam}`);
  }
  return businessDate;
}
