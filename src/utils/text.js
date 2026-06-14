export function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\u0900-\u097f\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value = "") {
  return [...new Set(normalizeText(value).split(" ").filter((token) => token.length > 1))];
}

export function interpolate(template = "", variables = {}) {
  return String(template).replace(/{{\s*([\w.]+)\s*}}/g, (_, path) => {
    const value = path.split(".").reduce((current, key) => current?.[key], variables);
    return value === undefined || value === null ? "" : String(value);
  });
}
