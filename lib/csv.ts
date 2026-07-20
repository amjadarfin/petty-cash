/**
 * Minimal, dependency-free CSV builder that opens cleanly in Excel:
 * - UTF-8 BOM prefix so Excel detects encoding correctly (no mangled currency symbols)
 * - CRLF line endings (Excel's native expectation on Windows)
 * - RFC 4180 quoting: any field containing a comma, quote, or newline gets quoted,
 *   with internal quotes doubled
 *
 * This avoids pulling in the `xlsx` npm package, which currently has unpatched
 * high-severity vulnerabilities (prototype pollution, ReDoS) with no fix on npm.
 * CSV opened directly in Excel covers the same practical need without that risk.
 */
export function reportMetaLines(fyName: string, filters?: string): string[] {
  const now = new Date();
  return [
    `Generated: ${now.toLocaleDateString("en-GB")} ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
    `Fiscal Year: ${fyName}`,
    `Filters: ${filters || "none"}`,
  ];
}

function escapeCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv(headers: string[], rows: unknown[][], meta?: string[]): string {
  const lines: string[] = [];
  if (meta && meta.length > 0) {
    for (const m of meta) lines.push(escapeCell(m));
    lines.push(""); // blank separator row before the real table
  }
  lines.push(headers.map(escapeCell).join(","));
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
}

export function csvResponse(filename: string, headers: string[], rows: unknown[][], meta?: string[]): Response {
  const csv = buildCsv(headers, rows, meta);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
