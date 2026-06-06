export function slugFromUrl(rawUrl: string): string {
  const { hostname } = new URL(rawUrl);
  return hostname
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .replace(/^-|-$/g, "");
}
