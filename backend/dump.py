import sqlite3
import sys

def go():
    conn = sqlite3.connect('database.db')
    invs = conn.execute('SELECT * FROM invoices').fetchall()
    print("Invoices:", invs)
    pos = conn.execute('SELECT * FROM purchase_orders').fetchall()
    print("POs:", pos)
    grns = conn.execute('SELECT * FROM grn').fetchall()
    print("GRNs:", grns)

if __name__ == '__main__':
    go()
