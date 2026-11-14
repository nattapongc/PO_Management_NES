import sqlite3
import hashlib
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.path.dirname(__file__), 'nes_po.db')

def hash_password(pw):
    return hashlib.sha256(pw.encode('utf-8')).hexdigest()

def upgrade():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('PRAGMA foreign_keys = ON;')

    # 1. Users Table (RBAC: ADMIN, APPROVER, PURCHASING, NORMAL_USER)
    cur.execute("PRAGMA foreign_keys = OFF;")
    cur.executescript('''
    CREATE TABLE IF NOT EXISTS users_new (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('ADMIN', 'APPROVER', 'PURCHASING', 'NORMAL_USER')),
        department TEXT DEFAULT '',
        email TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    ''')
    existing_tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if 'users' in existing_tables:
        cur.execute('''
            INSERT OR IGNORE INTO users_new (user_id, username, password_hash, full_name, role, department, email, is_active, created_at)
            SELECT user_id, username, password_hash, full_name, role, department, email, is_active, created_at FROM users
        ''')
        cur.execute("DROP TABLE users;")
    cur.execute("ALTER TABLE users_new RENAME TO users;")
    cur.execute("PRAGMA foreign_keys = ON;")

    default_users = [
        ('admin', hash_password('1234'), 'ผู้ดูแลระบบ (System Admin)', 'ADMIN', 'IT / Management', 'admin@nes.co.th'),
        ('approver', hash_password('1234'), 'คุณนวพล (ผู้มีอำนาจอนุมัติ)', 'APPROVER', 'ฝ่ายบริหาร (Management)', 'approver@nes.co.th'),
        ('purchasing', hash_password('1234'), 'คุณสมศรี (เจ้าหน้าที่จัดซื้อ)', 'PURCHASING', 'แผนกจัดซื้อ (Purchasing)', 'purchasing@nes.co.th'),
        ('engineer', hash_password('1234'), 'คุณวิชัย (วิศวกรฝ่ายผลิต)', 'NORMAL_USER', 'แผนกผลิต / Tooling', 'engineer@nes.co.th'),
    ]
    for uname, phash, fname, role, dept, email in default_users:
        cur.execute('''
            INSERT OR IGNORE INTO users (username, password_hash, full_name, role, department, email, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        ''', (uname, phash, fname, role, dept, email))
    cur.execute("UPDATE users SET role = 'NORMAL_USER' WHERE username = 'engineer';")

    # 2. Purchase Requisitions (PR - FM-PU-01 / Rev.06)
    cur.executescript('''
    CREATE TABLE IF NOT EXISTS purchase_requisitions (
        pr_id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_number TEXT UNIQUE NOT NULL,
        pr_date TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT 'แผนกผลิต (Production)',
        vendor_id INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
        vendor_name_snapshot TEXT DEFAULT '',
        vendor_address_snapshot TEXT DEFAULT '',
        vendor_tel_fax_snapshot TEXT DEFAULT '',
        purpose_flags TEXT DEFAULT '[]',
        requester_name TEXT NOT NULL DEFAULT '',
        requester_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        reviewer_name TEXT DEFAULT '',
        approver_name TEXT DEFAULT '',
        purchasing_officer_name TEXT DEFAULT '',
        purchasing_date TEXT DEFAULT '',
        accounting_officer_name TEXT DEFAULT '',
        accounting_date TEXT DEFAULT '',
        linked_po_id INTEGER REFERENCES purchase_orders(po_id) ON DELETE SET NULL,
        linked_po_number TEXT DEFAULT '',
        po_sub_total REAL DEFAULT 0,
        po_vat_amount REAL DEFAULT 0,
        po_grand_total REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN, PO_ISSUED
        effective_date TEXT NOT NULL DEFAULT 'Effective date : 11/11/2026',
        form_code TEXT NOT NULL DEFAULT 'FM-PU-01 / Rev.06',
        remarks TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pr_items (
        pr_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_id INTEGER NOT NULL REFERENCES purchase_requisitions(pr_id) ON DELETE CASCADE,
        line_no INTEGER NOT NULL,
        item_id INTEGER REFERENCES items(item_id) ON DELETE SET NULL,
        item_code_snapshot TEXT DEFAULT '',
        item_name_snapshot TEXT NOT NULL,
        purpose TEXT DEFAULT '',
        required_date TEXT DEFAULT '',
        quantity REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'PCS',
        actual_unit_price REAL DEFAULT NULL,
        actual_line_total REAL DEFAULT NULL
    );
    ''')

    # Add pr_id and requester_name columns to purchase_orders if not present
    po_cols = [r[1] for r in cur.execute("PRAGMA table_info(purchase_orders)").fetchall()]
    if 'pr_id' not in po_cols:
        cur.execute("ALTER TABLE purchase_orders ADD COLUMN pr_id INTEGER DEFAULT NULL;")
    if 'pr_requester_snapshot' not in po_cols:
        cur.execute("ALTER TABLE purchase_orders ADD COLUMN pr_requester_snapshot TEXT DEFAULT '';")
    if 'pr_department_snapshot' not in po_cols:
        cur.execute("ALTER TABLE purchase_orders ADD COLUMN pr_department_snapshot TEXT DEFAULT '';")

    # Seed realistic PRs if empty
    pr_count = cur.execute("SELECT COUNT(*) FROM purchase_requisitions").fetchone()[0]
    if pr_count == 0:
        v_mtcb = cur.execute("SELECT vendor_id, vendor_name, address, tel, fax FROM vendors WHERE vendor_code = '211/2557'").fetchone()
        v_sri = cur.execute("SELECT vendor_id, vendor_name, address, tel, fax FROM vendors WHERE vendor_code = '004/2551'").fetchone()

        po_0062 = cur.execute("SELECT po_id FROM purchase_orders WHERE po_number = 'PO/NES/0062-2026'").fetchone()
        po_0063 = cur.execute("SELECT po_id FROM purchase_orders WHERE po_number = 'PO/NES/0063-2026'").fetchone()

        ins01 = cur.execute("SELECT item_id FROM items WHERE item_code = 'INS-01'").fetchone()[0]
        ins14 = cur.execute("SELECT item_id FROM items WHERE item_code = 'INS-14'").fetchone()[0]
        ins08 = cur.execute("SELECT item_id FROM items WHERE item_code = 'INS-08'").fetchone()[0]
        dr01  = cur.execute("SELECT item_id FROM items WHERE item_code = 'DR-01'").fetchone()[0]

        # PR 1: 2/1/082 (Linked to PO/NES/0062-2026)
        cur.execute('''
            INSERT INTO purchase_requisitions (
                pr_number, pr_date, department, vendor_id, vendor_name_snapshot, vendor_address_snapshot, vendor_tel_fax_snapshot,
                purpose_flags, requester_name, reviewer_name, approver_name,
                purchasing_officer_name, purchasing_date, accounting_officer_name, accounting_date,
                linked_po_id, linked_po_number, po_sub_total, po_vat_amount, po_grand_total, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            '2/1/082', '2026-02-10', 'แผนกกลึง CNC (Production Line 1)',
            v_mtcb[0], v_mtcb[1], v_mtcb[2], f"Tel: {v_mtcb[3]} Fax: {v_mtcb[4]}",
            json.dumps(['cutting_tools', 'replacement']),
            'คุณวิชัย (วิศวกรฝ่ายผลิต)', 'หน.แผนกผลิต', 'ผจก.โรงงาน',
            'คุณสมศรี (เจ้าหน้าที่จัดซื้อ)', '2026-02-11', 'ฝ่ายบัญชี', '2026-02-11',
            po_0062[0] if po_0062 else None, 'PO/NES/0062-2026', 7480.00, 523.60, 8003.60, 'PO_ISSUED'
        ))
        pr1_id = cur.lastrowid
        pr1_items = [
            (1, ins01, 'INS-01', 'INSERT SEMT 13T3AGSN-JH VP15TF', 'ปาดหน้าชิ้นงานเหล็กหล่อ CNC', '2026-02-12', 30, 'PCS', 170.00, 5100.00),
            (2, ins14, 'INS-14', 'INSERT RPMW 08T2MOT VP15TF', 'กัดบ่าชิ้นงานตามแบบลูกค้า', '2026-02-12', 10, 'PCS', 92.00, 920.00),
            (3, ins08, 'INS-08', 'INSERT CPMH 090304LF NX2525', 'คว้านรูในละเอียด (Finishing)', '2026-02-12', 10, 'PCS', 146.00, 1460.00),
        ]
        for lno, iid, icode, iname, purp, reqd, qty, unit, aprice, atot in pr1_items:
            cur.execute('''
                INSERT INTO pr_items (pr_id, line_no, item_id, item_code_snapshot, item_name_snapshot, purpose, required_date, quantity, unit, actual_unit_price, actual_line_total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (pr1_id, lno, iid, icode, iname, purp, reqd, qty, unit, aprice, atot))

        if po_0062:
            cur.execute("UPDATE purchase_orders SET pr_id = ?, pr_requester_snapshot = ?, pr_department_snapshot = ? WHERE po_id = ?",
                        (pr1_id, 'คุณวิชัย (วิศวกรฝ่ายผลิต)', 'แผนกกลึง CNC (Production Line 1)', po_0062[0]))

        # PR 2: 2/11/015 (Linked to PO/NES/0063-2026)
        cur.execute('''
            INSERT INTO purchase_requisitions (
                pr_number, pr_date, department, vendor_id, vendor_name_snapshot, vendor_address_snapshot, vendor_tel_fax_snapshot,
                purpose_flags, requester_name, reviewer_name, approver_name,
                purchasing_officer_name, purchasing_date, accounting_officer_name, accounting_date,
                linked_po_id, linked_po_number, po_sub_total, po_vat_amount, po_grand_total, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            '2/11/015', '2026-11-04', 'แผนก Machining & Tooling',
            v_mtcb[0], v_mtcb[1], v_mtcb[2], f"Tel: {v_mtcb[3]} Fax: {v_mtcb[4]}",
            json.dumps(['cutting_tools', 'replacement']),
            'คุณวิชัย (วิศวกรฝ่ายผลิต)', 'หน.แผนกผลิต', 'ผจก.โรงงาน',
            'คุณสมศรี (เจ้าหน้าที่จัดซื้อ)', '2026-11-05', '', '',
            po_0063[0] if po_0063 else None, 'PO/NES/0063-2026', 4860.00, 340.20, 5200.20, 'PO_ISSUED'
        ))
        pr2_id = cur.lastrowid
        pr2_items = [
            (1, ins01, 'INS-01', 'INSERT SEMT 13T3AGSN-JH VP15TF', 'ทดแทนเม็ดมีดหมด Tool life', '2026-11-07', 20, 'PCS', 170.00, 3400.00),
            (2, ins08, 'INS-08', 'INSERT CPMH 090304LF NX2525', 'งานกลึงละเอียดประจำเดือน พ.ย.', '2026-11-07', 10, 'PCS', 146.00, 1460.00),
        ]
        for lno, iid, icode, iname, purp, reqd, qty, unit, aprice, atot in pr2_items:
            cur.execute('''
                INSERT INTO pr_items (pr_id, line_no, item_id, item_code_snapshot, item_name_snapshot, purpose, required_date, quantity, unit, actual_unit_price, actual_line_total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (pr2_id, lno, iid, icode, iname, purp, reqd, qty, unit, aprice, atot))

        if po_0063:
            cur.execute("UPDATE purchase_orders SET pr_id = ?, pr_requester_snapshot = ?, pr_department_snapshot = ? WHERE po_id = ?",
                        (pr2_id, 'คุณวิชัย (วิศวกรฝ่ายผลิต)', 'แผนก Machining & Tooling', po_0063[0]))

        # PR 3: 2/11/028 (Status: OPEN - Ready to be selected to open a new PO!)
        cur.execute('''
            INSERT INTO purchase_requisitions (
                pr_number, pr_date, department, vendor_id, vendor_name_snapshot, vendor_address_snapshot, vendor_tel_fax_snapshot,
                purpose_flags, requester_name, reviewer_name, approver_name,
                purchasing_officer_name, purchasing_date, accounting_officer_name, accounting_date,
                linked_po_id, linked_po_number, po_sub_total, po_vat_amount, po_grand_total, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            '2/11/028', '2026-11-14', 'แผนกผลิต (Production Line 2)',
            v_sri[0], v_sri[1], v_sri[2], f"Tel: {v_sri[3]} Fax: {v_sri[4]}",
            json.dumps(['cutting_tools', 'new_investment']),
            'คุณวิชัย (วิศวกรฝ่ายผลิต)', 'หน.แผนกผลิต', 'ผจก.โรงงาน',
            '', '', '', '',
            None, '', 0, 0, 0, 'OPEN'
        ))
        pr3_id = cur.lastrowid
        pr3_items = [
            (1, ins01, 'INS-01', 'INSERT SEMT 13T3AGSN-JH VP15TF', 'เตรียมขึ้นงาน Lot ใหม่เดือน พ.ย.', '2026-11-20', 40, 'PCS', None, None),
            (2, dr01,  'DR-01',  'ดอกสว่าน 3.2 mm.', 'เจาะรูนำชิ้นงานใหม่ (Improvement)', '2026-11-20', 15, 'PCS', None, None),
        ]
        for lno, iid, icode, iname, purp, reqd, qty, unit, aprice, atot in pr3_items:
            cur.execute('''
                INSERT INTO pr_items (pr_id, line_no, item_id, item_code_snapshot, item_name_snapshot, purpose, required_date, quantity, unit, actual_unit_price, actual_line_total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (pr3_id, lno, iid, icode, iname, purp, reqd, qty, unit, aprice, atot))

    # 3. WMS Inventory Lots & Transactions
    cur.executescript('''
    CREATE TABLE IF NOT EXISTS wms_lots (
        lot_id INTEGER PRIMARY KEY AUTOINCREMENT,
        lot_number TEXT UNIQUE NOT NULL,
        item_id INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
        vendor_id INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
        vendor_name_snapshot TEXT DEFAULT '',
        po_id INTEGER REFERENCES purchase_orders(po_id) ON DELETE SET NULL,
        po_number_snapshot TEXT DEFAULT '',
        received_date TEXT NOT NULL,
        initial_qty REAL NOT NULL DEFAULT 0,
        remaining_qty REAL NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT 'PCS',
        unit_cost REAL DEFAULT 0,
        location TEXT DEFAULT 'คลัง Tooling (Main Store)',
        remarks TEXT DEFAULT '',
        created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wms_transactions (
        tx_id INTEGER PRIMARY KEY AUTOINCREMENT,
        tx_type TEXT NOT NULL CHECK (tx_type IN ('INBOUND', 'OUTBOUND', 'CYCLE_COUNT')),
        item_id INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
        lot_id INTEGER REFERENCES wms_lots(lot_id) ON DELETE SET NULL,
        lot_number_snapshot TEXT DEFAULT '',
        vendor_id INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
        vendor_name_snapshot TEXT DEFAULT '',
        qty_before REAL NOT NULL DEFAULT 0,
        qty_change REAL NOT NULL DEFAULT 0,
        qty_after REAL NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT 'PCS',
        reference_doc TEXT DEFAULT '',
        reason TEXT DEFAULT '',
        performed_by TEXT DEFAULT '',
        tx_timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );
    ''')

    # Seed initial WMS lots & transactions if empty
    lot_count = cur.execute("SELECT COUNT(*) FROM wms_lots").fetchone()[0]
    if lot_count == 0:
        v_mtcb = cur.execute("SELECT vendor_id, vendor_name FROM vendors WHERE vendor_code = '211/2557'").fetchone()
        v_sri  = cur.execute("SELECT vendor_id, vendor_name FROM vendors WHERE vendor_code = '004/2551'").fetchone()
        po_0062 = cur.execute("SELECT po_id FROM purchase_orders WHERE po_number = 'PO/NES/0062-2026'").fetchone()

        ins01 = cur.execute("SELECT item_id FROM items WHERE item_code = 'INS-01'").fetchone()[0]
        ins14 = cur.execute("SELECT item_id FROM items WHERE item_code = 'INS-14'").fetchone()[0]
        ins08 = cur.execute("SELECT item_id FROM items WHERE item_code = 'INS-08'").fetchone()[0]
        dr01  = cur.execute("SELECT item_id FROM items WHERE item_code = 'DR-01'").fetchone()[0]

        sample_lots = [
            ('LOT-20251212-01', ins01, v_mtcb[0], v_mtcb[1], None, 'PO/NES/0518-2025', '2025-12-12', 20, 5, 'PCS', 175.00, 'ตู้ Tooling A-01', 'ล็อตเดือน ธ.ค. 2025'),
            ('LOT-20260212-01', ins01, v_mtcb[0], v_mtcb[1], po_0062[0] if po_0062 else None, 'PO/NES/0062-2026', '2026-02-12', 30, 22, 'PCS', 170.00, 'ตู้ Tooling A-01', 'รับเข้าตาม PO/NES/0062-2026'),
            ('LOT-20260212-02', ins14, v_mtcb[0], v_mtcb[1], po_0062[0] if po_0062 else None, 'PO/NES/0062-2026', '2026-02-12', 10, 8, 'PCS', 92.00, 'ตู้ Tooling A-02', 'รับเข้าตาม PO/NES/0062-2026'),
            ('LOT-20260212-03', ins08, v_mtcb[0], v_mtcb[1], po_0062[0] if po_0062 else None, 'PO/NES/0062-2026', '2026-02-12', 10, 10, 'PCS', 146.00, 'ตู้ Tooling A-03', 'รับเข้าตาม PO/NES/0062-2026'),
            ('LOT-20251212-02', dr01,  v_sri[0],  v_sri[1],  None, 'PO/NES/0518-2025', '2025-12-12', 10, 6, 'PCS', 175.00, 'ชั้นสว่าน B-01', 'รับเข้าดอกสว่าน 3.2 mm.'),
        ]
        for lnum, iid, vid, vname, poid, ponum, rdate, init_q, rem_q, unit, ucost, loc, rem in sample_lots:
            cur.execute('''
                INSERT INTO wms_lots (lot_number, item_id, vendor_id, vendor_name_snapshot, po_id, po_number_snapshot, received_date, initial_qty, remaining_qty, unit, unit_cost, location, remarks, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'คุณสมศรี (เจ้าหน้าที่จัดซื้อ)')
            ''', (lnum, iid, vid, vname, poid, ponum, rdate, init_q, rem_q, unit, ucost, loc, rem))
            lid = cur.lastrowid

            # Log INBOUND transaction
            cur.execute('''
                INSERT INTO wms_transactions (tx_type, item_id, lot_id, lot_number_snapshot, vendor_id, vendor_name_snapshot, qty_before, qty_change, qty_after, unit, reference_doc, reason, performed_by, tx_timestamp)
                VALUES ('INBOUND', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'รับสินค้าเข้าคลังตามใบสั่งซื้อ', 'คุณสมศรี (เจ้าหน้าที่จัดซื้อ)', ?)
            ''', (iid, lid, lnum, vid, vname, init_q, init_q, unit, ponum, rdate + ' 09:30:00'))

            # If remaining < initial, log an OUTBOUND transaction
            if rem_q < init_q:
                used = init_q - rem_q
                cur.execute('''
                    INSERT INTO wms_transactions (tx_type, item_id, lot_id, lot_number_snapshot, vendor_id, vendor_name_snapshot, qty_before, qty_change, qty_after, unit, reference_doc, reason, performed_by, tx_timestamp)
                    VALUES ('OUTBOUND', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISS-CNC-01', 'เบิกใช้งานแผนกกลึง CNC', 'คุณวิชัย (วิศวกรฝ่ายผลิต)', ?)
                ''', (iid, lid, lnum, vid, vname, init_q, -used, rem_q, unit, rdate + ' 15:00:00'))

    conn.commit()
    print("Database upgraded successfully with Users, PRs (FM-PU-01 / Rev.06), and WMS Inventory Lots & Cycle Count!")
    conn.close()

if __name__ == '__main__':
    upgrade()
