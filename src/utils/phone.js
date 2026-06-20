export function normalizeDigits(value = "") {
  return String(value)
    .replace(/[०-९]/g, digit => String(digit.charCodeAt(0) - 0x0966))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0));
}

export function normalizeBroadcastPhone(value = "", defaultCountryCode = "91") {
  const rawDigits = normalizeDigits(value).replace(/[^\d]/g, "");
  const country = normalizeDigits(defaultCountryCode).replace(/[^\d]/g, "");

  if (!rawDigits) return "";
  if (country && rawDigits.length === 10) return `${country}${rawDigits}`;
  return rawDigits.length >= 10 ? rawDigits : "";
}
