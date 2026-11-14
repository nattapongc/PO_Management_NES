import base64
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'nes_po.db')
OUT_PATH = os.path.join(os.path.dirname(__file__), 'nes_po_db_b64.js')

with open(DB_PATH, 'rb') as f:
    b64 = base64.b64encode(f.read()).decode('ascii')

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    f.write('// Auto-generated Base64 seed of nes_po.db for Vercel Serverless bundling\n')
    f.write(f'module.exports = "{b64}";\n')

print(f"Created nes_po_db_b64.js ({os.path.getsize(OUT_PATH) / 1024:.1f} KB)")
