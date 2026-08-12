export function parseCsv(csvString) {
  if (!csvString) return [];
  const lines = csvString.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = values[index] || '';
      obj[String(index + 1)] = values[index] || ''; // Allow referencing by 1-based index e.g. {{1}}
    });
    results.push(obj);
  }

  return results;
}
