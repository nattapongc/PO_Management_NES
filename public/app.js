/* ==========================================================================
   NES-PO, PR & WMS Management System — Complete Frontend Application Logic
   บริษัท นวพล เอ็นจิเนียริ่ง แอนด์ ซัพพลาย จำกัด
   ========================================================================== */

const PR_PURPOSE_OPTIONS = [
  { id: 'cutting_tools', label: 'Cutting Tools. (Mass, Make to order)', col: 1 },
  { id: 'replacement',   label: 'ทดแทน (เสื่อมสภาพ, หมด Tool life)', col: 1 },
  { id: 'new_investment',label: 'ลงทุนใหม่ (งานใหม่, Improvement)', col: 1 },
  { id: 'make_to_order', label: 'งานจ้างทำ (Make to order)', col: 1 },
  { id: 'ng',            label: 'NG', col: 1 },
  { id: 'consumable',    label: 'วัสดุสิ้นเปลือง', col: 2 },
  { id: 'machine_oil',   label: 'น้ำมันเครื่องจักร', col: 2 },
  { id: 'material',      label: "Mat'l", col: 2 }
];

const STATE = {
  currentUser: null,
  currentTab: 'dashboard',
  settings: null,
  categories: [],
  vendorTags: [],
  stats: {},
  nextPoNumber: 'PO/NES/0064-2026',
  nextPrNumber: '2/11/029',
  nextLotNumber: 'LOT-20261114-01',
  nextVendorCode: '412/2569',
  items: [],
  vendors: [],
  pos: [],
  prs: [],
  users: [],
  wmsLots: [],
  wmsTransactions: [],
  priceHistory: [],
  currentViewingPo: null,
  currentViewingPr: null,

  // PO Form State
  poForm: null,
  showLivePoPreview: true,
  livePreviewZoom: 'fit',

  // PR Form State
  prSubMode: 'list', // 'list' | 'create'
  prForm: null,
  showLivePrPreview: true,

  // WMS State
  wmsSubTab: 'lots', // 'lots' | 'items' | 'cycle' | 'history'
  wmsSearch: '',

  // Touch Signature Pad for Approval
  approvePenColor: '#1e3a8a',
  hasDrawnApproveSignature: false,

  // Filters
  poListStatusFilter: 'ALL',
  poListSearch: '',
  prListSearch: '',
  itemSearch: '',
  itemCategoryFilter: 'ALL',
  itemPage: 1,
  vendorSearch: '',
  vendorTagFilter: 'ALL',
  vendorPage: 1,
  selectedHistoryItemId: null,
  itemModalImageBase64: ''
};

// ==========================================================================
// 1. Utility Functions: Thai Baht Text, Date Formatting, Role Helpers
// ==========================================================================

function formatMoney(num) {
  const n = Number(num || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPoDocDate(isoDateStr) {
  if (!isoDateStr) return '';
  const clean = String(isoDateStr).trim().slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3) {
    const [yyyy, mm, dd] = parts;
    const yy = yyyy.slice(-2);
    return `${dd}-${mm}-${yy}`;
  }
  return isoDateStr;
}

function thaiBahtText(amount) {
  let num = Number(amount || 0);
  if (isNaN(num) || num <= 0) return 'ศูนย์บาทถ้วน';
  num = Math.round(num * 100) / 100;

  const [intPartStr, decPartStr] = num.toFixed(2).split('.');
  const numText = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const unitText = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  function convertInteger(str) {
    let nStr = str.replace(/^0+/, '');
    if (!nStr) return '';
    let result = '';
    const len = nStr.length;
    for (let i = 0; i < len; i++) {
      const digit = parseInt(nStr.charAt(i), 10);
      const pos = (len - i - 1) % 6;
      const isMillionBoundary = (len - i - 1) > 0 && pos === 0;

      if (digit !== 0) {
        if (pos === 1 && digit === 1) {
          result += 'สิบ';
        } else if (pos === 1 && digit === 2) {
          result += 'ยี่สิบ';
        } else if (pos === 0 && digit === 1 && len > 1 && nStr.charAt(i - 1) !== '0') {
          result += 'เอ็ด';
        } else {
          result += numText[digit] + unitText[pos];
        }
      }
      if (isMillionBoundary) {
        result += 'ล้าน';
      }
    }
    return result;
  }

  const bahtStr = convertInteger(intPartStr);
  const satangInt = parseInt(decPartStr, 10);
  let out = (bahtStr ? bahtStr + 'บาท' : '');
  if (satangInt === 0) {
    out += 'ถ้วน';
  } else {
    out += convertInteger(String(satangInt)) + 'สตางค์';
  }
  return out;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusBadgeHtml(status) {
  const map = {
    APPROVED: '✅ อนุมัติแล้ว (Approved)',
    PENDING: '⏳ รออนุมัติ (Pending)',
    REJECTED: '❌ ตีกลับ (Rejected)',
    DRAFT: '📝 ฉบับร่าง (Draft)',
    OPEN: '📋 รอเปิด PO (Open PR)',
    PO_ISSUED: '🔗 เปิดใบสั่งซื้อ PO แล้ว'
  };
  const cls = status === 'PO_ISSUED' ? 'APPROVED' : (status === 'OPEN' ? 'PENDING' : status);
  return `<span class="badge badge-${cls}">${map[status] || status}</span>`;
}

function getUserRole() {
  return (STATE.currentUser && STATE.currentUser.role) || 'PURCHASING';
}

function isNormalUser() {
  return getUserRole() === 'NORMAL_USER';
}

function canEditMasterData() {
  const r = getUserRole();
  return r === 'ADMIN' || r === 'PURCHASING';
}

function canIssuePr() {
  const r = getUserRole();
  return r === 'ADMIN' || r === 'PURCHASING' || r === 'NORMAL_USER';
}

function canIssuePo() {
  const r = getUserRole();
  return r === 'ADMIN' || r === 'PURCHASING';
}

function canIssuePoOrPr() {
  return canIssuePo();
}

function canApprovePo() {
  const r = getUserRole();
  return r === 'ADMIN' || r === 'APPROVER';
}

function isAdmin() {
  return getUserRole() === 'ADMIN';
}

// ==========================================================================
// 2. Authentication & Session Handling
// ==========================================================================

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function handleLoginSubmit(ev) {
  if (ev) ev.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  await performLogin(username, password);
}

async function quickLogin(username, password) {
  document.getElementById('login-username').value = username;
  document.getElementById('login-password').value = password;
  await performLogin(username, password);
}

async function performLogin(username, password) {
  const errBox = document.getElementById('login-error-box');
  errBox.style.display = 'none';
  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    STATE.currentUser = res.user;
    sessionStorage.setItem('nes_po_user', JSON.stringify(res.user));
    document.getElementById('login-overlay').classList.add('hidden');
    await loadAllData();
    if (isNormalUser()) {
      STATE.prSubMode = 'list';
      switchTab('prs');
    } else {
      switchTab('dashboard');
    }
  } catch (err) {
    errBox.textContent = '❌ ' + err.message;
    errBox.style.display = 'block';
  }
}

function handleLogout() {
  STATE.currentUser = null;
  sessionStorage.removeItem('nes_po_user');
  document.getElementById('login-password').value = '';
  document.getElementById('login-overlay').classList.remove('hidden');
}

async function loadAllData() {
  if (isNormalUser()) {
    // Normal User only needs bootstrap settings, items (for stock & PR), PRs, and WMS stock
    const [boot, items, prs, wms] = await Promise.all([
      apiFetch('/api/bootstrap'),
      apiFetch('/api/items'),
      apiFetch('/api/prs'),
      apiFetch('/api/wms/overview')
    ]);
    STATE.settings = boot.settings;
    STATE.categories = boot.categories;
    STATE.vendorTags = [];
    STATE.stats = boot.stats;
    STATE.nextPrNumber = boot.next_pr_number;
    STATE.items = items;
    STATE.vendors = [];
    STATE.pos = [];
    STATE.prs = prs;
    STATE.wmsLots = wms.lots || [];
    STATE.wmsTransactions = [];
    STATE.priceHistory = [];
    updateChromeUI();
    return;
  }

  const [boot, items, vendors, pos, prs, wms, history] = await Promise.all([
    apiFetch('/api/bootstrap'),
    apiFetch('/api/items'),
    apiFetch('/api/vendors'),
    apiFetch('/api/pos'),
    apiFetch('/api/prs'),
    apiFetch('/api/wms/overview'),
    apiFetch('/api/price-history')
  ]);

  STATE.settings = boot.settings;
  STATE.categories = boot.categories;
  STATE.vendorTags = boot.vendor_tags;
  STATE.stats = boot.stats;
  STATE.nextPoNumber = boot.next_po_number;
  STATE.nextPrNumber = boot.next_pr_number;
  STATE.nextLotNumber = boot.next_lot_number;
  STATE.nextVendorCode = boot.next_vendor_code;
  STATE.items = items;
  STATE.vendors = vendors;
  STATE.pos = pos;
  STATE.prs = prs;
  STATE.wmsLots = wms.lots || [];
  STATE.wmsTransactions = wms.transactions || [];
  STATE.priceHistory = history;

  if (isAdmin()) {
    STATE.users = await apiFetch('/api/users');
  }

  if (!STATE.selectedHistoryItemId && items.length > 0) {
    const ins01 = items.find(i => i.item_code === 'INS-01');
    STATE.selectedHistoryItemId = ins01 ? ins01.item_id : items[0].item_id;
  }

  updateChromeUI();
}

function updateChromeUI() {
  const logoEl = document.getElementById('sidebar-logo-img');
  const loginLogoEl = document.getElementById('login-logo-img');
  if (STATE.settings && STATE.settings.company_logo) {
    if (logoEl) logoEl.src = STATE.settings.company_logo;
    if (loginLogoEl) loginLogoEl.src = STATE.settings.company_logo;
  }

  const formCodeEl = document.getElementById('sidebar-form-code');
  if (formCodeEl && STATE.settings) {
    formCodeEl.textContent = STATE.settings.form_code || 'FM-PU-02 / Rev.00';
  }

  // Pending PO Badge
  const pendingBadge = document.getElementById('nav-pending-badge');
  const pendingCount = STATE.pos.filter(p => p.approval_status === 'PENDING').length;
  if (pendingBadge) {
    pendingBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    pendingBadge.textContent = pendingCount;
  }

  // Open PR Badge
  const openPrBadge = document.getElementById('nav-open-pr-badge');
  const openPrCount = STATE.prs.filter(p => p.status === 'OPEN').length;
  if (openPrBadge) {
    openPrBadge.style.display = openPrCount > 0 ? 'inline-block' : 'none';
    openPrBadge.textContent = openPrCount;
  }

  // Update Topbar User Info & Role Visibility
  if (STATE.currentUser) {
    const nameEl = document.getElementById('topbar-user-name');
    const roleEl = document.getElementById('topbar-user-role-badge');
    if (nameEl) nameEl.textContent = STATE.currentUser.full_name;
    if (roleEl) {
      const roleLabels = {
        ADMIN: '👑 ADMIN (ทุกสิทธิ์)',
        APPROVER: '✍️ APPROVER (ผู้อนุมัติ)',
        PURCHASING: '🛒 PURCHASING (ฝ่ายจัดซื้อ)',
        NORMAL_USER: '👤 NORMAL USER (เปิด PR / ดู Stock)'
      };
      roleEl.textContent = roleLabels[STATE.currentUser.role] || STATE.currentUser.role;
    }

    const normal = isNormalUser();
    const setShow = (id, show, displayType = 'flex') => {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? displayType : 'none';
    };

    // Normal User only sees PRs and Store Stock (WMS); all other tabs are hidden
    setShow('nav-btn-dashboard', !normal);
    setShow('nav-btn-prs', true);
    setShow('nav-btn-create-po', !normal && canIssuePo());
    setShow('nav-btn-approvals', !normal);
    setShow('nav-btn-price-history', !normal);
    setShow('nav-btn-wms', true);
    setShow('nav-btn-items', !normal);
    setShow('nav-btn-vendors', !normal);
    setShow('nav-admin-section-label', !normal, 'block');
    setShow('nav-btn-users', !normal && isAdmin());
    setShow('nav-btn-settings', !normal);

    const poSecLabel = document.getElementById('nav-po-section-label');
    if (poSecLabel) {
      poSecLabel.textContent = normal ? 'ระบบใบขอซื้อ (PR)' : 'ระบบใบขอซื้อ & ใบสั่งซื้อ (PR / PO)';
    }
    const wmsSecLabel = document.getElementById('nav-wms-section-label');
    if (wmsSecLabel) {
      wmsSecLabel.textContent = normal ? 'ตรวจสอบสต็อกคงเหลือ (Store)' : 'คลังสินค้า & ฐานข้อมูลหลัก';
    }
    const wmsBtnLabel = document.getElementById('nav-label-wms');
    if (wmsBtnLabel) {
      wmsBtnLabel.textContent = normal ? '📦 จำนวน Stock คงค้างใน Store' : '📦 คลังสินค้า & สต็อก (WMS)';
    }
  }
}

function switchTab(tabName) {
  if (isNormalUser() && tabName !== 'prs' && tabName !== 'wms') {
    tabName = 'prs';
  }
  if (tabName === 'users' && !isAdmin()) {
    alert('เฉพาะผู้ดูแลระบบ (Role: Admin) เท่านั้นที่สามารถเข้าจัดการผู้ใช้งานได้');
    return;
  }
  STATE.currentTab = tabName;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  const titles = {
    'dashboard': ['แดชบอร์ด & รายการใบสั่งซื้อ (PO / PR Traceability)', 'ภาพรวมการจัดซื้อ สถานะใบสั่งซื้อ และการสืบย้อนกลับใบขอซื้อ (PR)'],
    'prs': isNormalUser()
      ? ['ระบบใบขอซื้อ & ประวัติ PR (Purchase Requisition — FM-PU-01 / Rev.06)', 'สำหรับเปิดใบขอซื้อ (Issue PR) และตรวจสอบประวัติสถานะใบขอซื้อของแผนก']
      : ['ระบบใบขอซื้อ (Purchase Requisition — FM-PU-01 / Rev.06)', 'เปิดใบขอซื้อ (Issue PR) และเชื่อมโยงข้อมูลไปเปิดใบสั่งซื้อ (PO) พร้อมซิงค์ราคาจริงกลับอัตโนมัติ'],
    'create-po': ['เปิดใบสั่งซื้อ (Issue Purchase Order — FM-PU-02 / Rev.00)', 'เปิด PO ได้ทั้งแบบอิสระ หรือดึงข้อมูลจากใบขอซื้อ (PR) พร้อมดูหน้ากระดาษ PO แบบสดขณะพิมพ์'],
    'approvals': ['ศูนย์อนุมัติใบสั่งซื้อ (Approval Center — วาดลายเซ็นสด)', 'ตรวจสอบรายละเอียด PR/PO และลงนามอนุมัติด้วยการวาดลายเซ็นบนหน้าจอ (รองรับ PC / iPad / Tablet)'],
    'price-history': ['ประวัติการสั่งซื้อ & เปรียบเทียบราคา (Price History & Analytics)', 'เปรียบเทียบราคาสินค้าในแต่ละช่วงเวลาและเปรียบเทียบราคาแยกตามผู้ขาย'],
    'wms': isNormalUser()
      ? ['ตรวจสอบจำนวน Stock คงค้างใน Store (Store Stock Balance)', 'ตรวจสอบยอดคงเหลือของสินค้าและอะไหล่ในคลัง (Store) เพื่อประกอบการเปิดใบขอซื้อ (PR)']
      : ['คลังสินค้า & ตรวจนับสต็อก (WMS Inventory & Cycle Count)', 'บริหารจัดการรับเข้า-ตัดออกแยกตาม Lot (ระบุ Supplier) และทำ Manual Cycle Count ปรับสต็อก'],
    'items': ['จัดการข้อมูลสินค้า (Items Master Data)', 'ฐานข้อมูลสินค้า 928+ รายการ พร้อมยอดคงเหลือในคลัง WMS และราคาล่าสุด'],
    'vendors': ['จัดการข้อมูลผู้ขาย (Vendors / Suppliers Master Data)', 'ฐานข้อมูลผู้ขาย 411+ ราย พร้อมหมวดหมู่ M:N Tags'],
    'users': ['จัดการผู้ใช้งานและสิทธิ์การเข้าถึง (User Management — Admin Only)', 'สร้างและกำหนดสิทธิ์ผู้ใช้งานทั้ง 4 Roles: Admin, Approver, Purchasing, Normal User'],
    'settings': ['ตั้งค่าแบบฟอร์มเอกสารใบสั่งซื้อ (PO Document Settings)', 'แก้ไขโลโก้ ข้อมูลบริษัท ข้อความเซ็นรับ หมายเหตุ Effective Date และหมายเลขฟอร์ม']
  };
  const [t, sub] = titles[tabName] || ['', ''];
  document.getElementById('topbar-title').textContent = t;
  document.getElementById('topbar-subtitle').textContent = sub;

  renderCurrentTab();
}

function renderCurrentTab() {
  const container = document.getElementById('app-view');
  if (!container) return;

  switch (STATE.currentTab) {
    case 'dashboard':
      renderDashboard(container);
      break;
    case 'prs':
      renderPrPage(container);
      break;
    case 'create-po':
      renderCreatePoForm(container);
      break;
    case 'approvals':
      renderApprovalCenter(container);
      break;
    case 'price-history':
      renderPriceHistory(container);
      break;
    case 'wms':
      renderWmsPage(container);
      break;
    case 'items':
      renderItemsMaster(container);
      break;
    case 'vendors':
      renderVendorsMaster(container);
      break;
    case 'users':
      renderUsersAdminPage(container);
      break;
    case 'settings':
      renderDocumentSettings(container);
      break;
  }
}

// ==========================================================================
// 3. Official PO Document Renderer (FM-PU-02 / Rev.00)
// ==========================================================================

function buildOfficialPoDocumentHtml(poData, settingsOverride = null) {
  const s = settingsOverride || STATE.settings || {};
  const items = Array.isArray(poData.items) ? poData.items : [];
  const minRows = 12;
  const totalRows = Math.max(minRows, items.length);

  let rowsHtml = '';
  for (let i = 0; i < totalRows; i++) {
    const it = items[i];
    if (it) {
      const discText = Number(it.line_discount || 0) > 0 ? formatMoney(it.line_discount) : '-';
      rowsHtml += `
        <tr>
          <td style="text-align:center;">${i + 1}</td>
          <td>${escapeHtml(it.item_name_snapshot || '')}</td>
          <td>
            <div class="po-doc-qty-cell">
              <span>${Number(it.quantity || 0).toLocaleString('en-US')}</span>
              <span>${escapeHtml(it.unit || 'PCS')}</span>
            </div>
          </td>
          <td style="text-align:right;">${formatMoney(it.unit_price)}</td>
          <td style="text-align:center;">${discText}</td>
          <td style="text-align:right;">${formatMoney(it.line_total)}</td>
        </tr>
      `;
    } else {
      rowsHtml += `
        <tr>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
        </tr>
      `;
    }
  }

  const remarksText = (poData.remarks !== undefined && poData.remarks !== '')
    ? poData.remarks
    : (s.default_remarks || '');
  const remarkLines = String(remarksText).split('\n').filter(Boolean);

  const isApproved = poData.approval_status === 'APPROVED';
  const sigImgSrc = isApproved
    ? (poData.approver_signature_snapshot || s.signature_image || '')
    : '';
  const signedDateStr = isApproved
    ? formatPoDocDate(poData.approved_at ? poData.approved_at.slice(0, 10) : poData.po_date)
    : '';

  const specDiscVal = Number(poData.special_discount || 0);
  const vatRate = poData.vat_rate !== undefined ? Number(poData.vat_rate) : 7;
  const amountWords = poData.amount_text_th || thaiBahtText(poData.grand_total);

  return `
    <div class="po-paper">
      <div class="po-doc-top">
        <div class="po-doc-logo">
          ${s.company_logo ? `<img src="${s.company_logo}" alt="Company Logo" />` : '<div style="font-weight:bold;color:#1d4ed8;">N.E.S</div>'}
        </div>
        <div class="po-doc-company">
          <div class="po-doc-company-name">${escapeHtml(s.company_name || '')}</div>
          <div class="po-doc-company-addr">${escapeHtml(s.company_address || '')}</div>
          <div class="po-doc-company-contact">
            Tel. ${escapeHtml(s.company_tel || '')} &nbsp; Fax. ${escapeHtml(s.company_fax || '')} &nbsp; เลขประจำตัวผู้เสียภาษีอากร ${escapeHtml(s.company_tax_id || '')}
          </div>
        </div>
      </div>

      <div class="po-doc-meta">
        <div class="po-doc-vendor-side">
          <div class="po-doc-vendor-row">
            <div class="po-doc-vendor-label">ผู้ขาย :</div>
            <div class="po-doc-vendor-val" style="font-weight:700;">${escapeHtml(poData.vendor_name_snapshot || '')}</div>
          </div>
          <div class="po-doc-vendor-row">
            <div class="po-doc-vendor-label">ที่อยู่ :</div>
            <div class="po-doc-vendor-val">${escapeHtml(poData.vendor_address_snapshot || '')}</div>
          </div>
          <div class="po-doc-vendor-row">
            <div class="po-doc-vendor-label">โทรศัพท์ :</div>
            <div class="po-doc-vendor-split">
              <span style="min-width:130px;">${escapeHtml(poData.vendor_tel_snapshot || '-')}</span>
              <span>Fax: ${escapeHtml(poData.vendor_fax_snapshot || '-')}</span>
            </div>
          </div>
          <div class="po-doc-vendor-row">
            <div class="po-doc-vendor-label">ผู้ติดต่อ :</div>
            <div class="po-doc-vendor-split">
              <span style="min-width:130px;">${escapeHtml(poData.vendor_contact_name || '-')}</span>
              <span>email : ${escapeHtml(poData.vendor_contact_email || '-')}</span>
            </div>
          </div>
        </div>

        <div class="po-doc-right-side">
          <div class="po-doc-title-row">
            <div class="po-doc-title">ใบสั่งซื้อ (PO)</div>
            <div class="po-doc-page-no">หน้า 1/1</div>
          </div>
          <div class="po-doc-num-row">
            <div class="po-doc-num-label">เลขที่</div>
            <div class="po-doc-num-val">${escapeHtml(poData.po_number || '')}</div>
          </div>
          <div class="po-doc-num-row">
            <div class="po-doc-num-label">วันที่</div>
            <div class="po-doc-num-val">${escapeHtml(formatPoDocDate(poData.po_date))}</div>
          </div>
          <div class="po-doc-num-row">
            <div class="po-doc-num-label">เลขที่ Quotation</div>
            <div class="po-doc-num-val">${escapeHtml(poData.quotation_ref || '-')}</div>
          </div>
          <div class="po-doc-num-row">
            <div class="po-doc-num-label">เลขที่ PR</div>
            <div class="po-doc-num-val">${escapeHtml(poData.pr_number || '-')}</div>
          </div>
        </div>
      </div>

      <div class="po-doc-delivery-box">
        <div class="po-doc-deliv-col1">
          <div class="po-doc-deliv-line">
            <span class="po-doc-deliv-label">สถานที่ส่งของ</span>
            <span class="po-doc-deliv-val-dashed">${escapeHtml(poData.delivery_location || '')}</span>
          </div>
          <div class="po-doc-deliv-line">
            <span class="po-doc-deliv-label">ติดต่อ :</span>
            <span style="flex:1; text-align:center;">${escapeHtml(poData.delivery_contact || '')}</span>
          </div>
        </div>
        <div class="po-doc-deliv-col2">
          <div>กำหนดส่งของ</div>
          <div class="po-doc-deliv-date">${escapeHtml(formatPoDocDate(poData.delivery_date))}</div>
        </div>
        <div class="po-doc-deliv-col3">
          <div>เงื่อนไขการชำระเงิน</div>
          <div style="font-weight:600;">${escapeHtml(poData.payment_term || '')}</div>
        </div>
      </div>

      <table class="po-doc-table">
        <thead>
          <tr>
            <th style="width:7%;">ลำดับที่</th>
            <th style="width:45%;">รายการ</th>
            <th style="width:13%;">จำนวน</th>
            <th style="width:12%;">ราคา/หน่วย<br/>(บาท)</th>
            <th style="width:9%;">ส่วนลด</th>
            <th style="width:14%; border-right:none;">จำนวนเงิน (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" rowspan="4" class="po-doc-confirm-cell">
              <div class="po-doc-confirm-line1">${escapeHtml(s.confirm_box_line1 || 'กรุณาเซ็นรับ และ SCAN PO กลับทุกครั้งด้วยค่ะ')}</div>
              <div class="po-doc-confirm-line2">${escapeHtml(s.confirm_box_line2 || 'PLEASE CONFIRM BY EMAIL')}</div>
              <div class="po-doc-sign-lines">
                <div class="po-doc-sign-block">${escapeHtml(s.confirm_sign_label || 'SIGN')}</div>
                <div class="po-doc-sign-block">${escapeHtml(s.confirm_date_label || 'DATE')}</div>
              </div>
            </td>
            <td colspan="2" class="po-doc-sum-label po-doc-sum-first">รวม</td>
            <td class="po-doc-sum-val po-doc-sum-first" style="border-right:none;">${formatMoney(poData.sub_total)}</td>
          </tr>
          <tr>
            <td colspan="2" class="po-doc-sum-label">ส่วนลดพิเศษ</td>
            <td class="po-doc-sum-val" style="border-right:none;">${specDiscVal > 0 ? formatMoney(specDiscVal) : '-'}</td>
          </tr>
          <tr>
            <td colspan="2" class="po-doc-sum-label">มูลค่าสินค้า / บริการสุทธิ</td>
            <td class="po-doc-sum-val" style="border-right:none;">${formatMoney(poData.net_total)}</td>
          </tr>
          <tr>
            <td colspan="2" class="po-doc-sum-label">ภาษีมูลค่าเพิ่ม ${vatRate}%</td>
            <td class="po-doc-sum-val" style="border-right:none;">${formatMoney(poData.vat_amount)}</td>
          </tr>
          <tr>
            <td class="po-doc-bahttext-label">รวมเงิน</td>
            <td colspan="2" class="po-doc-bahttext-val">${escapeHtml(amountWords)}</td>
            <td colspan="2" class="po-doc-sum-label po-doc-sum-grand">รวมทั้งสิ้น</td>
            <td class="po-doc-sum-val po-doc-sum-grand" style="border-right:none;">${formatMoney(poData.grand_total)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="po-doc-bottom">
        <div class="po-doc-remarks">
          <div class="po-doc-remarks-title">หมายเหตุ</div>
          ${remarkLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
        </div>

        <div class="po-doc-sign-box">
          <div class="po-doc-sign-company">ในนาม ${escapeHtml(s.company_name || 'บริษัท นวพล เอ็นจิเนียริ่ง แอนด์ ซัพพลาย จำกัด')}</div>
          <div class="po-doc-sign-area">
            <span>ผู้มีอำนาจลงนาม</span>
            ${isApproved && sigImgSrc
              ? `<img src="${sigImgSrc}" class="po-doc-sign-img" alt="Authorized Signature" />`
              : `<span class="no-print" style="margin-left:18px; font-size:11.5px; color:#b45309; background:#fef3c7; padding:2px 8px; border-radius:4px;">(รออนุมัติ - วาดลายเซ็นเมื่อกด Approve)</span>`
            }
          </div>
          <div class="po-doc-sign-date-row">
            <span>วันที่</span>
            <div class="po-doc-sign-date-val">${escapeHtml(signedDateStr)}</div>
          </div>
        </div>
      </div>

      <div class="po-doc-footer-meta">
        <div>${escapeHtml(s.effective_date || 'Effective date : 01/06/2013')}</div>
        <div>${escapeHtml(s.form_code || 'FM-PU-02 / Rev.00')}</div>
      </div>
    </div>
  `;
}

// ==========================================================================
// 4. Official PR Document Renderer (Matches Example PDF FM-PU-01 / Rev.06 100%)
// ==========================================================================

function buildOfficialPrDocumentHtml(prData) {
  const s = STATE.settings || {};
  const items = Array.isArray(prData.items) ? prData.items : [];
  const flags = Array.isArray(prData.purpose_flags) ? prData.purpose_flags : [];
  const minRows = 11;
  const totalRows = Math.max(minRows, items.length);

  let rowsHtml = '';
  let calcSubTotal = 0;
  let hasAnyActualPrice = false;

  for (let i = 0; i < totalRows; i++) {
    const it = items[i];
    if (it) {
      const hasPrice = it.actual_unit_price !== null && it.actual_unit_price !== undefined && it.actual_unit_price !== '';
      const uPrice = hasPrice ? Number(it.actual_unit_price) : null;
      const lTotal = it.actual_line_total !== null && it.actual_line_total !== undefined && it.actual_line_total !== ''
        ? Number(it.actual_line_total)
        : (uPrice !== null ? uPrice * Number(it.quantity || 0) : null);

      if (lTotal !== null) {
        calcSubTotal += lTotal;
        hasAnyActualPrice = true;
      }

      rowsHtml += `
        <tr>
          <td style="text-align:center; height:23px;">${i + 1}</td>
          <td>${escapeHtml(it.item_name_snapshot || '')}</td>
          <td>${escapeHtml(it.purpose || '')}</td>
          <td style="text-align:center;">${escapeHtml(formatPoDocDate(it.required_date))}</td>
          <td style="text-align:center;">${Number(it.quantity || 0).toLocaleString('en-US')} ${escapeHtml(it.unit || 'PCS')}</td>
          <td class="pr-doc-purchasing-col" style="text-align:right; color:#1d4ed8; font-weight:600;">
            ${uPrice !== null ? formatMoney(uPrice) : ''}
          </td>
          <td style="text-align:right; color:#1d4ed8; font-weight:600;">
            ${lTotal !== null ? formatMoney(lTotal) : ''}
          </td>
        </tr>
      `;
    } else {
      rowsHtml += `
        <tr>
          <td style="height:23px;">&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td class="pr-doc-purchasing-col">&nbsp;</td>
          <td>&nbsp;</td>
        </tr>
      `;
    }
  }

  const subTotalVal = Number(prData.po_sub_total || calcSubTotal || 0);
  const vatVal = Number(prData.po_vat_amount || (hasAnyActualPrice ? subTotalVal * 0.07 : 0));
  const grandVal = Number(prData.po_grand_total || (hasAnyActualPrice ? subTotalVal + vatVal : 0));
  const showPoTotals = Boolean(prData.linked_po_number || hasAnyActualPrice);

  const chkBox = (id, label) => {
    const checked = flags.includes(id);
    return `
      <div class="pr-doc-chk-item">
        <span class="pr-doc-chk-box">${checked ? '✓' : ''}</span>
        <span>${escapeHtml(label)}</span>
      </div>
    `;
  };

  return `
    <div class="pr-paper">
      <div class="pr-doc-top-right">
        เลขที่ใบขอซื้อ (PR No.) <span style="display:inline-block; min-width:140px; border-bottom:1px dotted #000; text-align:center; font-weight:700;">${escapeHtml(prData.pr_number || '')}</span>
      </div>

      <div class="pr-doc-header">
        <div class="pr-doc-logo">
          ${s.company_logo ? `<img src="${s.company_logo}" alt="N.E.S Logo" />` : '<div style="font-weight:bold;color:#1d4ed8;">N.E.S</div>'}
        </div>
        <div class="pr-doc-title-center">
          <div class="pr-doc-company-en">NAWAPHOL ENGINEERING &amp; SUPPLY CO.,LTD.</div>
          <div class="pr-doc-subtitle-en">PURCHASING REQUESTION</div>
        </div>
        <div style="width:115px;"></div>
      </div>

      <div class="pr-doc-meta">
        <div class="pr-doc-meta-left">
          <div class="pr-doc-meta-row">
            <div class="pr-doc-meta-label">ผู้ขาย:</div>
            <div class="pr-doc-meta-val">${escapeHtml(prData.vendor_name_snapshot || '')}</div>
          </div>
          <div class="pr-doc-meta-row">
            <div class="pr-doc-meta-label">ที่อยู่:</div>
            <div class="pr-doc-meta-val">${escapeHtml(prData.vendor_address_snapshot || '')}</div>
          </div>
          <div class="pr-doc-meta-row">
            <div class="pr-doc-meta-label">TEL. &amp; FAX.</div>
            <div class="pr-doc-meta-val">${escapeHtml(prData.vendor_tel_fax_snapshot || '')}</div>
          </div>
        </div>

        <div class="pr-doc-meta-right">
          <div class="pr-doc-meta-row">
            <div class="pr-doc-meta-label">PO No.:</div>
            <div class="pr-doc-meta-val" style="color:#1d4ed8; font-weight:700;">
              ${escapeHtml(prData.linked_po_number || '')}
            </div>
          </div>
          <div class="pr-doc-meta-row">
            <div class="pr-doc-meta-label">วันที่:</div>
            <div class="pr-doc-meta-val">${escapeHtml(formatPoDocDate(prData.pr_date))}</div>
          </div>
          <div class="pr-doc-meta-row">
            <div class="pr-doc-meta-label">หน่วยงานที่สั่งซื้อ:</div>
            <div class="pr-doc-meta-val">${escapeHtml(prData.department || '')}</div>
          </div>
        </div>
      </div>

      <table class="pr-doc-table">
        <thead>
          <tr>
            <th colspan="5" style="border:none; background:transparent;"></th>
            <th colspan="2" class="pr-doc-purchasing-only-header">สำหรับแผนกจัดซื้อเท่านั้น</th>
          </tr>
          <tr>
            <th style="width:6%;">ลำดับที่</th>
            <th style="width:30%;">รายการ</th>
            <th style="width:22%;">วัตถุประสงค์</th>
            <th style="width:12%;">วันที่ต้องการ<br/>ใช้งาน</th>
            <th style="width:10%;">ปริมาณ</th>
            <th style="width:10%;" class="pr-doc-purchasing-col">ราคาต่อหน่วย<br/>ที่สั่งซื้อจริง</th>
            <th style="width:10%;">จำนวนเงิน<br/>รวมทั้งสิ้น</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <!-- Footer Rows inside PR Table (8 Purpose Checkboxes + Purchasing Totals) -->
          <tr>
            <td colspan="5" style="padding:2px 4px;">
              <div class="pr-doc-checkbox-grid">
                <div>${chkBox('cutting_tools', 'Cutting Tools. (Mass, Make to order)')}</div>
                <div>${chkBox('consumable', 'วัสดุสิ้นเปลือง')}</div>
              </div>
            </td>
            <td rowspan="3" class="pr-doc-purchasing-col" style="text-align:right; font-weight:700; vertical-align:middle;">รวม</td>
            <td rowspan="3" style="text-align:right; font-weight:700; color:#1d4ed8; vertical-align:middle;">
              ${showPoTotals ? formatMoney(subTotalVal) : ''}
            </td>
          </tr>
          <tr>
            <td colspan="5" style="padding:2px 4px;">
              <div class="pr-doc-checkbox-grid">
                <div>${chkBox('replacement', 'ทดแทน (เสื่อมสภาพ, หมด Tool life)')}</div>
                <div>${chkBox('machine_oil', 'น้ำมันเครื่องจักร')}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td colspan="5" style="padding:2px 4px;">
              <div class="pr-doc-checkbox-grid">
                <div>${chkBox('new_investment', 'ลงทุนใหม่ (งานใหม่, Improvement)')}</div>
                <div>${chkBox('material', "Mat'l")}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td colspan="5" style="padding:2px 4px;">
              <div class="pr-doc-checkbox-grid">
                <div>${chkBox('make_to_order', 'งานจ้างทำ (Make to order)')}</div>
                <div></div>
              </div>
            </td>
            <td class="pr-doc-purchasing-col" style="text-align:right; font-weight:600;">ภาษีมูลค่าเพิ่ม 7%</td>
            <td style="text-align:right; font-weight:600; color:#1d4ed8;">
              ${showPoTotals ? formatMoney(vatVal) : ''}
            </td>
          </tr>
          <tr>
            <td colspan="5" style="padding:2px 4px;">
              <div class="pr-doc-checkbox-grid">
                <div>${chkBox('ng', 'NG')}</div>
                <div></div>
              </div>
            </td>
            <td class="pr-doc-purchasing-col" style="text-align:right; font-weight:700;">รวมทั้งสิ้น</td>
            <td style="text-align:right; font-weight:700; color:#1d4ed8;">
              ${showPoTotals ? formatMoney(grandVal) : ''}
            </td>
          </tr>
        </tbody>
      </table>

      <div class="pr-doc-sign-grid">
        <div class="pr-doc-sign-col">
          <div class="pr-doc-sign-line">
            <span class="pr-doc-sign-line-label">ผู้ขอซื้อ:</span>
            <span class="pr-doc-sign-line-val">${escapeHtml(prData.requester_name || '')}</span>
          </div>
          <div class="pr-doc-sign-line">
            <span class="pr-doc-sign-line-label">ผู้ตรวจสอบ:</span>
            <span class="pr-doc-sign-line-val">${escapeHtml(prData.reviewer_name || '')}</span>
          </div>
          <div class="pr-doc-sign-line" style="margin-bottom:0;">
            <span class="pr-doc-sign-line-label">อนุมัติโดย:</span>
            <span class="pr-doc-sign-line-val">${escapeHtml(prData.approver_name || '')}</span>
          </div>
        </div>

        <div class="pr-doc-sign-col">
          <div class="pr-doc-sign-line">
            <span class="pr-doc-sign-line-label" style="width:82px;">แผนกจัดซื้อ:</span>
            <span class="pr-doc-sign-line-val">${escapeHtml(prData.purchasing_officer_name || '')}</span>
          </div>
          <div class="pr-doc-sign-line" style="margin-bottom:0;">
            <span class="pr-doc-sign-line-label" style="width:45px; text-align:left;">วันที่:</span>
            <span class="pr-doc-sign-line-val">${escapeHtml(formatPoDocDate(prData.purchasing_date))}</span>
          </div>
        </div>

        <div class="pr-doc-sign-col">
          <div class="pr-doc-sign-line">
            <span class="pr-doc-sign-line-label" style="width:75px;">แผนกบัญชี:</span>
            <span class="pr-doc-sign-line-val">${escapeHtml(prData.accounting_officer_name || '')}</span>
          </div>
          <div class="pr-doc-sign-line" style="margin-bottom:0;">
            <span class="pr-doc-sign-line-label" style="width:45px; text-align:left;">วันที่:</span>
            <span class="pr-doc-sign-line-val">${escapeHtml(formatPoDocDate(prData.accounting_date))}</span>
          </div>
        </div>
      </div>

      <div class="po-doc-footer-meta" style="margin-top:6px;">
        <div>${escapeHtml(prData.effective_date || 'Effective date : 11/11/2026')}</div>
        <div>${escapeHtml(prData.form_code || 'FM-PU-01 / Rev.06')}</div>
      </div>
    </div>
  `;
}

// ==========================================================================
// 5. Dashboard & PO / PR Overview Page
// ==========================================================================

function renderDashboard(container) {
  const s = STATE.stats || {};
  const filteredPos = STATE.pos.filter(po => {
    if (STATE.poListStatusFilter !== 'ALL' && po.approval_status !== STATE.poListStatusFilter) return false;
    if (STATE.poListSearch) {
      const q = STATE.poListSearch.toLowerCase();
      const matchPo = (po.po_number || '').toLowerCase().includes(q);
      const matchVendor = (po.vendor_name_snapshot || '').toLowerCase().includes(q);
      const matchPr = (po.pr_number || '').toLowerCase().includes(q);
      const matchItem = (po.items || []).some(i =>
        (i.item_name_snapshot || '').toLowerCase().includes(q) ||
        (i.item_code_snapshot || '').toLowerCase().includes(q)
      );
      if (!matchPo && !matchVendor && !matchPr && !matchItem) return false;
    }
    return true;
  });

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card" style="border-left: 4px solid var(--primary);">
        <div class="stat-label">ใบสั่งซื้อทั้งหมด (Total POs)</div>
        <div class="stat-value">${STATE.pos.length} ใบ</div>
        <div class="stat-sub">อนุมัติแล้ว ${STATE.pos.filter(p => p.approval_status === 'APPROVED').length} ใบ</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #2563eb; cursor:pointer;" onclick="switchTab('prs')">
        <div class="stat-label">ใบขอซื้อรอเปิด PO (Open PRs)</div>
        <div class="stat-value" style="color:#2563eb;">${STATE.prs.filter(p => p.status === 'OPEN').length} ใบ</div>
        <div class="stat-sub">จาก PR ทั้งหมด ${STATE.prs.length} ใบ (คลิกดูใบขอซื้อ)</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #f59e0b; cursor:pointer;" onclick="switchTab('approvals')">
        <div class="stat-label">PO รออนุมัติ (Pending Approval)</div>
        <div class="stat-value" style="color:#d97706;">${STATE.pos.filter(p => p.approval_status === 'PENDING').length} ใบ</div>
        <div class="stat-sub">คลิกเพื่อวาดลายเซ็นอนุมัติ PO</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid var(--success); cursor:pointer;" onclick="switchTab('wms')">
        <div class="stat-label">คลังสินค้า WMS (Active Lots)</div>
        <div class="stat-value" style="color:var(--success);">${STATE.wmsLots.filter(l => l.remaining_qty > 0).length} Lots</div>
        <div class="stat-sub">ยอดสั่งซื้ออนุมัติสะสม ${formatMoney(s.approved_spend || 0)} ฿</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📋 รายการใบสั่งซื้อ (Purchase Orders) & การสืบย้อนกลับใบขอซื้อ (PR Traceability)</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <input type="text" class="form-control" style="width:260px;" placeholder="🔍 ค้นหาเลขที่ PO, PR, ผู้ขาย, สินค้า..."
            value="${escapeHtml(STATE.poListSearch)}" oninput="STATE.poListSearch=this.value; renderDashboard(document.getElementById('app-view'))" />
          <select class="form-control" style="width:180px;" onchange="STATE.poListStatusFilter=this.value; renderDashboard(document.getElementById('app-view'))">
            <option value="ALL" ${STATE.poListStatusFilter === 'ALL' ? 'selected' : ''}>ทุกสถานะ (All Status)</option>
            <option value="PENDING" ${STATE.poListStatusFilter === 'PENDING' ? 'selected' : ''}>⏳ รออนุมัติ (Pending)</option>
            <option value="APPROVED" ${STATE.poListStatusFilter === 'APPROVED' ? 'selected' : ''}>✅ อนุมัติแล้ว (Approved)</option>
            <option value="REJECTED" ${STATE.poListStatusFilter === 'REJECTED' ? 'selected' : ''}>❌ ตีกลับ (Rejected)</option>
            <option value="DRAFT" ${STATE.poListStatusFilter === 'DRAFT' ? 'selected' : ''}>📝 ฉบับร่าง (Draft)</option>
          </select>
          ${canIssuePoOrPr() ? `<button class="btn btn-primary" onclick="startNewPo()">+ เปิดใบสั่งซื้อใหม่ (PO)</button>` : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>เลขที่ PO</th>
              <th>วันที่เปิด PO</th>
              <th>ผู้ขาย (Supplier)</th>
              <th>รายการสินค้า</th>
              <th>อ้างอิง PR / ผู้เปิด PR</th>
              <th style="text-align:right;">ยอดรวมสุทธิ (บาท)</th>
              <th>สถานะอนุมัติ</th>
              <th style="text-align:right;">จัดการ / ดู PDF</th>
            </tr>
          </thead>
          <tbody>
            ${filteredPos.length === 0 ? `
              <tr><td colspan="8" style="text-align:center; padding:28px; color:var(--text-muted);">ไม่พบรายการใบสั่งซื้อที่ค้นหา</td></tr>
            ` : filteredPos.map(po => {
              const linkedPr = STATE.prs.find(pr => (po.pr_id && pr.pr_id === po.pr_id) || (po.pr_number && pr.pr_number === po.pr_number));
              return `
                <tr>
                  <td>
                    <strong style="color:var(--primary); cursor:pointer;" onclick="openPoPdfModal(${po.po_id})">${escapeHtml(po.po_number)}</strong>
                  </td>
                  <td>${escapeHtml(formatPoDocDate(po.po_date))}</td>
                  <td>
                    <div style="font-weight:600;">${escapeHtml(po.vendor_name_snapshot)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">ติดต่อ: ${escapeHtml(po.vendor_contact_name || '-')} | ${escapeHtml(po.payment_term || '')}</div>
                  </td>
                  <td>
                    <div style="font-weight:500;">${(po.items || []).length} รายการ</div>
                    <div style="font-size:12px; color:var(--text-muted); max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ${escapeHtml((po.items || []).map(i => i.item_name_snapshot).join(', '))}
                    </div>
                  </td>
                  <td>
                    ${linkedPr ? `
                      <div>
                        <span class="badge-tag" style="cursor:pointer; font-weight:700;" onclick="openPrPdfModal(${linkedPr.pr_id})" title="คลิกเพื่อดูใบขอซื้อ PR ใบนี้">
                          🔗 PR: ${escapeHtml(linkedPr.pr_number)}
                        </span>
                      </div>
                      <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
                        ผู้ขอซื้อ: <strong>${escapeHtml(linkedPr.requester_name)}</strong>
                      </div>
                    ` : (po.pr_number ? `<div>PR: <strong>${escapeHtml(po.pr_number)}</strong></div>` : `<span style="color:var(--text-muted); font-size:12px;">เปิด PO อิสระ</span>`)}
                  </td>
                  <td style="text-align:right; font-weight:700;">${formatMoney(po.grand_total)}</td>
                  <td>${statusBadgeHtml(po.approval_status)}</td>
                  <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                      <button class="btn btn-sm btn-primary" onclick="openPoPdfModal(${po.po_id})">📄 ดู PO</button>
                      ${linkedPr ? `<button class="btn btn-sm btn-outline" onclick="openPrPdfModal(${linkedPr.pr_id})">📋 ดู PR</button>` : ''}
                      ${po.approval_status === 'PENDING' && canApprovePo() ? `
                        <button class="btn btn-sm btn-success" onclick="openApproveSignatureModal(${po.po_id})">✍️ เซ็นอนุมัติ</button>
                      ` : ''}
                      ${canIssuePoOrPr() ? `
                        <button class="btn btn-sm btn-outline" onclick="editExistingPo(${po.po_id})">✏️</button>
                        <button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="deletePoById(${po.po_id})">🗑️</button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==========================================================================
// 6. Purchase Requisitions Page (Issue PR - FM-PU-01 / Rev.06 & Link to PO)
// ==========================================================================

function startNewPrForm(preselectItemId = null) {
  const today = new Date().toISOString().slice(0, 10);
  const reqDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const preItem = preselectItemId ? STATE.items.find(x => Number(x.item_id) === Number(preselectItemId)) : null;

  STATE.prForm = {
    pr_id: null,
    pr_number: STATE.nextPrNumber || '2/11/029',
    pr_date: today,
    department: STATE.currentUser?.department || 'แผนกผลิต (Production)',
    vendor_id: null,
    vendor_name_snapshot: '',
    vendor_address_snapshot: '',
    vendor_tel_fax_snapshot: '',
    purpose_flags: ['cutting_tools', 'replacement'],
    requester_name: STATE.currentUser?.full_name || 'ผู้ขอซื้อ',
    requester_user_id: STATE.currentUser?.user_id || null,
    reviewer_name: 'หน.แผนกผลิต',
    approver_name: 'ผจก.โรงงาน',
    purchasing_officer_name: '',
    purchasing_date: '',
    accounting_officer_name: '',
    accounting_date: '',
    linked_po_number: '',
    effective_date: 'Effective date : 11/11/2026',
    form_code: 'FM-PU-01 / Rev.06',
    items: [
      {
        item_id: preItem ? preItem.item_id : null,
        item_code_snapshot: preItem ? preItem.item_code : '',
        item_name_snapshot: preItem ? preItem.item_name : '',
        purpose: '',
        required_date: reqDate,
        quantity: 10,
        unit: preItem ? (preItem.default_unit || 'PCS') : 'PCS',
        actual_unit_price: null,
        actual_line_total: null
      }
    ]
  };
  STATE.prSubMode = 'create';
  switchTab('prs');
}

function renderPrPage(container) {
  if (STATE.prSubMode === 'create') {
    renderCreatePrForm(container);
    return;
  }

  const normal = isNormalUser();
  const q = STATE.prListSearch.trim().toLowerCase();
  const filteredPrs = STATE.prs.filter(pr => {
    if (!q) return true;
    return (
      (pr.pr_number || '').toLowerCase().includes(q) ||
      (pr.department || '').toLowerCase().includes(q) ||
      (pr.requester_name || '').toLowerCase().includes(q) ||
      (pr.linked_po_number || '').toLowerCase().includes(q) ||
      (pr.items || []).some(i => (i.item_name_snapshot || '').toLowerCase().includes(q))
    );
  });

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">📋 ${normal ? 'ประวัติใบขอซื้อ (PR History) & เปิดใบขอซื้อใหม่ (FM-PU-01 / Rev.06)' : 'รายการใบขอซื้อ (Purchasing Requisition — FM-PU-01 / Rev.06)'}</div>
          <div style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">
            ${normal
              ? 'ตรวจสอบสถานะใบขอซื้อ (PR) ที่ยื่นเข้าระบบ และกดปุ่ม "+ เปิดใบขอซื้อใหม่" เพื่อขอซื้อสินค้า'
              : 'เมื่อนำ PR ไปเปิด PO แล้ว เลขที่ PO และราคาซื้อจริงจากแผนกจัดซื้อจะซิงค์กลับมาแสดงในใบ PR อัตโนมัติ'}
          </div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input type="text" class="form-control" style="width:260px;" placeholder="🔍 ค้นหาเลขที่ PR, ผู้ขอซื้อ, แผนก, สินค้า..."
            value="${escapeHtml(STATE.prListSearch)}" oninput="STATE.prListSearch=this.value; renderPrPage(document.getElementById('app-view'))" />
          ${normal ? `
            <button class="btn btn-outline" onclick="switchTab('wms')">📦 ดูจำนวน Stock ใน Store</button>
          ` : ''}
          ${canIssuePr() ? `
            <button class="btn btn-primary" onclick="startNewPrForm()">+ เปิดใบขอซื้อใหม่ (Issue PR)</button>
          ` : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>เลขที่ใบขอซื้อ (PR No.)</th>
              <th>วันที่ขอซื้อ</th>
              <th>หน่วยงานที่สั่งซื้อ</th>
              <th>ผู้ขอซื้อ (Issuer)</th>
              <th>รายการที่ขอซื้อ</th>
              <th>สถานะ / เลขที่ PO ที่เชื่อมโยง</th>
              ${!normal ? `<th style="text-align:right;">ยอดเงินใน PO จริง</th>` : ''}
              <th style="text-align:right;">จัดการ / ดูเอกสาร PR</th>
            </tr>
          </thead>
          <tbody>
            ${filteredPrs.length === 0 ? `
              <tr><td colspan="${normal ? 7 : 8}" style="text-align:center; padding:24px; color:var(--text-muted);">ไม่พบรายการใบขอซื้อ (PR)</td></tr>
            ` : filteredPrs.map(pr => `
              <tr>
                <td>
                  <strong style="color:var(--primary); cursor:pointer;" onclick="openPrPdfModal(${pr.pr_id})">${escapeHtml(pr.pr_number)}</strong>
                </td>
                <td>${escapeHtml(formatPoDocDate(pr.pr_date))}</td>
                <td>${escapeHtml(pr.department)}</td>
                <td><strong>${escapeHtml(pr.requester_name)}</strong></td>
                <td>
                  <div style="font-weight:600;">${(pr.items || []).length} รายการ</div>
                  <div style="font-size:12px; color:var(--text-muted); max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${escapeHtml((pr.items || []).map(i => `${i.item_name_snapshot} (${i.quantity} ${i.unit})`).join(', '))}
                  </div>
                </td>
                <td>
                  ${pr.linked_po_number ? `
                    <div>
                      ${normal ? `
                        <span class="badge badge-APPROVED">🔗 เปิด PO แล้ว (${escapeHtml(pr.linked_po_number)})</span>
                      ` : `
                        <span class="badge badge-APPROVED" style="cursor:pointer;" onclick="openPoPdfModal(${pr.linked_po_id})">
                          🔗 PO: ${escapeHtml(pr.linked_po_number)}
                        </span>
                      `}
                    </div>
                  ` : statusBadgeHtml('OPEN')}
                </td>
                ${!normal ? `
                  <td style="text-align:right; font-weight:700; color:${pr.po_grand_total > 0 ? 'var(--primary)' : 'var(--text-muted)'};">
                    ${pr.po_grand_total > 0 ? formatMoney(pr.po_grand_total) + ' ฿' : '-'}
                  </td>
                ` : ''}
                <td style="text-align:right;">
                  <div style="display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                    <button class="btn btn-sm btn-primary" onclick="openPrPdfModal(${pr.pr_id})">📄 ดูใบ PR (FM-PU-01)</button>
                    ${canIssuePo() && !pr.linked_po_id ? `
                      <button class="btn btn-sm btn-success" onclick="createPoFromPr(${pr.pr_id})">🔗 นำไปเปิด PO</button>
                    ` : ''}
                    ${canIssuePo() ? `
                      <button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="deletePrById(${pr.pr_id})">🗑️</button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderCreatePrForm(container) {
  if (!STATE.prForm) startNewPrForm();
  const f = STATE.prForm;
  const normal = isNormalUser();

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <button class="btn btn-sm btn-outline" onclick="STATE.prSubMode='list'; renderPrPage(document.getElementById('app-view'))">← กลับหน้ารายการ PR</button>
        <span class="badge badge-tag" style="font-size:13px;">เปิดใบขอซื้อใหม่ (Issue Purchasing Requisition — FM-PU-01 / Rev.06)</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-outline" onclick="previewPrDraftModal()">🖨️ ดูตัวอย่างเต็มจอ / พิมพ์</button>
        <button class="btn btn-primary" onclick="submitPrForm()">🚀 บันทึกยื่นใบขอซื้อ (Submit PR)</button>
      </div>
    </div>

    <div class="po-create-split">
      <!-- Left: PR Form Entry -->
      <div>
        <div class="card" style="margin-bottom:16px;">
          <div class="card-header">
            <div class="card-title">📋 1. ข้อมูลหัวเอกสารใบขอซื้อ (PR Header — FM-PU-01)</div>
          </div>
          <div class="form-grid">
            <div class="form-group col-4">
              <label class="form-label">เลขที่ใบขอซื้อ (PR No.) *</label>
              <input type="text" class="form-control" style="font-weight:700; color:var(--primary);"
                value="${escapeHtml(f.pr_number)}" oninput="onPrFieldInput('pr_number', this.value)" />
            </div>
            <div class="form-group col-4">
              <label class="form-label">วันที่ขอซื้อ *</label>
              <input type="date" class="form-control" value="${escapeHtml(f.pr_date)}" onchange="onPrFieldInput('pr_date', this.value)" />
            </div>
            <div class="form-group col-4">
              <label class="form-label">หน่วยงานที่สั่งซื้อ *</label>
              <input type="text" class="form-control" value="${escapeHtml(f.department)}" oninput="onPrFieldInput('department', this.value)" />
            </div>

            ${!normal ? `
              <div class="form-group col-12">
                <label class="form-label">ผู้ขายที่แนะนำ (ถ้าทราบ — หรือเว้นว่างให้ฝ่ายจัดซื้อเลือกตอนเปิด PO ได้)</label>
                <select class="form-control" onchange="onPrVendorSelect(this.value)">
                  <option value="">-- ไม่ระบุ / ให้ฝ่ายจัดซื้อเลือกผู้ขายตอนเปิด PO --</option>
                  ${STATE.vendors.slice(0, 150).map(v => `
                    <option value="${v.vendor_id}" ${Number(f.vendor_id) === Number(v.vendor_id) ? 'selected' : ''}>
                      [${escapeHtml(v.vendor_code)}] ${escapeHtml(v.vendor_name)}
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group col-6">
                <label class="form-label">ชื่อผู้ขาย (แสดงบนใบ PR)</label>
                <input type="text" class="form-control" id="pr-vendor-name" value="${escapeHtml(f.vendor_name_snapshot)}" oninput="onPrFieldInput('vendor_name_snapshot', this.value)" />
              </div>
              <div class="form-group col-6">
                <label class="form-label">TEL. & FAX.</label>
                <input type="text" class="form-control" id="pr-vendor-telfax" value="${escapeHtml(f.vendor_tel_fax_snapshot)}" oninput="onPrFieldInput('vendor_tel_fax_snapshot', this.value)" />
              </div>
              <div class="form-group col-12">
                <label class="form-label">ที่อยู่ผู้ขาย</label>
                <input type="text" class="form-control" id="pr-vendor-addr" value="${escapeHtml(f.vendor_address_snapshot)}" oninput="onPrFieldInput('vendor_address_snapshot', this.value)" />
              </div>
            ` : `
              <div class="col-12" style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px 12px; font-size:12.5px; color:#1e40af;">
                ℹ️ <strong>หมายเหตุสำหรับผู้ขอซื้อ (Normal User):</strong> ข้อมูลผู้ขาย (Vendor) และราคาสั่งซื้อจริง แผนกจัดซื้อจะเป็นผู้ระบุและเชื่อมโยงกลับมาที่ใบ PR อัตโนมัติเมื่อเปิดใบสั่งซื้อ (PO)
              </div>
            `}

            <div class="form-group col-4">
              <label class="form-label">ผู้ขอซื้อ (Requester) *</label>
              <input type="text" class="form-control" value="${escapeHtml(f.requester_name)}" oninput="onPrFieldInput('requester_name', this.value)" />
            </div>
            <div class="form-group col-4">
              <label class="form-label">ผู้ตรวจสอบ (Reviewer)</label>
              <input type="text" class="form-control" value="${escapeHtml(f.reviewer_name)}" oninput="onPrFieldInput('reviewer_name', this.value)" />
            </div>
            <div class="form-group col-4">
              <label class="form-label">อนุมัติโดย (Approver)</label>
              <input type="text" class="form-control" value="${escapeHtml(f.approver_name)}" oninput="onPrFieldInput('approver_name', this.value)" />
            </div>

            <div class="form-group col-12">
              <label class="form-label">ประเภทการขอซื้อ (ติ๊กเลือกตามแบบฟอร์ม FM-PU-01)</label>
              <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; padding:10px; background:var(--surface-alt); border:1px solid var(--border); border-radius:8px;">
                ${PR_PURPOSE_OPTIONS.map(opt => `
                  <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px;">
                    <input type="checkbox" ${f.purpose_flags.includes(opt.id) ? 'checked' : ''}
                      onchange="togglePrPurposeFlag('${opt.id}', this.checked)" />
                    <span>${escapeHtml(opt.label)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🔩 2. รายการสินค้าที่ขอซื้อ (PR Items)</div>
            <button class="btn btn-sm btn-primary" onclick="addPrItemRow()">+ เพิ่มรายการขอซื้อ</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:45px;">ลำดับ</th>
                  <th>เลือกสินค้าจากระบบ / ชื่อรายการ</th>
                  <th style="width:170px;">วัตถุประสงค์การใช้งาน</th>
                  <th style="width:130px;">วันที่ต้องการใช้</th>
                  <th style="width:85px;">ปริมาณ</th>
                  <th style="width:75px;">หน่วย</th>
                  <th style="width:45px;">ลบ</th>
                </tr>
              </thead>
              <tbody>
                ${f.items.map((row, idx) => `
                  <tr>
                    <td style="text-align:center; font-weight:700;">${idx + 1}</td>
                    <td>
                      <select class="form-control" style="margin-bottom:4px; font-size:12.5px;" onchange="onPrItemSelect(${idx}, this.value)">
                        <option value="">-- เลือกจากฐานข้อมูลสินค้า (หรือพิมพ์ด้านล่าง) --</option>
                        ${STATE.items.slice(0, 250).map(it => `
                          <option value="${it.item_id}" ${Number(row.item_id) === Number(it.item_id) ? 'selected' : ''}>
                            [${escapeHtml(it.item_code)}] ${escapeHtml(it.item_name)} (สต็อก: ${it.current_stock} ${escapeHtml(it.default_unit)})
                          </option>
                        `).join('')}
                      </select>
                      <input type="text" class="form-control" placeholder="ระบุชื่อรายการที่ขอซื้อ..."
                        value="${escapeHtml(row.item_name_snapshot)}"
                        oninput="onPrItemFieldInput(${idx}, 'item_name_snapshot', this.value)" />
                    </td>
                    <td>
                      <input type="text" class="form-control" placeholder="เช่น ใช้กลึงงาน CNC"
                        value="${escapeHtml(row.purpose)}"
                        oninput="onPrItemFieldInput(${idx}, 'purpose', this.value)" />
                    </td>
                    <td>
                      <input type="date" class="form-control" value="${escapeHtml(row.required_date)}"
                        onchange="onPrItemFieldInput(${idx}, 'required_date', this.value)" />
                    </td>
                    <td>
                      <input type="number" step="any" min="1" class="form-control" style="text-align:right; font-weight:700;"
                        value="${row.quantity}" oninput="onPrItemFieldInput(${idx}, 'quantity', this.value)" />
                    </td>
                    <td>
                      <input type="text" class="form-control" list="unit-datalist" style="text-align:center;"
                        value="${escapeHtml(row.unit)}" oninput="onPrItemFieldInput(${idx}, 'unit', this.value)" />
                    </td>
                    <td style="text-align:center;">
                      <button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="removePrItemRow(${idx})">✕</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:center;">
            <button class="btn btn-sm btn-outline" onclick="addPrItemRow()">+ เพิ่มแถวรายการ</button>
            <button class="btn btn-primary" onclick="submitPrForm()">💾 บันทึกยื่นใบขอซื้อ (Issue PR)</button>
          </div>
        </div>
      </div>

      <!-- Right: Sticky Live Preview of FM-PU-01 / Rev.06 -->
      <aside class="po-live-preview-pane">
        <div class="po-live-preview-header">
          <div>
            <div style="font-weight:700; font-size:14.5px;">👁️ ตัวอย่างใบขอซื้อจริง (FM-PU-01 / Rev.06)</div>
            <div style="font-size:11.5px; color:#94a3b8;">ช่อง "สำหรับแผนกจัดซื้อเท่านั้น" จะซิงค์ราคาอัตโนมัติเมื่อเปิด PO</div>
          </div>
          <button class="btn btn-sm btn-outline" style="background:#334155;color:#fff;border-color:#475569;" onclick="previewPrDraftModal()">🖨️ ขยายเต็มจอ</button>
        </div>
        <div class="po-live-preview-viewport" id="create-pr-live-preview-viewport">
          <div id="create-pr-live-preview-scaler"></div>
        </div>
      </aside>
    </div>
  `;

  refreshCreatePrLivePreview();
}

function onPrFieldInput(field, val) {
  if (!STATE.prForm) return;
  STATE.prForm[field] = val;
  refreshCreatePrLivePreview();
}

function onPrVendorSelect(vendorId) {
  if (!STATE.prForm) return;
  const v = STATE.vendors.find(x => Number(x.vendor_id) === Number(vendorId));
  if (v) {
    STATE.prForm.vendor_id = v.vendor_id;
    STATE.prForm.vendor_name_snapshot = v.vendor_name || '';
    STATE.prForm.vendor_address_snapshot = v.address || '';
    STATE.prForm.vendor_tel_fax_snapshot = [v.tel ? `Tel: ${v.tel}` : '', v.fax ? `Fax: ${v.fax}` : ''].filter(Boolean).join(' ');
  } else {
    STATE.prForm.vendor_id = null;
  }
  document.getElementById('pr-vendor-name').value = STATE.prForm.vendor_name_snapshot;
  document.getElementById('pr-vendor-addr').value = STATE.prForm.vendor_address_snapshot;
  document.getElementById('pr-vendor-telfax').value = STATE.prForm.vendor_tel_fax_snapshot;
  refreshCreatePrLivePreview();
}

function togglePrPurposeFlag(flagId, checked) {
  if (!STATE.prForm) return;
  const set = new Set(STATE.prForm.purpose_flags || []);
  if (checked) set.add(flagId);
  else set.delete(flagId);
  STATE.prForm.purpose_flags = Array.from(set);
  refreshCreatePrLivePreview();
}

function onPrItemSelect(rowIdx, itemId) {
  if (!STATE.prForm || !STATE.prForm.items[rowIdx]) return;
  const it = STATE.items.find(x => Number(x.item_id) === Number(itemId));
  if (!it) return;
  const row = STATE.prForm.items[rowIdx];
  row.item_id = it.item_id;
  row.item_code_snapshot = it.item_code;
  row.item_name_snapshot = it.item_name;
  row.unit = it.default_unit || 'PCS';
  renderCreatePrForm(document.getElementById('app-view'));
}

function onPrItemFieldInput(rowIdx, field, val) {
  if (!STATE.prForm || !STATE.prForm.items[rowIdx]) return;
  if (field === 'quantity') {
    STATE.prForm.items[rowIdx].quantity = Number(val || 0);
  } else {
    STATE.prForm.items[rowIdx][field] = val;
  }
  refreshCreatePrLivePreview();
}

function addPrItemRow() {
  if (!STATE.prForm) return;
  const reqDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  STATE.prForm.items.push({
    item_id: null,
    item_code_snapshot: '',
    item_name_snapshot: '',
    purpose: '',
    required_date: reqDate,
    quantity: 10,
    unit: 'PCS',
    actual_unit_price: null,
    actual_line_total: null
  });
  renderCreatePrForm(document.getElementById('app-view'));
}

function removePrItemRow(idx) {
  if (!STATE.prForm || STATE.prForm.items.length <= 1) return;
  STATE.prForm.items.splice(idx, 1);
  renderCreatePrForm(document.getElementById('app-view'));
}

function refreshCreatePrLivePreview() {
  const viewport = document.getElementById('create-pr-live-preview-viewport');
  const scaler = document.getElementById('create-pr-live-preview-scaler');
  if (!viewport || !scaler || !STATE.prForm) return;

  scaler.innerHTML = buildOfficialPrDocumentHtml(STATE.prForm);
  const paperEl = scaler.querySelector('.pr-paper');
  if (!paperEl) return;

  const availWidth = Math.max(320, viewport.clientWidth - 24);
  const paperWidthPx = 1047; // 277mm landscape
  const scale = Math.min(1, availWidth / paperWidthPx);
  scaler.style.transform = `scale(${scale.toFixed(4)})`;
  scaler.style.transformOrigin = 'top left';
  scaler.style.width = `${paperWidthPx}px`;
  const naturalHeight = paperEl.offsetHeight || 725;
  scaler.style.height = `${Math.ceil(naturalHeight * scale)}px`;
}

function previewPrDraftModal() {
  if (!STATE.prForm) return;
  openPrPdfModalWithObject(STATE.prForm);
}

async function submitPrForm() {
  const f = STATE.prForm;
  if (!f) return;
  const validItems = f.items.filter(i => i.item_name_snapshot && i.item_name_snapshot.trim() !== '');
  if (validItems.length === 0) {
    alert('กรุณาระบุรายการสินค้าที่ขอซื้ออย่างน้อย 1 รายการ');
    return;
  }
  try {
    const saved = await apiFetch('/api/prs', {
      method: 'POST',
      body: JSON.stringify({ ...f, items: validItems })
    });
    await loadAllData();
    STATE.prSubMode = 'list';
    renderPrPage(document.getElementById('app-view'));
    openPrPdfModalWithObject(saved);
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึก PR: ' + err.message);
  }
}

async function openPrPdfModal(prId) {
  const pr = await apiFetch(`/api/prs/${prId}`);
  openPrPdfModalWithObject(pr);
}

function openPrPdfModalWithObject(pr) {
  STATE.currentViewingPr = pr;
  document.getElementById('pr-modal-title').textContent = `เอกสารใบขอซื้อ (PR): ${pr.pr_number || 'ตัวอย่าง'}`;
  document.getElementById('pr-modal-status-badge').innerHTML = statusBadgeHtml(pr.status || 'OPEN');

  const actionsEl = document.getElementById('pr-modal-actions');
  if (pr.pr_id && !pr.linked_po_id && canIssuePo()) {
    actionsEl.innerHTML = `
      <button class="btn btn-success" onclick="closeModal('pr-pdf-modal'); createPoFromPr(${pr.pr_id});">
        🔗 นำ PR ใบนี้ไปเปิดใบสั่งซื้อ (Create PO from PR)
      </button>
    `;
  } else if (pr.linked_po_id && !isNormalUser()) {
    actionsEl.innerHTML = `
      <button class="btn btn-outline" onclick="closeModal('pr-pdf-modal'); openPoPdfModal(${pr.linked_po_id});">
        📄 เปิดดูใบสั่งซื้อ ${escapeHtml(pr.linked_po_number)}
      </button>
    `;
  } else {
    actionsEl.innerHTML = '';
  }

  const docHtml = buildOfficialPrDocumentHtml(pr);
  document.getElementById('pr-pdf-preview-body').innerHTML = docHtml;
  document.getElementById('print-po-container').innerHTML = docHtml;
  document.getElementById('pr-pdf-modal').classList.add('open');
}

function printCurrentPr() {
  if (!STATE.currentViewingPr) return;
  const docHtml = buildOfficialPrDocumentHtml(STATE.currentViewingPr);
  document.getElementById('print-po-container').innerHTML = docHtml;
  window.print();
}

async function deletePrById(prId) {
  if (!confirm('ยืนยันการลบใบขอซื้อ (PR) นี้?')) return;
  await apiFetch(`/api/prs/${prId}`, { method: 'DELETE' });
  await loadAllData();
  renderCurrentTab();
}

// ==========================================================================
// 7. Issue / Create / Edit PO Page (Supports Both Standalone & Linked PR!)
// ==========================================================================

function startNewPo() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const s = STATE.settings || {};

  STATE.poForm = {
    po_id: null,
    po_number: STATE.nextPoNumber || 'PO/NES/0064-2026',
    po_date: today,
    vendor_id: null,
    vendor_code_snapshot: '',
    vendor_name_snapshot: '',
    vendor_address_snapshot: '',
    vendor_tel_snapshot: '',
    vendor_fax_snapshot: '',
    vendor_contact_name: '',
    vendor_contact_email: '',
    pr_id: null,
    pr_number: '',
    pr_requester_snapshot: '',
    pr_department_snapshot: '',
    quotation_ref: '',
    delivery_location: s.default_delivery_location || 'โรงงาน ซอย 12',
    delivery_contact: s.default_delivery_contact || 'จัดซื้อ 094-479-2417',
    delivery_date: tomorrow,
    payment_term: 'CREDIT 30 DAYS',
    special_discount: 0,
    vat_rate: s.default_vat_rate !== undefined ? Number(s.default_vat_rate) : 7,
    remarks: s.default_remarks || '',
    update_vendor_master: false,
    issued_by: STATE.currentUser?.full_name || 'ฝ่ายจัดซื้อ',
    items: [
      {
        item_id: null,
        item_code_snapshot: '',
        item_name_snapshot: '',
        item_image_snapshot: '',
        pic_engineer: '',
        last_unit_price: null,
        last_vendor_name: '',
        quantity: 10,
        unit: 'PCS',
        unit_price: 0,
        line_discount: 0,
        line_total: 0
      }
    ]
  };
  recalcPoFormTotals();
  switchTab('create-po');
}

function createPoFromPr(prId) {
  const pr = STATE.prs.find(p => Number(p.pr_id) === Number(prId));
  if (!pr) return;
  startNewPo();
  applyPrToPoForm(pr.pr_id);
}

function applyPrToPoForm(prId) {
  const f = STATE.poForm;
  if (!f) return;
  if (!prId) {
    f.pr_id = null;
    f.pr_number = '';
    f.pr_requester_snapshot = '';
    f.pr_department_snapshot = '';
    renderCreatePoForm(document.getElementById('app-view'));
    return;
  }

  const pr = STATE.prs.find(p => Number(p.pr_id) === Number(prId));
  if (!pr) return;

  f.pr_id = pr.pr_id;
  f.pr_number = pr.pr_number;
  f.pr_requester_snapshot = pr.requester_name || '';
  f.pr_department_snapshot = pr.department || '';

  if (pr.vendor_id) {
    const v = STATE.vendors.find(x => Number(x.vendor_id) === Number(pr.vendor_id));
    if (v) {
      f.vendor_id = v.vendor_id;
      f.vendor_code_snapshot = v.vendor_code || '';
      f.vendor_name_snapshot = v.vendor_name || '';
      f.vendor_address_snapshot = v.address || '';
      f.vendor_tel_snapshot = v.tel || v.mobile || '';
      f.vendor_fax_snapshot = v.fax || '';
      f.vendor_contact_name = v.contact_name || '';
      f.vendor_contact_email = v.email || '';
      f.payment_term = v.default_payment_term || 'CREDIT 30 DAYS';
    }
  } else if (pr.vendor_name_snapshot) {
    f.vendor_name_snapshot = pr.vendor_name_snapshot;
    f.vendor_address_snapshot = pr.vendor_address_snapshot || '';
  }

  if (Array.isArray(pr.items) && pr.items.length > 0) {
    f.items = pr.items.map(pri => {
      const masterItem = STATE.items.find(m => Number(m.item_id) === Number(pri.item_id));
      const unitPrice = pri.actual_unit_price !== null && pri.actual_unit_price !== undefined
        ? Number(pri.actual_unit_price)
        : (masterItem && masterItem.last_unit_price ? Number(masterItem.last_unit_price) : 0);
      return {
        item_id: pri.item_id,
        item_code_snapshot: pri.item_code_snapshot || (masterItem ? masterItem.item_code : ''),
        item_name_snapshot: pri.item_name_snapshot,
        item_image_snapshot: masterItem ? (masterItem.image_url || masterItem.category_icon_url) : '',
        pic_engineer: masterItem ? masterItem.pic_engineer : '',
        last_unit_price: masterItem ? masterItem.last_unit_price : null,
        last_vendor_name: masterItem ? masterItem.last_vendor_name : '',
        quantity: Number(pri.quantity || 1),
        unit: pri.unit || 'PCS',
        unit_price: unitPrice,
        line_discount: 0,
        line_total: Number(pri.quantity || 1) * unitPrice
      };
    });
  }

  recalcPoFormTotals();
  renderCreatePoForm(document.getElementById('app-view'));
}

async function editExistingPo(poId) {
  const po = await apiFetch(`/api/pos/${poId}`);
  STATE.poForm = {
    po_id: po.po_id,
    po_number: po.po_number,
    po_date: po.po_date,
    vendor_id: po.vendor_id,
    vendor_code_snapshot: po.vendor_code_snapshot || '',
    vendor_name_snapshot: po.vendor_name_snapshot || '',
    vendor_address_snapshot: po.vendor_address_snapshot || '',
    vendor_tel_snapshot: po.vendor_tel_snapshot || '',
    vendor_fax_snapshot: po.vendor_fax_snapshot || '',
    vendor_contact_name: po.vendor_contact_name || '',
    vendor_contact_email: po.vendor_contact_email || '',
    pr_id: po.pr_id || null,
    pr_number: po.pr_number || '',
    pr_requester_snapshot: po.pr_requester_snapshot || '',
    pr_department_snapshot: po.pr_department_snapshot || '',
    quotation_ref: po.quotation_ref || '',
    delivery_location: po.delivery_location || '',
    delivery_contact: po.delivery_contact || '',
    delivery_date: po.delivery_date || '',
    payment_term: po.payment_term || 'CREDIT 30 DAYS',
    special_discount: Number(po.special_discount || 0),
    vat_rate: Number(po.vat_rate !== undefined ? po.vat_rate : 7),
    remarks: po.remarks || '',
    update_vendor_master: false,
    issued_by: po.issued_by || STATE.currentUser?.full_name || 'ฝ่ายจัดซื้อ',
    items: (po.items || []).map(it => {
      const masterItem = STATE.items.find(m => m.item_id === it.item_id);
      return {
        item_id: it.item_id,
        item_code_snapshot: it.item_code_snapshot,
        item_name_snapshot: it.item_name_snapshot,
        item_image_snapshot: it.item_image_snapshot || (masterItem ? masterItem.image_url : ''),
        pic_engineer: masterItem ? masterItem.pic_engineer : '',
        last_unit_price: masterItem ? masterItem.last_unit_price : null,
        last_vendor_name: masterItem ? masterItem.last_vendor_name : '',
        quantity: Number(it.quantity || 1),
        unit: it.unit || 'PCS',
        unit_price: Number(it.unit_price || 0),
        line_discount: Number(it.line_discount || 0),
        line_total: Number(it.line_total || 0)
      };
    })
  };
  recalcPoFormTotals();
  switchTab('create-po');
}

function recalcPoFormTotals() {
  const f = STATE.poForm;
  if (!f) return;
  let sub = 0;
  for (const row of f.items) {
    const qty = Number(row.quantity || 0);
    const price = Number(row.unit_price || 0);
    const disc = Number(row.line_discount || 0);
    row.line_total = Math.max(0, (qty * price) - disc);
    sub += row.line_total;
  }
  f.sub_total = sub;
  const specDisc = Number(f.special_discount || 0);
  f.net_total = Math.max(0, sub - specDisc);
  const vatRate = Number(f.vat_rate !== undefined ? f.vat_rate : 7);
  f.vat_amount = Math.round(f.net_total * (vatRate / 100) * 100) / 100;
  f.grand_total = Math.round((f.net_total + f.vat_amount) * 100) / 100;
  f.amount_text_th = thaiBahtText(f.grand_total);
}

function togglePoSeparatorFormat() {
  const f = STATE.poForm;
  if (!f || !f.po_number) return;
  if (f.po_number.includes('-20')) {
    f.po_number = f.po_number.replace('-20', '/20');
  } else if (f.po_number.includes('/20')) {
    f.po_number = f.po_number.replace('/20', '-20');
  }
  const input = document.getElementById('po-form-number');
  if (input) input.value = f.po_number;
  refreshCreatePoLivePreview();
}

function onPoHeaderFieldInput(field, val) {
  if (!STATE.poForm) return;
  STATE.poForm[field] = val;
  refreshCreatePoLivePreview();
}

function toggleLivePoPreviewPane() {
  STATE.showLivePoPreview = !STATE.showLivePoPreview;
  renderCreatePoForm(document.getElementById('app-view'));
}

function setLivePreviewZoom(mode) {
  STATE.livePreviewZoom = mode;
  refreshCreatePoLivePreview();
}

function refreshCreatePoLivePreview() {
  const viewport = document.getElementById('create-po-live-preview-viewport');
  const scaler = document.getElementById('create-po-live-preview-scaler');
  if (!viewport || !scaler || !STATE.poForm) return;

  const poPreviewData = {
    ...STATE.poForm,
    approval_status: STATE.poForm.approval_status || 'DRAFT'
  };
  scaler.innerHTML = buildOfficialPoDocumentHtml(poPreviewData);

  const paperEl = scaler.querySelector('.po-paper');
  if (!paperEl) return;

  if (STATE.livePreviewZoom === '100') {
    scaler.style.transform = 'scale(1)';
    scaler.style.transformOrigin = 'top left';
    scaler.style.width = '210mm';
    scaler.style.height = 'auto';
  } else {
    const availWidth = Math.max(320, viewport.clientWidth - 24);
    const paperWidthPx = 794;
    const scale = Math.min(1, availWidth / paperWidthPx);
    scaler.style.transform = `scale(${scale.toFixed(4)})`;
    scaler.style.transformOrigin = 'top left';
    scaler.style.width = `${paperWidthPx}px`;
    const naturalHeight = paperEl.offsetHeight || 1122;
    scaler.style.height = `${Math.ceil(naturalHeight * scale)}px`;
  }
}

function renderCreatePoForm(container) {
  if (!STATE.poForm) startNewPo();
  const f = STATE.poForm;

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <span class="badge badge-tag" style="font-size:13px;">
          ${f.po_id ? `กำลังแก้ไขใบสั่งซื้อ #${escapeHtml(f.po_number)}` : 'สร้างใบสั่งซื้อใหม่ (New Purchase Order)'}
        </span>
        ${f.pr_id ? `
          <span class="badge badge-APPROVED" style="font-size:12.5px;">
            🔗 เชื่อมโยงกับใบขอซื้อ PR: ${escapeHtml(f.pr_number)} (ผู้ขอซื้อ: ${escapeHtml(f.pr_requester_snapshot || '-')})
          </span>
        ` : ''}
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-outline" onclick="toggleLivePoPreviewPane()">
          ${STATE.showLivePoPreview ? '📐 ซ่อนตัวอย่างด้านขวา' : '👁️ แสดงตัวอย่าง PO ด้านขวา'}
        </button>
        <button class="btn btn-outline" onclick="previewPoDraftModal()">🖨️ ขยายเต็มจอ / พิมพ์ PDF</button>
        <button class="btn btn-outline" onclick="submitPoForm('DRAFT')">💾 บันทึกร่าง</button>
        <button class="btn btn-primary" onclick="submitPoForm('PENDING')">🚀 ยื่นเปิดใบสั่งซื้อ (Submit / Issue PO)</button>
      </div>
    </div>

    <div class="po-create-split ${STATE.showLivePoPreview ? '' : 'preview-hidden'}">
      <!-- LEFT COLUMN: PO Entry Form -->
      <div class="po-create-form-col">
        <!-- PR Link Selector Box -->
        <div class="card" style="margin-bottom:16px; background:#eff6ff; border-color:#bfdbfe;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <div style="font-weight:700; color:var(--primary); font-size:14px;">
                🔗 เชื่อมโยงใบขอซื้อ (Issue PO จาก PR — หรือเว้นว่างเพื่อเปิด PO แบบอิสระ)
              </div>
              <div style="font-size:12px; color:#475569;">
                เมื่อเลือก PR ระบบจะดึงรายการสินค้าและรหัส PR มาให้อัตโนมัติ และส่งราคาสั่งซื้อจริงกลับไปแสดงในฟอร์ม PR
              </div>
            </div>
            <select class="form-control" style="max-width:380px; font-weight:600;" onchange="applyPrToPoForm(this.value)">
              <option value="">-- เปิดใบสั่งซื้อ (PO) แบบอิสระ (ไม่อ้างอิง PR) --</option>
              ${STATE.prs.map(pr => `
                <option value="${pr.pr_id}" ${Number(f.pr_id) === Number(pr.pr_id) ? 'selected' : ''}>
                  [PR: ${escapeHtml(pr.pr_number)}] ${escapeHtml(pr.department)} — โดย ${escapeHtml(pr.requester_name)} (${pr.linked_po_number ? 'เปิด PO แล้ว: ' + pr.linked_po_number : 'รอเปิด PO'})
                </option>
              `).join('')}
            </select>
          </div>
        </div>

        <!-- Section 1: Supplier Info -->
        <div class="card" style="margin-bottom:16px;">
          <div class="card-header">
            <div class="card-title">🏭 1. ข้อมูลผู้ขาย (Supplier / Vendor Information)</div>
            <button class="btn btn-sm btn-outline" onclick="openVendorModal()">+ เพิ่มผู้ขายใหม่</button>
          </div>

          <div class="form-grid">
            <div class="form-group col-12">
              <label class="form-label">
                <span>เลือกผู้ขายจากฐานข้อมูล (ค้นหารหัส, ชื่อบริษัท, หรือหมวดหมู่) *</span>
                <span style="font-size:11.5px; color:var(--primary);">ดึงข้อมูลอัตโนมัติ และแก้ไขช่องสีเหลืองอ่อนได้</span>
              </label>
              <div class="search-dropdown" id="vendor-search-dropdown">
                <div class="search-dropdown-trigger" onclick="toggleVendorDropdown()">
                  <span id="vendor-selected-label" style="font-weight:600; color:${f.vendor_name_snapshot ? 'var(--text)' : 'var(--text-muted)'};">
                    ${f.vendor_name_snapshot
                      ? `[${escapeHtml(f.vendor_code_snapshot || 'Vendor')}] ${escapeHtml(f.vendor_name_snapshot)}`
                      : '🔍 คลิกเพื่อค้นหาและเลือกบริษัทผู้ขาย (411 รายการ)...'}
                  </span>
                  <span>▾</span>
                </div>
                <div class="search-dropdown-panel" id="vendor-dropdown-panel" style="min-width:100%; max-width:100%;">
                  <div class="search-dropdown-header">
                    <input type="text" class="form-control" id="vendor-dropdown-search-input"
                      placeholder="พิมพ์ชื่อบริษัท, รหัสผู้ขาย (เช่น 211/2557, MATERIALS CARBIDE), หรือ Tag..."
                      oninput="renderVendorDropdownList(this.value)" />
                  </div>
                  <div class="search-dropdown-list" id="vendor-dropdown-list"></div>
                </div>
              </div>
            </div>

            <div class="form-group col-12">
              <label class="form-label">ชื่อบริษัทผู้ขาย (แสดงบนใบ PO) *</label>
              <input type="text" class="form-control" value="${escapeHtml(f.vendor_name_snapshot)}"
                oninput="onPoHeaderFieldInput('vendor_name_snapshot', this.value)" placeholder="ชื่อบริษัทผู้ขาย" />
            </div>

            <div class="form-group col-12">
              <label class="form-label">ที่อยู่ผู้ขาย (Address)</label>
              <input type="text" class="form-control editable-highlight" id="po-vendor-address" value="${escapeHtml(f.vendor_address_snapshot)}"
                oninput="onPoHeaderFieldInput('vendor_address_snapshot', this.value)" placeholder="ที่อยู่ผู้ขาย" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">โทรศัพท์ (Tel) <small style="color:#b45309;">(แก้ไขได้)</small></label>
              <input type="text" class="form-control editable-highlight" id="po-vendor-tel" value="${escapeHtml(f.vendor_tel_snapshot)}"
                oninput="onPoHeaderFieldInput('vendor_tel_snapshot', this.value)" placeholder="เช่น 02.370.1599" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">Fax <small style="color:#b45309;">(แก้ไขได้)</small></label>
              <input type="text" class="form-control editable-highlight" id="po-vendor-fax" value="${escapeHtml(f.vendor_fax_snapshot)}"
                oninput="onPoHeaderFieldInput('vendor_fax_snapshot', this.value)" placeholder="เช่น 02.370.1303-4" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">ผู้ติดต่อ (Contact Person) <small style="color:#b45309;">(แก้ไขได้)</small></label>
              <input type="text" class="form-control editable-highlight" id="po-vendor-contact" value="${escapeHtml(f.vendor_contact_name)}"
                oninput="onPoHeaderFieldInput('vendor_contact_name', this.value)" placeholder="เช่น คุณมิค" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">อีเมล (Email) <small style="color:#b45309;">(แก้ไขได้)</small></label>
              <input type="text" class="form-control editable-highlight" id="po-vendor-email" value="${escapeHtml(f.vendor_contact_email)}"
                oninput="onPoHeaderFieldInput('vendor_contact_email', this.value)" placeholder="เช่น mic@mtcb.co.th" />
            </div>

            <div class="col-12" style="padding-top:2px;">
              <label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-size:12.5px; color:#334155;">
                <input type="checkbox" ${f.update_vendor_master ? 'checked' : ''} onchange="STATE.poForm.update_vendor_master = this.checked" />
                <span>บันทึกการแก้ไขข้อมูลติดต่อนี้ (ผู้ติดต่อ / โทรศัพท์ / Fax / Email) อัปเดตกลับไปที่ฐานข้อมูลหลักของผู้ขายด้วย</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Section 2: PO Header Details -->
        <div class="card" style="margin-bottom:16px;">
          <div class="card-header">
            <div class="card-title">📄 2. รายละเอียดตัวใบสั่งซื้อ (PO Header Details)</div>
            <span style="font-size:12px; color:var(--text-muted);">หน้า 1/1</span>
          </div>

          <div class="form-grid">
            <div class="form-group col-6">
              <label class="form-label">
                <span>เลขที่ PO *</span>
                <span style="font-size:11px; color:var(--primary); cursor:pointer;" onclick="togglePoSeparatorFormat()">⇄ สลับคั่น - หรือ /</span>
              </label>
              <input type="text" class="form-control" id="po-form-number" style="font-weight:700; color:var(--primary);"
                value="${escapeHtml(f.po_number)}" oninput="onPoHeaderFieldInput('po_number', this.value)" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">วันที่เปิด PO *</label>
              <input type="date" class="form-control" value="${escapeHtml(f.po_date)}"
                onchange="onPoHeaderFieldInput('po_date', this.value)" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">
                <span>เลขที่ Quotation</span>
                <span style="font-size:11px; color:var(--primary); cursor:pointer;"
                  onclick="document.getElementById('po-form-qt').value='ราคาเดิม'; onPoHeaderFieldInput('quotation_ref', 'ราคาเดิม');">+ ใส่ "ราคาเดิม"</span>
              </label>
              <input type="text" class="form-control" id="po-form-qt" value="${escapeHtml(f.quotation_ref)}"
                oninput="onPoHeaderFieldInput('quotation_ref', this.value)" placeholder="เช่น ราคาเดิม หรือ เลข QT" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">เลขที่ PR (ซิงค์กับฟอร์ม PR อัตโนมัติ)</label>
              <input type="text" class="form-control" value="${escapeHtml(f.pr_number)}"
                oninput="onPoHeaderFieldInput('pr_number', this.value)" placeholder="เช่น 2/1/082" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">สถานที่ส่งของ</label>
              <input type="text" class="form-control" value="${escapeHtml(f.delivery_location)}"
                oninput="onPoHeaderFieldInput('delivery_location', this.value)" placeholder="เช่น โรงงาน ซอย 12" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">ติดต่อ (ผู้รับของ/จัดซื้อ)</label>
              <input type="text" class="form-control" value="${escapeHtml(f.delivery_contact)}"
                oninput="onPoHeaderFieldInput('delivery_contact', this.value)" placeholder="เช่น จัดซื้อ 094-479-2417" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">กำหนดส่งของ</label>
              <input type="date" class="form-control" style="color:#dc2626; font-weight:600;" value="${escapeHtml(f.delivery_date)}"
                onchange="onPoHeaderFieldInput('delivery_date', this.value)" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">เงื่อนไขการชำระเงิน <small style="color:#b45309;">(แก้ไขได้)</small></label>
              <input type="text" class="form-control editable-highlight" id="po-vendor-payment" list="payment-term-list"
                value="${escapeHtml(f.payment_term)}" oninput="onPoHeaderFieldInput('payment_term', this.value)" />
            </div>
          </div>
        </div>

        <!-- Section 3: Line Items Table -->
        <div class="card" style="margin-bottom:0;">
          <div class="card-header">
            <div>
              <div class="card-title">🛒 3. รายละเอียดรายการที่สั่งซื้อ (PO Line Items)</div>
              <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                คลิกช่องรายการสินค้าเพื่อค้นหาแบบ Dropdown แสดง <strong>Picture | Item Code | Item Name | PIC | Last Price/Unit</strong>
              </div>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn btn-sm btn-outline" onclick="openItemModal(null, null)">+ เพิ่มสินค้าใหม่เข้า DB</button>
              <button class="btn btn-sm btn-primary" onclick="addPoItemRow()">+ เพิ่มแถวรายการ</button>
            </div>
          </div>

          <div style="overflow:visible;">
            <table class="data-table" id="po-items-entry-table">
              <thead>
                <tr>
                  <th style="width:42px; text-align:center;">ลำดับ</th>
                  <th style="min-width:250px;">รายการสินค้า (Picture | Code | Name | Last Price)</th>
                  <th style="width:88px;">จำนวน</th>
                  <th style="width:86px;">หน่วย</th>
                  <th style="width:115px;">ราคา/หน่วย</th>
                  <th style="width:92px;">ส่วนลด</th>
                  <th style="width:115px; text-align:right;">จำนวนเงิน</th>
                  <th style="width:44px; text-align:center;">ลบ</th>
                </tr>
              </thead>
              <tbody id="po-items-tbody">
                ${renderPoItemRowsHtml()}
              </tbody>
            </table>
          </div>

          <div style="margin-top:12px;">
            <button class="btn btn-sm btn-outline" onclick="addPoItemRow()">+ เพิ่มรายการสั่งซื้อ (Add Line Item)</button>
          </div>

          <div class="form-grid" style="margin-top:18px; padding-top:16px; border-top:2px solid var(--border);">
            <div class="col-7">
              <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label">ตัวอักษรรวมเงินภาษาไทย (แปลงอัตโนมัติตามยอดรวมทั้งสิ้น)</label>
                <input type="text" class="form-control" id="po-amount-text-th" style="font-weight:700; color:var(--primary); background:#eff6ff;"
                  value="${escapeHtml(f.amount_text_th)}" oninput="onPoHeaderFieldInput('amount_text_th', this.value)" />
              </div>
              <div class="form-group">
                <label class="form-label">หมายเหตุท้ายใบสั่งซื้อ (Remarks)</label>
                <textarea class="form-control" rows="4" oninput="onPoHeaderFieldInput('remarks', this.value)">${escapeHtml(f.remarks)}</textarea>
              </div>
            </div>

            <div class="col-5">
              <div style="background:var(--surface-alt); border:1px solid var(--border); border-radius:10px; padding:14px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13.5px;">
                  <span>รวมเป็นเงิน (Sub Total)</span>
                  <strong id="po-sum-subtotal">${formatMoney(f.sub_total)} บาท</strong>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:13.5px;">
                  <span>ส่วนลดพิเศษท้ายบิล</span>
                  <input type="number" step="0.01" class="form-control" style="width:110px; text-align:right; padding:4px 8px;"
                    value="${f.special_discount}" oninput="onSpecialDiscountChange(this.value)" />
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13.5px;">
                  <span>มูลค่าสินค้า / บริการสุทธิ</span>
                  <strong id="po-sum-nettotal">${formatMoney(f.net_total)} บาท</strong>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font-size:13.5px;">
                  <span style="display:flex; align-items:center; gap:6px;">
                    VAT (%)
                    <input type="number" step="1" class="form-control" style="width:58px; padding:3px 6px;"
                      value="${f.vat_rate}" oninput="onVatRateChange(this.value)" />
                  </span>
                  <strong id="po-sum-vat">${formatMoney(f.vat_amount)} บาท</strong>
                </div>
                <div style="display:flex; justify-content:space-between; padding-top:10px; border-top:2px solid var(--border-strong); font-size:16px; font-weight:700; color:var(--primary);">
                  <span>รวมทั้งสิ้น</span>
                  <span id="po-sum-grandtotal">${formatMoney(f.grand_total)} บาท</span>
                </div>
              </div>

              <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px; flex-wrap:wrap;">
                <button class="btn btn-outline" onclick="submitPoForm('DRAFT')">💾 บันทึกร่าง</button>
                <button class="btn btn-primary" style="padding:10px 16px;" onclick="submitPoForm('PENDING')">
                  🚀 ยื่นเปิดใบสั่งซื้อ (Submit PO)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT COLUMN: Real-Time Sticky Official PO Document Preview -->
      ${STATE.showLivePoPreview ? `
        <aside class="po-live-preview-pane" id="create-po-live-preview-pane">
          <div class="po-live-preview-header">
            <div>
              <div style="font-weight:700; font-size:14.5px; display:flex; align-items:center; gap:6px;">
                <span>👁️ ตัวอย่างใบสั่งซื้อจริง (FM-PU-02)</span>
                <span style="background:#22c55e; color:#fff; font-size:10.5px; padding:1px 7px; border-radius:99px;">Real-time</span>
              </div>
              <div style="font-size:11.5px; color:#94a3b8;">แสดงผลหน้ากระดาษ A4 ตามข้อมูลที่คุณกำลังกรอกทันที</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              <button class="btn btn-sm ${STATE.livePreviewZoom === 'fit' ? 'btn-primary' : 'btn-outline'}"
                style="${STATE.livePreviewZoom !== 'fit' ? 'background:#334155;color:#fff;border-color:#475569;' : ''}"
                onclick="setLivePreviewZoom('fit')">พอดีกรอบ</button>
              <button class="btn btn-sm ${STATE.livePreviewZoom === '100' ? 'btn-primary' : 'btn-outline'}"
                style="${STATE.livePreviewZoom !== '100' ? 'background:#334155;color:#fff;border-color:#475569;' : ''}"
                onclick="setLivePreviewZoom('100')">100%</button>
              <button class="btn btn-sm btn-outline" style="background:#334155;color:#fff;border-color:#475569;"
                onclick="previewPoDraftModal()">🖨️ พิมพ์</button>
            </div>
          </div>

          <div class="po-live-preview-viewport" id="create-po-live-preview-viewport">
            <div id="create-po-live-preview-scaler"></div>
          </div>
        </aside>
      ` : ''}
    </div>
  `;

  if (STATE.showLivePoPreview) {
    refreshCreatePoLivePreview();
  }
}

function renderPoItemRowsHtml() {
  const f = STATE.poForm;
  if (!f || !Array.isArray(f.items)) return '';

  return f.items.map((row, idx) => {
    const lastPrice = row.last_unit_price !== null && row.last_unit_price !== undefined ? Number(row.last_unit_price) : null;
    const currPrice = Number(row.unit_price || 0);
    let priceCompareHtml = '';
    if (lastPrice !== null && currPrice > 0) {
      const diff = currPrice - lastPrice;
      if (Math.abs(diff) < 0.005) {
        priceCompareHtml = `<div style="font-size:11px; color:var(--success); margin-top:3px;">✓ เท่ากับราคาล่าสุด (${formatMoney(lastPrice)} บ.)</div>`;
      } else if (diff > 0) {
        priceCompareHtml = `<div style="font-size:11px; color:#d97706; font-weight:600; margin-top:3px;">⚠️ +${formatMoney(diff)} บ. (เดิม ${formatMoney(lastPrice)})</div>`;
      } else {
        priceCompareHtml = `<div style="font-size:11px; color:var(--primary); font-weight:600; margin-top:3px;">▼ ${formatMoney(diff)} บ. (เดิม ${formatMoney(lastPrice)})</div>`;
      }
    } else if (lastPrice !== null) {
      priceCompareHtml = `<div style="font-size:11px; color:var(--text-muted); margin-top:3px;">ล่าสุด: ${formatMoney(lastPrice)} บ.</div>`;
    }

    return `
      <tr>
        <td style="text-align:center; font-weight:700;">${idx + 1}</td>
        <td>
          <div class="search-dropdown" id="item-dropdown-wrap-${idx}">
            <div class="search-dropdown-trigger" onclick="openItemDropdownForRow(${idx})">
              ${row.item_name_snapshot ? `
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                  ${row.item_image_snapshot ? `<img src="${row.item_image_snapshot}" style="width:30px; height:30px; border-radius:6px; object-fit:cover; border:1px solid var(--border);" />` : ''}
                  <div style="text-align:left;">
                    <div style="font-weight:700; font-size:12.5px; color:var(--primary);">${escapeHtml(row.item_code_snapshot)} — ${escapeHtml(row.item_name_snapshot)}</div>
                    <div style="font-size:11px; color:var(--text-muted);">
                      PIC: ${escapeHtml(row.pic_engineer || 'Tooling')} | ล่าสุด: ${lastPrice !== null ? formatMoney(lastPrice) + ' บ./' + escapeHtml(row.unit) : 'ยังไม่เคยสั่งซื้อ'}
                    </div>
                  </div>
                </div>
              ` : `<span style="color:var(--text-muted); font-size:12.5px;">🔍 คลิกเลือกสินค้า (Picture | Code | Name | Last Price)...</span>`}
              <span>▾</span>
            </div>

            <div class="search-dropdown-panel" id="item-dropdown-panel-${idx}">
              <div class="search-dropdown-header">
                <input type="text" class="form-control" id="item-dropdown-input-${idx}"
                  placeholder="ค้นหารหัสสินค้า (เช่น INS-01), ชื่อสินค้า (เช่น SEMT), หรือผู้ดูแล (PIC)..."
                  oninput="renderItemDropdownRows(${idx}, this.value)" />
                <button class="btn btn-sm btn-primary" onclick="openItemModal(null, ${idx})">+ สินค้าใหม่</button>
              </div>
              <div class="dropdown-col-header">
                <div>Picture</div>
                <div>Item No.</div>
                <div>Item Name</div>
                <div>PIC</div>
                <div style="text-align:right;">Last Price / Stock</div>
              </div>
              <div class="search-dropdown-list" id="item-dropdown-list-${idx}"></div>
            </div>
          </div>
          <div style="margin-top:4px; display:flex; align-items:center; gap:6px;">
            <input type="text" class="form-control" style="font-size:12px; padding:4px 8px;"
              placeholder="แก้ไขชื่อรายการที่แสดงบนใบ PO ได้ตามต้องการ..."
              value="${escapeHtml(row.item_name_snapshot)}"
              oninput="onPoItemFieldChange(${idx}, 'item_name_snapshot', this.value)" />
            ${row.item_id ? `<button class="btn btn-sm btn-outline" title="ดูประวัติราคาสินค้านี้" onclick="viewItemHistory(${row.item_id})">📈</button>` : ''}
          </div>
        </td>
        <td style="vertical-align:top;">
          <input type="number" step="any" min="0" class="form-control" style="text-align:right; font-weight:600; padding:6px 8px;"
            value="${row.quantity}" oninput="onPoItemFieldChange(${idx}, 'quantity', this.value)" />
        </td>
        <td style="vertical-align:top;">
          <input type="text" class="form-control editable-highlight" list="unit-datalist" style="text-align:center; font-weight:600; padding:6px 6px;"
            value="${escapeHtml(row.unit)}" oninput="onPoItemFieldChange(${idx}, 'unit', this.value)" />
        </td>
        <td style="vertical-align:top;">
          <input type="number" step="0.01" min="0" class="form-control" style="text-align:right; font-weight:600; padding:6px 8px;"
            value="${row.unit_price}" oninput="onPoItemFieldChange(${idx}, 'unit_price', this.value)" />
          ${priceCompareHtml}
        </td>
        <td style="vertical-align:top;">
          <input type="number" step="0.01" min="0" class="form-control" style="text-align:right; padding:6px 8px;"
            value="${row.line_discount}" oninput="onPoItemFieldChange(${idx}, 'line_discount', this.value)" />
        </td>
        <td style="vertical-align:top; text-align:right; font-weight:700; font-size:13.5px; padding-top:14px;" id="po-row-total-${idx}">
          ${formatMoney(row.line_total)}
        </td>
        <td style="vertical-align:top; text-align:center; padding-top:10px;">
          <button class="btn btn-sm btn-outline" style="color:var(--danger); padding:4px 8px;" onclick="removePoItemRow(${idx})">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleVendorDropdown() {
  const panel = document.getElementById('vendor-dropdown-panel');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  closeAllDropdownPanels();
  if (!isOpen) {
    panel.classList.add('open');
    renderVendorDropdownList('');
    const inp = document.getElementById('vendor-dropdown-search-input');
    if (inp) {
      inp.value = '';
      setTimeout(() => inp.focus(), 30);
    }
  }
}

function renderVendorDropdownList(query = '') {
  const listEl = document.getElementById('vendor-dropdown-list');
  if (!listEl) return;
  const q = String(query || '').trim().toLowerCase();
  const matches = STATE.vendors.filter(v => {
    if (!q) return true;
    return (
      (v.vendor_code || '').toLowerCase().includes(q) ||
      (v.vendor_name || '').toLowerCase().includes(q) ||
      (v.contact_name || '').toLowerCase().includes(q) ||
      (v.description || '').toLowerCase().includes(q) ||
      (v.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }).slice(0, 60);

  if (matches.length === 0) {
    listEl.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-muted);">ไม่พบผู้ขายที่ตรงกับ "${escapeHtml(query)}"</div>`;
    return;
  }

  listEl.innerHTML = matches.map(v => `
    <div style="padding:10px 14px; border-bottom:1px solid #f1f5f9; cursor:pointer; display:flex; justify-content:space-between; align-items:center;"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'"
      onclick="selectVendorForPo(${v.vendor_id})">
      <div>
        <div style="font-weight:700; color:var(--text);">
          <span style="color:var(--primary);">[${escapeHtml(v.vendor_code)}]</span> ${escapeHtml(v.vendor_name)}
        </div>
        <div style="font-size:12px; color:var(--text-muted);">
          ติดต่อ: ${escapeHtml(v.contact_name || '-')} | โทร: ${escapeHtml(v.tel || v.mobile || '-')} | ${escapeHtml(v.address || '')}
        </div>
      </div>
      <div style="display:flex; gap:4px; flex-wrap:wrap; justify-content:flex-end;">
        ${(v.tags || []).map(t => `<span class="badge-tag">${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>
  `).join('');
}

function selectVendorForPo(vendorId) {
  const v = STATE.vendors.find(x => x.vendor_id === vendorId);
  if (!v || !STATE.poForm) return;
  const f = STATE.poForm;
  f.vendor_id = v.vendor_id;
  f.vendor_code_snapshot = v.vendor_code || '';
  f.vendor_name_snapshot = v.vendor_name || '';
  f.vendor_address_snapshot = v.address || '';
  f.vendor_tel_snapshot = v.tel || v.mobile || '';
  f.vendor_fax_snapshot = v.fax || '';
  f.vendor_contact_name = v.contact_name || '';
  f.vendor_contact_email = v.email || '';
  f.payment_term = v.default_payment_term || 'CREDIT 30 DAYS';

  closeAllDropdownPanels();
  renderCreatePoForm(document.getElementById('app-view'));
}

function openItemDropdownForRow(rowIdx) {
  const panel = document.getElementById(`item-dropdown-panel-${rowIdx}`);
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  closeAllDropdownPanels();
  if (!isOpen) {
    panel.classList.add('open');
    renderItemDropdownRows(rowIdx, '');
    const inp = document.getElementById(`item-dropdown-input-${rowIdx}`);
    if (inp) {
      inp.value = '';
      setTimeout(() => inp.focus(), 30);
    }
  }
}

function renderItemDropdownRows(rowIdx, query = '') {
  const listEl = document.getElementById(`item-dropdown-list-${rowIdx}`);
  if (!listEl) return;
  const q = String(query || '').trim().toLowerCase();

  const filtered = STATE.items.filter(it => {
    if (!q) return true;
    return (
      (it.item_code || '').toLowerCase().includes(q) ||
      (it.item_name || '').toLowerCase().includes(q) ||
      (it.category_name || '').toLowerCase().includes(q) ||
      (it.pic_engineer || '').toLowerCase().includes(q)
    );
  });

  if (!q) {
    filtered.sort((a, b) => (b.last_unit_price ? 1 : 0) - (a.last_unit_price ? 1 : 0));
  }

  const topItems = filtered.slice(0, 60);
  if (topItems.length === 0) {
    listEl.innerHTML = `<div style="padding:14px; text-align:center; color:var(--text-muted);">ไม่พบสินค้าที่ค้นหา สามารถกดปุ่ม "+ สินค้าใหม่" ด้านบนได้ทันที</div>`;
    return;
  }

  listEl.innerHTML = topItems.map(it => {
    const imgSrc = it.image_url || it.category_icon_url || '';
    const lastPriceText = it.last_unit_price !== null && it.last_unit_price !== undefined
      ? `<strong style="color:var(--success);">${formatMoney(it.last_unit_price)} ฿</strong> / ${escapeHtml(it.default_unit || 'PCS')}`
      : `<span style="color:var(--text-muted);">ยังไม่เคยซื้อ</span>`;
    return `
      <div class="dropdown-item-row" onclick="selectItemForPoRow(${rowIdx}, ${it.item_id})">
        <div>${imgSrc ? `<img src="${imgSrc}" alt="${escapeHtml(it.item_code)}" />` : ''}</div>
        <div>
          <div style="font-weight:700; color:var(--primary);">${escapeHtml(it.item_code)}</div>
          <div style="font-size:10.5px; color:var(--text-muted);">${escapeHtml(it.category_name || '')}</div>
        </div>
        <div style="font-weight:600; color:var(--text);">${escapeHtml(it.item_name)}</div>
        <div style="font-size:12px; color:#475569;">${escapeHtml(it.pic_engineer || 'วิศวกร Tooling')}</div>
        <div style="text-align:right; font-size:12px;">
          <div>${lastPriceText}</div>
          <div style="font-size:10.5px; color:#2563eb;">คลัง: ${Number(it.current_stock || 0)} ${escapeHtml(it.default_unit || 'PCS')}</div>
        </div>
      </div>
    `;
  }).join('');
}

function selectItemForPoRow(rowIdx, itemId) {
  const it = STATE.items.find(x => x.item_id === itemId);
  if (!it || !STATE.poForm) return;
  const row = STATE.poForm.items[rowIdx];
  if (!row) return;

  row.item_id = it.item_id;
  row.item_code_snapshot = it.item_code;
  row.item_name_snapshot = it.item_name;
  row.item_image_snapshot = it.image_url || it.category_icon_url || '';
  row.pic_engineer = it.pic_engineer || 'วิศวกร Tooling';
  row.unit = it.default_unit || 'PCS';
  row.last_unit_price = it.last_unit_price;
  row.last_vendor_name = it.last_vendor_name || '';
  if (it.last_unit_price !== null && it.last_unit_price !== undefined) {
    row.unit_price = Number(it.last_unit_price);
  }

  closeAllDropdownPanels();
  recalcPoFormTotals();
  renderCreatePoForm(document.getElementById('app-view'));
}

function onPoItemFieldChange(rowIdx, field, val) {
  const f = STATE.poForm;
  if (!f || !f.items[rowIdx]) return;
  if (field === 'unit' || field === 'item_name_snapshot') {
    f.items[rowIdx][field] = val;
  } else {
    f.items[rowIdx][field] = Number(val || 0);
  }
  recalcPoFormTotals();
  updatePoSummaryDom(rowIdx);
}

function onSpecialDiscountChange(val) {
  if (!STATE.poForm) return;
  STATE.poForm.special_discount = Number(val || 0);
  recalcPoFormTotals();
  updatePoSummaryDom();
}

function onVatRateChange(val) {
  if (!STATE.poForm) return;
  STATE.poForm.vat_rate = Number(val || 0);
  recalcPoFormTotals();
  updatePoSummaryDom();
}

function updatePoSummaryDom(changedRowIdx = null) {
  const f = STATE.poForm;
  if (!f) return;
  if (changedRowIdx !== null && f.items[changedRowIdx]) {
    const rowTotEl = document.getElementById(`po-row-total-${changedRowIdx}`);
    if (rowTotEl) rowTotEl.textContent = formatMoney(f.items[changedRowIdx].line_total);
  }
  const subEl = document.getElementById('po-sum-subtotal');
  const netEl = document.getElementById('po-sum-nettotal');
  const vatEl = document.getElementById('po-sum-vat');
  const grandEl = document.getElementById('po-sum-grandtotal');
  const wordsEl = document.getElementById('po-amount-text-th');

  if (subEl) subEl.textContent = `${formatMoney(f.sub_total)} บาท`;
  if (netEl) netEl.textContent = `${formatMoney(f.net_total)} บาท`;
  if (vatEl) vatEl.textContent = `${formatMoney(f.vat_amount)} บาท`;
  if (grandEl) grandEl.textContent = `${formatMoney(f.grand_total)} บาท`;
  if (wordsEl) wordsEl.value = f.amount_text_th;
  refreshCreatePoLivePreview();
}

function addPoItemRow() {
  if (!STATE.poForm) return;
  STATE.poForm.items.push({
    item_id: null,
    item_code_snapshot: '',
    item_name_snapshot: '',
    item_image_snapshot: '',
    pic_engineer: '',
    last_unit_price: null,
    last_vendor_name: '',
    quantity: 1,
    unit: 'PCS',
    unit_price: 0,
    line_discount: 0,
    line_total: 0
  });
  recalcPoFormTotals();
  renderCreatePoForm(document.getElementById('app-view'));
}

function removePoItemRow(idx) {
  if (!STATE.poForm) return;
  if (STATE.poForm.items.length <= 1) {
    alert('ใบสั่งซื้อต้องมีรายการสินค้าอย่างน้อย 1 รายการ');
    return;
  }
  STATE.poForm.items.splice(idx, 1);
  recalcPoFormTotals();
  renderCreatePoForm(document.getElementById('app-view'));
}

function previewPoDraftModal() {
  if (!STATE.poForm) return;
  recalcPoFormTotals();
  openPoPdfModalWithObject({
    ...STATE.poForm,
    approval_status: STATE.poForm.approval_status || 'DRAFT'
  });
}

async function submitPoForm(targetStatus = 'PENDING') {
  const f = STATE.poForm;
  if (!f) return;
  if (!f.vendor_name_snapshot.trim()) {
    alert('กรุณาเลือกหรือระบุชื่อบริษัทผู้ขาย (Supplier)');
    return;
  }
  const validItems = f.items.filter(i => i.item_name_snapshot && i.item_name_snapshot.trim() !== '');
  if (validItems.length === 0) {
    alert('กรุณาเลือกรายการสินค้าอย่างน้อย 1 รายการ');
    return;
  }
  recalcPoFormTotals();

  const payload = {
    ...f,
    issued_by: STATE.currentUser?.full_name || f.issued_by || 'ฝ่ายจัดซื้อ',
    items: validItems,
    approval_status: targetStatus
  };

  try {
    let savedPo;
    if (f.po_id) {
      savedPo = await apiFetch(`/api/pos/${f.po_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } else {
      savedPo = await apiFetch('/api/pos', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    await loadAllData();
    switchTab('dashboard');
    openPoPdfModal(savedPo.po_id);
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึก PO: ' + err.message);
  }
}

// ==========================================================================
// 8. Official PO Modal & Interactive Touch/Stylus Signature Approval
// ==========================================================================

async function openPoPdfModal(poId) {
  const po = await apiFetch(`/api/pos/${poId}`);
  openPoPdfModalWithObject(po);
}

function openPoPdfModalWithObject(po) {
  STATE.currentViewingPo = po;
  document.getElementById('po-modal-title').textContent = `เอกสารใบสั่งซื้อ: ${po.po_number || 'ตัวอย่างก่อนบันทึก'}`;
  document.getElementById('po-modal-status-badge').innerHTML = statusBadgeHtml(po.approval_status || 'DRAFT');

  const prTraceEl = document.getElementById('po-modal-pr-trace-badge');
  const linkedPr = STATE.prs.find(pr => (po.pr_id && pr.pr_id === po.pr_id) || (po.pr_number && pr.pr_number === po.pr_number));
  if (linkedPr) {
    prTraceEl.innerHTML = `
      <span class="badge-tag" style="cursor:pointer; font-weight:700;" onclick="closeModal('po-pdf-modal'); openPrPdfModal(${linkedPr.pr_id});">
        🔗 อ้างอิงใบขอซื้อ PR: ${escapeHtml(linkedPr.pr_number)} (ผู้เปิด PR: ${escapeHtml(linkedPr.requester_name)}) — คลิกดูใบ PR
      </span>
    `;
  } else if (po.pr_number) {
    prTraceEl.innerHTML = `<span class="badge-tag">PR: ${escapeHtml(po.pr_number)}</span>`;
  } else {
    prTraceEl.innerHTML = '';
  }

  const rejectBanner = document.getElementById('po-modal-reject-banner');
  if (po.approval_status === 'REJECTED' && po.reject_reason) {
    rejectBanner.style.display = 'block';
    rejectBanner.textContent = `❌ เหตุผลที่ตีกลับ: ${po.reject_reason}`;
  } else {
    rejectBanner.style.display = 'none';
  }

  const actionsContainer = document.getElementById('po-modal-approval-actions');
  if (po.po_id && po.approval_status === 'PENDING' && canApprovePo()) {
    actionsContainer.innerHTML = `
      <button class="btn btn-success" onclick="openApproveSignatureModal(${po.po_id})">✍️ วาดลายเซ็นอนุมัติ (Approve & Sign)</button>
      <button class="btn btn-danger" onclick="rejectPoById(${po.po_id})">✕ ตีกลับ (Reject)</button>
    `;
  } else if (po.po_id && po.approval_status === 'APPROVED') {
    actionsContainer.innerHTML = `<span style="font-size:12.5px; color:var(--success); font-weight:700;">✓ ลงลายมือชื่ออนุมัติแล้ว (${escapeHtml(po.approved_by || '')})</span>`;
  } else {
    actionsContainer.innerHTML = '';
  }

  const docHtml = buildOfficialPoDocumentHtml(po);
  document.getElementById('po-pdf-preview-body').innerHTML = docHtml;
  document.getElementById('print-po-container').innerHTML = docHtml;
  document.getElementById('po-pdf-modal').classList.add('open');
}

function printCurrentPo() {
  if (!STATE.currentViewingPo) return;
  const docHtml = buildOfficialPoDocumentHtml(STATE.currentViewingPo);
  document.getElementById('print-po-container').innerHTML = docHtml;
  window.print();
}

// Interactive Touch / Stylus / Mouse Signature Modal for PO Approval
function openApproveSignatureModal(poId) {
  if (!canApprovePo()) {
    alert('เฉพาะบทบาท Approver หรือ Admin เท่านั้นที่มีสิทธิ์ลงนามอนุมัติใบสั่งซื้อ');
    return;
  }
  const po = STATE.pos.find(p => Number(p.po_id) === Number(poId)) || STATE.currentViewingPo;
  if (!po) return;

  document.getElementById('approve-sig-po-id').value = po.po_id;
  document.getElementById('approve-sig-po-summary').textContent = `เลขที่ PO: ${po.po_number} (วันที่: ${formatPoDocDate(po.po_date)})`;
  document.getElementById('approve-sig-vendor-summary').textContent = `ผู้ขาย: ${po.vendor_name_snapshot} ${po.pr_number ? `| อ้างอิง PR: ${po.pr_number}` : ''}`;
  document.getElementById('approve-sig-total-summary').textContent = `${formatMoney(po.grand_total)} บาท`;
  document.getElementById('approve-sig-comment').value = 'อนุมัติสั่งซื้อตามเสนอ';

  document.getElementById('approve-signature-modal').classList.add('open');
  setTimeout(() => initApproveTouchSignatureCanvas(), 40);
}

function initApproveTouchSignatureCanvas() {
  const canvas = document.getElementById('approve-touch-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw subtle baseline guide
  ctx.save();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(40, 155);
  ctx.lineTo(canvas.width - 40, 155);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = STATE.approvePenColor || '#1e3a8a';
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  STATE.hasDrawnApproveSignature = false;

  let isDrawing = false;

  function getCanvasCoords(ev) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = ev.clientX;
    let clientY = ev.clientY;
    if (ev.touches && ev.touches.length > 0) {
      clientX = ev.touches[0].clientX;
      clientY = ev.touches[0].clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  function startDraw(ev) {
    ev.preventDefault();
    isDrawing = true;
    STATE.hasDrawnApproveSignature = true;
    const p = getCanvasCoords(ev);
    ctx.strokeStyle = STATE.approvePenColor || '#1e3a8a';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function moveDraw(ev) {
    if (!isDrawing) return;
    ev.preventDefault();
    const p = getCanvasCoords(ev);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function endDraw(ev) {
    if (!isDrawing) return;
    ev.preventDefault();
    isDrawing = false;
  }

  canvas.onpointerdown = startDraw;
  canvas.onpointermove = moveDraw;
  canvas.onpointerup = endDraw;
  canvas.onpointercancel = endDraw;

  canvas.ontouchstart = startDraw;
  canvas.ontouchmove = moveDraw;
  canvas.ontouchend = endDraw;
}

function setApprovePenColor(color) {
  STATE.approvePenColor = color;
}

function clearApproveTouchCanvas() {
  initApproveTouchSignatureCanvas();
}

async function confirmSignatureAndApprovePo() {
  const poId = Number(document.getElementById('approve-sig-po-id').value);
  if (!poId) return;
  if (!STATE.hasDrawnApproveSignature) {
    alert('กรุณาวาดลายเซ็นลงในกรอบก่อนกดยืนยันอนุมัติ');
    return;
  }

  const canvas = document.getElementById('approve-touch-canvas');
  const signatureDataUrl = canvas.toDataURL('image/png');
  const comment = document.getElementById('approve-sig-comment').value.trim();

  try {
    const updated = await apiFetch(`/api/pos/${poId}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        approver_name: STATE.currentUser?.full_name || 'ผู้มีอำนาจลงนาม',
        signature_image: signatureDataUrl,
        comment
      })
    });
    closeModal('approve-signature-modal');
    await loadAllData();
    renderCurrentTab();
    openPoPdfModalWithObject(updated);
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการอนุมัติ: ' + err.message);
  }
}

async function rejectPoById(poId) {
  const reason = prompt('กรุณาระบุเหตุผลในการตีกลับใบสั่งซื้อ (Reject Reason):', 'กรุณาตรวจสอบราคาหรือเงื่อนไขการชำระเงินอีกครั้ง');
  if (reason === null) return;
  try {
    const updated = await apiFetch(`/api/pos/${poId}/reject`, {
      method: 'POST',
      body: JSON.stringify({
        approver_name: STATE.currentUser?.full_name || 'ผู้มีอำนาจลงนาม',
        comment: reason
      })
    });
    await loadAllData();
    renderCurrentTab();
    openPoPdfModalWithObject(updated);
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function deletePoById(poId) {
  if (!confirm('ยืนยันการลบใบสั่งซื้อนี้?')) return;
  await apiFetch(`/api/pos/${poId}`, { method: 'DELETE' });
  await loadAllData();
  renderCurrentTab();
}

// ==========================================================================
// 9. Approval Center Page
// ==========================================================================

function renderApprovalCenter(container) {
  const pendingList = STATE.pos.filter(p => p.approval_status === 'PENDING');
  const historyList = STATE.pos.filter(p => p.approval_status !== 'PENDING');

  container.innerHTML = `
    <div class="card" style="border-left: 4px solid #f59e0b;">
      <div class="card-header">
        <div>
          <div class="card-title">✍️ รายการใบสั่งซื้อที่รออนุมัติ (${pendingList.length} ใบ)</div>
          <div style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">
            เมื่อกด <strong>"✍️ วาดลายเซ็นอนุมัติ"</strong> จะเปิดกระดานเซ็นชื่อที่รองรับทั้ง iPad / Tablet / เมาส์ แล้วประทับลายเซ็นลงในใบ PO อัตโนมัติ
          </div>
        </div>
      </div>

      ${pendingList.length === 0 ? `
        <div style="padding:28px; text-align:center; color:var(--text-muted);">
          🎉 ไม่มีรายการใบสั่งซื้อค้างรออนุมัติในขณะนี้
        </div>
      ` : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>เลขที่ PO</th>
                <th>วันที่เปิด PO</th>
                <th>ผู้ขาย (Supplier)</th>
                <th>อ้างอิง PR / ผู้เปิด PR</th>
                <th>รายการที่สั่งซื้อ</th>
                <th style="text-align:right;">ยอดรวมสุทธิ (บาท)</th>
                <th style="text-align:right;">การอนุมัติ (Approval Actions)</th>
              </tr>
            </thead>
            <tbody>
              ${pendingList.map(po => {
                const linkedPr = STATE.prs.find(pr => (po.pr_id && pr.pr_id === po.pr_id) || (po.pr_number && pr.pr_number === po.pr_number));
                return `
                  <tr>
                    <td><strong style="color:var(--primary); cursor:pointer;" onclick="openPoPdfModal(${po.po_id})">${escapeHtml(po.po_number)}</strong></td>
                    <td>${escapeHtml(formatPoDocDate(po.po_date))}</td>
                    <td>
                      <div style="font-weight:700;">${escapeHtml(po.vendor_name_snapshot)}</div>
                      <div style="font-size:12px; color:var(--text-muted);">QT: ${escapeHtml(po.quotation_ref || '-')}</div>
                    </td>
                    <td>
                      ${linkedPr ? `
                        <span class="badge-tag" style="cursor:pointer;" onclick="openPrPdfModal(${linkedPr.pr_id})">🔗 PR: ${escapeHtml(linkedPr.pr_number)}</span>
                        <div style="font-size:11.5px; color:var(--text-muted);">โดย: ${escapeHtml(linkedPr.requester_name)}</div>
                      ` : (po.pr_number || '-')}
                    </td>
                    <td>
                      ${(po.items || []).map(i => `
                        <div style="font-size:12.5px;">• <strong>${escapeHtml(i.item_code_snapshot)}</strong> ${escapeHtml(i.item_name_snapshot)} (${i.quantity} ${escapeHtml(i.unit)} @ ${formatMoney(i.unit_price)} บ.)</div>
                      `).join('')}
                    </td>
                    <td style="text-align:right; font-weight:700; font-size:15px;">${formatMoney(po.grand_total)}</td>
                    <td style="text-align:right;">
                      <div style="display:inline-flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                        <button class="btn btn-sm btn-outline" onclick="openPoPdfModal(${po.po_id})">📄 ตรวจดู PO</button>
                        ${canApprovePo() ? `
                          <button class="btn btn-sm btn-success" onclick="openApproveSignatureModal(${po.po_id})">✍️ วาดลายเซ็นอนุมัติ</button>
                          <button class="btn btn-sm btn-danger" onclick="rejectPoById(${po.po_id})">✕ ตีกลับ</button>
                        ` : `<span style="font-size:12px; color:var(--text-muted);">รอผู้อนุมัติ (Approver)</span>`}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📜 ประวัติการพิจารณาอนุมัติใบสั่งซื้อ (Approved / Rejected History)</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>เลขที่ PO</th>
              <th>วันที่ PO</th>
              <th>ผู้ขาย</th>
              <th>อ้างอิง PR</th>
              <th style="text-align:right;">ยอดรวมทั้งสิ้น</th>
              <th>สถานะ</th>
              <th>ผู้อนุมัติ / เวลาอนุมัติ</th>
              <th style="text-align:right;">ดูเอกสาร PDF</th>
            </tr>
          </thead>
          <tbody>
            ${historyList.map(po => `
              <tr>
                <td><strong style="color:var(--primary); cursor:pointer;" onclick="openPoPdfModal(${po.po_id})">${escapeHtml(po.po_number)}</strong></td>
                <td>${escapeHtml(formatPoDocDate(po.po_date))}</td>
                <td>${escapeHtml(po.vendor_name_snapshot)}</td>
                <td>${escapeHtml(po.pr_number || '-')}</td>
                <td style="text-align:right; font-weight:700;">${formatMoney(po.grand_total)}</td>
                <td>${statusBadgeHtml(po.approval_status)}</td>
                <td style="font-size:12.5px;">
                  ${po.approval_status === 'APPROVED'
                    ? `<strong>${escapeHtml(po.approved_by)}</strong> (${escapeHtml(po.approved_at || '')})`
                    : escapeHtml(po.reject_reason || '-')}
                </td>
                <td style="text-align:right;">
                  <button class="btn btn-sm btn-primary" onclick="openPoPdfModal(${po.po_id})">📄 ดูใบ PO มีลายเซ็น</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==========================================================================
// 10. WMS Warehouse Management System (Receive Lot, Issue, Manual Cycle Count)
// ==========================================================================

function renderWmsPage(container) {
  const normal = isNormalUser();
  const q = STATE.wmsSearch.trim().toLowerCase();

  if (normal) {
    const itemsForStore = STATE.items.filter(it => {
      if (!q) return it.current_stock > 0 || (it.active_lot_count && it.active_lot_count > 0);
      return (
        (it.item_code || '').toLowerCase().includes(q) ||
        (it.item_name || '').toLowerCase().includes(q) ||
        (it.category_name || '').toLowerCase().includes(q)
      );
    }).slice(0, 120);

    const totalItemsInStock = STATE.items.filter(it => Number(it.current_stock || 0) > 0).length;
    const totalUnitsInStore = STATE.wmsLots.reduce((acc, l) => acc + Number(l.remaining_qty || 0), 0);

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card" style="border-left:4px solid var(--primary);">
          <div class="stat-label">รายการสินค้าที่มีของใน Store</div>
          <div class="stat-value">${totalItemsInStock} รายการ</div>
          <div class="stat-sub">จากฐานข้อมูลสินค้าทั้งหมด ${STATE.items.length} รายการ</div>
        </div>
        <div class="stat-card" style="border-left:4px solid var(--success);">
          <div class="stat-label">จำนวน Stock คงค้างรวมใน Store</div>
          <div class="stat-value" style="color:var(--success);">${totalUnitsInStore.toLocaleString('en-US')} ชิ้น</div>
          <div class="stat-sub">ยอดคงเหลือพร้อมเบิกใช้งานในคลัง</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #2563eb; cursor:pointer;" onclick="startNewPrForm()">
          <div class="stat-label">ต้องการขอซื้อสินค้าเพิ่ม?</div>
          <div class="stat-value" style="color:#2563eb; font-size:20px;">+ เปิดใบขอซื้อ (Issue PR)</div>
          <div class="stat-sub">คลิกเพื่อยื่นใบขอซื้อ (FM-PU-01) ให้ฝ่ายจัดซื้อ</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📦 ตรวจสอบจำนวน Stock คงค้างใน Store (Store Stock Balance)</div>
            <div style="font-size:12.5px; color:var(--text-muted);">
              สำหรับแผนกทั่วไปตรวจสอบจำนวนสินค้าคงเหลือในคลัง และกดขอซื้อ (เปิด PR) ได้ทันทีเมื่อสินค้าใกล้หมด
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <input type="text" class="form-control" style="width:280px;" placeholder="🔍 ค้นหารหัสสินค้า, ชื่อสินค้า, หมวดหมู่..."
              value="${escapeHtml(STATE.wmsSearch)}" oninput="STATE.wmsSearch=this.value; renderWmsPage(document.getElementById('app-view'))" />
            <button class="btn btn-primary" onclick="startNewPrForm()">+ เปิดใบขอซื้อใหม่ (Issue PR)</button>
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:60px;">รูปภาพ</th>
                <th>รหัสสินค้า (Item Code)</th>
                <th>รายการสินค้า (Item Name)</th>
                <th>หมวดหมู่</th>
                <th style="text-align:center;">จำนวน Lot ที่มีของ</th>
                <th style="text-align:right;">จำนวน Stock คงค้างใน Store</th>
                <th style="text-align:right;">ขอซื้อเพิ่ม (Issue PR)</th>
              </tr>
            </thead>
            <tbody>
              ${itemsForStore.length === 0 ? `
                <tr><td colspan="7" style="text-align:center; padding:24px; color:var(--text-muted);">ไม่พบรายการสินค้าที่ค้นหา</td></tr>
              ` : itemsForStore.map(it => {
                const imgSrc = it.image_url || it.category_icon_url || '';
                return `
                  <tr>
                    <td>
                      ${imgSrc ? `<img src="${imgSrc}" style="width:38px; height:38px; border-radius:6px; object-fit:cover; border:1px solid var(--border);" />` : '-'}
                    </td>
                    <td><strong style="color:var(--primary);">${escapeHtml(it.item_code)}</strong></td>
                    <td style="font-weight:600;">${escapeHtml(it.item_name)}</td>
                    <td><span class="badge-tag">${escapeHtml(it.category_name || '')}</span></td>
                    <td style="text-align:center;">${it.active_lot_count || 0} Lots</td>
                    <td style="text-align:right; font-weight:700; font-size:15px; color:${it.current_stock > 0 ? 'var(--success)' : 'var(--danger)'};">
                      ${Number(it.current_stock || 0).toLocaleString('en-US')} ${escapeHtml(it.default_unit || 'PCS')}
                    </td>
                    <td style="text-align:right;">
                      <button class="btn btn-sm btn-primary" onclick="startNewPrForm(${it.item_id})">📋 ขอซื้อรายการนี้ (เปิด PR)</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    return;
  }

  const filteredLots = STATE.wmsLots.filter(l => {
    if (!q) return true;
    return (
      (l.lot_number || '').toLowerCase().includes(q) ||
      (l.item_code || '').toLowerCase().includes(q) ||
      (l.item_name || '').toLowerCase().includes(q) ||
      (l.vendor_name_snapshot || '').toLowerCase().includes(q) ||
      (l.po_number_snapshot || '').toLowerCase().includes(q)
    );
  });

  const itemsWithStock = STATE.items.filter(it => {
    if (!q) return it.current_stock > 0 || it.last_unit_price !== null;
    return (
      (it.item_code || '').toLowerCase().includes(q) ||
      (it.item_name || '').toLowerCase().includes(q) ||
      (it.category_name || '').toLowerCase().includes(q)
    );
  }).slice(0, 80);

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card" style="border-left:4px solid var(--primary);">
        <div class="stat-label">จำนวน Lot ในคลังทั้งหมด</div>
        <div class="stat-value">${STATE.wmsLots.length} Lots</div>
        <div class="stat-sub">มีสินค้าคงเหลือ ${STATE.wmsLots.filter(l => l.remaining_qty > 0).length} Lots</div>
      </div>
      <div class="stat-card" style="border-left:4px solid var(--success);">
        <div class="stat-label">จำนวนชิ้นรวมในคลัง (Total Units)</div>
        <div class="stat-value" style="color:var(--success);">
          ${STATE.wmsLots.reduce((acc, l) => acc + Number(l.remaining_qty || 0), 0).toLocaleString('en-US')} ชิ้น
        </div>
        <div class="stat-sub">คำนวณจากยอดคงเหลือทุก Lot</div>
      </div>
      <div class="stat-card" style="border-left:4px solid #6366f1;">
        <div class="stat-label">ประวัติธุรกรรมคลัง (Transactions)</div>
        <div class="stat-value">${STATE.wmsTransactions.length} รายการ</div>
        <div class="stat-sub">รับเข้า / ตัดออก / Cycle Count</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn ${STATE.wmsSubTab === 'lots' ? 'btn-primary' : 'btn-outline'}"
            onclick="STATE.wmsSubTab='lots'; renderWmsPage(document.getElementById('app-view'))">
            📦 สต็อกแยกตาม Lot & Supplier (${STATE.wmsLots.length})
          </button>
          <button class="btn ${STATE.wmsSubTab === 'items' ? 'btn-primary' : 'btn-outline'}"
            onclick="STATE.wmsSubTab='items'; renderWmsPage(document.getElementById('app-view'))">
            🔩 ยอดคงเหลือรวมรายสินค้า & Cycle Count
          </button>
          <button class="btn ${STATE.wmsSubTab === 'history' ? 'btn-primary' : 'btn-outline'}"
            onclick="STATE.wmsSubTab='history'; renderWmsPage(document.getElementById('app-view'))">
            📜 ประวัติรับเข้า-ตัดออก-ตรวจนับสต็อก
          </button>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <input type="text" class="form-control" style="width:240px;" placeholder="🔍 ค้นหา Lot, รหัสสินค้า, Supplier..."
            value="${escapeHtml(STATE.wmsSearch)}" oninput="STATE.wmsSearch=this.value; renderWmsPage(document.getElementById('app-view'))" />
          ${canEditMasterData() ? `
            <button class="btn btn-success" onclick="openWmsInboundModal()">📥 รับเข้า Lot ใหม่</button>
            <button class="btn btn-warning" onclick="openWmsOutboundModal()">📤 ตัดเบิกสินค้า</button>
            <button class="btn btn-primary" onclick="openWmsCycleCountModal()">📋 ทำ Cycle Count ปรับสต็อก</button>
          ` : ''}
        </div>
      </div>

      ${STATE.wmsSubTab === 'lots' ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>เลขที่ Lot</th>
                <th>วันที่รับเข้า</th>
                <th>รหัสสินค้า / ชื่อสินค้า</th>
                <th>Supplier (ผู้ขายของ Lot นี้)</th>
                <th>อ้างอิง PO</th>
                <th>สถานที่เก็บ</th>
                <th style="text-align:right;">รับเข้า (Initial)</th>
                <th style="text-align:right;">คงเหลือ (Remaining)</th>
                <th style="text-align:right;">จัดการคลัง</th>
              </tr>
            </thead>
            <tbody>
              ${filteredLots.map(l => `
                <tr>
                  <td><strong style="color:var(--primary);">${escapeHtml(l.lot_number)}</strong></td>
                  <td>${escapeHtml(formatPoDocDate(l.received_date))}</td>
                  <td>
                    <div style="font-weight:700;">[${escapeHtml(l.item_code)}] ${escapeHtml(l.item_name)}</div>
                    <div style="font-size:11.5px; color:var(--text-muted);">ทุน: ${formatMoney(l.unit_cost)} ฿/${escapeHtml(l.unit)}</div>
                  </td>
                  <td><strong>${escapeHtml(l.vendor_name_snapshot || '-')}</strong></td>
                  <td><span class="badge-tag">${escapeHtml(l.po_number_snapshot || '-')}</span></td>
                  <td>${escapeHtml(l.location || '-')}</td>
                  <td style="text-align:right; font-weight:600;">${Number(l.initial_qty).toLocaleString('en-US')} ${escapeHtml(l.unit)}</td>
                  <td style="text-align:right; font-weight:700; font-size:14.5px; color:${l.remaining_qty > 0 ? 'var(--success)' : 'var(--danger)'};">
                    ${Number(l.remaining_qty).toLocaleString('en-US')} ${escapeHtml(l.unit)}
                  </td>
                  <td style="text-align:right;">
                    ${canEditMasterData() ? `
                      <div style="display:inline-flex; gap:6px;">
                        ${l.remaining_qty > 0 ? `<button class="btn btn-sm btn-outline" onclick="openWmsOutboundModal(${l.lot_id})">📤 ตัดเบิก</button>` : ''}
                        <button class="btn btn-sm btn-outline" onclick="openWmsCycleCountModal(${l.item_id}, ${l.lot_id})">📋 Cycle Count</button>
                      </div>
                    ` : '-'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : STATE.wmsSubTab === 'items' ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>รหัสสินค้า</th>
                <th>ชื่อสินค้า (Item Name)</th>
                <th>หมวดหมู่</th>
                <th style="text-align:right;">จำนวน Lot ที่มีของ</th>
                <th style="text-align:right;">ยอดคงเหลือรวม (Total Stock)</th>
                <th style="text-align:right;">จัดการรับเข้า / ตรวจนับสต็อก</th>
              </tr>
            </thead>
            <tbody>
              ${itemsWithStock.map(it => `
                <tr>
                  <td><strong style="color:var(--primary);">${escapeHtml(it.item_code)}</strong></td>
                  <td style="font-weight:600;">${escapeHtml(it.item_name)}</td>
                  <td><span class="badge-tag">${escapeHtml(it.category_name || '')}</span></td>
                  <td style="text-align:right;">${it.active_lot_count || 0} Lots</td>
                  <td style="text-align:right; font-weight:700; font-size:15px; color:${it.current_stock > 0 ? 'var(--success)' : 'var(--text-muted)'};">
                    ${Number(it.current_stock || 0).toLocaleString('en-US')} ${escapeHtml(it.default_unit || 'PCS')}
                  </td>
                  <td style="text-align:right;">
                    ${canEditMasterData() ? `
                      <button class="btn btn-sm btn-success" onclick="openWmsInboundModal(${it.item_id})">📥 รับเข้า Lot</button>
                      <button class="btn btn-sm btn-primary" onclick="openWmsCycleCountModal(${it.item_id})">📋 ปรับสต็อก (Cycle Count)</button>
                    ` : '-'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>วัน-เวลา</th>
                <th>ประเภทรายการ</th>
                <th>เลขที่ Lot</th>
                <th>สินค้า</th>
                <th>Supplier</th>
                <th style="text-align:right;">ก่อนทำรายการ</th>
                <th style="text-align:right;">เปลี่ยนแปลง</th>
                <th style="text-align:right;">คงเหลือสุทธิ</th>
                <th>เหตุผล / อ้างอิง / ผู้ทำรายการ</th>
              </tr>
            </thead>
            <tbody>
              ${STATE.wmsTransactions.map(tx => {
                const badgeMap = {
                  INBOUND: '<span class="badge badge-APPROVED">📥 รับเข้า (Inbound)</span>',
                  OUTBOUND: '<span class="badge badge-PENDING">📤 ตัดเบิก (Outbound)</span>',
                  CYCLE_COUNT: '<span class="badge badge-tag">📋 ปรับยอด (Cycle Count)</span>'
                };
                const chg = Number(tx.qty_change || 0);
                return `
                  <tr>
                    <td style="font-size:12px;">${escapeHtml(tx.tx_timestamp)}</td>
                    <td>${badgeMap[tx.tx_type] || tx.tx_type}</td>
                    <td><strong>${escapeHtml(tx.lot_number_snapshot)}</strong></td>
                    <td>[${escapeHtml(tx.item_code)}] ${escapeHtml(tx.item_name)}</td>
                    <td>${escapeHtml(tx.vendor_name_snapshot || '-')}</td>
                    <td style="text-align:right;">${tx.qty_before} ${escapeHtml(tx.unit)}</td>
                    <td style="text-align:right; font-weight:700; color:${chg >= 0 ? 'var(--success)' : 'var(--danger)'};">
                      ${chg > 0 ? '+' : ''}${chg} ${escapeHtml(tx.unit)}
                    </td>
                    <td style="text-align:right; font-weight:700;">${tx.qty_after} ${escapeHtml(tx.unit)}</td>
                    <td style="font-size:12px;">
                      <div>${escapeHtml(tx.reason || '')} ${tx.reference_doc ? `(${escapeHtml(tx.reference_doc)})` : ''}</div>
                      <div style="color:var(--text-muted);">โดย: ${escapeHtml(tx.performed_by || '-')}</div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

function openWmsInboundModal(preselectItemId = null) {
  document.getElementById('wms-in-lot').value = STATE.nextLotNumber || 'LOT-20261114-01';
  document.getElementById('wms-in-date').value = new Date().toISOString().slice(0, 10);

  const itemSel = document.getElementById('wms-in-item');
  itemSel.innerHTML = STATE.items.slice(0, 300).map(it => `
    <option value="${it.item_id}" ${Number(preselectItemId) === Number(it.item_id) ? 'selected' : ''}>
      [${escapeHtml(it.item_code)}] ${escapeHtml(it.item_name)} (คงเหลือ: ${it.current_stock} ${escapeHtml(it.default_unit)})
    </option>
  `).join('');

  const vendorSel = document.getElementById('wms-in-vendor');
  vendorSel.innerHTML = STATE.vendors.slice(0, 200).map(v => `
    <option value="${v.vendor_id}">[${escapeHtml(v.vendor_code)}] ${escapeHtml(v.vendor_name)}</option>
  `).join('');

  onWmsInboundItemChange();
  document.getElementById('wms-inbound-modal').classList.add('open');
}

function onWmsInboundItemChange() {
  const itemId = Number(document.getElementById('wms-in-item').value);
  const it = STATE.items.find(x => x.item_id === itemId);
  if (it) {
    document.getElementById('wms-in-unit').value = it.default_unit || 'PCS';
    document.getElementById('wms-in-cost').value = it.last_unit_price || 0;
    if (it.last_vendor_id) {
      document.getElementById('wms-in-vendor').value = it.last_vendor_id;
    }
  }
}

async function submitWmsInbound() {
  const payload = {
    lot_number: document.getElementById('wms-in-lot').value.trim(),
    received_date: document.getElementById('wms-in-date').value,
    item_id: Number(document.getElementById('wms-in-item').value),
    vendor_id: Number(document.getElementById('wms-in-vendor').value),
    quantity: Number(document.getElementById('wms-in-qty').value),
    unit: document.getElementById('wms-in-unit').value.trim() || 'PCS',
    unit_cost: Number(document.getElementById('wms-in-cost').value || 0),
    po_number_snapshot: document.getElementById('wms-in-po').value.trim(),
    location: document.getElementById('wms-in-loc').value.trim(),
    remarks: document.getElementById('wms-in-remarks').value.trim(),
    performed_by: STATE.currentUser?.full_name || 'ฝ่ายจัดซื้อ'
  };
  try {
    await apiFetch('/api/wms/inbound', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('wms-inbound-modal');
    await loadAllData();
    renderCurrentTab();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

function openWmsOutboundModal(preselectLotId = null) {
  const activeLots = STATE.wmsLots.filter(l => l.remaining_qty > 0);
  if (activeLots.length === 0) {
    alert('ไม่มี Lot สินค้าที่มียอดคงเหลือให้ตัดเบิก');
    return;
  }
  const lotSel = document.getElementById('wms-out-lot');
  lotSel.innerHTML = activeLots.map(l => `
    <option value="${l.lot_id}" ${Number(preselectLotId) === Number(l.lot_id) ? 'selected' : ''}>
      [${escapeHtml(l.lot_number)}] ${escapeHtml(l.item_code)} - ${escapeHtml(l.item_name)} | Supplier: ${escapeHtml(l.vendor_name_snapshot)} (เหลือ ${l.remaining_qty} ${escapeHtml(l.unit)})
    </option>
  `).join('');

  onWmsOutboundLotChange();
  document.getElementById('wms-outbound-modal').classList.add('open');
}

function onWmsOutboundLotChange() {
  const lotId = Number(document.getElementById('wms-out-lot').value);
  const lot = STATE.wmsLots.find(l => l.lot_id === lotId);
  if (lot) {
    document.getElementById('wms-out-avail').value = `${lot.remaining_qty} ${lot.unit} (รับเข้าจาก ${lot.vendor_name_snapshot})`;
    document.getElementById('wms-out-qty').max = lot.remaining_qty;
  }
}

async function submitWmsOutbound() {
  const payload = {
    lot_id: Number(document.getElementById('wms-out-lot').value),
    quantity: Number(document.getElementById('wms-out-qty').value),
    reference_doc: document.getElementById('wms-out-ref').value.trim(),
    reason: document.getElementById('wms-out-reason').value.trim(),
    performed_by: STATE.currentUser?.full_name || 'ฝ่ายจัดซื้อ'
  };
  try {
    await apiFetch('/api/wms/outbound', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('wms-outbound-modal');
    await loadAllData();
    renderCurrentTab();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

function openWmsCycleCountModal(preselectItemId = null, preselectLotId = null) {
  const itemSel = document.getElementById('wms-cc-item');
  itemSel.innerHTML = STATE.items.slice(0, 300).map(it => `
    <option value="${it.item_id}" ${Number(preselectItemId) === Number(it.item_id) ? 'selected' : ''}>
      [${escapeHtml(it.item_code)}] ${escapeHtml(it.item_name)} (สต็อกรวม: ${it.current_stock} ${escapeHtml(it.default_unit)})
    </option>
  `).join('');

  onWmsCycleItemChange(preselectLotId);
  document.getElementById('wms-cycle-modal').classList.add('open');
}

function onWmsCycleItemChange(preselectLotId = null) {
  const itemId = Number(document.getElementById('wms-cc-item').value);
  const lotsForItem = STATE.wmsLots.filter(l => Number(l.item_id) === itemId);
  const lotSel = document.getElementById('wms-cc-lot');

  if (lotsForItem.length > 0) {
    lotSel.innerHTML = lotsForItem.map(l => `
      <option value="${l.lot_id}" ${Number(preselectLotId) === Number(l.lot_id) ? 'selected' : ''}>
        Lot: ${escapeHtml(l.lot_number)} | Supplier: ${escapeHtml(l.vendor_name_snapshot)} (ในระบบ: ${l.remaining_qty} ${escapeHtml(l.unit)})
      </option>
    `).join('');
  } else {
    lotSel.innerHTML = `<option value="">-- ยังไม่มี Lot เดิม (ระบบจะสร้าง Lot ปรับยอด Cycle Count ใหม่ให้อัตโนมัติ) --</option>`;
  }
  onWmsCycleLotChange();
}

function onWmsCycleLotChange() {
  const lotId = Number(document.getElementById('wms-cc-lot').value);
  const lot = STATE.wmsLots.find(l => l.lot_id === lotId);
  if (lot) {
    document.getElementById('wms-cc-sys-qty').value = `${lot.remaining_qty} ${lot.unit}`;
    document.getElementById('wms-cc-actual-qty').value = lot.remaining_qty;
  } else {
    document.getElementById('wms-cc-sys-qty').value = '0 PCS';
    document.getElementById('wms-cc-actual-qty').value = 0;
  }
}

async function submitWmsCycleCount() {
  const payload = {
    item_id: Number(document.getElementById('wms-cc-item').value),
    lot_id: document.getElementById('wms-cc-lot').value ? Number(document.getElementById('wms-cc-lot').value) : null,
    counted_qty: Number(document.getElementById('wms-cc-actual-qty').value),
    reason: document.getElementById('wms-cc-reason').value.trim(),
    performed_by: STATE.currentUser?.full_name || 'เจ้าหน้าที่ตรวจนับสต็อก'
  };
  try {
    await apiFetch('/api/wms/cycle-count', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('wms-cycle-modal');
    await loadAllData();
    renderCurrentTab();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// ==========================================================================
// 11. Price History & Comparison Analytics Page
// ==========================================================================

function viewItemHistory(itemId) {
  STATE.selectedHistoryItemId = Number(itemId);
  switchTab('price-history');
}

function shortenVendorNameForChart(name) {
  if (!name) return '-';
  let s = String(name).trim()
    .replace(/^บริษัท\s+/g, 'บจก.')
    .replace(/\s+จำกัด\s*\(มหาชน\)/g, '')
    .replace(/\s+จำกัด/g, '')
    .replace(/\s+CO\.,\s*LTD\.?/gi, '')
    .replace(/\s+COMPANY\s+LIMITED/gi, '')
    .trim();
  if (s.length > 18) {
    s = s.slice(0, 17) + '…';
  }
  return s;
}

function renderPriceHistory(container) {
  const itemIdsWithHistory = new Set(STATE.priceHistory.map(h => h.item_id));
  const sortedItems = [...STATE.items].sort((a, b) => {
    const aHas = itemIdsWithHistory.has(a.item_id) ? 1 : 0;
    const bHas = itemIdsWithHistory.has(b.item_id) ? 1 : 0;
    return bHas - aHas;
  });

  const selectedId = Number(STATE.selectedHistoryItemId || (sortedItems[0] && sortedItems[0].item_id));
  const selectedItem = STATE.items.find(i => i.item_id === selectedId);
  const itemRecords = STATE.priceHistory.filter(h => Number(h.item_id) === selectedId);

  const prices = itemRecords.map(r => Number(r.unit_price));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const lastPrice = prices.length ? prices[prices.length - 1] : 0;
  const firstPrice = prices.length ? prices[0] : 0;
  const changePct = firstPrice > 0 ? (((lastPrice - firstPrice) / firstPrice) * 100).toFixed(1) : '0.0';

  const lastRecord = itemRecords.length ? itemRecords[itemRecords.length - 1] : null;
  const minRecord = itemRecords.length ? itemRecords.reduce((best, r) => Number(r.unit_price) <= Number(best.unit_price) ? r : best, itemRecords[0]) : null;
  const maxRecord = itemRecords.length ? itemRecords.reduce((worst, r) => Number(r.unit_price) >= Number(worst.unit_price) ? r : worst, itemRecords[0]) : null;

  const vendorPalette = ['#1d4ed8', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#dc2626'];
  const byVendor = new Map();
  let colorIdx = 0;
  for (const r of itemRecords) {
    const key = r.vendor_name_snapshot || 'ไม่ระบุ';
    const dateFmt = formatPoDocDate(r.po_date);
    if (!byVendor.has(key)) {
      byVendor.set(key, {
        vendor_name: key,
        color: vendorPalette[colorIdx % vendorPalette.length],
        payment_term: r.payment_term || '',
        orders: 1,
        total_qty: Number(r.quantity),
        min_price: Number(r.unit_price),
        max_price: Number(r.unit_price),
        last_price: Number(r.unit_price),
        dates: [dateFmt],
        pos: [r.po_number]
      });
      colorIdx += 1;
    } else {
      const v = byVendor.get(key);
      v.orders += 1;
      v.total_qty += Number(r.quantity);
      v.min_price = Math.min(v.min_price, Number(r.unit_price));
      v.max_price = Math.max(v.max_price, Number(r.unit_price));
      v.last_price = Number(r.unit_price);
      if (!v.dates.includes(dateFmt)) v.dates.push(dateFmt);
      if (!v.pos.includes(r.po_number)) v.pos.push(r.po_number);
    }
  }

  let svgChartHtml = '';
  if (itemRecords.length > 0) {
    const w = 720, h = 265, padL = 65, padR = 55, padT = 34, padB = 72;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const lo = Math.max(0, minPrice * 0.88);
    const hi = maxPrice * 1.08 || 100;
    const range = Math.max(1, hi - lo);

    const pts = itemRecords.map((r, idx) => {
      const x = itemRecords.length === 1 ? padL + plotW / 2 : padL + (idx / (itemRecords.length - 1)) * plotW;
      const y = padT + plotH - ((Number(r.unit_price) - lo) / range) * plotH;
      const vInfo = byVendor.get(r.vendor_name_snapshot || 'ไม่ระบุ');
      const dotColor = vInfo ? vInfo.color : '#1d4ed8';
      return { x, y, r, dotColor };
    });

    const polylinePoints = pts.map(p => `${p.x},${p.y}`).join(' ');

    const legendHtml = Array.from(byVendor.values()).map(v => `
      <span style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; background:#fff; border:1px solid var(--border); padding:3px 10px; border-radius:99px;">
        <span style="width:10px; height:10px; border-radius:50%; background:${v.color}; display:inline-block;"></span>
        <span>${escapeHtml(v.vendor_name)}</span>
      </span>
    `).join('');

    svgChartHtml = `
      <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; align-items:center;">
        <span style="font-size:12px; color:var(--text-muted); font-weight:600;">ผู้ขายในแต่ละช่วงเวลา:</span>
        ${legendHtml}
      </div>
      <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:265px; background:#f8fafc; border-radius:8px; border:1px solid var(--border);">
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#cbd5e1" stroke-width="1.5" />
        <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#cbd5e1" stroke-width="1.5" />
        ${pts.length > 1 ? `<polyline fill="none" stroke="#1d4ed8" stroke-width="2.5" points="${polylinePoints}" />` : ''}
        ${pts.map(p => `
          <g style="cursor:pointer;" onclick="openPoPdfModal(${p.r.po_id})">
            <title>วันที่: ${formatPoDocDate(p.r.po_date)} | PO: ${p.r.po_number}\nผู้ขาย: ${p.r.vendor_name_snapshot}\nราคา: ${formatMoney(p.r.unit_price)} บาท/${p.r.unit} (จำนวน ${p.r.quantity} ${p.r.unit})</title>
            <circle cx="${p.x}" cy="${p.y}" r="7" fill="${p.dotColor}" stroke="#fff" stroke-width="2" />
            <text x="${p.x}" y="${p.y - 12}" text-anchor="middle" font-size="12" font-weight="bold" fill="#0f172a">${formatMoney(p.r.unit_price)} ฿</text>
            <text x="${p.x}" y="${padT + plotH + 17}" text-anchor="middle" font-size="11" font-weight="600" fill="#334155">${escapeHtml(formatPoDocDate(p.r.po_date))}</text>
            <text x="${p.x}" y="${padT + plotH + 32}" text-anchor="middle" font-size="9.5" fill="#64748b">${escapeHtml(p.r.po_number)}</text>
            <text x="${p.x}" y="${padT + plotH + 48}" text-anchor="middle" font-size="10" font-weight="bold" fill="${p.dotColor}">${escapeHtml(shortenVendorNameForChart(p.r.vendor_name_snapshot))}</text>
          </g>
        `).join('')}
      </svg>
    `;
  } else {
    svgChartHtml = `<div style="padding:40px; text-align:center; color:var(--text-muted); background:#f8fafc; border-radius:8px;">สินค้านี้ยังไม่มีประวัติ PO ที่อนุมัติแล้ว</div>`;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">📈 เลือกสินค้าเพื่อดูแนวโน้มและเปรียบเทียบราคาในแต่ละช่วงเวลา</div>
        <select class="form-control" style="max-width:480px; font-weight:600;"
          onchange="STATE.selectedHistoryItemId = Number(this.value); renderPriceHistory(document.getElementById('app-view'))">
          ${sortedItems.slice(0, 200).map(it => `
            <option value="${it.item_id}" ${it.item_id === selectedId ? 'selected' : ''}>
              ${itemIdsWithHistory.has(it.item_id) ? '★ ' : ''}[${escapeHtml(it.item_code)}] ${escapeHtml(it.item_name)}
              ${it.last_unit_price ? ` (ราคาล่าสุด: ${formatMoney(it.last_unit_price)} บ.)` : ''}
            </option>
          `).join('')}
        </select>
      </div>

      ${selectedItem ? `
        <div class="stats-grid" style="margin-bottom:18px;">
          <div class="stat-card">
            <div class="stat-label">ราคาล่าสุด (Last Approved Price)</div>
            <div class="stat-value" style="color:var(--primary);">${formatMoney(lastPrice)} ฿ / ${escapeHtml(selectedItem.default_unit || 'PCS')}</div>
            <div class="stat-sub">
              ผู้ขายล่าสุด: <strong>${escapeHtml(lastRecord ? lastRecord.vendor_name_snapshot : '-')}</strong>
              ${lastRecord ? ` (${escapeHtml(formatPoDocDate(lastRecord.po_date))})` : ''}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-label">ราคาต่ำสุดที่เคยซื้อ (Best / Min Price)</div>
            <div class="stat-value" style="color:var(--success);">${formatMoney(minPrice)} ฿</div>
            <div class="stat-sub">
              ซื้อจาก: <strong>${escapeHtml(minRecord ? minRecord.vendor_name_snapshot : '-')}</strong>
              <div style="font-size:11px; color:var(--text-muted);">ราคาสูงสุด: ${formatMoney(maxPrice)} ฿ (${escapeHtml(maxRecord ? shortenVendorNameForChart(maxRecord.vendor_name_snapshot) : '-')})</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-label">ราคาเฉลี่ยทุกงวด (Average Price)</div>
            <div class="stat-value">${formatMoney(avgPrice)} ฿</div>
            <div class="stat-sub">จากประวัติสั่งซื้อ ${itemRecords.length} ครั้ง (${byVendor.size} ผู้ขาย)</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">การเปลี่ยนแปลงราคา (เทียบครั้งแรก)</div>
            <div class="stat-value" style="color:${Number(changePct) <= 0 ? 'var(--success)' : 'var(--danger)'};">
              ${Number(changePct) > 0 ? '+' : ''}${changePct}%
            </div>
            <div class="stat-sub">${Number(changePct) <= 0 ? 'ประหยัดต้นทุนลง' : 'ราคาปรับตัวสูงขึ้น'}</div>
          </div>
        </div>

        <div class="form-grid">
          <div class="col-7">
            <h4 style="margin-bottom:8px;">กราฟเปรียบเทียบราคาต่อหน่วยตามช่วงเวลา และผู้ขายในแต่ละงวด (Price Trend & Vendor by Period)</h4>
            ${svgChartHtml}

            ${itemRecords.length > 0 ? `
              <div style="margin-top:14px;">
                <h4 style="margin-bottom:8px; font-size:13.5px; color:#334155;">🗓️ รายละเอียดการซื้อแต่ละช่วงเวลาของสินค้า [${escapeHtml(selectedItem.item_code)}] ${escapeHtml(selectedItem.item_name)}</h4>
                <div class="table-wrap">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th style="width:55px; text-align:center;">ครั้งที่</th>
                        <th>ช่วงวันที่ซื้อ</th>
                        <th>เลขที่ PO</th>
                        <th>ซื้อมาจากผู้ขาย (Vendor / Supplier)</th>
                        <th style="text-align:right;">จำนวน</th>
                        <th style="text-align:right;">ราคา/หน่วย</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itemRecords.map((r, idx) => {
                        const vInfo = byVendor.get(r.vendor_name_snapshot || 'ไม่ระบุ');
                        const dotColor = vInfo ? vInfo.color : '#1d4ed8';
                        const prevPrice = idx > 0 ? Number(itemRecords[idx - 1].unit_price) : null;
                        const currPrice = Number(r.unit_price);
                        let diffBadge = '';
                        if (prevPrice !== null) {
                          const d = currPrice - prevPrice;
                          if (Math.abs(d) < 0.005) {
                            diffBadge = `<span style="font-size:11px; color:var(--text-muted); margin-left:4px;">(เท่าเดิม)</span>`;
                          } else if (d < 0) {
                            diffBadge = `<span style="font-size:11px; color:var(--success); font-weight:700; margin-left:4px;">(${formatMoney(d)})</span>`;
                          } else {
                            diffBadge = `<span style="font-size:11px; color:var(--danger); font-weight:700; margin-left:4px;">(+${formatMoney(d)})</span>`;
                          }
                        }
                        return `
                          <tr>
                            <td style="text-align:center; font-weight:700;">#${idx + 1}</td>
                            <td style="font-weight:600;">${escapeHtml(formatPoDocDate(r.po_date))}</td>
                            <td>
                              <strong style="color:var(--primary); cursor:pointer;" onclick="openPoPdfModal(${r.po_id})">${escapeHtml(r.po_number)}</strong>
                            </td>
                            <td>
                              <span style="display:inline-flex; align-items:center; gap:6px; font-weight:700;">
                                <span style="width:9px; height:9px; border-radius:50%; background:${dotColor}; display:inline-block;"></span>
                                <span>${escapeHtml(r.vendor_name_snapshot)}</span>
                              </span>
                            </td>
                            <td style="text-align:right;">${r.quantity} ${escapeHtml(r.unit)}</td>
                            <td style="text-align:right; font-weight:700; color:var(--primary);">
                              ${formatMoney(r.unit_price)} ฿${diffBadge}
                            </td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}
          </div>
          <div class="col-5">
            <h4 style="margin-bottom:10px;">เปรียบเทียบราคาแยกตามผู้ขาย (Supplier Comparison)</h4>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>ผู้ขาย (Vendor) & ช่วงวันที่ซื้อ</th>
                    <th style="text-align:right;">ราคาต่ำสุด</th>
                    <th style="text-align:right;">ราคาล่าสุด</th>
                    <th>เครดิต</th>
                  </tr>
                </thead>
                <tbody>
                  ${Array.from(byVendor.values()).length === 0 ? `
                    <tr><td colspan="4" style="text-align:center; color:var(--text-muted);">ยังไม่มีข้อมูล</td></tr>
                  ` : Array.from(byVendor.values()).map(v => `
                    <tr>
                      <td>
                        <div style="font-weight:700; display:flex; align-items:center; gap:6px;">
                          <span style="width:10px; height:10px; border-radius:50%; background:${v.color}; display:inline-block; flex-shrink:0;"></span>
                          <span>${escapeHtml(v.vendor_name)}</span>
                        </div>
                        <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
                          สั่งซื้อ ${v.orders} ครั้ง (รวม ${v.total_qty} ชิ้น)
                        </div>
                        <div style="font-size:11px; color:#1d4ed8; margin-top:2px;">
                          📅 ช่วงที่ซื้อ: ${escapeHtml(v.dates.join(', '))}
                        </div>
                      </td>
                      <td style="text-align:right; color:var(--success); font-weight:700;">${formatMoney(v.min_price)}</td>
                      <td style="text-align:right; font-weight:700;">${formatMoney(v.last_price)}</td>
                      <td style="font-size:12px;">${escapeHtml(v.payment_term)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📋 ตารางประวัติการสั่งซื้อที่อนุมัติแล้วทั้งหมด (Approved Purchase Price Log)</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>วันที่ PO</th>
              <th>เลขที่ PO</th>
              <th>รหัสสินค้า</th>
              <th>รายการสินค้า (Item Name)</th>
              <th>ผู้ขาย (Supplier)</th>
              <th style="text-align:right;">จำนวน</th>
              <th style="text-align:right;">ราคา/หน่วย (บาท)</th>
              <th style="text-align:right;">จำนวนเงินรวม</th>
            </tr>
          </thead>
          <tbody>
            ${[...STATE.priceHistory].reverse().map(r => `
              <tr>
                <td>${escapeHtml(formatPoDocDate(r.po_date))}</td>
                <td><strong style="color:var(--primary); cursor:pointer;" onclick="openPoPdfModal(${r.po_id})">${escapeHtml(r.po_number)}</strong></td>
                <td><span class="badge-tag" style="cursor:pointer;" onclick="viewItemHistory(${r.item_id})">${escapeHtml(r.item_code_snapshot)}</span></td>
                <td style="font-weight:600;">${escapeHtml(r.item_name_snapshot)}</td>
                <td><strong>${escapeHtml(r.vendor_name_snapshot)}</strong></td>
                <td style="text-align:right;">${r.quantity} ${escapeHtml(r.unit)}</td>
                <td style="text-align:right; font-weight:700; color:var(--primary);">${formatMoney(r.unit_price)}</td>
                <td style="text-align:right; font-weight:600;">${formatMoney(r.line_total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==========================================================================
// 12. Items Master Data Page (Role-Aware CRUD + WMS Stock Display)
// ==========================================================================

function renderItemsMaster(container) {
  const q = STATE.itemSearch.trim().toLowerCase();
  const filtered = STATE.items.filter(it => {
    if (STATE.itemCategoryFilter !== 'ALL' && String(it.category_id) !== String(STATE.itemCategoryFilter)) return false;
    if (q) {
      return (
        (it.item_code || '').toLowerCase().includes(q) ||
        (it.item_name || '').toLowerCase().includes(q) ||
        (it.category_name || '').toLowerCase().includes(q) ||
        (it.pic_engineer || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pageSize = 40;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (STATE.itemPage > totalPages) STATE.itemPage = 1;
  const slice = filtered.slice((STATE.itemPage - 1) * pageSize, STATE.itemPage * pageSize);

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">🔩 ข้อมูลสินค้าและอะไหล่ (Items Master Data — ทั้งหมด ${STATE.items.length} รายการ)</div>
          <div style="font-size:12.5px; color:var(--text-muted);">แสดงยอดคงเหลือในคลัง WMS และราคาล่าสุด</div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input type="text" class="form-control" style="width:250px;" placeholder="🔍 ค้นหารหัสสินค้า, ชื่อสินค้า..."
            value="${escapeHtml(STATE.itemSearch)}" oninput="STATE.itemSearch=this.value; STATE.itemPage=1; renderItemsMaster(document.getElementById('app-view'))" />
          <select class="form-control" style="width:200px;" onchange="STATE.itemCategoryFilter=this.value; STATE.itemPage=1; renderItemsMaster(document.getElementById('app-view'))">
            <option value="ALL">ทุกหมวดหมู่ (18 หมวด)</option>
            ${STATE.categories.map(c => `
              <option value="${c.category_id}" ${String(STATE.itemCategoryFilter) === String(c.category_id) ? 'selected' : ''}>
                [${escapeHtml(c.category_code)}] ${escapeHtml(c.category_name)}
              </option>
            `).join('')}
          </select>
          ${canEditMasterData() ? `<button class="btn btn-primary" onclick="openItemModal()">+ เพิ่มสินค้าใหม่ (Add Item)</button>` : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:60px;">Picture</th>
              <th>Item Code</th>
              <th>หมวดหมู่</th>
              <th>ชื่อและรายละเอียดสินค้า (Item Name)</th>
              <th>ผู้ดูแล (PIC)</th>
              <th style="text-align:right;">สต็อกคงเหลือ (WMS)</th>
              <th style="text-align:right;">ราคาล่าสุด/หน่วย</th>
              <th style="text-align:right;">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${slice.map(it => `
              <tr>
                <td>
                  <img src="${it.image_url || it.category_icon_url || ''}" alt="${escapeHtml(it.item_code)}"
                    style="width:40px; height:40px; border-radius:8px; object-fit:cover; border:1px solid var(--border);" />
                </td>
                <td><strong style="color:var(--primary);">${escapeHtml(it.item_code)}</strong></td>
                <td><span class="badge-tag">${escapeHtml(it.category_name || '')}</span></td>
                <td style="font-weight:600;">${escapeHtml(it.item_name)}</td>
                <td>${escapeHtml(it.pic_engineer || 'วิศวกร Tooling')}</td>
                <td style="text-align:right; font-weight:700; color:${it.current_stock > 0 ? 'var(--primary)' : 'var(--text-muted)'};">
                  ${Number(it.current_stock || 0).toLocaleString('en-US')} ${escapeHtml(it.default_unit || 'PCS')}
                </td>
                <td style="text-align:right; font-weight:700; color:${it.last_unit_price ? 'var(--success)' : 'var(--text-muted)'};">
                  ${it.last_unit_price !== null && it.last_unit_price !== undefined ? formatMoney(it.last_unit_price) + ' ฿' : '-'}
                </td>
                <td style="text-align:right;">
                  ${canEditMasterData() ? `
                    <button class="btn btn-sm btn-outline" onclick="openItemModal(${it.item_id})">✏️ แก้ไข</button>
                    <button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="deleteItemById(${it.item_id})">🗑️ ลบ</button>
                  ` : `<span style="font-size:12px; color:var(--text-muted);">ดูข้อมูล</span>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px;">
        <div style="font-size:13px; color:var(--text-muted);">
          แสดง ${slice.length} รายการ จากทั้งหมด ${filtered.length} รายการ (หน้า ${STATE.itemPage} / ${totalPages})
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-sm btn-outline" ${STATE.itemPage <= 1 ? 'disabled' : ''} onclick="STATE.itemPage--; renderItemsMaster(document.getElementById('app-view'))">‹ ก่อนหน้า</button>
          <button class="btn btn-sm btn-outline" ${STATE.itemPage >= totalPages ? 'disabled' : ''} onclick="STATE.itemPage++; renderItemsMaster(document.getElementById('app-view'))">ถัดไป ›</button>
        </div>
      </div>
    </div>
  `;
}

async function openItemModal(itemId = null, quickSelectRowIdx = null) {
  closeAllDropdownPanels();
  const catSelect = document.getElementById('item-form-category');
  catSelect.innerHTML = STATE.categories.map(c => `<option value="${c.category_id}">[${escapeHtml(c.category_code)}] ${escapeHtml(c.category_name)}</option>`).join('');
  document.getElementById('item-form-quick-row-idx').value = quickSelectRowIdx !== null && quickSelectRowIdx !== undefined ? String(quickSelectRowIdx) : '';
  document.getElementById('item-form-file').value = '';

  if (itemId) {
    const it = STATE.items.find(x => x.item_id === itemId);
    if (!it) return;
    document.getElementById('item-modal-title').textContent = `แก้ไขข้อมูลสินค้า: ${it.item_code}`;
    document.getElementById('item-form-id').value = it.item_id;
    catSelect.value = it.category_id;
    document.getElementById('item-form-code').value = it.item_code;
    document.getElementById('item-form-name').value = it.item_name;
    document.getElementById('item-form-unit').value = it.default_unit || 'PCS';
    document.getElementById('item-form-pic').value = it.pic_engineer || 'วิศวกร Tooling';
    document.getElementById('item-form-price').value = it.last_unit_price !== null ? it.last_unit_price : '';
    STATE.itemModalImageBase64 = it.image_url || it.category_icon_url || '';
    document.getElementById('item-form-img-preview').src = STATE.itemModalImageBase64;
  } else {
    document.getElementById('item-modal-title').textContent = 'เพิ่มรายการสินค้าใหม่ (Add New Item)';
    document.getElementById('item-form-id').value = '';
    catSelect.value = STATE.categories[0]?.category_id || 1;
    document.getElementById('item-form-name').value = '';
    document.getElementById('item-form-unit').value = 'PCS';
    document.getElementById('item-form-pic').value = 'วิศวกร Tooling';
    document.getElementById('item-form-price').value = '';
    await onItemCategoryModalChange(true);
  }

  document.getElementById('item-modal').classList.add('open');
}

async function onItemCategoryModalChange(forceNewCode = false) {
  const catId = Number(document.getElementById('item-form-category').value);
  const cat = STATE.categories.find(c => c.category_id === catId);
  const idVal = document.getElementById('item-form-id').value;
  if (!idVal || forceNewCode) {
    const res = await apiFetch(`/api/items/next-code?category_id=${catId}`);
    document.getElementById('item-form-code').value = res.next_code;
  }
  if (!idVal && cat) {
    STATE.itemModalImageBase64 = cat.icon_url || '';
    document.getElementById('item-form-img-preview').src = STATE.itemModalImageBase64;
  }
}

function onItemImageUpload(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    STATE.itemModalImageBase64 = reader.result;
    document.getElementById('item-form-img-preview').src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveItemModal() {
  const itemId = document.getElementById('item-form-id').value;
  const quickRowIdx = document.getElementById('item-form-quick-row-idx').value;
  const payload = {
    category_id: Number(document.getElementById('item-form-category').value),
    item_code: document.getElementById('item-form-code').value.trim(),
    item_name: document.getElementById('item-form-name').value.trim(),
    default_unit: document.getElementById('item-form-unit').value.trim() || 'PCS',
    pic_engineer: document.getElementById('item-form-pic').value.trim() || 'วิศวกร Tooling',
    last_unit_price: document.getElementById('item-form-price').value,
    image_url: STATE.itemModalImageBase64
  };
  if (!payload.item_name) {
    alert('กรุณากรอกชื่อสินค้า (Item Name)');
    return;
  }

  try {
    let saved;
    if (itemId) {
      saved = await apiFetch(`/api/items/${itemId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      saved = await apiFetch('/api/items', { method: 'POST', body: JSON.stringify(payload) });
    }
    await loadAllData();
    closeModal('item-modal');

    if (quickRowIdx !== '' && STATE.currentTab === 'create-po') {
      selectItemForPoRow(Number(quickRowIdx), saved.item_id);
    } else {
      renderCurrentTab();
    }
  } catch (err) {
    alert('ไม่สามารถบันทึกสินค้าได้: ' + err.message);
  }
}

async function deleteItemById(itemId) {
  if (!confirm('ยืนยันการลบรายการสินค้านี้?')) return;
  await apiFetch(`/api/items/${itemId}`, { method: 'DELETE' });
  await loadAllData();
  renderCurrentTab();
}

// ==========================================================================
// 13. Vendors Master Data Page (Role-Aware CRUD + M:N Tags)
// ==========================================================================

function renderVendorsMaster(container) {
  const q = STATE.vendorSearch.trim().toLowerCase();
  const filtered = STATE.vendors.filter(v => {
    if (STATE.vendorTagFilter !== 'ALL' && !(v.tags || []).includes(STATE.vendorTagFilter)) return false;
    if (q) {
      return (
        (v.vendor_code || '').toLowerCase().includes(q) ||
        (v.vendor_name || '').toLowerCase().includes(q) ||
        (v.contact_name || '').toLowerCase().includes(q) ||
        (v.tel || '').toLowerCase().includes(q) ||
        (v.description || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pageSize = 35;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (STATE.vendorPage > totalPages) STATE.vendorPage = 1;
  const slice = filtered.slice((STATE.vendorPage - 1) * pageSize, STATE.vendorPage * pageSize);

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">🏭 ข้อมูลผู้ขาย (Vendors / Suppliers Master Data — ทั้งหมด ${STATE.vendors.length} ราย)</div>
          <div style="font-size:12.5px; color:var(--text-muted);">รองรับการแยกหมวดหมู่แบบ M:N Tags และดึงข้อมูลอัตโนมัติเมื่อเปิดใบสั่งซื้อ</div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input type="text" class="form-control" style="width:250px;" placeholder="🔍 ค้นหารหัส, ชื่อบริษัท, ผู้ติดต่อ..."
            value="${escapeHtml(STATE.vendorSearch)}" oninput="STATE.vendorSearch=this.value; STATE.vendorPage=1; renderVendorsMaster(document.getElementById('app-view'))" />
          <select class="form-control" style="width:190px;" onchange="STATE.vendorTagFilter=this.value; STATE.vendorPage=1; renderVendorsMaster(document.getElementById('app-view'))">
            <option value="ALL">ทุกหมวดหมู่ (All Tags)</option>
            ${STATE.vendorTags.map(t => `
              <option value="${escapeHtml(t.tag_name)}" ${STATE.vendorTagFilter === t.tag_name ? 'selected' : ''}>
                ${escapeHtml(t.tag_name)}
              </option>
            `).join('')}
          </select>
          ${canEditMasterData() ? `<button class="btn btn-primary" onclick="openVendorModal()">+ เพิ่มผู้ขายใหม่ (Add Vendor)</button>` : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>รหัสผู้ขาย</th>
              <th>ชื่อบริษัทผู้ขาย / ที่อยู่</th>
              <th>หมวดหมู่ (Tags)</th>
              <th>ผู้ติดต่อ / โทรศัพท์ / Email</th>
              <th>เครดิต</th>
              <th style="text-align:right;">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${slice.map(v => `
              <tr>
                <td><strong style="color:var(--primary);">${escapeHtml(v.vendor_code)}</strong></td>
                <td>
                  <div style="font-weight:700;">${escapeHtml(v.vendor_name)}</div>
                  <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(v.address || '-')}</div>
                  ${v.description ? `<div style="font-size:11.5px; color:#475569;">สินค้า: ${escapeHtml(v.description)}</div>` : ''}
                </td>
                <td>
                  <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    ${(v.tags || []).map(t => `<span class="badge-tag">${escapeHtml(t)}</span>`).join('')}
                  </div>
                </td>
                <td style="font-size:12.5px;">
                  <div>👤 ${escapeHtml(v.contact_name || '-')}</div>
                  <div>📞 ${escapeHtml(v.tel || v.mobile || '-')} ${v.fax ? `| Fax: ${escapeHtml(v.fax)}` : ''}</div>
                  ${v.email ? `<div>✉️ ${escapeHtml(v.email)}</div>` : ''}
                </td>
                <td><span class="badge badge-DRAFT">${escapeHtml(v.default_payment_term || 'CREDIT 30 DAYS')}</span></td>
                <td style="text-align:right;">
                  ${canEditMasterData() ? `
                    <button class="btn btn-sm btn-outline" onclick="openVendorModal(${v.vendor_id})">✏️ แก้ไข</button>
                    <button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="deleteVendorById(${v.vendor_id})">🗑️ ลบ</button>
                  ` : `<span style="font-size:12px; color:var(--text-muted);">ดูข้อมูล</span>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px;">
        <div style="font-size:13px; color:var(--text-muted);">
          แสดง ${slice.length} รายการ จากทั้งหมด ${filtered.length} รายการ (หน้า ${STATE.vendorPage} / ${totalPages})
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-sm btn-outline" ${STATE.vendorPage <= 1 ? 'disabled' : ''} onclick="STATE.vendorPage--; renderVendorsMaster(document.getElementById('app-view'))">‹ ก่อนหน้า</button>
          <button class="btn btn-sm btn-outline" ${STATE.vendorPage >= totalPages ? 'disabled' : ''} onclick="STATE.vendorPage++; renderVendorsMaster(document.getElementById('app-view'))">ถัดไป ›</button>
        </div>
      </div>
    </div>
  `;
}

function openVendorModal(vendorId = null) {
  const tagsWrap = document.getElementById('vendor-form-tags-wrap');
  let selectedTags = [];

  if (vendorId) {
    const v = STATE.vendors.find(x => x.vendor_id === vendorId);
    if (!v) return;
    document.getElementById('vendor-modal-title').textContent = `แก้ไขข้อมูลผู้ขาย: ${v.vendor_code}`;
    document.getElementById('vendor-form-id').value = v.vendor_id;
    document.getElementById('vendor-form-code').value = v.vendor_code || '';
    document.getElementById('vendor-form-name').value = v.vendor_name || '';
    document.getElementById('vendor-form-address').value = v.address || '';
    document.getElementById('vendor-form-tel').value = v.tel || '';
    document.getElementById('vendor-form-fax').value = v.fax || '';
    document.getElementById('vendor-form-mobile').value = v.mobile || '';
    document.getElementById('vendor-form-contact').value = v.contact_name || '';
    document.getElementById('vendor-form-email').value = v.email || '';
    document.getElementById('vendor-form-payment').value = v.default_payment_term || 'CREDIT 30 DAYS';
    document.getElementById('vendor-form-desc').value = v.description || '';
    selectedTags = v.tags || [];
  } else {
    document.getElementById('vendor-modal-title').textContent = 'เพิ่มข้อมูลผู้ขายใหม่ (Add Supplier / Vendor)';
    document.getElementById('vendor-form-id').value = '';
    document.getElementById('vendor-form-code').value = STATE.nextVendorCode || '412/2569';
    document.getElementById('vendor-form-name').value = '';
    document.getElementById('vendor-form-address').value = '';
    document.getElementById('vendor-form-tel').value = '';
    document.getElementById('vendor-form-fax').value = '';
    document.getElementById('vendor-form-mobile').value = '';
    document.getElementById('vendor-form-contact').value = '';
    document.getElementById('vendor-form-email').value = '';
    document.getElementById('vendor-form-payment').value = 'CREDIT 30 DAYS';
    document.getElementById('vendor-form-desc').value = '';
    selectedTags = ['Tools'];
  }

  tagsWrap.innerHTML = STATE.vendorTags.map(t => `
    <label style="display:inline-flex; align-items:center; gap:5px; padding:4px 10px; background:#fff; border:1px solid var(--border-strong); border-radius:6px; cursor:pointer; font-size:12.5px;">
      <input type="checkbox" class="vendor-tag-checkbox" value="${escapeHtml(t.tag_name)}" ${selectedTags.includes(t.tag_name) ? 'checked' : ''} />
      <span>${escapeHtml(t.tag_name)}</span>
    </label>
  `).join('');

  document.getElementById('vendor-modal').classList.add('open');
}

async function saveVendorModal() {
  const vendorId = document.getElementById('vendor-form-id').value;
  const checkedTags = Array.from(document.querySelectorAll('.vendor-tag-checkbox:checked')).map(el => el.value);

  const payload = {
    vendor_code: document.getElementById('vendor-form-code').value.trim(),
    vendor_name: document.getElementById('vendor-form-name').value.trim(),
    address: document.getElementById('vendor-form-address').value.trim(),
    tel: document.getElementById('vendor-form-tel').value.trim(),
    fax: document.getElementById('vendor-form-fax').value.trim(),
    mobile: document.getElementById('vendor-form-mobile').value.trim(),
    contact_name: document.getElementById('vendor-form-contact').value.trim(),
    email: document.getElementById('vendor-form-email').value.trim(),
    default_payment_term: document.getElementById('vendor-form-payment').value.trim() || 'CREDIT 30 DAYS',
    description: document.getElementById('vendor-form-desc').value.trim(),
    tags: checkedTags
  };

  if (!payload.vendor_name) {
    alert('กรุณาระบุชื่อบริษัทผู้ขาย');
    return;
  }

  try {
    let saved;
    if (vendorId) {
      saved = await apiFetch(`/api/vendors/${vendorId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      saved = await apiFetch('/api/vendors', { method: 'POST', body: JSON.stringify(payload) });
    }
    await loadAllData();
    closeModal('vendor-modal');
    if (STATE.currentTab === 'create-po' && saved) {
      selectVendorForPo(saved.vendor_id);
    } else {
      renderCurrentTab();
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึกผู้ขาย: ' + err.message);
  }
}

async function deleteVendorById(vendorId) {
  if (!confirm('ยืนยันการลบข้อมูลผู้ขายรายนี้?')) return;
  await apiFetch(`/api/vendors/${vendorId}`, { method: 'DELETE' });
  await loadAllData();
  renderCurrentTab();
}

// ==========================================================================
// 14. User Management Page (Role: Admin Only)
// ==========================================================================

function renderUsersAdminPage(container) {
  if (!isAdmin()) {
    container.innerHTML = `<div class="card">เฉพาะผู้ดูแลระบบ (Role: Admin) เท่านั้นที่เข้าถึงหน้านี้ได้</div>`;
    return;
  }

  const roleDesc = {
    ADMIN: '👑 1. Admin — ใช้งานและแก้ไขได้ทุกส่วนในระบบ + สร้าง/จัดการ User',
    APPROVER: '✍️ 2. Approver — อนุมัติ PO (วาดลายเซ็น) และเปิดดูรายละเอียด PR, PO, รายการทั้งหมด',
    PURCHASING: '🛒 3. Purchasing — เปิด PR/PO, ลงทะเบียนและแก้ไข Vendor List, Item List และจัดการคลัง WMS',
    NORMAL_USER: '👤 4. Normal User — สำหรับแผนกทั่วไป: เปิด PR, ดูประวัติ PR และดูจำนวน Stock คงค้างใน Store เท่านั้น'
  };

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">👥 จัดการบัญชีผู้ใช้งานและกำหนดสิทธิ์ (User & Role Management — Admin Only)</div>
          <div style="font-size:12.5px; color:var(--text-muted);">สร้างบัญชีผู้ใช้งานและกำหนดสิทธิ์ตามโครงสร้างองค์กร หรือดาวน์โหลดฐานข้อมูลเพื่อย้ายไปติดตั้งบน Server ลูกค้า</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <a href="/api/admin/export-db" download="nes_po.db" class="btn btn-outline" style="text-decoration:none;">
            💾 ดาวน์โหลดฐานข้อมูล nes_po.db (สำหรับลง Server ลูกค้า)
          </a>
          <button class="btn btn-primary" onclick="openUserModal()">+ สร้างผู้ใช้งานใหม่ (Create User)</button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>ชื่อ - นามสกุล</th>
              <th>บทบาทและขอบเขตสิทธิ์ (Role)</th>
              <th>แผนก (Department)</th>
              <th>อีเมล</th>
              <th style="text-align:right;">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${STATE.users.map(u => `
              <tr>
                <td>#${u.user_id}</td>
                <td><strong style="color:var(--primary);">${escapeHtml(u.username)}</strong></td>
                <td style="font-weight:700;">${escapeHtml(u.full_name)}</td>
                <td><span class="badge badge-tag">${escapeHtml(roleDesc[u.role] || u.role)}</span></td>
                <td>${escapeHtml(u.department || '-')}</td>
                <td>${escapeHtml(u.email || '-')}</td>
                <td style="text-align:right;">
                  <button class="btn btn-sm btn-outline" onclick="openUserModal(${u.user_id})">✏️ แก้ไข / รีเซ็ตรหัส</button>
                  <button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="deleteUserById(${u.user_id})">🗑️ ลบ</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openUserModal(userId = null) {
  if (!isAdmin()) return;
  if (userId) {
    const u = STATE.users.find(x => x.user_id === userId);
    if (!u) return;
    document.getElementById('user-modal-title').textContent = `แก้ไขผู้ใช้งาน: ${u.username}`;
    document.getElementById('user-form-id').value = u.user_id;
    document.getElementById('user-form-username').value = u.username;
    document.getElementById('user-form-password').value = '';
    document.getElementById('user-form-password').placeholder = 'เว้นว่างไว้หากไม่ต้องการเปลี่ยนรหัสผ่าน';
    document.getElementById('user-form-fullname').value = u.full_name;
    document.getElementById('user-form-role').value = u.role;
    document.getElementById('user-form-dept').value = u.department || '';
    document.getElementById('user-form-email').value = u.email || '';
  } else {
    document.getElementById('user-modal-title').textContent = 'สร้างบัญชีผู้ใช้งานใหม่ (Create New User)';
    document.getElementById('user-form-id').value = '';
    document.getElementById('user-form-username').value = '';
    document.getElementById('user-form-password').value = '1234';
    document.getElementById('user-form-password').placeholder = 'ระบุรหัสผ่าน';
    document.getElementById('user-form-fullname').value = '';
    document.getElementById('user-form-role').value = 'PURCHASING';
    document.getElementById('user-form-dept').value = 'แผนกจัดซื้อ';
    document.getElementById('user-form-email').value = '';
  }
  document.getElementById('user-modal').classList.add('open');
}

async function saveUserModal() {
  const userId = document.getElementById('user-form-id').value;
  const payload = {
    actor_role: getUserRole(),
    username: document.getElementById('user-form-username').value.trim(),
    password: document.getElementById('user-form-password').value,
    full_name: document.getElementById('user-form-fullname').value.trim(),
    role: document.getElementById('user-form-role').value,
    department: document.getElementById('user-form-dept').value.trim(),
    email: document.getElementById('user-form-email').value.trim()
  };

  try {
    if (userId) {
      await apiFetch(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('user-modal');
    await loadAllData();
    renderCurrentTab();
  } catch (err) {
    alert('ไม่สามารถบันทึกผู้ใช้ได้: ' + err.message);
  }
}

async function deleteUserById(userId) {
  if (!confirm('ยืนยันการลบบัญชีผู้ใช้งานนี้?')) return;
  try {
    await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
    await loadAllData();
    renderCurrentTab();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// ==========================================================================
// 15. PO Document Template Settings Page
// ==========================================================================

function renderDocumentSettings(container) {
  const s = STATE.settings || {};

  container.innerHTML = `
    <div class="form-grid">
      <div class="col-6">
        <div class="card">
          <div class="card-header">
            <div class="card-title">⚙️ แก้ไขข้อมูลบนหน้าเอกสารออก PO (FM-PU-02 Template)</div>
            <button class="btn btn-primary" onclick="saveDocumentSettings()">💾 บันทึกการตั้งค่าเอกสาร</button>
          </div>

          <div class="form-grid">
            <div class="form-group col-12" style="padding-bottom:12px; border-bottom:1px solid var(--border);">
              <label class="form-label">1. Logo บริษัท (Company Logo)</label>
              <div style="display:flex; align-items:center; gap:14px;">
                <img id="set-logo-preview" src="${s.company_logo || ''}" alt="Logo"
                  style="width:110px; height:64px; object-fit:contain; border:1px solid var(--border); border-radius:8px; padding:4px; background:#fff;" />
                <div style="flex:1;">
                  <input type="file" accept="image/*" class="form-control" onchange="onSettingsLogoUpload(event)" />
                  <div style="margin-top:6px;">
                    <button class="btn btn-sm btn-outline" onclick="resetDefaultLogo()">↺ ใช้โลโก้ N.E.S ต้นฉบับ</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="form-group col-12">
              <label class="form-label">2. ชื่อบริษัท (Company Name)</label>
              <input type="text" class="form-control" id="set-company-name" value="${escapeHtml(s.company_name)}" oninput="refreshSettingsLivePreview()" />
            </div>
            <div class="form-group col-12">
              <label class="form-label">ที่อยู่บริษัท (Address)</label>
              <input type="text" class="form-control" id="set-company-address" value="${escapeHtml(s.company_address)}" oninput="refreshSettingsLivePreview()" />
            </div>
            <div class="form-group col-4">
              <label class="form-label">เบอร์โทรศัพท์ (Tel.)</label>
              <input type="text" class="form-control" id="set-company-tel" value="${escapeHtml(s.company_tel)}" oninput="refreshSettingsLivePreview()" />
            </div>
            <div class="form-group col-4">
              <label class="form-label">เบอร์แฟกซ์ (Fax.)</label>
              <input type="text" class="form-control" id="set-company-fax" value="${escapeHtml(s.company_fax)}" oninput="refreshSettingsLivePreview()" />
            </div>
            <div class="form-group col-4">
              <label class="form-label">เลขประจำตัวผู้เสียภาษีอากร</label>
              <input type="text" class="form-control" id="set-company-tax" value="${escapeHtml(s.company_tax_id)}" oninput="refreshSettingsLivePreview()" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">4. ข้อความช่องเซ็นรับ (บรรทัดที่ 1)</label>
              <input type="text" class="form-control" id="set-confirm-1" value="${escapeHtml(s.confirm_box_line1)}" oninput="refreshSettingsLivePreview()" />
            </div>
            <div class="form-group col-6">
              <label class="form-label">ข้อความช่องเซ็นรับ (บรรทัดที่ 2)</label>
              <input type="text" class="form-control" id="set-confirm-2" value="${escapeHtml(s.confirm_box_line2)}" oninput="refreshSettingsLivePreview()" />
            </div>
            <div class="form-group col-6">
              <label class="form-label">ป้ายกำกับช่องเซ็นชื่อ (เช่น SIGN)</label>
              <input type="text" class="form-control" id="set-sign-label" value="${escapeHtml(s.confirm_sign_label)}" oninput="refreshSettingsLivePreview()" />
            </div>
            <div class="form-group col-6">
              <label class="form-label">ป้ายกำกับช่องวันที่ (เช่น DATE)</label>
              <input type="text" class="form-control" id="set-date-label" value="${escapeHtml(s.confirm_date_label)}" oninput="refreshSettingsLivePreview()" />
            </div>

            <div class="form-group col-12">
              <label class="form-label">5. หมายเหตุท้ายกระดาษเริ่มต้น (Default Remarks)</label>
              <textarea class="form-control" id="set-remarks" rows="4" oninput="refreshSettingsLivePreview()">${escapeHtml(s.default_remarks)}</textarea>
            </div>

            <div class="form-group col-6">
              <label class="form-label">6. Effective Date (มุมซ้ายล่าง)</label>
              <input type="text" class="form-control" id="set-effective-date" value="${escapeHtml(s.effective_date)}" oninput="refreshSettingsLivePreview()" />
            </div>
            <div class="form-group col-6">
              <label class="form-label">7. หมายเลขแบบฟอร์ม (มุมขวาล่าง)</label>
              <input type="text" class="form-control" id="set-form-code" value="${escapeHtml(s.form_code)}" oninput="refreshSettingsLivePreview()" />
            </div>

            <div class="form-group col-6">
              <label class="form-label">สถานที่ส่งของเริ่มต้น</label>
              <input type="text" class="form-control" id="set-default-loc" value="${escapeHtml(s.default_delivery_location)}" />
            </div>
            <div class="form-group col-6">
              <label class="form-label">ผู้ติดต่อรับของเริ่มต้น</label>
              <input type="text" class="form-control" id="set-default-contact" value="${escapeHtml(s.default_delivery_contact)}" />
            </div>
          </div>

          <div style="margin-top:16px; display:flex; justify-content:flex-end;">
            <button class="btn btn-primary" onclick="saveDocumentSettings()">💾 บันทึกการตั้งค่าเอกสารทั้งหมด</button>
          </div>
        </div>
      </div>

      <div class="col-6">
        <div class="card" style="background:#334155; color:#fff;">
          <div class="card-header" style="border-bottom-color:rgba(255,255,255,0.15);">
            <div class="card-title" style="color:#fff;">👁️ ตัวอย่างหน้าเอกสาร PO จริง (Live Preview)</div>
            <span style="font-size:12px; color:#cbd5e1;">อัปเดตทันทีเมื่อแก้ไขข้อมูลด้านซ้าย</span>
          </div>
          <div style="overflow-x:auto; background:#525659; padding:12px; border-radius:8px;">
            <div id="settings-live-po-preview" style="transform:scale(0.68); transform-origin:top left; width:147%; margin-bottom:-90mm;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  refreshSettingsLivePreview();
}

function collectDraftSettingsFromDom() {
  const s = STATE.settings || {};
  return {
    ...s,
    company_logo: document.getElementById('set-logo-preview')?.src || s.company_logo,
    company_name: document.getElementById('set-company-name')?.value || '',
    company_address: document.getElementById('set-company-address')?.value || '',
    company_tel: document.getElementById('set-company-tel')?.value || '',
    company_fax: document.getElementById('set-company-fax')?.value || '',
    company_tax_id: document.getElementById('set-company-tax')?.value || '',
    confirm_box_line1: document.getElementById('set-confirm-1')?.value || '',
    confirm_box_line2: document.getElementById('set-confirm-2')?.value || '',
    confirm_sign_label: document.getElementById('set-sign-label')?.value || '',
    confirm_date_label: document.getElementById('set-date-label')?.value || '',
    default_remarks: document.getElementById('set-remarks')?.value || '',
    effective_date: document.getElementById('set-effective-date')?.value || '',
    form_code: document.getElementById('set-form-code')?.value || '',
    default_delivery_location: document.getElementById('set-default-loc')?.value || 'โรงงาน ซอย 12',
    default_delivery_contact: document.getElementById('set-default-contact')?.value || 'จัดซื้อ 094-479-2417'
  };
}

function refreshSettingsLivePreview() {
  const previewEl = document.getElementById('settings-live-po-preview');
  if (!previewEl) return;
  const draftSettings = collectDraftSettingsFromDom();
  const samplePo = STATE.pos.find(p => p.po_number === 'PO/NES/0062-2026') || STATE.pos[0] || {
    po_number: 'PO/NES/0062-2026',
    po_date: '2026-02-11',
    vendor_name_snapshot: 'MATERIALS CARBIDE CO., LTD.',
    vendor_address_snapshot: '2991 ถนนลาดพร้าว แขวงคลองจั่น เขตบางกะปิ กรุงเทพฯ 10240',
    vendor_tel_snapshot: '02.370.1599',
    vendor_fax_snapshot: '02.370.1303-4',
    vendor_contact_name: 'คุณมิค',
    vendor_contact_email: 'mic@mtcb.co.th',
    quotation_ref: 'ราคาเดิม',
    pr_number: '2/1/082',
    delivery_location: draftSettings.default_delivery_location,
    delivery_contact: draftSettings.default_delivery_contact,
    delivery_date: '2026-02-12',
    payment_term: 'CREDIT 30 DAYS',
    sub_total: 7480,
    special_discount: 0,
    net_total: 7480,
    vat_rate: 7,
    vat_amount: 523.6,
    grand_total: 8003.6,
    amount_text_th: 'แปดพันสามบาทหกสิบสตางค์',
    approval_status: 'APPROVED',
    approved_at: '2026-02-11',
    items: []
  };
  const poForPreview = {
    ...samplePo,
    remarks: draftSettings.default_remarks
  };
  previewEl.innerHTML = buildOfficialPoDocumentHtml(poForPreview, draftSettings);
}

function onSettingsLogoUpload(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('set-logo-preview').src = reader.result;
    refreshSettingsLivePreview();
  };
  reader.readAsDataURL(file);
}

async function resetDefaultLogo() {
  const updated = await apiFetch('/api/settings/reset-logo', { method: 'POST' });
  STATE.settings = updated;
  document.getElementById('set-logo-preview').src = updated.company_logo;
  updateChromeUI();
  refreshSettingsLivePreview();
}

async function saveDocumentSettings() {
  const payload = collectDraftSettingsFromDom();
  try {
    const updated = await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    STATE.settings = updated;
    updateChromeUI();
    alert('บันทึกการตั้งค่าเอกสารใบสั่งซื้อ (FM-PU-02) เรียบร้อยแล้ว');
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// ==========================================================================
// 16. Helpers & Initialization
// ==========================================================================

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('open');
}

function closeAllDropdownPanels() {
  document.querySelectorAll('.search-dropdown-panel.open').forEach(el => el.classList.remove('open'));
}

document.addEventListener('click', e => {
  if (!e.target.closest('.search-dropdown')) {
    closeAllDropdownPanels();
  }
});

window.addEventListener('resize', () => {
  if (STATE.currentTab === 'create-po' && STATE.showLivePoPreview) {
    refreshCreatePoLivePreview();
  }
  if (STATE.currentTab === 'prs' && STATE.prSubMode === 'create') {
    refreshCreatePrLivePreview();
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  try {
    // Load bootstrap logo for login screen
    const boot = await apiFetch('/api/bootstrap');
    if (boot.settings && boot.settings.company_logo) {
      const loginLogo = document.getElementById('login-logo-img');
      if (loginLogo) loginLogo.src = boot.settings.company_logo;
    }

    const savedUserJson = sessionStorage.getItem('nes_po_user');
    if (savedUserJson) {
      STATE.currentUser = JSON.parse(savedUserJson);
      document.getElementById('login-overlay').classList.add('hidden');
      await loadAllData();
      if (isNormalUser()) {
        switchTab('prs');
      } else {
        renderCurrentTab();
      }
    }
  } catch (err) {
    console.error('Initialization error:', err);
  }
});
