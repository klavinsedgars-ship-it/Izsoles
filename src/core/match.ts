import type { Listing, SavedSearch } from "../db/schema.js";
import { normalizeCity } from "../scrapers/types.js";

/**
 * Pure predicate: does `listing` satisfy every constraint of `search`?
 * Empty/undefined criteria are treated as "no restriction".
 * This function has no I/O so it is fully unit-testable.
 */
export function listingMatches(listing: Listing, search: SavedSearch): boolean {
  // Source
  if (search.sources.length && !search.sources.includes(listing.source)) return false;

  // Listing kind (auction / sale / rent)
  if (search.listingKinds.length && !search.listingKinds.includes(listing.listingKind)) {
    return false;
  }

  // Property type
  if (search.propertyTypes.length) {
    if (!listing.propertyType || !search.propertyTypes.includes(listing.propertyType)) {
      return false;
    }
  }

  // City — match against normalized city or the listing's normalized label.
  if (search.cities.length) {
    const candidates = [
      listing.city,
      normalizeCity(listing.cityLabel),
      normalizeCity(listing.district),
      normalizeCity(listing.address),
    ].filter(Boolean) as string[];
    const wanted = search.cities.map(normalizeCity);
    const hit = wanted.some((w) => candidates.some((c) => c.includes(w)));
    if (!hit) return false;
  }

  // Price range (skip listings with unknown price only when a bound is set)
  if (search.priceMin != null || search.priceMax != null) {
    if (listing.price == null) return false;
    if (search.priceMin != null && listing.price < search.priceMin) return false;
    if (search.priceMax != null && listing.price > search.priceMax) return false;
  }

  // Area range
  if (search.areaMin != null || search.areaMax != null) {
    if (listing.areaM2 == null) return false;
    if (search.areaMin != null && listing.areaM2 < search.areaMin) return false;
    if (search.areaMax != null && listing.areaM2 > search.areaMax) return false;
  }

  // Rooms range
  if (search.roomsMin != null || search.roomsMax != null) {
    if (listing.rooms == null) return false;
    if (search.roomsMin != null && listing.rooms < search.roomsMin) return false;
    if (search.roomsMax != null && listing.rooms > search.roomsMax) return false;
  }

  // Keywords — any-of match across title/description/address.
  if (search.keywords.length) {
    const haystack = [listing.title, listing.description, listing.address]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const hit = search.keywords.some((k) => haystack.includes(k.toLowerCase()));
    if (!hit) return false;
  }

  return true;
}
