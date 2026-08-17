-- Find It — initial schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_role AS ENUM ('student', 'admin');
CREATE TYPE item_type AS ENUM ('lost', 'found');
CREATE TYPE item_status AS ENUM ('active', 'matched', 'returned');
CREATE TYPE report_status AS ENUM ('open', 'resolved', 'rejected');

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(120) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  student_id      VARCHAR(50),
  role            user_role NOT NULL DEFAULT 'student',
  profile_image   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(150) NOT NULL,
  description     TEXT,
  category        VARCHAR(50) NOT NULL,
  location        VARCHAR(200) NOT NULL,
  item_date       DATE NOT NULL,
  image_url       TEXT,
  type            item_type NOT NULL,
  status          item_status NOT NULL DEFAULT 'active',
  contact_info    VARCHAR(200) NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_type_status ON items(type, status);
CREATE INDEX idx_items_category ON items(category);
CREATE INDEX idx_items_created_at ON items(created_at DESC);
-- Simple keyword search across title/description/location
CREATE INDEX idx_items_search ON items
  USING GIN (to_tsvector('english', title || ' ' || coalesce(description, '') || ' ' || location));

CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason          VARCHAR(500) NOT NULL,
  status          report_status NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lost_item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  found_item_id   UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  score           NUMERIC(5,2) NOT NULL, -- 0.00 - 100.00, "possible match" only
  status          VARCHAR(20) NOT NULL DEFAULT 'suggested',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lost_item_id, found_item_id)
);

-- Claims: a user asserting ownership of a found item / that they found a lost item.
-- Only the item's original poster (or an admin) may confirm a return, so a claim
-- cannot unilaterally close out someone else's post.
CREATE TABLE claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  claimant_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message         TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
