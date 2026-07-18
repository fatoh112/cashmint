const csvValue = (value, delimiter) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function downloadCsv({ filename, columns, rows, delimiter = ';' }) {
  const header = columns.map((column) => csvValue(column.label, delimiter)).join(delimiter);
  const records = rows.map((row) => columns.map((column) => csvValue(typeof column.value === 'function' ? column.value(row) : row[column.key], delimiter)).join(delimiter));
  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), header, '\r\n', records.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const formatAccountingDecimal = (value) => Number(value || 0).toFixed(4);
