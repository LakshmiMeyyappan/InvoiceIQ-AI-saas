import os
import json
import re
import tempfile
import io
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, HTTPException
from typing import List
import uuid as _uuid
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, text
from sqlalchemy.orm import declarative_base, sessionmaker
from pydantic import BaseModel
from PIL import Image
import fitz
import pytesseract
from groq import Groq
from dotenv import load_dotenv
from dateutil import parser
import requests
from bulk_processor import process_bulk

# ----------------------------
# SETUP
# ----------------------------
load_dotenv()

app = FastAPI(title="AI Invoice SaaS", version="2.0.0")

from fastapi.middleware.cors import CORSMiddleware

# Define origins 
origins = [
    "https://invoice-iq-ai-saas.vercel.app",
    "https://lashai.in",
    "https://www.lashai.in",
    "http://localhost:3000" 
]

# Then pass the 'origins' list to the middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


db_url = os.getenv("DATABASE_URL")

# Create the engine (this replaces your old sqlite line)
engine = create_engine(db_url)

SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

# ----------------------------
# HELPERS
# ----------------------------
def safe_float(value, default=0.0):
    """Safely convert any value (including "5,000" strings) to float."""
    if value is None:
        return default
    try:
        return float(str(value).replace(",", "").strip())
    except Exception:
        return default

def safe_int(value, default=0):
    """Safely convert any value to int."""
    if value is None:
        return default
    try:
        return int(str(value).replace(",", "").strip().split(".")[0])
    except Exception:
        return default

# ----------------------------
# CURRENCY CONVERSION
# ----------------------------
def convert_to_inr(amount, currency):
    if currency == "INR":
        return amount
    if currency == "USD":
        try:
            rate = requests.get("https://api.exchangerate-api.com/v4/latest/USD", timeout=3).json()
            return amount * rate["rates"]["INR"]
        except Exception:
            return amount
    return amount

# ----------------------------
# MODELS
# ----------------------------
class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id = Column(Integer, primary_key=True)
    po_number = Column(String, unique=True)
    vendor = Column(String)
    item = Column(String)
    quantity = Column(Integer)
    price = Column(Float)

class GRN(Base):
    __tablename__ = "grn"
    id = Column(Integer, primary_key=True)
    grn_number = Column(String, unique=True)
    po_number = Column(String)
    vendor = Column(String)
    item = Column(String)
    quantity_received = Column(Integer)

class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(Integer, primary_key=True)
    invoice_number = Column(String, unique=True)
    po_number = Column(String)
    grn_number = Column(String)
    vendor = Column(String)
    invoice_date = Column(Date)
    currency = Column(String)
    original_amount = Column(Float)
    original_gst = Column(Float)
    total_amount = Column(Float)
    gst = Column(Float)
    shipping_charges = Column(Float, default=0)
    handling_charges = Column(Float, default=0)
    status = Column(String, default="PENDING")
    reason = Column(String, default="")

class BulkJob(Base):
    __tablename__ = "bulk_jobs"
    id = Column(Integer, primary_key=True)
    job_id = Column(String, unique=True)
    file_count = Column(Integer)
    processed = Column(Integer)
    errors = Column(Integer)
    elapsed_sec = Column(Float)
    results_json = Column(String)   # full JSON payload
    created_at = Column(String)

Base.metadata.create_all(bind=engine)

# ----------------------------
# OCR
# ----------------------------
def extract_text_from_pdf(file_bytes):
    text_content = ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(file_bytes)
        path = tmp.name
    doc = fitz.open(path)
    for page in doc:
        text_content += page.get_text()
    if not text_content.strip():
        for page in doc:
            pix = page.get_pixmap(dpi=300)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            text_content += pytesseract.image_to_string(img)
    doc.close()
    return text_content

# ----------------------------
# LLM EXTRACTION
# ----------------------------
def extract_invoice_with_llm(text):
    prompt = f"""
    Extract invoice data and return ONLY valid JSON:

    {{
    "vendor": "",
    "invoice_number": "",
    "invoice_date": "YYYY-MM-DD",
    "po_number": "",
    "grn_number": "",
    "currency": "USD or INR",
    "total_amount": 0,
    "gst": 0,
    "shipping_charges": 0,
    "handling_charges": 0
    }}

    Rules:
    - Return ONLY JSON, no markdown, no explanation
    - All numbers must be plain numbers (no commas, no currency symbols)
    - If field not found, use 0 or empty string

    Text: {text}
    """
    res = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0
    )
    content = res.choices[0].message.content
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        raise HTTPException(status_code=400, detail="LLM could not parse invoice")
    return json.loads(match.group(0))


def extract_po_with_llm(text):
    prompt = f"""
    Extract Purchase Order data and return ONLY valid JSON:

    {{
      "po_number": "",
      "vendor": "",
      "item": "",
      "quantity": 0,
      "price": 0
    }}

    Rules:
    - Return ONLY JSON, no markdown, no explanation
    - All numbers must be plain numbers (no commas, no currency symbols)
    - price is the unit price per item

    Text: {text}
    """
    res = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0
    )
    content = res.choices[0].message.content
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        raise HTTPException(status_code=400, detail="LLM could not parse PO")
    return json.loads(match.group(0))

def extract_grn_with_llm(text):
    prompt = f"""
    Extract GRN data and return ONLY valid JSON:

    {{
      "grn_number": "",
      "po_number": "",
      "vendor": "",
      "item": "",
      "quantity_received": 0
    }}

    Rules:
    - Return ONLY JSON, no markdown, no explanation

    Text: {text}
    """
    res = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0
    )
    content = res.choices[0].message.content
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        raise HTTPException(status_code=400, detail="LLM could not parse GRN")
    return json.loads(match.group(0))

# ----------------------------
# THREE-WAY MATCH ENGINE
# ----------------------------
def three_way_match(invoice, db):
    """
    Professional 3-way match:
    1. Locate PO by po_number first, fallback to vendor
    2. Compare base amount (excluding shipping + handling) vs PO expected
    3. Verify GRN exists and quantity matches PO
    """
    # Step 1: Find PO
    po = None
    if invoice.po_number:
        po = db.query(PurchaseOrder).filter(
            PurchaseOrder.po_number == invoice.po_number
        ).first()

    if not po and invoice.vendor:
        po = db.query(PurchaseOrder).filter(
            PurchaseOrder.vendor == invoice.vendor
        ).first()

    if not po:
        return "HOLD", "No matching PO found"

    # Step 2: Amount validation — exclude shipping & handling charges
    po_expected = po.quantity * po.price
    shipping = invoice.shipping_charges or 0
    handling = invoice.handling_charges or 0
    gst = invoice.original_gst or 0

    # Try all valid base amount scenarios:
    # a) Invoice total already excludes shipping/handling
    # b) Invoice total includes shipping/handling (subtract them)
    # c) Invoice total includes gst + shipping/handling (subtract all)
    base_a = invoice.original_amount
    base_b = invoice.original_amount - shipping - handling
    base_c = invoice.original_amount - gst - shipping - handling

    tolerance = max(1, po_expected * 0.01)  # 1% tolerance or at least ₹1

    matched_base = None
    if abs(base_a - po_expected) <= tolerance:
        matched_base = base_a
    elif abs(base_b - po_expected) <= tolerance:
        matched_base = base_b
    elif abs(base_c - po_expected) <= tolerance:
        matched_base = base_c

    if matched_base is None:
        return "HOLD", (
            f"Amount mismatch: Invoice base ≈ ₹{base_b:,.0f}, "
            f"PO expected ₹{po_expected:,.0f}"
        )

    # Step 3: Find GRN
    grn = None
    if invoice.grn_number:
        grn = db.query(GRN).filter(GRN.grn_number == invoice.grn_number).first()

    if not grn:
        grn = db.query(GRN).filter(GRN.po_number == po.po_number).first()

    if not grn:
        return "HOLD", "GRN not found"

    # Step 4: Quantity check
    if grn.quantity_received != po.quantity:
        return "HOLD", (
            f"Quantity mismatch: GRN received {grn.quantity_received}, "
            f"PO ordered {po.quantity}"
        )

    # ✅ All checks passed — auto-link
    invoice.po_number = po.po_number
    invoice.grn_number = grn.grn_number
    return "APPROVED", "3-way match successful"


# ----------------------------
# UPLOAD INVOICE
# ----------------------------
@app.post("/upload/")
def upload_invoice(file: UploadFile = File(...)):
    db = SessionLocal()
    try:
        text_data = extract_text_from_pdf(file.file.read())
        data = extract_invoice_with_llm(text_data)

        invoice_number = data.get("invoice_number", "").strip()
        if not invoice_number:
            raise HTTPException(status_code=400, detail="Missing invoice number")

        if db.query(Invoice).filter_by(invoice_number=invoice_number).first():
            raise HTTPException(status_code=409, detail="Duplicate invoice")

        po_number = data.get("po_number", "").strip()
        grn_number = data.get("grn_number", "").strip()
        currency = data.get("currency", "INR").strip()

        original_amount = safe_float(data.get("total_amount", 0))
        original_gst = safe_float(data.get("gst", 0))
        shipping = safe_float(data.get("shipping_charges", 0))
        handling = safe_float(data.get("handling_charges", 0))

        converted_amount = convert_to_inr(original_amount, currency)
        converted_gst = convert_to_inr(original_gst, currency)

        # total_amount stored = base + shipping + handling (full payable)
        total = converted_amount + shipping + handling

        invoice = Invoice(
            vendor=data.get("vendor", "").strip(),
            invoice_number=invoice_number,
            invoice_date=parser.parse(data.get("invoice_date", "2024-01-01")).date(),
            po_number=po_number,
            grn_number=grn_number,
            currency=currency,
            original_amount=original_amount,
            original_gst=original_gst,
            total_amount=total,
            gst=converted_gst,
            shipping_charges=shipping,
            handling_charges=handling,
        )

        status, reason = three_way_match(invoice, db)
        invoice.status = status
        invoice.reason = reason

        db.add(invoice)
        db.commit()
        return {"message": "Invoice processed", "status": status, "reason": reason}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ----------------------------
# UPLOAD PO
# ----------------------------
@app.post("/upload-po-pdf/")
def upload_po_pdf(file: UploadFile = File(...)):
    db = SessionLocal()
    try:
        text_data = extract_text_from_pdf(file.file.read())
        data = extract_po_with_llm(text_data)

        po_number = data.get("po_number", "").strip()
        if not po_number:
            raise HTTPException(status_code=400, detail="PO number missing in document")

        if db.query(PurchaseOrder).filter_by(po_number=po_number).first():
            raise HTTPException(status_code=409, detail=f"PO {po_number} already exists")

        po = PurchaseOrder(
            po_number=po_number,
            vendor=data.get("vendor", "").strip(),
            item=data.get("item", "").strip(),
            quantity=safe_int(data.get("quantity", 0)),
            price=safe_float(data.get("price", 0)),
        )
        db.add(po)
        db.commit()

        expected = po.quantity * po.price
        return {
            "message": "PO saved successfully",
            "po_number": po_number,
            "vendor": po.vendor,
            "item": po.item,
            "quantity": po.quantity,
            "unit_price": po.price,
            "expected_total": expected,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ----------------------------
# UPLOAD GRN
# ----------------------------
@app.post("/upload-grn-pdf/")
def upload_grn_pdf(file: UploadFile = File(...)):
    db = SessionLocal()
    try:
        text_data = extract_text_from_pdf(file.file.read())
        data = extract_grn_with_llm(text_data)

        grn_number = data.get("grn_number", "").strip()
        if not grn_number:
            raise HTTPException(status_code=400, detail="GRN number missing in document")

        if db.query(GRN).filter_by(grn_number=grn_number).first():
            raise HTTPException(status_code=409, detail=f"GRN {grn_number} already exists")

        grn = GRN(
            grn_number=grn_number,
            po_number=data.get("po_number", "").strip(),
            vendor=data.get("vendor", "").strip(),
            item=data.get("item", "").strip(),
            quantity_received=safe_int(data.get("quantity_received", 0)),
        )
        db.add(grn)
        db.commit()
        return {
            "message": "GRN saved successfully",
            "grn_number": grn_number,
            "po_number": grn.po_number,
            "quantity_received": grn.quantity_received,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ----------------------------
# MANUAL PO ENTRY (no PDF needed)
# ----------------------------
class ManualPOInput(BaseModel):
    po_number: str
    vendor: str
    item: str
    quantity: int
    price: float

@app.post("/manual-po/")
def manual_po(data: ManualPOInput):
    """Insert a PO manually without a PDF — useful for correcting data."""
    db = SessionLocal()
    try:
        existing = db.query(PurchaseOrder).filter_by(po_number=data.po_number).first()
        if existing:
            # Update instead of error
            existing.vendor = data.vendor
            existing.item = data.item
            existing.quantity = data.quantity
            existing.price = data.price
            db.commit()
            return {"message": "PO updated", "po_number": data.po_number, "expected_total": data.quantity * data.price}

        po = PurchaseOrder(
            po_number=data.po_number,
            vendor=data.vendor,
            item=data.item,
            quantity=data.quantity,
            price=data.price,
        )
        db.add(po)
        db.commit()
        return {"message": "PO created", "po_number": data.po_number, "expected_total": data.quantity * data.price}
    finally:
        db.close()


# ----------------------------
# REMATCH ALL HELD INVOICES
# ----------------------------
@app.post("/rematch-all/")
def rematch_all():
    """Re-run 3-way match on all HOLD invoices. Call this after uploading missing POs/GRNs."""
    db = SessionLocal()
    try:
        held = db.query(Invoice).filter_by(status="HOLD").all()
        results = []
        for invoice in held:
            old_status = invoice.status
            old_reason = invoice.reason
            new_status, new_reason = three_way_match(invoice, db)
            invoice.status = new_status
            invoice.reason = new_reason
            results.append({
                "invoice": invoice.invoice_number,
                "old_status": old_status,
                "old_reason": old_reason,
                "new_status": new_status,
                "new_reason": new_reason,
            })
        db.commit()
        return {"rematched": len(held), "results": results}
    finally:
        db.close()


# ----------------------------
# ASK AI (NL → SQL)
# ----------------------------
class Question(BaseModel):
    question: str

@app.post("/ask/")
def ask_question(data: Question):
    db = SessionLocal()
    try:
        sql_prompt = f"""
        You are a PostgreSQL expert.

        Table: invoices
        Columns: vendor, invoice_number, invoice_date, currency, original_amount, original_gst,
                 total_amount, gst, shipping_charges, handling_charges, status, reason, po_number, grn_number

        Column meanings:
        - currency: 'USD' or 'INR' — the original invoice currency
        - original_amount: the invoice total in the ORIGINAL currency (USD or INR)
        - original_gst: the GST in the ORIGINAL currency
        - total_amount: the invoice total converted to INR (always INR)
        - gst: the GST converted to INR (always INR)
        - vendor: exact vendor name from the invoice

        IMPORTANT - status values are ALWAYS uppercase:
        - 'HOLD', 'APPROVED', 'PENDING'
        Never use lowercase for status values.

        IMPORTANT - vendor/name searches:
        - ALWAYS use LIKE with wildcards: WHERE LOWER(vendor) LIKE LOWER('%searchterm%')
        - Never use exact equality for vendor searches.

        IMPORTANT - amount/GST queries:
        - Always SELECT vendor, currency, original_amount, original_gst, total_amount, gst
          alongside any aggregate so the frontend can display both USD and INR values.
        - For "highest GST" type queries: SELECT vendor, currency, original_gst, gst FROM invoices ORDER BY gst DESC LIMIT 1
        - For "total GST": SELECT SUM(gst) as total_gst_inr FROM invoices

        RULES:
        - ONLY return raw SQL (no explanation, no markdown, no ```sql)
        - ONLY SELECT queries
        - Use exact column names above

        Question: {data.question}
        """
        res = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": sql_prompt}],
            temperature=0
        )
        sql = res.choices[0].message.content.strip()
        sql = sql.replace("```sql", "").replace("```", "").strip()

        if any(x in sql.upper() for x in ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER"]):
            return {"answer": "Blocked: only SELECT queries allowed"}

        rows = db.execute(text(sql)).mappings().all()
        return {"answer": [dict(r) for r in rows], "sql": sql}

    except Exception as e:
        return {"answer": str(e)}
    finally:
        db.close()


# ----------------------------
# GET ALL INVOICES
# ----------------------------
@app.get("/invoices/")
def get_invoices():
    db = SessionLocal()
    try:
        invoices = db.query(Invoice).all()
        result = []
        for inv in invoices:
            shipping = inv.shipping_charges or 0
            handling = inv.handling_charges or 0

            # Base amount = total minus surcharges
            base_inr = inv.total_amount - shipping - handling

            base_usd = None
            if inv.currency == "USD":
                base_usd = inv.original_amount - shipping - handling

            result.append({
                "Invoice Number": inv.invoice_number,
                "Vendor Name": inv.vendor,
                "PO Number": inv.po_number,
                "GRN Number": inv.grn_number,
                "Currency": inv.currency,
                "Total Amount (USD)": round(base_usd, 2) if base_usd is not None else None,
                "Total Amount (INR)": round(base_inr, 2),
                "GST": inv.gst,
                "Shipping": shipping,
                "Handling": handling,
                "Status": inv.status,
                "Reason": inv.reason,
            })
        return result
    finally:
        db.close()


# ----------------------------
# GET SUMMARY STATS
# ----------------------------
@app.get("/stats/")
def get_stats():
    db = SessionLocal()
    try:
        invoices = db.query(Invoice).all()
        total = len(invoices)
        approved = sum(1 for i in invoices if i.status == "APPROVED")
        held = sum(1 for i in invoices if i.status == "HOLD")
        pending = sum(1 for i in invoices if i.status not in ("APPROVED", "HOLD"))
        total_value = sum((i.total_amount or 0) - (i.shipping_charges or 0) - (i.handling_charges or 0) for i in invoices)
        return {
            "total_invoices": total,
            "approved": approved,
            "held": held,
            "pending": pending,
            "total_value_inr": round(total_value, 2),
        }
    finally:
        db.close()


# ----------------------------
# BULK UPLOAD
# ----------------------------
@app.post("/bulk-upload/")
async def bulk_upload(files: List[UploadFile] = File(...)):
    """
    Accept multiple files (PDF / images / Excel / Word / CSV).
    Detect type → extract text → classify → extract fields → group by PO → 3-way match.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    if len(files) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 files per batch")

    # Read all file bytes (must be done before passing to thread pool)
    file_pairs = []
    for f in files:
        b = await f.read()
        file_pairs.append((f.filename, b))

    try:
        result = process_bulk(file_pairs, groq_client=client)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # -------------------------------------------------------------------
    # Persist extracted docs (PO / GRN / INVOICE) to the main tables
    # so they appear in the Dashboard and stats.
    # -------------------------------------------------------------------
    db = SessionLocal()
    saved_summary = {"po": 0, "grn": 0, "invoice": 0, "skipped": 0}
    try:
        for fs in result.get("file_statuses", []):
            if fs.get("status") != "done":
                continue

            doc_type = fs.get("doc_type", "")
            raw      = fs.get("raw", {})
            items    = fs.get("items", [])

            if doc_type == "PO":
                po_number = (fs.get("po_number") or "").strip()
                if not po_number:
                    saved_summary["skipped"] += 1
                    continue
                if db.query(PurchaseOrder).filter_by(po_number=po_number).first():
                    saved_summary["skipped"] += 1
                    continue
                qty   = sum(it.get("qty", 0) for it in items)
                price = items[0].get("unit_price", 0.0) if items else 0.0
                db.add(PurchaseOrder(
                    po_number=po_number,
                    vendor=fs.get("vendor", ""),
                    item=items[0].get("name", "") if items else "",
                    quantity=safe_int(qty),
                    price=safe_float(price),
                ))
                saved_summary["po"] += 1

            elif doc_type == "GRN":
                grn_number = (fs.get("grn_number") or "").strip()
                if not grn_number:
                    saved_summary["skipped"] += 1
                    continue
                if db.query(GRN).filter_by(grn_number=grn_number).first():
                    saved_summary["skipped"] += 1
                    continue
                qty_received = sum(it.get("qty_received", 0) for it in items)
                db.add(GRN(
                    grn_number=grn_number,
                    po_number=(fs.get("po_number") or "").strip(),
                    vendor=fs.get("vendor", ""),
                    item=items[0].get("name", "") if items else "",
                    quantity_received=safe_int(qty_received),
                ))
                saved_summary["grn"] += 1

            elif doc_type == "INVOICE":
                invoice_number = (fs.get("invoice_number") or "").strip()
                if not invoice_number:
                    saved_summary["skipped"] += 1
                    continue
                if db.query(Invoice).filter_by(invoice_number=invoice_number).first():
                    saved_summary["skipped"] += 1
                    continue
                currency        = fs.get("currency", "INR")
                original_amount = safe_float(fs.get("total", 0))
                original_gst    = safe_float(fs.get("tax", 0))
                shipping        = safe_float(raw.get("shipping", 0))
                handling        = safe_float(raw.get("handling", 0))
                converted_amount = convert_to_inr(original_amount, currency)
                converted_gst    = convert_to_inr(original_gst, currency)
                total            = converted_amount + shipping + handling
                try:
                    inv_date = parser.parse(str(raw.get("invoice_date") or "2024-01-01")).date()
                except Exception:
                    inv_date = parser.parse("2024-01-01").date()
                invoice = Invoice(
                    invoice_number=invoice_number,
                    vendor=fs.get("vendor", ""),
                    invoice_date=inv_date,
                    po_number=(fs.get("po_number") or "").strip(),
                    grn_number=(fs.get("grn_number") or "").strip(),
                    currency=currency,
                    original_amount=original_amount,
                    original_gst=original_gst,
                    total_amount=total,
                    gst=converted_gst,
                    shipping_charges=shipping,
                    handling_charges=handling,
                )
                status, reason = three_way_match(invoice, db)
                invoice.status = status
                invoice.reason = reason
                db.add(invoice)
                saved_summary["invoice"] += 1

        db.commit()

        # Also store the bulk job record
        job = BulkJob(
            job_id=result["job_id"],
            file_count=result["total_files"],
            processed=result["processed"],
            errors=result["errors"],
            elapsed_sec=result["elapsed_sec"],
            results_json=json.dumps(result),
            created_at=datetime.utcnow().isoformat(),
        )
        db.add(job)
        db.commit()

    finally:
        db.close()

    result["saved_to_db"] = saved_summary
    return result


@app.get("/bulk-jobs/")
def get_bulk_jobs():
    """List all past bulk jobs (summary only — no full results)."""
    db = SessionLocal()
    try:
        jobs = db.query(BulkJob).order_by(BulkJob.id.desc()).all()
        return [
            {
                "job_id":     j.job_id,
                "file_count": j.file_count,
                "processed":  j.processed,
                "errors":     j.errors,
                "elapsed_sec": j.elapsed_sec,
                "created_at": j.created_at,
            }
            for j in jobs
        ]
    finally:
        db.close()


@app.get("/bulk-job/{job_id}")
def get_bulk_job(job_id: str):
    """Full results for a specific bulk job."""
    db = SessionLocal()
    try:
        job = db.query(BulkJob).filter_by(job_id=job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return json.loads(job.results_json)
    finally:
        db.close()
