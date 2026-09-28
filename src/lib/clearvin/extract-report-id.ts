/**
 * Try to recover ClearVin report id from JSON or embedded HTML metadata.
 */
export function extractHtmlFromReportJson(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const root = parsed as Record<string, unknown>;
  const candidates = [root.html, root.reportHtml, root.body];
  for (const c of candidates) {
    if (typeof c === "string" && c.includes("<")) return c;
  }
  const result = root.result;
  if (result && typeof result === "object") {
    const rec = result as Record<string, unknown>;
    const inner = [rec.html, rec.reportHtml, rec.body];
    for (const c of inner) {
      if (typeof c === "string" && c.includes("<")) return c;
    }
  }
  return undefined;
}

export function extractReportIdFromClearVinPayload(
  bodyText: string,
  parsedJson: unknown | null,
): string | undefined {
  if (parsedJson && typeof parsedJson === "object") {
    const root = parsedJson as Record<string, unknown>;
    if (root.status === "error") return undefined;

    const result = root.result;
    if (result && typeof result === "object") {
      const rec = result as Record<string, unknown>;
      const id = rec.id ?? rec.reportId ?? rec.report_id;
      if (typeof id === "string" && id.trim()) return id.trim();
      if (typeof id === "number" && Number.isFinite(id)) return String(id);
    }

    const topId = root.reportId ?? root.report_id ?? root.id;
    if (typeof topId === "string" && topId.trim()) return topId.trim();
    if (typeof topId === "number" && Number.isFinite(topId)) return String(topId);
  }

  const head = bodyText.slice(0, 200_000);

  const quoted = head.match(
    /"(?:reportId|report_id)"\s*:\s*"([^"\\]{4,64})"/i,
  );
  if (quoted?.[1]) return quoted[1].trim();

  const meta = head.match(
    /(?:report|data)[-_]?id\s*[=:]\s*["']?([A-F0-9]{6,32})["']?/i,
  );
  if (meta?.[1]) return meta[1].trim();

  return undefined;
}
