import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_HTML_BYTES = 1_000_000;
const MAX_SOURCE_CHARS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) return false;
  const [a, b] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)));
}

function isPublicIpv6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (isIP(mapped) === 4) return isPublicIpv4(mapped);
  }
  return /^[23]/.test(value);
}

async function validatePublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid public story link.");
  }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) {
    throw new Error("Story links must use a public http or https address.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("That story link is not a public website.");
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && !isPublicIpv4(hostname)) throw new Error("That story link is not a public website.");
  if (ipVersion === 6 && !isPublicIpv6(hostname)) throw new Error("That story link is not a public website.");
  if (!ipVersion) {
    const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
    if (!addresses.length || addresses.some((entry) => entry.family === 4 ? !isPublicIpv4(entry.address) : !isPublicIpv6(entry.address))) {
      throw new Error("That story link does not resolve to a public website.");
    }
  }
  return url;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanHtml(html: string): { title: string; description: string; body: string } {
  const meta: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((item) => [item[1].toLowerCase(), decodeHtml(item[2]).trim()]));
    const key = (attributes.property || attributes.name || attributes.itemprop || "").toLowerCase();
    if (key && attributes.content) meta[key] = attributes.content;
  }
  const title = (meta["og:title"] || meta["twitter:title"] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "External story").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const descriptions = [meta.description, meta["og:description"], meta["twitter:description"]].filter(Boolean);
  const jsonLdDescriptions: string[] = [];
  const jsonLdBodies: string[] = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed: unknown = JSON.parse(match[1]);
      const visit = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const item = value as Record<string, unknown>;
        for (const key of ["description", "abstract", "text"]) if (typeof item[key] === "string") jsonLdDescriptions.push(item[key] as string);
        if (typeof item.articleBody === "string") jsonLdBodies.push(item.articleBody);
        if (Array.isArray(value)) value.forEach(visit);
        else Object.values(item).forEach(visit);
      };
      visit(parsed);
    } catch {
      // Ignore invalid embedded metadata.
    }
  }
  const toText = (value: string) => decodeHtml(value
    .replace(/<(script|style|noscript|svg|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .replace(/\n{3,}/g, "\n\n")).trim();
  const articleHtml = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? "";
  const body = toText(articleHtml);
  const description = [...jsonLdDescriptions, ...descriptions].map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? "";
  const structuredBody = jsonLdBodies.map((item) => item.replace(/\s+/g, " ").trim()).sort((a, b) => b.length - a.length)[0] ?? "";
  return { title, description, body: [structuredBody, body].filter(Boolean).join("\n\n").slice(0, MAX_SOURCE_CHARS) };
}

export async function loadExternalStorySource(rawUrl: string): Promise<{ url: string; title: string; text: string }> {
  let url = await validatePublicHttpUrl(rawUrl.trim());
  let response: Response | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "manual", headers: { "User-Agent": "PitchLabStorySource/1.0", Accept: "text/html,application/xhtml+xml" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("The story link redirected too many times.");
      url = await validatePublicHttpUrl(new URL(location, url).toString());
      continue;
    }
    break;
  }
  if (!response?.ok) throw new Error(`Could not open that story link (HTTP ${response?.status ?? "unknown"}). Try pasting the story synopsis instead.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("That link does not contain a readable web page. Paste the story synopsis instead.");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_HTML_BYTES) throw new Error("That story page is too large to read. Paste the synopsis instead.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Could not read that story page. Paste the synopsis instead.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("That story page is too large to read. Paste the synopsis instead.");
    }
    chunks.push(value);
  }
  const html = new TextDecoder().decode(Buffer.concat(chunks));
  const extracted = cleanHtml(html);
  const hasStoryDetails = extracted.description.length >= 40 || extracted.body.length >= 80;
  if (!hasStoryDetails) throw new Error("That page does not provide a readable synopsis. Paste a synopsis or story text, or choose another public source with plot details.");
  const text = [extracted.title, extracted.description, extracted.body].filter(Boolean).join("\n\n").slice(0, MAX_SOURCE_CHARS);
  return { url: url.toString(), title: extracted.title, text: `Source URL: ${url.toString()}\n${text}` };
}
