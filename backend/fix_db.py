import sqlite3

conn = sqlite3.connect('database.db')

print("=== BEFORE ===")
print("POs:", conn.execute("SELECT * FROM purchase_orders").fetchall())
print("GRNs:", conn.execute("SELECT * FROM grn").fetchall())
print("Invoices:", conn.execute("SELECT invoice_number,po_number,grn_number,original_amount,original_gst,shipping_charges,handling_charges,status,reason FROM invoices").fetchall())

# Upsert PO101
existing_po = conn.execute("SELECT * FROM purchase_orders WHERE po_number='PO101'").fetchone()
if existing_po:
    conn.execute("UPDATE purchase_orders SET vendor='TechGuruPlus', item='Laptop', quantity=10, price=5000 WHERE po_number='PO101'")
    print("PO101 updated")
else:
    conn.execute("INSERT INTO purchase_orders (po_number, vendor, item, quantity, price) VALUES ('PO101','TechGuruPlus','Laptop',10,5000)")
    print("PO101 inserted")

conn.commit()

# Now fix INV001 status
inv = conn.execute("SELECT invoice_number,po_number,grn_number,original_amount,original_gst,shipping_charges,handling_charges FROM invoices WHERE invoice_number='INV001'").fetchone()
po  = conn.execute("SELECT quantity, price FROM purchase_orders WHERE po_number='PO101'").fetchone()
grn = conn.execute("SELECT quantity_received FROM grn WHERE grn_number='GRN201'").fetchone()

print(f"\ninv={inv}, po={po}, grn={grn}")

if inv and po and grn:
    inv_num, po_num, grn_num, orig_amt, orig_gst, shipping, handling = inv
    qty, price = po
    qty_rcvd = grn[0]
    po_expected = qty * price

    base_a = orig_amt
    base_b = orig_amt - shipping - handling
    base_c = orig_amt - orig_gst - shipping - handling
    tol = max(1, po_expected * 0.01)

    print(f"PO expected={po_expected}, base_a={base_a}, base_b={base_b}, base_c={base_c}, tol={tol}")
    print(f"qty ordered={qty}, qty received={qty_rcvd}")

    amt_ok = (abs(base_a - po_expected) <= tol or
              abs(base_b - po_expected) <= tol or
              abs(base_c - po_expected) <= tol)
    qty_ok = qty_rcvd == qty

    print(f"amt_ok={amt_ok}, qty_ok={qty_ok}")

    if amt_ok and qty_ok:
        conn.execute("UPDATE invoices SET status='APPROVED', reason='3-way match successful' WHERE invoice_number='INV001'")
        conn.commit()
        print("SUCCESS: INV001 -> APPROVED")
    else:
        print("MISMATCH — check amounts and quantities")
else:
    print("Missing data — check tables")

print("\n=== AFTER ===")
print("POs:", conn.execute("SELECT * FROM purchase_orders").fetchall())
print("Invoices:", conn.execute("SELECT invoice_number,status,reason FROM invoices").fetchall())
conn.close()
