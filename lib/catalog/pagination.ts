/** Read a catalog completely, or fail without returning a truncated catalog. */
export async function readCatalogRows(query: any): Promise<{ data: any[] | null; error: unknown }> {
  const rows: any[] = [];
  const pageSize = 500;
  for (let start = 0; start < 50000; start += pageSize) {
    const result = await query.range(start, start + pageSize - 1);
    if (result.error || !Array.isArray(result.data)) return { data: null, error: result.error ?? "invalid_catalog_response" };
    rows.push(...result.data);
    if (result.data.length < pageSize) return { data: rows, error: null };
  }
  return { data: null, error: "catalog_too_large" };
}
