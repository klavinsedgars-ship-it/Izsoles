import type { Listing, SavedSearch } from "../db/schema.js";

const SOURCE_LABEL: Record<string, string> = {
  izsoles: "izsoles.ta.gov.lv",
  city24: "City24",
  ss: "SS.com",
};

function euro(n: number | null): string {
  if (n == null) return "—";
  return "€" + n.toLocaleString("en-US");
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function listingRow(l: Listing): string {
  const bits: string[] = [];
  if (l.areaM2 != null) bits.push(`${l.areaM2} m²`);
  if (l.rooms != null) bits.push(`${l.rooms} rooms`);
  if (l.floor != null) bits.push(`floor ${l.floor}`);
  const meta = bits.join(" · ");

  const auction =
    l.listingKind === "auction" && l.auctionEnd
      ? `<div style="color:#b45309;font-size:13px;margin-top:2px">Auction ends ${fmtDate(l.auctionEnd)}${l.deposit != null ? ` · deposit ${euro(l.deposit)}` : ""}</div>`
      : "";

  return `
  <tr>
    <td style="padding:14px 0;border-bottom:1px solid #eee">
      <a href="${l.url}" style="color:#111;text-decoration:none;font-weight:600;font-size:15px">
        ${escapeHtml(l.title ?? l.address ?? "Listing")}
      </a>
      <div style="color:#555;font-size:13px;margin-top:3px">
        ${escapeHtml(l.cityLabel ?? "")}${l.address && l.address !== l.cityLabel ? " · " + escapeHtml(l.address) : ""}
      </div>
      <div style="margin-top:6px">
        <span style="font-size:16px;font-weight:700;color:#111">${euro(l.price)}</span>
        ${meta ? `<span style="color:#777;font-size:13px;margin-left:8px">${meta}</span>` : ""}
        <span style="display:inline-block;margin-left:8px;font-size:11px;color:#666;background:#f2f2f2;padding:2px 6px;border-radius:4px">${SOURCE_LABEL[l.source] ?? l.source}</span>
      </div>
      ${auction}
    </td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildDigestEmail(search: SavedSearch, matches: Listing[]): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `${matches.length} new listing${matches.length === 1 ? "" : "s"} · ${search.name}`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 4px;font-size:20px;color:#111">${escapeHtml(search.name)}</h2>
    <p style="margin:0 0 16px;color:#666;font-size:14px">
      ${matches.length} new match${matches.length === 1 ? "" : "es"} for your saved search.
    </p>
    <table style="width:100%;border-collapse:collapse">
      ${matches.map(listingRow).join("")}
    </table>
    <p style="color:#999;font-size:12px;margin-top:24px">
      You're receiving this because you set up the saved search "${escapeHtml(search.name)}".
    </p>
  </div>`;

  const text = [
    `${search.name} — ${matches.length} new listings`,
    "",
    ...matches.map(
      (l) =>
        `• ${l.title ?? l.address ?? "Listing"} — ${euro(l.price)} — ${SOURCE_LABEL[l.source] ?? l.source}\n  ${l.url}`,
    ),
  ].join("\n");

  return { subject, html, text };
}
