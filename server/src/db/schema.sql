-- Applied by the server on every start; every statement must be idempotent.

CREATE TABLE IF NOT EXISTS users (
  id            INT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  role          ENUM('ADMIN','OPERATOR','VIEWER') NOT NULL,
  password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id                      VARCHAR(16) PRIMARY KEY,
  name                    VARCHAR(255) NOT NULL,
  type                    ENUM('RETAIL','INSTITUTIONAL') NOT NULL,
  country                 CHAR(2) NOT NULL,
  kyc_status              ENUM('APPROVED','PENDING','EXPIRED','REJECTED') NOT NULL,
  email                   VARCHAR(255) NOT NULL,
  phone                   VARCHAR(64) NOT NULL,
  relationship_manager_id INT NOT NULL,
  onboarded_on            DATE NOT NULL,
  -- Optimistic locking: every update must name the version it was based on.
  version                 INT NOT NULL DEFAULT 1,
  updated_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (relationship_manager_id) REFERENCES users(id),
  INDEX idx_clients_name (name),
  INDEX idx_clients_type (type),
  INDEX idx_clients_country (country),
  INDEX idx_clients_kyc (kyc_status),
  INDEX idx_clients_rm (relationship_manager_id)
);

CREATE TABLE IF NOT EXISTS portfolios (
  id            VARCHAR(16) PRIMARY KEY,
  client_id     VARCHAR(16) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  base_currency CHAR(3) NOT NULL,
  status        ENUM('ACTIVE','CLOSED') NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  INDEX idx_portfolios_client (client_id)
);

CREATE TABLE IF NOT EXISTS instruments (
  isin     CHAR(12) PRIMARY KEY,
  name     VARCHAR(255) NOT NULL,
  type     ENUM('EQUITY','BOND','FUND') NOT NULL,
  currency CHAR(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date    DATE NOT NULL,
  currency     CHAR(3) NOT NULL,
  eur_per_unit DECIMAL(18,6) NOT NULL,
  PRIMARY KEY (rate_date, currency)
);

CREATE TABLE IF NOT EXISTS imports (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  filename       VARCHAR(255) NOT NULL,
  sha256         CHAR(64) NOT NULL,
  uploaded_by    INT NOT NULL,
  uploaded_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  total_rows     INT NOT NULL,
  imported_rows  INT NOT NULL,
  duplicate_rows INT NOT NULL,
  error_rows     INT NOT NULL,
  results        JSON NOT NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_imports_uploaded_at (uploaded_at)
);

CREATE TABLE IF NOT EXISTS transactions (
  id              VARCHAR(16) PRIMARY KEY,
  external_ref    VARCHAR(64) NOT NULL UNIQUE,
  client_id       VARCHAR(16) NOT NULL,
  portfolio_id    VARCHAR(16) NOT NULL,
  isin            CHAR(12) NOT NULL,
  type            ENUM('BUY','SELL','TRANSFER_IN','TRANSFER_OUT') NOT NULL,
  trade_date      DATE NOT NULL,
  settlement_date DATE NOT NULL,
  quantity        DECIMAL(20,4) NOT NULL,
  price           DECIMAL(20,6) NULL,
  currency        CHAR(3) NOT NULL,
  status          ENUM('PENDING','SETTLED','CANCELLED','FAILED') NOT NULL,
  import_id       INT NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (isin) REFERENCES instruments(isin),
  FOREIGN KEY (import_id) REFERENCES imports(id),
  -- Invoicing reads "client's settled transactions settling in month X".
  INDEX idx_tx_client_settle (client_id, settlement_date),
  INDEX idx_tx_trade_date (trade_date),
  INDEX idx_tx_settlement_date (settlement_date),
  INDEX idx_tx_status (status),
  INDEX idx_tx_type (type),
  INDEX idx_tx_currency (currency),
  INDEX idx_tx_isin (isin),
  INDEX idx_tx_portfolio (portfolio_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  number      VARCHAR(32) NULL UNIQUE,
  client_id   VARCHAR(16) NOT NULL,
  period      CHAR(7) NOT NULL, -- YYYY-MM
  status      ENUM('DRAFT','ISSUED','PAID','VOID') NOT NULL DEFAULT 'DRAFT',
  currency    CHAR(3) NOT NULL DEFAULT 'EUR',
  total       DECIMAL(14,2) NOT NULL,
  created_by  INT NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  issued_at   DATETIME(3) NULL,
  paid_at     DATETIME(3) NULL,
  voided_at   DATETIME(3) NULL,
  void_reason VARCHAR(500) NULL,
  version     INT NOT NULL DEFAULT 1,
  -- NULL for void invoices, so the unique key below only constrains non-void ones:
  -- at most one non-void invoice per client and month, enforced by the database.
  live_marker TINYINT GENERATED ALWAYS AS (IF(status = 'VOID', NULL, 1)) STORED,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_invoice_client_period_live (client_id, period, live_marker),
  INDEX idx_invoices_period (period),
  INDEX idx_invoices_status (status)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id  INT NOT NULL,
  position    INT NOT NULL,
  kind        ENUM('BUY','SELL','TRANSFER_IN','TRANSFER_OUT','ACCOUNT_FEE') NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity    INT NOT NULL,
  amount      DECIMAL(14,2) NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  INDEX idx_lines_invoice (invoice_id)
);

-- Per-transaction fee breakdown behind each line, so every cent is traceable.
CREATE TABLE IF NOT EXISTS invoice_items (
  invoice_id     INT NOT NULL,
  transaction_id VARCHAR(16) NOT NULL,
  kind           ENUM('BUY','SELL','TRANSFER_IN','TRANSFER_OUT') NOT NULL,
  gross          DECIMAL(24,6) NULL,
  fx_rate        DECIMAL(18,6) NULL,
  gross_eur      DECIMAL(24,6) NULL,
  fee            DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (invoice_id, transaction_id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  user_id     INT NULL,
  entity_type ENUM('CLIENT','TRANSACTION','INVOICE') NOT NULL,
  entity_id   VARCHAR(32) NOT NULL,
  client_id   VARCHAR(16) NULL,
  action      VARCHAR(32) NOT NULL,
  changes     JSON NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_audit_client (client_id, at),
  INDEX idx_audit_entity (entity_type, entity_id, at)
);

CREATE TABLE IF NOT EXISTS app_meta (
  meta_key   VARCHAR(64) PRIMARY KEY,
  meta_value VARCHAR(255) NOT NULL
);
