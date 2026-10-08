-- ===========================================================================
--  DashBill  --  MySQL schema
--  Author: Samuel Fernandes
--
--  Every statement here is idempotent (CREATE TABLE IF NOT EXISTS / INSERT
--  IGNORE), so this file is safe to run on every application start-up.
--  Statements are separated by a line containing only `;;`.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(100)  NOT NULL PRIMARY KEY,
  setting_value LONGTEXT      NULL,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(180)  NOT NULL,
  company       VARCHAR(180)  NULL,
  email         VARCHAR(180)  NULL,
  phone         VARCHAR(60)   NULL,
  gstin         VARCHAR(20)   NULL,
  pan           VARCHAR(20)   NULL,
  address_line1 VARCHAR(255)  NULL,
  address_line2 VARCHAR(255)  NULL,
  city          VARCHAR(120)  NULL,
  state         VARCHAR(120)  NULL,
  pincode       VARCHAR(20)   NULL,
  country       VARCHAR(120)  NOT NULL DEFAULT 'India',
  notes         TEXT          NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clients_name (name),
  INDEX idx_clients_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id      INT UNSIGNED NULL,
  code           VARCHAR(40)  NULL,
  title          VARCHAR(220) NOT NULL,
  description    TEXT         NULL,
  amount         DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  status         ENUM('planned','in_progress','submitted','completed','on_hold','cancelled')
                 NOT NULL DEFAULT 'planned',
  payment_status ENUM('unpaid','partial','paid') NOT NULL DEFAULT 'unpaid',
  amount_paid    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  start_date     DATE         NULL,
  due_date       DATE         NULL,
  completed_on   DATE         NULL,
  paid_on        DATE         NULL,
  notes          TEXT         NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_projects_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_projects_status (status),
  INDEX idx_projects_payment (payment_status),
  INDEX idx_projects_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

-- ---------------------------------------------------------------------------
-- Income
-- `source` tells you where the row came from:
--   manual  -> typed straight into the Income tab
--   project -> auto-posted when a project was marked paid
--   invoice -> auto-posted when an invoice payment was recorded
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incomes (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id    INT UNSIGNED  NULL,
  project_id   INT UNSIGNED  NULL,
  invoice_id   INT UNSIGNED  NULL,
  amount       DECIMAL(14,2) NOT NULL,
  received_on  DATE          NOT NULL,
  category     VARCHAR(80)   NOT NULL DEFAULT 'Project work',
  description  VARCHAR(500)  NULL,
  method       ENUM('cash','upi','bank_transfer','cheque','card','other')
               NOT NULL DEFAULT 'upi',
  reference    VARCHAR(120)  NULL,
  source       ENUM('manual','project','invoice') NOT NULL DEFAULT 'manual',
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_incomes_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_incomes_project FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_incomes_date (received_on),
  INDEX idx_incomes_client (client_id),
  INDEX idx_incomes_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  kind       ENUM('business','materials','reinvestment','loan','subscription','personal','tax','other')
             NOT NULL DEFAULT 'business',
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_expense_category_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category_id   INT UNSIGNED  NULL,
  title         VARCHAR(220)  NOT NULL,
  payee         VARCHAR(180)  NULL,
  amount        DECIMAL(14,2) NOT NULL,
  frequency     ENUM('weekly','monthly','quarterly','half_yearly','yearly')
                NOT NULL DEFAULT 'monthly',
  start_date    DATE          NOT NULL,
  end_date      DATE          NULL,
  next_due_date DATE          NOT NULL,
  outstanding   DECIMAL(14,2) NULL COMMENT 'Remaining loan balance, if this is a loan/EMI',
  installments_left INT       NULL,
  notes         TEXT          NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_recurring_category FOREIGN KEY (category_id) REFERENCES expense_categories(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_recurring_due (next_due_date, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

CREATE TABLE IF NOT EXISTS expenses (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category_id   INT UNSIGNED  NULL,
  recurring_id  INT UNSIGNED  NULL,
  project_id    INT UNSIGNED  NULL COMMENT 'Set when the spend is billable to a project',
  title         VARCHAR(220)  NOT NULL,
  payee         VARCHAR(180)  NULL,
  amount        DECIMAL(14,2) NOT NULL,
  spent_on      DATE          NOT NULL,
  method        ENUM('cash','upi','bank_transfer','cheque','card','other')
                NOT NULL DEFAULT 'upi',
  reference     VARCHAR(120)  NULL,
  notes         TEXT          NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_category FOREIGN KEY (category_id) REFERENCES expense_categories(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_expenses_recurring FOREIGN KEY (recurring_id) REFERENCES recurring_expenses(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_expenses_project FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_expenses_date (spent_on),
  INDEX idx_expenses_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_number  VARCHAR(60)   NOT NULL,
  client_id       INT UNSIGNED  NULL,
  project_id      INT UNSIGNED  NULL,
  invoice_date    DATE          NOT NULL,
  due_date        DATE          NULL,
  status          ENUM('draft','sent','partially_paid','paid','cancelled')
                  NOT NULL DEFAULT 'draft',
  -- Billing party snapshots: an invoice must never change if a client record is
  -- edited years later, so the addresses are frozen onto the invoice itself.
  bill_to_name    VARCHAR(220)  NULL,
  bill_to_address TEXT          NULL,
  bill_to_gstin   VARCHAR(20)   NULL,
  bill_from_name  VARCHAR(220)  NULL,
  bill_from_address TEXT        NULL,
  bill_from_gstin VARCHAR(20)   NULL,
  place_of_supply VARCHAR(120)  NULL,
  currency_symbol VARCHAR(8)    NOT NULL DEFAULT '₹',
  -- 'gst' is a single combined line ("GST @ 18%"), which is what most
  -- commercial work needs. The split forms stay available for when the
  -- customer's accountant wants them itemised.
  --
  -- 'gst' sits LAST on purpose. MySQL and TiDB store an ENUM as the index of
  -- its member, so inserting a value in the middle would renumber the ones
  -- after it and silently turn every existing CGST+SGST invoice into
  -- something else. New members are only ever appended.
  gst_mode        ENUM('none','cgst_sgst','igst','gst') NOT NULL DEFAULT 'none',
  gst_rate        DECIMAL(6,3)  NOT NULL DEFAULT 0.000,
  gst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'Combined GST, when gst_mode = gst',
  subtotal        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_type   ENUM('none','percent','amount') NOT NULL DEFAULT 'none',
  discount_value  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  taxable_amount  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  cgst_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  sgst_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  igst_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  shipping_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  round_off       DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
  total           DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  amount_paid     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  notes           TEXT          NULL,
  terms           TEXT          NULL,
  bank_details    TEXT          NULL COMMENT 'Per-invoice override of the payment details block',
  column_config   TEXT          NULL COMMENT 'JSON: which line-item columns show, plus custom ones',
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_number (invoice_number),
  CONSTRAINT fk_invoices_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_invoices_project FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_invoices_date (invoice_date),
  INDEX idx_invoices_status (status),
  INDEX idx_invoices_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

CREATE TABLE IF NOT EXISTS invoice_items (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id  INT UNSIGNED  NOT NULL,
  position    INT UNSIGNED  NOT NULL DEFAULT 1,
  description VARCHAR(500)  NOT NULL,
  hsn_sac     VARCHAR(20)   NULL,
  quantity    DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  unit        VARCHAR(30)   NULL,
  rate        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  amount      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  custom_fields TEXT        NULL COMMENT 'JSON: values for any custom columns on this invoice',
  CONSTRAINT fk_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_items_invoice (invoice_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT UNSIGNED  NOT NULL,
  income_id  INT UNSIGNED  NULL,
  amount     DECIMAL(14,2) NOT NULL,
  paid_on    DATE          NOT NULL,
  method     ENUM('cash','upi','bank_transfer','cheque','card','other')
             NOT NULL DEFAULT 'upi',
  reference  VARCHAR(120)  NULL,
  notes      VARCHAR(400)  NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payments_income FOREIGN KEY (income_id) REFERENCES incomes(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_payments_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

-- ---------------------------------------------------------------------------
-- Activity log -- feeds the "Recent activity" strip on the dashboard
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity      VARCHAR(40)  NOT NULL,
  entity_id   INT UNSIGNED NULL,
  action      VARCHAR(40)  NOT NULL,
  summary     VARCHAR(400) NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activity_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;;

-- ---------------------------------------------------------------------------
-- Seed data: a starter set of expense categories
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO expense_categories (name, kind) VALUES
  ('Paper & Printing Stock', 'materials'),
  ('Inks & Toners', 'materials'),
  ('Lamination & Finishing', 'materials'),
  ('Outsourced Printing', 'business'),
  ('Machine Purchase', 'reinvestment'),
  ('Machine Repair & Maintenance', 'business'),
  ('Software Subscriptions', 'subscription'),
  ('Internet & Phone', 'business'),
  ('Electricity', 'business'),
  ('Shop Rent', 'business'),
  ('Salaries & Wages', 'business'),
  ('Freelancer Payouts', 'business'),
  ('Transport & Delivery', 'business'),
  ('Marketing & Advertising', 'business'),
  ('Packaging', 'materials'),
  ('Bank Loan EMI', 'loan'),
  ('Equipment Loan EMI', 'loan'),
  ('GST Payment', 'tax'),
  ('Income Tax', 'tax'),
  ('Accounting & Professional Fees', 'business'),
  ('Office Supplies', 'business'),
  ('Household & Personal', 'personal'),
  ('Groceries', 'personal'),
  ('Fuel', 'personal'),
  ('Medical', 'personal'),
  ('Miscellaneous', 'other')
;;
