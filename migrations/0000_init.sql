CREATE TABLE IF NOT EXISTS "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"listing_kind" text NOT NULL,
	"property_type" text,
	"title" text,
	"description" text,
	"city" text,
	"city_label" text,
	"district" text,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"price" integer,
	"currency" text DEFAULT 'EUR',
	"price_per_m2" integer,
	"area_m2" double precision,
	"rooms" integer,
	"floor" integer,
	"auction_start" timestamp with time zone,
	"auction_end" timestamp with time zone,
	"deposit" integer,
	"cadastral_number" text,
	"image_url" text,
	"raw" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"saved_search_id" integer NOT NULL,
	"listing_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"listing_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"property_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_min" integer,
	"price_max" integer,
	"area_min" double precision,
	"area_max" double precision,
	"rooms_min" integer,
	"rooms_max" integer,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_saved_search_id_saved_searches_id_fk" FOREIGN KEY ("saved_search_id") REFERENCES "public"."saved_searches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listings_source_external_idx" ON "listings" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_city_idx" ON "listings" USING btree ("city");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_first_seen_idx" ON "listings" USING btree ("first_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_search_listing_idx" ON "notifications" USING btree ("saved_search_id","listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_status_idx" ON "notifications" USING btree ("status");