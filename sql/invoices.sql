-- ============================================================
--  EVEE CRM - Yadea Sales Tax Invoices
--    C:\xampp\mysql\bin\mysql.exe -u root < sql\invoices.sql
--
--  Stores every sales tax invoice created from the Invoices
--  page so it survives page refreshes and is shared across
--  browsers. NOTE: the API also auto-creates this table on
--  first use, running this file is optional.
--
--  content holds the per-invoice overrides for the sheet's
--  editable text plus any manually set totals, as JSON:
--    {"text":{"titleText":"Tax Invoice"},
--     "totalExcl":"250000","taxPayable":"","totalIncl":""}
--  An empty amount means the figure is worked out from
--  qty x value_excl and the tax rate.
-- ============================================================
USE evee_crm;

CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_no VARCHAR(191) NOT NULL,
    dated VARCHAR(20) DEFAULT '',
    strn VARCHAR(64) DEFAULT '',
    address TEXT,
    customer_name VARCHAR(255) DEFAULT '',
    qty INT NOT NULL DEFAULT 1,
    motorcycle VARCHAR(255) DEFAULT '',
    model_year VARCHAR(20) DEFAULT '',
    colour VARCHAR(100) DEFAULT '',
    engine_no VARCHAR(100) DEFAULT '',
    chassis_no VARCHAR(100) DEFAULT '',
    value_excl DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(6,2) NOT NULL DEFAULT 18,
    tax_payable DECIMAL(12,2) NOT NULL DEFAULT 0,
    value_incl DECIMAL(12,2) NOT NULL DEFAULT 0,
    content MEDIUMTEXT,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_invoices_invoice_no (invoice_no),
    INDEX idx_invoices_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
