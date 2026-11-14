-- =============================================================================
-- NES-PO, PR (FM-PU-01) & WMS Management — Supabase Cloud Setup Script
-- วิธีใช้งาน: คัดลอกโค้ดทั้งหมดนี้ไปวางในเมนู "SQL Editor" บนเว็บ Supabase แล้วกด "Run"
-- =============================================================================

-- 1. ตารางหลักสำหรับซิงค์ฐานข้อมูลอัตโนมัติระหว่าง Vercel Serverless <-> Supabase
-- (ช่วยให้ทุกการเปิด PR/PO, วาดลายเซ็น, ปรับสต็อก WMS บน Vercel ถูกบันทึกถาวรบน Supabase ทันที)
CREATE TABLE IF NOT EXISTS public.nes_cloud_snapshots (
    id INTEGER PRIMARY KEY DEFAULT 1,
    db_base64 TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- เปิดสิทธิ์ให้ API Key สามารถอ่าน/เขียนตารางซิงค์ได้เมื่อตั้งค่า SUPABASE_URL และ SUPABASE_KEY
ALTER TABLE public.nes_cloud_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full sync access" ON public.nes_cloud_snapshots;
CREATE POLICY "Allow full sync access"
ON public.nes_cloud_snapshots
FOR ALL
USING (true)
WITH CHECK (true);

-- =============================================================================
-- 2. โครงสร้างตาราง Relational PostgreSQL (กรณีต้องการ Query ตารางบน Supabase โดยตรง)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.users (
    user_id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'APPROVER', 'PURCHASING', 'NORMAL_USER')),
    department TEXT DEFAULT '',
    email TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vendors (
    vendor_id SERIAL PRIMARY KEY,
    vendor_code TEXT UNIQUE NOT NULL,
    vendor_name TEXT NOT NULL,
    address TEXT DEFAULT '',
    tel TEXT DEFAULT '',
    fax TEXT DEFAULT '',
    mobile TEXT DEFAULT '',
    contact_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    default_payment_term TEXT DEFAULT 'CREDIT 30 DAYS',
    description TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.item_categories (
    category_id SERIAL PRIMARY KEY,
    category_code TEXT UNIQUE NOT NULL,
    category_name TEXT NOT NULL,
    icon_url TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.items (
    item_id SERIAL PRIMARY KEY,
    item_code TEXT UNIQUE NOT NULL,
    item_name TEXT NOT NULL,
    category_id INTEGER REFERENCES public.item_categories(category_id) ON DELETE SET NULL,
    default_unit TEXT NOT NULL DEFAULT 'PCS',
    pic_engineer TEXT DEFAULT 'วิศวกร Tooling',
    image_url TEXT DEFAULT '',
    last_unit_price NUMERIC(12,2) DEFAULT NULL,
    last_vendor_id INTEGER REFERENCES public.vendors(vendor_id) ON DELETE SET NULL,
    last_po_date TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_requisitions (
    pr_id SERIAL PRIMARY KEY,
    pr_number TEXT UNIQUE NOT NULL,
    pr_date TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT 'แผนกผลิต (Production)',
    vendor_id INTEGER REFERENCES public.vendors(vendor_id) ON DELETE SET NULL,
    vendor_name_snapshot TEXT DEFAULT '',
    vendor_address_snapshot TEXT DEFAULT '',
    vendor_tel_fax_snapshot TEXT DEFAULT '',
    purpose_flags TEXT DEFAULT '[]',
    requester_name TEXT NOT NULL DEFAULT '',
    requester_user_id INTEGER REFERENCES public.users(user_id) ON DELETE SET NULL,
    reviewer_name TEXT DEFAULT '',
    approver_name TEXT DEFAULT '',
    purchasing_officer_name TEXT DEFAULT '',
    purchasing_date TEXT DEFAULT '',
    accounting_officer_name TEXT DEFAULT '',
    accounting_date TEXT DEFAULT '',
    linked_po_id INTEGER DEFAULT NULL,
    linked_po_number TEXT DEFAULT '',
    po_sub_total NUMERIC(12,2) DEFAULT 0,
    po_vat_amount NUMERIC(12,2) DEFAULT 0,
    po_grand_total NUMERIC(12,2) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN',
    effective_date TEXT NOT NULL DEFAULT 'Effective date : 11/11/2026',
    form_code TEXT NOT NULL DEFAULT 'FM-PU-01 / Rev.06',
    remarks TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
    po_id SERIAL PRIMARY KEY,
    po_number TEXT UNIQUE NOT NULL,
    po_date TEXT NOT NULL,
    vendor_id INTEGER REFERENCES public.vendors(vendor_id) ON DELETE SET NULL,
    vendor_code_snapshot TEXT DEFAULT '',
    vendor_name_snapshot TEXT NOT NULL,
    vendor_address_snapshot TEXT DEFAULT '',
    vendor_tel_snapshot TEXT DEFAULT '',
    vendor_fax_snapshot TEXT DEFAULT '',
    vendor_contact_name TEXT DEFAULT '',
    vendor_contact_email TEXT DEFAULT '',
    quotation_ref TEXT DEFAULT '',
    pr_id INTEGER REFERENCES public.purchase_requisitions(pr_id) ON DELETE SET NULL,
    pr_number TEXT DEFAULT '',
    pr_requester_snapshot TEXT DEFAULT '',
    pr_department_snapshot TEXT DEFAULT '',
    delivery_location TEXT DEFAULT 'โรงงาน ซอย 12',
    delivery_contact TEXT DEFAULT 'จัดซื้อ 094-479-2417',
    delivery_date TEXT DEFAULT '',
    payment_term TEXT DEFAULT 'CREDIT 30 DAYS',
    sub_total NUMERIC(12,2) DEFAULT 0,
    special_discount NUMERIC(12,2) DEFAULT 0,
    net_total NUMERIC(12,2) DEFAULT 0,
    vat_rate NUMERIC(5,2) DEFAULT 7,
    vat_amount NUMERIC(12,2) DEFAULT 0,
    grand_total NUMERIC(12,2) DEFAULT 0,
    amount_text_th TEXT DEFAULT '',
    remarks TEXT DEFAULT '',
    approval_status TEXT NOT NULL DEFAULT 'PENDING',
    issued_by TEXT DEFAULT 'ฝ่ายจัดซื้อ',
    approved_by TEXT DEFAULT '',
    approved_at TEXT DEFAULT '',
    approver_signature_image TEXT DEFAULT '',
    reject_reason TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wms_lots (
    lot_id SERIAL PRIMARY KEY,
    lot_number TEXT UNIQUE NOT NULL,
    received_date TEXT NOT NULL,
    item_id INTEGER NOT NULL REFERENCES public.items(item_id) ON DELETE CASCADE,
    vendor_id INTEGER REFERENCES public.vendors(vendor_id) ON DELETE SET NULL,
    vendor_name_snapshot TEXT DEFAULT '',
    po_id INTEGER REFERENCES public.purchase_orders(po_id) ON DELETE SET NULL,
    po_number_snapshot TEXT DEFAULT '',
    initial_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
    remaining_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'PCS',
    unit_cost NUMERIC(12,2) DEFAULT 0,
    location TEXT DEFAULT 'STORE-A1',
    remarks TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
