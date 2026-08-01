import { test } from "node:test";
import assert from "node:assert/strict";
import { listingMatches } from "./match.js";
import type { Listing, SavedSearch } from "../db/schema.js";

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 1,
    source: "izsoles",
    externalId: "x1",
    url: "https://example.com/1",
    listingKind: "auction",
    propertyType: "apartment",
    title: "Cozy flat in Riga center",
    description: null,
    city: "riga",
    cityLabel: "Rīga",
    district: null,
    address: "Brīvības iela 1, Rīga",
    lat: null,
    lng: null,
    price: 50000,
    currency: "EUR",
    pricePerM2: null,
    areaM2: 55,
    rooms: 2,
    floor: 3,
    auctionStart: null,
    auctionEnd: null,
    deposit: null,
    cadastralNumber: null,
    imageUrl: null,
    raw: null,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

function search(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 1,
    name: "test",
    email: "a@b.com",
    active: true,
    sources: [],
    listingKinds: [],
    propertyTypes: [],
    cities: [],
    priceMin: null,
    priceMax: null,
    areaMin: null,
    areaMax: null,
    roomsMin: null,
    roomsMax: null,
    keywords: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test("empty search matches everything", () => {
  assert.equal(listingMatches(listing(), search()), true);
});

test("city matches diacritic-insensitively", () => {
  assert.equal(listingMatches(listing(), search({ cities: ["riga"] })), true);
  assert.equal(listingMatches(listing(), search({ cities: ["Rīga"] })), true);
  assert.equal(listingMatches(listing(), search({ cities: ["jurmala"] })), false);
});

test("price range enforced, unknown price excluded when bounded", () => {
  assert.equal(listingMatches(listing({ price: 40000 }), search({ priceMax: 45000 })), true);
  assert.equal(listingMatches(listing({ price: 50000 }), search({ priceMax: 45000 })), false);
  assert.equal(listingMatches(listing({ price: null }), search({ priceMax: 45000 })), false);
  assert.equal(listingMatches(listing({ price: null }), search()), true);
});

test("source and kind filters", () => {
  assert.equal(listingMatches(listing(), search({ sources: ["ss"] })), false);
  assert.equal(listingMatches(listing(), search({ sources: ["izsoles"] })), true);
  assert.equal(listingMatches(listing(), search({ listingKinds: ["sale"] })), false);
});

test("rooms and area ranges", () => {
  assert.equal(listingMatches(listing({ rooms: 2 }), search({ roomsMin: 2, roomsMax: 3 })), true);
  assert.equal(listingMatches(listing({ rooms: 1 }), search({ roomsMin: 2 })), false);
  assert.equal(listingMatches(listing({ areaM2: 55 }), search({ areaMin: 60 })), false);
});

test("keywords any-of across text fields", () => {
  assert.equal(listingMatches(listing(), search({ keywords: ["center"] })), true);
  assert.equal(listingMatches(listing(), search({ keywords: ["garage", "flat"] })), true);
  assert.equal(listingMatches(listing(), search({ keywords: ["penthouse"] })), false);
});
