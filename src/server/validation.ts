import { z } from "zod";
import { LISTING_KINDS, PROPERTY_TYPES, SOURCES } from "../db/schema.js";

export const savedSearchInput = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  active: z.boolean().optional().default(true),
  sources: z.array(z.enum(SOURCES)).optional().default([]),
  listingKinds: z.array(z.enum(LISTING_KINDS)).optional().default([]),
  propertyTypes: z.array(z.enum(PROPERTY_TYPES)).optional().default([]),
  cities: z.array(z.string().min(1)).optional().default([]),
  priceMin: z.number().int().nonnegative().nullish(),
  priceMax: z.number().int().nonnegative().nullish(),
  areaMin: z.number().nonnegative().nullish(),
  areaMax: z.number().nonnegative().nullish(),
  roomsMin: z.number().int().nonnegative().nullish(),
  roomsMax: z.number().int().nonnegative().nullish(),
  keywords: z.array(z.string().min(1)).optional().default([]),
});

export type SavedSearchInput = z.infer<typeof savedSearchInput>;
