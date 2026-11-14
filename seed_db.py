import sqlite3
import zipfile
import xml.etree.ElementTree as ET
import base64
import json
import re
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.path.dirname(__file__), 'nes_po.db')
XLSX_PATH = os.path.join(os.path.dirname(__file__), 'nes_master_data.xlsx')
LOGO_PATH = os.path.join(os.path.dirname(__file__), 'extracted_logo.png')

def get_logo_base64():
    if os.path.exists(LOGO_PATH):
        with open(LOGO_PATH, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode('ascii')
            return f"data:image/png;base64,{b64}"
    return ""

def get_default_signature_svg_base64():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="260" height="80" viewBox="0 0 260 80">
      <path d="M25,58 C42,22 55,18 62,45 C67,62 78,24 96,30 C110,35 98,56 115,52 C132,48 148,18 165,24 C178,29 162,52 182,48 C202,44 218,28 240,34"
            fill="none" stroke="#1e3a8a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M40,65 Q125,52 225,60" fill="none" stroke="#1d4ed8" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>
    </svg>'''
    b64 = base64.b64encode(svg.encode('utf-8')).decode('ascii')
    return f"data:image/svg+xml;base64,{b64}"

def get_category_icon_svg(cat_code):
    colors = {
        'INS': ('#eff6ff', '#1d4ed8', '◆ INSERT'),
        'DR':  ('#f0fdf4', '#15803d', '▲ DRILL'),
        'DT':  ('#ecfdf5', '#047857', '▲ TAPER'),
        'CD':  ('#f0fdfa', '#0f766e', '◎ C-DRILL'),
        'CF':  ('#fdf4ff', '#a21caf', '◇ CHAMFER'),
        'TA':  ('#fff7ed', '#c2410c', '≡ TAP'),
        'RM':  ('#fef2f2', '#b91c1c', '║ REAMER'),
        'EM':  ('#eef2ff', '#4338ca', '❖ ENDMILL'),
        'CR':  ('#f8fafc', '#334155', '◉ COLLET'),
        'WD':  ('#fffbeb', '#b45309', '⚡ WELD'),
        'CONS':('#f5f3ff', '#6d28d9', '◈ CONSUM'),
        'S':   ('#f1f5f9', '#475569', '⊕ SCREW'),
        'OT':  ('#f3f4f6', '#374151', '□ OTHER'),
        'SH':  ('#fdf2f8', '#be185d', '▣ SHIM'),
        'M':   ('#ecfeff', '#0e7490', '⌖ MEAS'),
        'H':   ('#f0f9ff', '#0369a1', '⛨ HOLDER'),
        'F':   ('#fefce8', '#a16207', '⚙ FACEMILL'),
        'MT':  ('#', '#4b5563', '🔧 MAINT'),
    }
    bg, fg, label = colors.get(cat_code, ('#eff6ff', '#1d4ed8', cat_code))
    if not bg.startswith('#'):
        bg = '#f3f4f6'
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <rect width="80" height="80" rx="12" fill="{bg}" stroke="{fg}" stroke-width="2" stroke-opacity="0.25"/>
      <circle cx="40" cy="30" r="14" fill="{fg}" fill-opacity="0.15"/>
      <polygon points="40,18 51,30 40,42 29,30" fill="none" stroke="{fg}" stroke-width="2.2"/>
      <circle cx="40" cy="30" r="3.5" fill="{fg}"/>
      <text x="40" y="64" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="{fg}">{cat_code}</text>
    </svg>'''
    return f"data:image/svg+xml;base64,{base64.b64encode(svg.encode('utf-8')).decode('ascii')}"

def clean_thai_corruptions(text):
    if not text:
        return ""
    s = str(text).strip()
    replacements = [
        ('สแต็คเกอร์ยกของแบบงาเPaintingยบ', 'สแต็คเกอร์ยกของแบบงาเสียบ'),
        ('เพลาทองแดงPainting่เหลี่ยม', 'เพลาทองแดงสี่เหลี่ยม'),
        ('กำจัดของเPaintingยอันตราย (Oil, Liquid)', 'กำจัดของเสียอันตราย (น้ำมัน)'),
        ('แจ้งสัญญาณ TOT เPaintingย', 'แจ้งสัญญาณ TOT เสีย'),
        ('คุณสอดPainting', 'คุณสอดสี'),
        ('บริษัท จ.Painting่เจริญ อินดัสทรี จำกัด', 'บริษัท จ.สี่เจริญ อินดัสทรี จำกัด'),
        ('อ.เมืองนครราชPaintingมา จ.นครราชPaintingมา', 'อ.เมืองนครราชสีมา จ.นครราชสีมา'),
        ('Paintingทาอาคาร Paintingอุตสาหกรรมและอุปกรณ์งานPainting', 'สีทาอาคาร สีอุตสาหกรรมและอุปกรณ์งานสี'),
        ('ถ.คลองอาเPainting่ยคลองกันยา', 'ถ.คลองอาเสี่ยคลองกันยา'),
        ('Paintingขาว', 'สีขาว'),
        ('Paintingและ Hardware', 'สีและ Hardware'),
        ('วัสดุConstruction', 'วัสดุก่อสร้าง'),
        ('รับเหมาConstruction', 'รับเหมาก่อสร้าง'),
        ('งานConstruction', 'งานก่อสร้าง'),
        ('Electric Poleทาง', 'เสาไฟทาง'),
        ('Electric Pole ทาง', 'เสาไฟทาง'),
        ('Oil, Liquidหล่อลื่น', 'น้ำมันหล่อลื่น'),
        ('Oil, Liquidเครื่องจักร', 'น้ำมันเครื่องจักร'),
        ('Oil, Liquidไฮโดรลิค', 'น้ำมันไฮโดรลิค'),
        ('Oil, Liquidกันสนิม', 'น้ำมันกันสนิม'),
    ]
    for old, new in replacements:
        s = s.replace(old, new)
    if s == 'Painting':
        s = 'สี'
    return s

def parse_excel():
    z = zipfile.ZipFile(XLSX_PATH)
    ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    sst = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall('main:si', ns):
            texts = [t.text or '' for t in si.findall('.//main:t', ns)]
            sst.append(''.join(texts))

    def parse_sheet(sheet_path):
        root = ET.fromstring(z.read(sheet_path))
        rows = []
        for r in root.findall('.//main:sheetData/main:row', ns):
            row_num = int(r.attrib.get('r', 0))
            cells = {}
            for c in r.findall('main:c', ns):
                ref = c.attrib.get('r', '')
                col = re.sub(r'\d+', '', ref)
                t = c.attrib.get('t')
                v_el = c.find('main:v', ns)
                val = v_el.text if v_el is not None else ''
                if t == 's' and val != '':
                    val = sst[int(val)]
                cells[col] = val.strip() if isinstance(val, str) else val
            rows.append((row_num, cells))
        return rows

    vendors_raw = parse_sheet('xl/worksheets/sheet1.xml')
    types_raw = parse_sheet('xl/worksheets/sheet2.xml')
    items_raw = parse_sheet('xl/worksheets/sheet3.xml')
    return vendors_raw, types_raw, items_raw

def seed():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.executescript('''
    PRAGMA foreign_keys = ON;

    CREATE TABLE document_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        company_logo TEXT,
        company_name TEXT NOT NULL,
        company_address TEXT NOT NULL,
        company_tel TEXT NOT NULL,
        company_fax TEXT NOT NULL,
        company_tax_id TEXT NOT NULL,
        authorized_signer_name TEXT NOT NULL,
        signature_image TEXT,
        confirm_box_line1 TEXT NOT NULL,
        confirm_box_line2 TEXT NOT NULL,
        confirm_sign_label TEXT NOT NULL,
        confirm_date_label TEXT NOT NULL,
        default_remarks TEXT NOT NULL,
        effective_date TEXT NOT NULL,
        form_code TEXT NOT NULL,
        po_number_prefix TEXT NOT NULL DEFAULT 'PO/NES/',
        po_number_separator TEXT NOT NULL DEFAULT '-',
        default_delivery_location TEXT NOT NULL DEFAULT 'โรงงาน ซอย 12',
        default_delivery_contact TEXT NOT NULL DEFAULT 'จัดซื้อ 094-479-2417',
        default_vat_rate REAL NOT NULL DEFAULT 7.0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE vendor_tags (
        tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_name TEXT UNIQUE NOT NULL,
        description TEXT
    );

    CREATE TABLE vendors (
        vendor_id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_code TEXT UNIQUE NOT NULL,
        vendor_name TEXT NOT NULL,
        tax_id TEXT DEFAULT '',
        address TEXT DEFAULT '',
        tel TEXT DEFAULT '',
        fax TEXT DEFAULT '',
        mobile TEXT DEFAULT '',
        email TEXT DEFAULT '',
        contact_name TEXT DEFAULT '',
        default_payment_term TEXT DEFAULT 'CREDIT 30 DAYS',
        description TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE vendor_tag_mappings (
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES vendor_tags(tag_id) ON DELETE CASCADE,
        PRIMARY KEY (vendor_id, tag_id)
    );

    CREATE TABLE item_categories (
        category_id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_code TEXT UNIQUE NOT NULL,
        category_name TEXT UNIQUE NOT NULL,
        default_unit TEXT NOT NULL DEFAULT 'PCS',
        icon_url TEXT
    );

    CREATE TABLE items (
        item_id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_code TEXT UNIQUE NOT NULL,
        category_id INTEGER NOT NULL REFERENCES item_categories(category_id),
        item_name TEXT NOT NULL,
        default_unit TEXT NOT NULL DEFAULT 'PCS',
        image_url TEXT DEFAULT '',
        pic_engineer TEXT DEFAULT 'Tooling / Production',
        last_unit_price REAL DEFAULT NULL,
        last_vendor_id INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
        last_po_date TEXT DEFAULT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE purchase_orders (
        po_id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_number TEXT UNIQUE NOT NULL,
        po_date TEXT NOT NULL,
        vendor_id INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
        vendor_code_snapshot TEXT DEFAULT '',
        vendor_name_snapshot TEXT NOT NULL,
        vendor_address_snapshot TEXT DEFAULT '',
        vendor_tel_snapshot TEXT DEFAULT '',
        vendor_fax_snapshot TEXT DEFAULT '',
        vendor_contact_name TEXT DEFAULT '',
        vendor_contact_email TEXT DEFAULT '',
        pr_number TEXT DEFAULT '',
        quotation_ref TEXT DEFAULT '',
        delivery_location TEXT DEFAULT '',
        delivery_contact TEXT DEFAULT '',
        delivery_date TEXT DEFAULT '',
        payment_term TEXT DEFAULT 'CREDIT 30 DAYS',
        sub_total REAL NOT NULL DEFAULT 0,
        special_discount REAL NOT NULL DEFAULT 0,
        net_total REAL NOT NULL DEFAULT 0,
        vat_rate REAL NOT NULL DEFAULT 7.0,
        vat_amount REAL NOT NULL DEFAULT 0,
        grand_total REAL NOT NULL DEFAULT 0,
        amount_text_th TEXT DEFAULT '',
        remarks TEXT DEFAULT '',
        approval_status TEXT NOT NULL DEFAULT 'PENDING', -- DRAFT, PENDING, APPROVED, REJECTED
        issued_by TEXT NOT NULL DEFAULT 'ฝ่ายจัดซื้อ (Buyer)',
        approved_by TEXT DEFAULT '',
        approved_at TEXT DEFAULT '',
        approver_signature_snapshot TEXT DEFAULT '',
        reject_reason TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE po_items (
        po_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id INTEGER NOT NULL REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
        line_no INTEGER NOT NULL,
        item_id INTEGER REFERENCES items(item_id) ON DELETE SET NULL,
        item_code_snapshot TEXT NOT NULL,
        item_name_snapshot TEXT NOT NULL,
        item_image_snapshot TEXT DEFAULT '',
        quantity REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'PCS',
        unit_price REAL NOT NULL DEFAULT 0,
        line_discount REAL NOT NULL DEFAULT 0,
        line_total REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE po_approval_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id INTEGER NOT NULL REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
        actor_name TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL, -- CREATED, SUBMITTED, APPROVED, REJECTED, REVISED
        comment TEXT DEFAULT '',
        action_timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );
    ''')

    # 1. Insert Document Settings matching Example Form FM-PU-02 / Rev.00
    default_remarks = (
        "1. โปรดระบุเลขที่ใบสั่งซื้อ (PO) ในใบส่งของ หรือจดหมายโต้ตอบทุกฉบับ เพื่อสะดวกในการอ้างอิง\n"
        "2. ได้รับ PO แล้ว กรุณา SCAN กลับเพื่อยืนยันทุกครั้ง\n"
        "3. ส่งสินค้าโปรดแนบ PO ทุกครั้ง"
    )
    cur.execute('''
        INSERT INTO document_settings (
            id, company_logo, company_name, company_address, company_tel, company_fax, company_tax_id,
            authorized_signer_name, signature_image, confirm_box_line1, confirm_box_line2,
            confirm_sign_label, confirm_date_label, default_remarks, effective_date, form_code,
            po_number_prefix, po_number_separator, default_delivery_location, default_delivery_contact, default_vat_rate
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        get_logo_base64(),
        'บริษัท นวพล เอ็นจิเนียริ่ง แอนด์ ซัพพลาย จำกัด',
        '98/1 หมู่ 2 ตำบลหนองรี อำเภอเมืองชลบุรี จังหวัดชลบุรี 20000',
        '038-148111 , 038-148222',
        '038-148139',
        '0205547015961',
        'ผู้มีอำนาจลงนาม (Authorized Signatory)',
        get_default_signature_svg_base64(),
        'กรุณาเซ็นรับ และ SCAN PO กลับทุกครั้งด้วยค่ะ',
        'PLEASE CONFIRM BY EMAIL',
        'SIGN',
        'DATE',
        default_remarks,
        'Effective date : 01/06/2013',
        'FM-PU-02 / Rev.00',
        'PO/NES/',
        '-',
        'โรงงาน ซอย 12',
        'จัดซื้อ 094-479-2417',
        7.0
    ))

    vendors_raw, types_raw, items_raw = parse_excel()

    # 2. Insert Vendor Tags
    tag_map = {}
    for _, c in types_raw[1:]:
        tname = c.get('C', '').strip()
        tdesc = c.get('D', '').strip()
        if tname:
            cur.execute('INSERT OR IGNORE INTO vendor_tags (tag_name, description) VALUES (?, ?)', (tname, tdesc))
            cur.execute('SELECT tag_id FROM vendor_tags WHERE tag_name = ?', (tname,))
            tag_map[tname] = cur.fetchone()[0]

    # 3. Insert Vendors & M:N Tag Mappings (with data cleaning)
    vendor_by_code = {}
    vendor_tags_by_code = {}
    for _, c in vendors_raw[1:]:
        vcode = c.get('A', '').strip()
        if not vcode:
            continue
        vtag = c.get('B', '').strip()
        vname = clean_thai_corruptions(c.get('C', ''))
        vaddr = clean_thai_corruptions(c.get('D', ''))
        vtel = clean_thai_corruptions(c.get('E', ''))
        vfax = clean_thai_corruptions(c.get('F', ''))
        vmobile = clean_thai_corruptions(c.get('G', ''))
        vemail = clean_thai_corruptions(c.get('H', ''))
        vcontact = clean_thai_corruptions(c.get('I', ''))
        vdesc = clean_thai_corruptions(c.get('J', ''))

        # Fix misplaced emails
        if '@' in vfax and not vemail:
            vemail = vfax
            vfax = ''
        if '@' in vmobile and not vemail:
            vemail = vmobile
            vmobile = ''
        if 'Email :' in vname:
            parts = vname.split('Email :')
            vname = parts[0].strip()
            if not vemail:
                vemail = parts[1].strip()

        if vcode not in vendor_by_code:
            vendor_by_code[vcode] = {
                'vendor_code': vcode,
                'vendor_name': vname or f'Vendor {vcode}',
                'address': vaddr,
                'tel': vtel,
                'fax': vfax,
                'mobile': vmobile,
                'email': vemail,
                'contact_name': vcontact,
                'description': vdesc
            }
            vendor_tags_by_code[vcode] = set()
        if vtag:
            vendor_tags_by_code[vcode].add(vtag)

    vendor_id_by_code = {}
    for vcode, vdata in vendor_by_code.items():
        cur.execute('''
            INSERT INTO vendors (vendor_code, vendor_name, address, tel, fax, mobile, email, contact_name, default_payment_term, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREDIT 30 DAYS', ?)
        ''', (
            vdata['vendor_code'], vdata['vendor_name'], vdata['address'],
            vdata['tel'], vdata['fax'], vdata['mobile'], vdata['email'],
            vdata['contact_name'], vdata['description']
        ))
        vid = cur.lastrowid
        vendor_id_by_code[vcode] = vid
        for tname in vendor_tags_by_code.get(vcode, []):
            if tname not in tag_map:
                cur.execute('INSERT OR IGNORE INTO vendor_tags (tag_name, description) VALUES (?, ?)', (tname, ''))
                cur.execute('SELECT tag_id FROM vendor_tags WHERE tag_name = ?', (tname,))
                tag_map[tname] = cur.fetchone()[0]
            cur.execute('INSERT OR IGNORE INTO vendor_tag_mappings (vendor_id, tag_id) VALUES (?, ?)', (vid, tag_map[tname]))

    # 4. Insert Item Categories & Items
    cat_definitions = [
        ('INS', 'INSERT', 'PCS'),
        ('DR', 'DRILL', 'PCS'),
        ('DT', 'DRILL TAPER', 'PCS'),
        ('CD', 'CENTER DRILL', 'PCS'),
        ('CF', 'CHAMFER', 'PCS'),
        ('TA', 'TAP', 'PCS'),
        ('RM', 'REAMER', 'PCS'),
        ('EM', 'END MILL', 'PCS'),
        ('CR', 'COLLET', 'PCS'),
        ('WD', 'WELDING', 'PCS'),
        ('CONS', 'CONSUMABLE', 'PCS'),
        ('S', 'SCREW', 'PCS'),
        ('OT', 'OTHERS', 'PCS'),
        ('SH', 'SHIM', 'PCS'),
        ('M', 'MEASUREMENT', 'PCS'),
        ('H', 'HOLDER', 'PCS'),
        ('F', 'FACE MILLING', 'PCS'),
        ('MT', 'MAINTENANCE', 'PCS'),
    ]
    cat_id_by_name = {}
    cat_icon_by_name = {}
    for ccode, cname, cunit in cat_definitions:
        icon_svg = get_category_icon_svg(ccode)
        cur.execute('INSERT INTO item_categories (category_code, category_name, default_unit, icon_url) VALUES (?, ?, ?, ?)',
                    (ccode, cname, cunit, icon_svg))
        cat_id_by_name[cname] = cur.lastrowid
        cat_icon_by_name[cname] = icon_svg

    item_id_by_code = {}
    for _, c in items_raw[1:]:
        icode = c.get('B', '').strip()
        itype = c.get('C', '').strip()
        iname = c.get('D', '').strip()
        if not icode:
            continue
        if not iname:
            iname = f"(ไม่ระบุชื่อสินค้า {icode})"
        cid = cat_id_by_name.get(itype, cat_id_by_name['OTHERS'])
        icon_url = cat_icon_by_name.get(itype, cat_icon_by_name['OTHERS'])
        pic_eng = 'วิศวกร Tooling' if itype in ('INSERT', 'DRILL', 'END MILL', 'TAP', 'REAMER', 'HOLDER', 'COLLET', 'CHAMFER', 'CENTER DRILL', 'DRILL TAPER', 'FACE MILLING', 'SHIM') else 'ฝ่ายซ่อมบำรุง / ผลิต'
        cur.execute('''
            INSERT OR IGNORE INTO items (item_code, category_id, item_name, default_unit, image_url, pic_engineer, is_active)
            VALUES (?, ?, ?, 'PCS', ?, ?, ?)
        ''', (icode, cid, iname, icon_url, pic_eng, 0 if 'ไม่ระบุชื่อ' in iname else 1))
        cur.execute('SELECT item_id FROM items WHERE item_code = ?', (icode,))
        row = cur.fetchone()
        if row:
            item_id_by_code[icode] = row[0]

    # 5. Seed Historical & Current Purchase Orders so Price History & Comparison works out-of-the-box!
    sig_img = get_default_signature_svg_base64()
    v_mtcb = vendor_id_by_code.get('211/2557') # MATERIALS CARBIDE CO., LTD.
    v_sri = vendor_id_by_code.get('004/2551')  # บจก.ศรีรุ่งเรืองแมชชีนแอนด์ทูลส์

    # Historical PO 1: Oct 2025 (from Sri Rung Ruang)
    cur.execute('''
        INSERT INTO purchase_orders (
            po_number, po_date, vendor_id, vendor_code_snapshot, vendor_name_snapshot,
            vendor_address_snapshot, vendor_tel_snapshot, vendor_fax_snapshot,
            vendor_contact_name, vendor_contact_email, pr_number, quotation_ref,
            delivery_location, delivery_contact, delivery_date, payment_term,
            sub_total, special_discount, net_total, vat_rate, vat_amount, grand_total,
            amount_text_th, remarks, approval_status, issued_by, approved_by, approved_at, approver_signature_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        'PO/NES/0412-2025', '2025-10-15', v_sri, '004/2551', 'บจก.ศรีรุ่งเรืองแมชชีนแอนด์ทูลส์',
        '888 ม.4 ถ.เลี่ยงเมืองชลบุรี ต.หนองไม้แดง', '038-743414-21', '038-743422-3',
        'ฝ่ายขายอุตสาหกรรม', 'sales@srirungruang.co.th', '1/10/045', 'QT-2510-089',
        'โรงงาน ซอย 12', 'จัดซื้อ 094-479-2417', '2025-10-18', 'CREDIT 30 DAYS',
        8950.00, 0.00, 8950.00, 7.0, 626.50, 9576.50,
        'เก้าพันห้าร้อยเจ็ดสิบหกบาทห้าสิบสตางค์', default_remarks, 'APPROVED',
        'เจ้าหน้าที่จัดซื้อ', 'ผู้มีอำนาจลงนาม', '2025-10-15 14:20:00', sig_img
    ))
    po_hist1 = cur.lastrowid
    hist1_items = [
        (1, 'INS-01', 'INSERT SEMT 13T3AGSN-JH VP15TF', 30, 'PCS', 180.00, 0, 5400.00),
        (2, 'INS-14', 'INSERT RPMW 08T2MOT VP15TF', 20, 'PCS', 98.00, 0, 1960.00),
        (3, 'INS-08', 'INSERT CPMH 090304LF NX2525', 10, 'PCS', 159.00, 0, 1590.00),
    ]
    for lno, icode, iname, qty, unit, uprice, disc, ltot in hist1_items:
        cur.execute('''
            INSERT INTO po_items (po_id, line_no, item_id, item_code_snapshot, item_name_snapshot, item_image_snapshot, quantity, unit, unit_price, line_discount, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (po_hist1, lno, item_id_by_code.get(icode), icode, iname, cat_icon_by_name['INSERT'], qty, unit, uprice, disc, ltot))
    cur.execute('INSERT INTO po_approval_logs (po_id, actor_name, actor_role, action, comment, action_timestamp) VALUES (?, ?, ?, ?, ?, ?)',
                (po_hist1, 'ผู้มีอำนาจลงนาม', 'APPROVER', 'APPROVED', 'อนุมัติสั่งซื้อตามใบเสนอราคา', '2025-10-15 14:20:00'))

    # Historical PO 2: Dec 2025 (from MATERIALS CARBIDE - slight price drop)
    cur.execute('''
        INSERT INTO purchase_orders (
            po_number, po_date, vendor_id, vendor_code_snapshot, vendor_name_snapshot,
            vendor_address_snapshot, vendor_tel_snapshot, vendor_fax_snapshot,
            vendor_contact_name, vendor_contact_email, pr_number, quotation_ref,
            delivery_location, delivery_contact, delivery_date, payment_term,
            sub_total, special_discount, net_total, vat_rate, vat_amount, grand_total,
            amount_text_th, remarks, approval_status, issued_by, approved_by, approved_at, approver_signature_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        'PO/NES/0518-2025', '2025-12-10', v_mtcb, '211/2557', 'MATERIALS CARBIDE CO., LTD.',
        '2991 ถนนลาดพร้าว แขวงคลองจั่น เขตบางกะปิ กรุงเทพฯ 10240', '02.370.1599', '02.370.1303-4',
        'คุณมิค', 'mic@mtcb.co.th', '1/12/112', 'QT-MTCB-2512',
        'โรงงาน ซอย 12', 'จัดซื้อ 094-479-2417', '2025-12-12', 'CREDIT 30 DAYS',
        6200.00, 0.00, 6200.00, 7.0, 434.00, 6634.00,
        'หกพันหกร้อยสามสิบสี่บาทถ้วน', default_remarks, 'APPROVED',
        'เจ้าหน้าที่จัดซื้อ', 'ผู้มีอำนาจลงนาม', '2025-12-10 11:05:00', sig_img
    ))
    po_hist2 = cur.lastrowid
    hist2_items = [
        (1, 'INS-01', 'INSERT SEMT 13T3AGSN-JH VP15TF', 20, 'PCS', 175.00, 0, 3500.00),
        (2, 'INS-14', 'INSERT RPMW 08T2MOT VP15TF', 10, 'PCS', 95.00, 0, 950.00),
        (3, 'DR-01',  'ดอกสว่าน 3.2 mm.', 10, 'PCS', 175.00, 0, 1750.00),
    ]
    for lno, icode, iname, qty, unit, uprice, disc, ltot in hist2_items:
        cat_key = 'DRILL' if icode.startswith('DR') else 'INSERT'
        cur.execute('''
            INSERT INTO po_items (po_id, line_no, item_id, item_code_snapshot, item_name_snapshot, item_image_snapshot, quantity, unit, unit_price, line_discount, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (po_hist2, lno, item_id_by_code.get(icode), icode, iname, cat_icon_by_name[cat_key], qty, unit, uprice, disc, ltot))
    cur.execute('INSERT INTO po_approval_logs (po_id, actor_name, actor_role, action, comment, action_timestamp) VALUES (?, ?, ?, ?, ?, ?)',
                (po_hist2, 'ผู้มีอำนาจลงนาม', 'APPROVER', 'APPROVED', 'อนุมัติ ราคาต่ำกว่าเจ้าเดิม', '2025-12-10 11:05:00'))

    # 6. Exact Example PO from PDF: PO/NES/0062-2026 (Date: 11-02-26 -> 2026-02-11, Delivery: 12-02-26 -> 2026-02-12)
    cur.execute('''
        INSERT INTO purchase_orders (
            po_number, po_date, vendor_id, vendor_code_snapshot, vendor_name_snapshot,
            vendor_address_snapshot, vendor_tel_snapshot, vendor_fax_snapshot,
            vendor_contact_name, vendor_contact_email, pr_number, quotation_ref,
            delivery_location, delivery_contact, delivery_date, payment_term,
            sub_total, special_discount, net_total, vat_rate, vat_amount, grand_total,
            amount_text_th, remarks, approval_status, issued_by, approved_by, approved_at, approver_signature_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        'PO/NES/0062-2026', '2026-02-11', v_mtcb, '211/2557', 'MATERIALS CARBIDE CO., LTD.',
        '2991 ถนนลาดพร้าว แขวงคลองจั่น เขตบางกะปิ กรุงเทพฯ 10240', '02.370.1599', '02.370.1303-4',
        'คุณมิค', 'mic@mtcb.co.th', '2/1/082', 'ราคาเดิม',
        'โรงงาน ซอย 12', 'จัดซื้อ 094-479-2417', '2026-02-12', 'CREDIT 30 DAYS',
        7480.00, 0.00, 7480.00, 7.0, 523.60, 8003.60,
        'แปดพันสามบาทหกสิบสตางค์', default_remarks, 'APPROVED',
        'เจ้าหน้าที่จัดซื้อ', 'ผู้มีอำนาจลงนาม', '2026-02-11 10:30:00', sig_img
    ))
    po_example_id = cur.lastrowid

    example_items = [
        (1, 'INS-01', 'INSERT SEMT 13T3AGSN-JH VP15TF', 30, 'PCS', 170.00, 0.0, 5100.00),
        (2, 'INS-14', 'INSERT RPMW 08T2MOT VP15TF',     10, 'PCS', 92.00,  0.0, 920.00),
        (3, 'INS-08', 'INSERT CPMH 090304LF NX2525',    10, 'PCS', 146.00, 0.0, 1460.00),
    ]
    for lno, icode, iname, qty, unit, uprice, disc, ltot in example_items:
        iid = item_id_by_code.get(icode)
        cur.execute('''
            INSERT INTO po_items (po_id, line_no, item_id, item_code_snapshot, item_name_snapshot, item_image_snapshot, quantity, unit, unit_price, line_discount, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (po_example_id, lno, iid, icode, iname, cat_icon_by_name['INSERT'], qty, unit, uprice, disc, ltot))

    cur.execute('INSERT INTO po_approval_logs (po_id, actor_name, actor_role, action, comment, action_timestamp) VALUES (?, ?, ?, ?, ?, ?)',
                (po_example_id, 'เจ้าหน้าที่จัดซื้อ', 'BUYER', 'SUBMITTED', 'ยื่นขออนุมัติใบสั่งซื้อ PO/NES/0062-2026', '2026-02-11 09:15:00'))
    cur.execute('INSERT INTO po_approval_logs (po_id, actor_name, actor_role, action, comment, action_timestamp) VALUES (?, ?, ?, ?, ?, ?)',
                (po_example_id, 'ผู้มีอำนาจลงนาม', 'APPROVER', 'APPROVED', 'อนุมัติตามราคาเดิม', '2026-02-11 10:30:00'))

    # Update cached last_unit_price on items from approved POs
    cur.execute('''
        UPDATE items
        SET last_unit_price = (
            SELECT pi.unit_price
            FROM po_items pi
            JOIN purchase_orders po ON pi.po_id = po.po_id
            WHERE pi.item_id = items.item_id AND po.approval_status = 'APPROVED'
            ORDER BY po.po_date DESC, po.po_id DESC
            LIMIT 1
        ),
        last_vendor_id = (
            SELECT po.vendor_id
            FROM po_items pi
            JOIN purchase_orders po ON pi.po_id = po.po_id
            WHERE pi.item_id = items.item_id AND po.approval_status = 'APPROVED'
            ORDER BY po.po_date DESC, po.po_id DESC
            LIMIT 1
        ),
        last_po_date = (
            SELECT po.po_date
            FROM po_items pi
            JOIN purchase_orders po ON pi.po_id = po.po_id
            WHERE pi.item_id = items.item_id AND po.approval_status = 'APPROVED'
            ORDER BY po.po_date DESC, po.po_id DESC
            LIMIT 1
        )
        WHERE EXISTS (
            SELECT 1 FROM po_items pi
            JOIN purchase_orders po ON pi.po_id = po.po_id
            WHERE pi.item_id = items.item_id AND po.approval_status = 'APPROVED'
        )
    ''')

    # Also add 1 PENDING PO (PO/NES/0063-2026) so the user can test clicking Approve right away!
    cur.execute('''
        INSERT INTO purchase_orders (
            po_number, po_date, vendor_id, vendor_code_snapshot, vendor_name_snapshot,
            vendor_address_snapshot, vendor_tel_snapshot, vendor_fax_snapshot,
            vendor_contact_name, vendor_contact_email, pr_number, quotation_ref,
            delivery_location, delivery_contact, delivery_date, payment_term,
            sub_total, special_discount, net_total, vat_rate, vat_amount, grand_total,
            amount_text_th, remarks, approval_status, issued_by, approved_by, approved_at, approver_signature_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        'PO/NES/0063-2026', '2026-11-05', v_mtcb, '211/2557', 'MATERIALS CARBIDE CO., LTD.',
        '2991 ถนนลาดพร้าว แขวงคลองจั่น เขตบางกะปิ กรุงเทพฯ 10240', '02.370.1599', '02.370.1303-4',
        'คุณมิค', 'mic@mtcb.co.th', '2/11/015', 'ราคาเดิม',
        'โรงงาน ซอย 12', 'จัดซื้อ 094-479-2417', '2026-11-07', 'CREDIT 30 DAYS',
        4860.00, 0.00, 4860.00, 7.0, 340.20, 5200.20,
        'ห้าพันสองร้อยบาทยี่สิบสตางค์', default_remarks, 'PENDING',
        'เจ้าหน้าที่จัดซื้อ', '', '', ''
    ))
    po_pending_id = cur.lastrowid
    pending_items = [
        (1, 'INS-01', 'INSERT SEMT 13T3AGSN-JH VP15TF', 20, 'PCS', 170.00, 0.0, 3400.00),
        (2, 'INS-08', 'INSERT CPMH 090304LF NX2525',    10, 'PCS', 146.00, 0.0, 1460.00),
    ]
    for lno, icode, iname, qty, unit, uprice, disc, ltot in pending_items:
        cur.execute('''
            INSERT INTO po_items (po_id, line_no, item_id, item_code_snapshot, item_name_snapshot, item_image_snapshot, quantity, unit, unit_price, line_discount, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (po_pending_id, lno, item_id_by_code.get(icode), icode, iname, cat_icon_by_name['INSERT'], qty, unit, uprice, disc, ltot))
    cur.execute('INSERT INTO po_approval_logs (po_id, actor_name, actor_role, action, comment, action_timestamp) VALUES (?, ?, ?, ?, ?, ?)',
                (po_pending_id, 'เจ้าหน้าที่จัดซื้อ', 'BUYER', 'SUBMITTED', 'ยื่นขออนุมัติใบสั่งซื้อประจำเดือน พ.ย.', '2026-11-05 09:00:00'))

    conn.commit()

    # Print summary counts
    v_count = cur.execute('SELECT COUNT(*) FROM vendors').fetchone()[0]
    t_count = cur.execute('SELECT COUNT(*) FROM vendor_tags').fetchone()[0]
    i_count = cur.execute('SELECT COUNT(*) FROM items').fetchone()[0]
    c_count = cur.execute('SELECT COUNT(*) FROM item_categories').fetchone()[0]
    p_count = cur.execute('SELECT COUNT(*) FROM purchase_orders').fetchone()[0]
    print(f"Seeded nes_po.db successfully: {v_count} vendors, {t_count} vendor tags, {i_count} items, {c_count} categories, {p_count} POs.")
    conn.close()

if __name__ == '__main__':
    seed()
    import upgrade_db
    upgrade_db.upgrade()
