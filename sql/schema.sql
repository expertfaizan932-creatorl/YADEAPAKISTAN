-- ============================================================
--  EVEE CRM - Contacts/Leads Database Schema
--  XAMPP MySQL (MariaDB 10.4+)
--  Design goal: STORE contacts AND make leads easy to FIND.
--
--  How to run:
--    C:\xampp\mysql\bin\mysql.exe -u root < sql\schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS evee_crm
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE evee_crm;

-- ------------------------------------------------------------
-- CORE TABLE: contacts (a contact can be flagged as a Lead)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contact_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS contacts;

CREATE TABLE contacts (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  first_name       VARCHAR(100) NOT NULL DEFAULT '',
  last_name        VARCHAR(100) NOT NULL DEFAULT '',
  full_name        VARCHAR(201) GENERATED ALWAYS AS (CONCAT(first_name, ' ', last_name)) STORED,
  phone            VARCHAR(40)  DEFAULT NULL,
  email            VARCHAR(190) DEFAULT NULL,
  business_name    VARCHAR(190) DEFAULT NULL,
  contact_type     ENUM('', 'Lead', 'Customer', 'Vendor', 'Partner') NOT NULL DEFAULT '',
  is_lead          TINYINT(1)   NOT NULL DEFAULT 0,
  avatar_color     VARCHAR(60)  NOT NULL DEFAULT 'bg-emerald-200 text-emerald-800',
  avatar_data      MEDIUMTEXT   DEFAULT NULL,
  notes            TEXT         DEFAULT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME     DEFAULT NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                     ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- Exact lookups: dedupe + "did we already import this phone/email?"
  -- Deliberately NOT unique: tenancy gives every Dealer their own row, so a
  -- value another tenant already owns must never block a save (it used to fail
  -- with "Duplicate entry ... for key 'uq_contact_email'"). The application-
  -- level dedupe in api/index.php create_contact() - which only ever merges
  -- into a row the caller may see - is the real protection, and
  -- ensure_contacts_may_duplicate() drops these keys from older databases.
  KEY idx_contact_phone (phone),
  KEY idx_contact_email (email),

  -- Range / filter lookups
  KEY idx_contact_name  (last_name, first_name),
  KEY idx_contact_type  (contact_type),
  KEY idx_contact_lead  (is_lead),
  KEY idx_contact_created (created_at),
  KEY idx_contact_activity (last_activity_at),

  -- Full-text: free-text search across name / email / business
  FULLTEXT KEY ft_contact_search (first_name, last_name, email, business_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- TAGS (normalized, many-to-many via contact_tags)
-- ------------------------------------------------------------
CREATE TABLE tags (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name  VARCHAR(60)  NOT NULL,
  color VARCHAR(30)  NOT NULL DEFAULT 'bg-slate-100 text-slate-600',
  PRIMARY KEY (id),
  UNIQUE KEY uq_tag_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contact_tags (
  contact_id INT UNSIGNED NOT NULL,
  tag_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (contact_id, tag_id),
  KEY idx_contact_tags_tag (tag_id),
  CONSTRAINT fk_ct_contact FOREIGN KEY (contact_id)
    REFERENCES contacts(id) ON DELETE CASCADE,
  CONSTRAINT fk_ct_tag FOREIGN KEY (tag_id)
    REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Common tags (safe re-run)
-- ------------------------------------------------------------
INSERT INTO tags (name, color) VALUES
  ('warm lead',  'bg-amber-50 text-amber-700'),
  ('hot lead',   'bg-rose-50 text-rose-700'),
  ('cold lead',  'bg-slate-100 text-slate-600'),
  ('follow-up',  'bg-blue-50 text-blue-700'),
  ('customer',   'bg-green-50 text-green-700')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ------------------------------------------------------------
-- VIEW: contacts joined with aggregated tags
--   SELECT * FROM v_contacts_with_tags WHERE ...  -> easy to read
-- ------------------------------------------------------------
DROP VIEW IF EXISTS v_contacts_with_tags;
CREATE VIEW v_contacts_with_tags AS
SELECT
  c.id,
  c.full_name            AS name,
  c.first_name,
  c.last_name,
  c.phone,
  c.email,
  c.business_name,
  c.contact_type,
  c.is_lead,
  c.avatar_color,
  c.avatar_data,
  c.custom_fields,
  c.notes,
  c.created_at,
  c.last_activity_at,
  c.updated_at,
  COALESCE(GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ','), '') AS tags,
  COALESCE(GROUP_CONCAT(t.id   ORDER BY t.name SEPARATOR ','), '') AS tag_ids
FROM contacts c
LEFT JOIN contact_tags ct ON ct.contact_id = c.id
LEFT JOIN tags t         ON t.id         = ct.tag_id
GROUP BY c.id;

-- ------------------------------------------------------------
-- VIEW: LEADS ONLY (the "find my leads" shortcut)
--   A contact is a lead if explicitly flagged OR tagged with a
--   *lead* tag (warm/hot/cold lead) OR contact_type = 'Lead'.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS v_leads;
CREATE VIEW v_leads AS
SELECT *
FROM v_contacts_with_tags
WHERE is_lead = 1
   OR contact_type = 'Lead'
   OR FIND_IN_SET('warm lead', tags)
   OR FIND_IN_SET('hot lead',  tags)
   OR FIND_IN_SET('cold lead', tags);

-- ------------------------------------------------------------
-- SEARCH HELPERS (pre-made queries for common lookups)
-- ------------------------------------------------------------
-- 1) Find a lead by ANY of: name / phone / email / tag / business
--    SELECT * FROM v_leads
--    WHERE name LIKE '%faiz%'
--       OR phone LIKE '%1520951%'
--       OR email LIKE '%faizan%'
--       OR tags LIKE '%warm%'
--       OR business_name LIKE '%evee%';
--
-- 2) Fast free-text search (FULLTEXT, ranked by relevance)
--    SELECT *, MATCH(first_name,last_name,email,business_name)
--             AGAINST ('faizan' IN NATURAL LANGUAGE MODE) AS relevance
--    FROM contacts
--    WHERE MATCH(first_name,last_name,email,business_name)
--          AGAINST ('faizan' IN NATURAL LANGUAGE MODE)
--    ORDER BY relevance DESC;
--
-- 3) Recent leads (dashboard)
--    SELECT * FROM v_leads ORDER BY created_at DESC LIMIT 20;
