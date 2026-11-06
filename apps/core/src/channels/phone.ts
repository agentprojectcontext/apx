// A phone number as WhatsApp addresses it: digits with the country code, no "+". People type numbers the local way
// ("976 666 004", "011 15 2345-6789"); WhatsApp takes those as some other country's number and the message goes
// nowhere, so the country code is filled in from a number APX already knows, or the number is refused.
import { type CountryCode, parsePhoneNumberFromString } from "libphonenumber-js/min";

export type PhoneResult = { digits: string } | { problem: string };

/** The country of a full international number (digits, with or without "+"), when it is a valid one. */
export function countryOf(number: string | undefined): CountryCode | undefined {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  const n = parsePhoneNumberFromString(`+${digits}`);
  return n?.isValid() ? n.country : undefined;
}

/** WhatsApp's own rule for Argentina: a mobile is 54 9 and the area code, the 9 a local number leaves out. */
function whatsappForm(e164: string): string {
  const d = e164.replace(/^\+/, "");
  return d.startsWith("54") && !d.startsWith("549") && d.length === 12 ? `549${d.slice(2)}` : d;
}

/**
 * A number as written (spaces, dashes, brackets, a leading "+" or "00") made into WhatsApp's digits. Without a country
 * code, `country` (the contact's or the owner's) is assumed; `stored`: digits WhatsApp gave once, read as international
 * first. Already international numbers come back unchanged, so applying it twice changes nothing.
 */
export function whatsappDigits(
  typed: string,
  o: { country?: CountryCode | undefined; stored?: boolean } = {},
): PhoneResult {
  const raw = typed.trim();
  const compact = raw.replace(/[\s().\-/]/g, "");
  const international = /^(\+|00)/.test(compact);
  // Mexican mobiles once carried a 1 after 52; the plan numbers them without it.
  const digits = compact.replace(/^(\+|00)/, "").replace(/^521(\d{10})$/, "52$1");
  if (!/^\d{5,16}$/.test(digits)) return { problem: `"${raw}" is not a phone number` };
  const asInternational = () => {
    const n = parsePhoneNumberFromString(`+${digits}`);
    return n?.isValid() ? n : undefined;
  };
  const asNational = () => {
    if (!o.country) return undefined;
    const n = parsePhoneNumberFromString(digits, o.country);
    return n?.isValid() ? n : undefined;
  };
  const n = international
    ? asInternational()
    : o.stored
      ? (asInternational() ?? asNational())
      : (asNational() ?? asInternational());
  if (n) return { digits: whatsappForm(n.number) };
  if (international) return { problem: `${raw} is not a valid phone number: check its digits` };
  return {
    problem: o.country
      ? `${raw} is not a valid phone number in ${o.country} and has no country code: write it with one, like +51 976 666 004`
      : `${raw} has no country code: write it with one, like +51 976 666 004`,
  };
}
