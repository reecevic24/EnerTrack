CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 160),
    registration_number text NOT NULL UNIQUE CHECK (length(trim(registration_number)) BETWEEN 1 AND 80),
    email text NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'auditor' CHECK (role IN ('auditor', 'admin')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE facilities (
    id text PRIMARY KEY,
    display_name text NOT NULL UNIQUE,
    sort_order integer NOT NULL UNIQUE
);

INSERT INTO facilities (id, display_name, sort_order) VALUES
    ('Admin', 'Admin', 1),
    ('Tech Building', 'Tech Building', 2),
    ('Hostels', 'Hostels', 3),
    ('MTL', 'MTL', 4),
    ('Main water supply', 'Main water supply', 5),
    ('Soweto Kitchen', 'Soweto Kitchen', 6),
    ('Ngeria Hostels', 'Ngeria Hostels', 7),
    ('Soweto 2', 'Soweto 2', 8),
    ('Annex', 'Annex', 9)
ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    sort_order = EXCLUDED.sort_order;

CREATE TABLE audits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auditor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    facility_id text NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    hostel_name text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'discarded')),
    location text NOT NULL DEFAULT '',
    floor_area numeric(14, 3) CHECK (floor_area IS NULL OR floor_area >= 0),
    author_name text NOT NULL DEFAULT '',
    building_type text NOT NULL DEFAULT '',
    operating_hours numeric(5, 2) CHECK (operating_hours IS NULL OR operating_hours BETWEEN 0 AND 24),
    occupants integer CHECK (occupants IS NULL OR occupants >= 0),
    energy_sources text NOT NULL DEFAULT '',
    audit_date date,
    savings_target numeric(5, 2) NOT NULL DEFAULT 15 CHECK (savings_target BETWEEN 0 AND 100),
    audit_purpose text NOT NULL DEFAULT '',
    background text NOT NULL DEFAULT '',
    scope text NOT NULL DEFAULT '',
    tariff_rate numeric(12, 4) NOT NULL DEFAULT 12 CHECK (tariff_rate >= 0),
    emission_factor numeric(12, 6) NOT NULL DEFAULT 0.05 CHECK (emission_factor >= 0),
    report_reference text,
    report_text text NOT NULL DEFAULT '',
    report_generated_at timestamptz,
    submitted_at timestamptz,
    reviewed_at timestamptz,
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (facility_id = 'Hostels' OR hostel_name = '')
);

CREATE UNIQUE INDEX audits_owner_facility_hostel_unique
    ON audits (auditor_id, facility_id, lower(hostel_name));
CREATE INDEX audits_status_updated_idx ON audits (status, updated_at DESC);
CREATE INDEX audits_facility_date_idx ON audits (facility_id, audit_date DESC);
CREATE INDEX audits_auditor_updated_idx ON audits (auditor_id, updated_at DESC);

CREATE TABLE audit_equipment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    client_id text NOT NULL,
    category text NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 100),
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
    rated_watts numeric(14, 3) NOT NULL CHECK (rated_watts > 0),
    quantity integer NOT NULL CHECK (quantity > 0),
    operating_hours numeric(5, 2) NOT NULL CHECK (operating_hours BETWEEN 0 AND 24),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (audit_id, client_id)
);
CREATE INDEX audit_equipment_audit_idx ON audit_equipment (audit_id, sort_order);

CREATE TABLE audit_monthly_readings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    billing_month date NOT NULL,
    consumption_kwh numeric(16, 3) NOT NULL CHECK (consumption_kwh >= 0),
    bill_amount numeric(16, 2) NOT NULL CHECK (bill_amount >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (audit_id, billing_month)
);
CREATE INDEX audit_readings_month_idx ON audit_monthly_readings (billing_month DESC);

CREATE TABLE audit_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
    mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
    image_data bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_photos_audit_idx ON audit_photos (audit_id, created_at);

CREATE TABLE audit_recommendations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    category text NOT NULL DEFAULT '',
    recommendation text NOT NULL DEFAULT '',
    priority text CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high')),
    timeline text NOT NULL DEFAULT '',
    estimated_monthly_savings_kwh numeric(14, 3) CHECK (estimated_monthly_savings_kwh IS NULL OR estimated_monthly_savings_kwh >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('edited', 'approved', 'discarded', 'resubmitted')),
    comments text NOT NULL DEFAULT '',
    snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_reviews_audit_idx ON audit_reviews (audit_id, created_at DESC);

CREATE TABLE audit_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    generated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    audit_version integer NOT NULL CHECK (audit_version > 0),
    report_text text NOT NULL,
    pdf_data bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (audit_id, audit_version)
);

CREATE TABLE auditor_recommendation_sets (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    recommendations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recommendations) = 'array'),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_expiry_idx ON password_reset_tokens (expires_at);
