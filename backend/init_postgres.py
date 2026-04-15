import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

def init_remote_db():
    # Get the URL from your .env
    db_url = os.getenv("DATABASE_URL")
    
    try:
        # Connect to Joshie's DB
        conn = psycopg2.connect(db_url)
        cursor = conn.cursor()
        
        # Create the tables for your 3-way matching
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS purchase_orders (
                po_number TEXT PRIMARY KEY,
                vendor TEXT,
                item TEXT,
                quantity INTEGER,
                price FLOAT
            );
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS grn (
                grn_number TEXT PRIMARY KEY,
                po_number TEXT,
                item_received TEXT,
                quantity_received INTEGER
            );
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS invoices (
                invoice_number TEXT PRIMARY KEY,
                po_number TEXT,
                grn_number TEXT,
                original_amount FLOAT,
                original_gst FLOAT,
                shipping_charges FLOAT,
                handling_charges FLOAT,
                status TEXT,
                reason TEXT
            );
        """)
        
        conn.commit()
        print("✅ Successfully created tables in Joshie's PostgreSQL!")
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Connection failed: {e}")

if __name__ == "__main__":
    init_remote_db()