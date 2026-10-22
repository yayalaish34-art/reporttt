/**
 * A customer's address as the CRM holds it, shaped for printing.
 *
 * Client-safe — no database here — because the editors compose the "מיקום" line in the
 * browser from the fields the customer picker hands them.
 */

/**
 * The street line, or '' where the CRM filed the city in it.
 *
 * A customer opened in the CRM with no street gets the city copied into `address` as
 * well — 1,245 of them. Taken at face value that prints "הרצליה, הרצליה", which reads as
 * a mistake rather than as a missing street. The city alone is the honest line.
 */
export function streetOf(address: string, city: string): string {
  const street = address.trim();
  return street !== '' && street === city.trim() ? '' : street;
}

/**
 * "חנה רובינא 4, הרצליה" — the street, then the city.
 *
 * The city is left off where the street line already ends with it, which is how a
 * surveyor types an address by hand and how some CRM rows were imported.
 */
export function joinAddress(address: string, city: string): string {
  const street = streetOf(address, city);
  const town = city.trim();
  if (!street) return town;
  if (!town || street.endsWith(town)) return street;
  return `${street}, ${town}`;
}
