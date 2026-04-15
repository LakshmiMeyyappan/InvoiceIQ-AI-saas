"""
bulk_processor.py
=================
Production-grade bulk document processing pipeline for InvoiceIQ.

Layers:
  1. detect_file_type   - Routes by file extension
  2. extract_text       - PDF / Image / Excel / Word → raw text
  3. classify_document  - Keyword scoring → PO / GRN / INVOICE
  4. extract_fields_llm - Groq LLM → structured dict per doc type
  5. normalize_document - Unified schema for all doc types
  6. group_by_po        - Cluster docs by po_number
  7. match_group        - 3-way match engine per PO cluster
  8. process_bulk       - Orchestrator (progress tracking)
"""

from __future__ import annotations

import io
import json
import logging
import re
import tempfile
import time
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any

import fitz  # PyMuPDF
import pandas as pd
from PIL import Image
import pytesseract
from groq import Groq


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config / constants
# ---------------------------------------------------------------------------
SUPPORTED_EXTENSIONS = {
    "pdf", "jpg", "jpeg", "png", "bmp", "tiff",
    "xlsx", "xls", "csv",
    "docx", "doc",
}

DOC_TYPES = ("PO", "GRN", "INVOICE")

# Keyword sets for classification
_KW = {
    "PO": [
        "purchase order", "p.o.", "po number", "po#", "order number",
        "buyer", "ordered quantity", "unit price", "order date",
    ],
    "GRN": [
        "goods receipt", "grn", "goods received", "receipt note",
        "received quantity", "delivery note", "received by",
    ],
    "INVOICE": [
        "invoice", "bill to", "invoice number", "inv#", "tax invoice",
        "amount due", "payable", "total amount", "invoice date",
    ],
}

TOLERANCE_PCT = 0.01   # 1% price tolerance
MAX_WORKERS = 4        # parallel file processing threads


# ---------------------------------------------------------------------------
# 1. File-type detection
# ---------------------------------------------------------------------------
def detect_file_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "pdf":
        return "pdf"
    if ext in {"jpg", "jpeg", "png", "bmp", "tiff"}:
        return "image"
    if ext in {"xlsx", "xls"}:
        return "excel"
    if ext == "csv":
        return "csv"
    if ext in {"docx", "doc"}:
        return "word"
    return "unknown"


# ---------------------------------------------------------------------------
# 2. Text extraction — per file type
# ---------------------------------------------------------------------------
def extract_text_pdf(file_bytes: bytes) -> str:
    text = ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(file_bytes)
        path = tmp.name
    doc = fitz.open(path)
    for page in doc:
        text += page.get_text()
    if not text.strip():          # scanned PDF — fall back to OCR
        for page in doc:
            pix = page.get_pixmap(dpi=300)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            text += pytesseract.image_to_string(img)
    doc.close()
    return text


def extract_text_image(file_bytes: bytes) -> str:
    img = Image.open(io.BytesIO(file_bytes))
    return pytesseract.image_to_string(img)


def extract_text_excel(file_bytes: bytes) -> str:
    df = pd.read_excel(io.BytesIO(file_bytes), sheet_name=None)
    parts = []
    for sheet, data in df.items():
        parts.append(f"Sheet: {sheet}")
        parts.append(data.fillna("").to_string(index=False))
    return "\n".join(parts)


def extract_text_csv(file_bytes: bytes) -> str:
    df = pd.read_csv(io.BytesIO(file_bytes))
    return df.fillna("").to_string(index=False)


def extract_text_word(file_bytes: bytes) -> str:
    try:
        from docx import Document as DocxDocument
        doc = DocxDocument(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs)
    except Exception as exc:
        logger.warning("Word extraction failed: %s", exc)
        return ""


def extract_text(file_bytes: bytes, file_type: str) -> str:
    """Route to the correct extractor."""
    extractors = {
        "pdf":   extract_text_pdf,
        "image": extract_text_image,
        "excel": extract_text_excel,
        "csv":   extract_text_csv,
        "word":  extract_text_word,
    }
    fn = extractors.get(file_type)
    if fn is None:
        raise ValueError(f"Unsupported file type: {file_type}")
    return fn(file_bytes)


# ---------------------------------------------------------------------------
# 3. Document classification — keyword scoring
# ---------------------------------------------------------------------------
def classify_document(text: str) -> str:
    """
    Score each doc type by keyword hits.
    Returns: 'PO' | 'GRN' | 'INVOICE'
    """
    lower = text.lower()
    scores = {dtype: 0 for dtype in DOC_TYPES}
    for dtype, keywords in _KW.items():
        for kw in keywords:
            if kw in lower:
                scores[dtype] += 1
    best = max(scores, key=scores.__getitem__)
    logger.debug("Classification scores: %s → %s", scores, best)
    return best


# ---------------------------------------------------------------------------
# 4. LLM field extraction — type-specific prompts
# ---------------------------------------------------------------------------
_PROMPTS = {
    "PO": """
Extract Purchase Order data from the text and return ONLY valid JSON:
{{
  "po_number": "",
  "vendor": "",
  "items": [{{"name": "", "qty": 0, "unit_price": 0}}],
  "total": 0,
  "tax": 0,
  "currency": "INR"
}}
Rules: numbers as plain digits (no commas, no symbols), return ONLY JSON.
Text: {text}
""",
    "GRN": """
Extract Goods Receipt Note data and return ONLY valid JSON:
{{
  "grn_number": "",
  "po_number": "",
  "vendor": "",
  "items": [{{"name": "", "qty_received": 0}}],
  "total_received_qty": 0
}}
Rules: numbers as plain digits, return ONLY JSON.
Text: {text}
""",
    "INVOICE": """
Extract Invoice data and return ONLY valid JSON:
{{
  "invoice_number": "",
  "po_number": "",
  "grn_number": "",
  "vendor": "",
  "items": [{{"name": "", "qty": 0, "unit_price": 0}}],
  "total": 0,
  "tax": 0,
  "shipping": 0,
  "handling": 0,
  "currency": "INR",
  "invoice_date": "YYYY-MM-DD"
}}
Rules: numbers as plain digits, return ONLY JSON.
Text: {text}
""",
}


def extract_fields_llm(text: str, doc_type: str, client: Groq) -> dict:
    """Call Groq LLM with a type-specific prompt and parse JSON response."""
    prompt = _PROMPTS[doc_type].format(text=text[:4000])  # token cap
    try:
        res = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        content = res.choices[0].message.content
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
    except Exception as exc:
        logger.error("LLM extraction failed for %s: %s", doc_type, exc)
    return {}


# ---------------------------------------------------------------------------
# 5. Normalize — unified schema
# ---------------------------------------------------------------------------
def _safe_float(v, default=0.0) -> float:
    if v is None:
        return default
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return default


def _safe_int(v, default=0) -> int:
    if v is None:
        return default
    try:
        return int(str(v).replace(",", "").strip().split(".")[0])
    except Exception:
        return default


@dataclass
class NormalizedDoc:
    """Unified document representation."""
    doc_type: str                  # PO | GRN | INVOICE
    filename: str
    po_number: str = ""
    invoice_number: str = ""
    grn_number: str = ""
    vendor: str = ""
    items: list[dict] = field(default_factory=list)
    total: float = 0.0
    tax: float = 0.0
    currency: str = "INR"
    raw: dict = field(default_factory=dict)


def normalize_document(raw: dict, doc_type: str, filename: str) -> NormalizedDoc:
    doc = NormalizedDoc(doc_type=doc_type, filename=filename, raw=raw)

    doc.po_number      = str(raw.get("po_number", "") or "").strip()
    doc.invoice_number = str(raw.get("invoice_number", "") or "").strip()
    doc.grn_number     = str(raw.get("grn_number", "") or "").strip()
    doc.vendor         = str(raw.get("vendor", "") or "").strip()
    doc.currency       = str(raw.get("currency", "INR") or "INR").strip().upper()
    doc.total          = _safe_float(raw.get("total", 0))
    doc.tax            = _safe_float(raw.get("tax", 0))

    raw_items = raw.get("items", []) or []
    for it in raw_items:
        if doc_type == "GRN":
            doc.items.append({
                "name": str(it.get("name", "") or ""),
                "qty_received": _safe_int(it.get("qty_received", 0)),
            })
        else:
            doc.items.append({
                "name":       str(it.get("name", "") or ""),
                "qty":        _safe_int(it.get("qty", 0)),
                "unit_price": _safe_float(it.get("unit_price", 0)),
            })

    return doc


# ---------------------------------------------------------------------------
# 6. Group by PO number
# ---------------------------------------------------------------------------
def group_by_po(docs: list[NormalizedDoc]) -> dict[str, dict[str, list]]:
    """
    Returns:
      { po_number: { "PO": [...], "GRN": [...], "INVOICE": [...] } }
    Documents with no PO number go into group "_UNKNOWN_".
    """
    groups: dict[str, dict] = defaultdict(lambda: {"PO": [], "GRN": [], "INVOICE": []})
    for doc in docs:
        key = doc.po_number or "_UNKNOWN_"
        groups[key][doc.doc_type].append(doc)
    return dict(groups)


# ---------------------------------------------------------------------------
# 7. 3-Way match engine — per PO group
# ---------------------------------------------------------------------------
@dataclass
class MatchResult:
    po_number: str
    invoice_number: str
    invoice_file: str
    status: str               # MATCHED | PARTIAL | MISMATCH | MISSING_PO | MISSING_GRN | DUPLICATE
    reasons: list[str] = field(default_factory=list)
    matched_grns: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "po_number":      self.po_number,
            "invoice_number": self.invoice_number,
            "invoice_file":   self.invoice_file,
            "status":         self.status,
            "reasons":        self.reasons,
            "matched_grns":   self.matched_grns,
        }


def _total_po_qty(po: NormalizedDoc) -> int:
    return sum(it.get("qty", 0) for it in po.items)


def _total_po_expected(po: NormalizedDoc) -> float:
    return sum(it.get("qty", 0) * it.get("unit_price", 0) for it in po.items)


def _total_grn_qty(grn: NormalizedDoc) -> int:
    return sum(it.get("qty_received", 0) for it in grn.items)


def _invoice_base(inv: NormalizedDoc) -> float:
    """Invoice amount stripped of surcharges so we compare apples to apples."""
    shipping = _safe_float(inv.raw.get("shipping", 0))
    handling = _safe_float(inv.raw.get("handling", 0))
    return inv.total - shipping - handling


def match_group(
    po_num: str,
    pos: list[NormalizedDoc],
    grns: list[NormalizedDoc],
    invoices: list[NormalizedDoc],
    seen_invoices: set[str],
) -> list[MatchResult]:
    """
    Run 3-way match for all invoices in one PO group.
    Handles: 1 PO → many GRNs/invoices, partial delivery, duplicates.
    """
    results: list[MatchResult] = []

    for inv in invoices:
        inv_num = inv.invoice_number or inv.filename
        reasons: list[str] = []
        matched_grn_ids: list[str] = []

        # ── Duplicate check ──
        if inv_num in seen_invoices:
            results.append(MatchResult(
                po_number=po_num, invoice_number=inv_num,
                invoice_file=inv.filename,
                status="DUPLICATE",
                reasons=[f"Invoice {inv_num} already processed"],
            ))
            continue
        seen_invoices.add(inv_num)

        # ── Missing PO ──
        if not pos:
            results.append(MatchResult(
                po_number=po_num, invoice_number=inv_num,
                invoice_file=inv.filename,
                status="MISSING_PO",
                reasons=["No Purchase Order found for this PO group"],
            ))
            continue

        po = pos[0]   # primary PO (single-PO assumption per group)

        # ── Missing GRN ──
        if not grns:
            results.append(MatchResult(
                po_number=po_num, invoice_number=inv_num,
                invoice_file=inv.filename,
                status="MISSING_GRN",
                reasons=["No GRN found for this PO group"],
            ))
            continue

        # ── PO vs Invoice: price/total check ──
        po_expected = _total_po_expected(po)
        inv_base = _invoice_base(inv)
        tol = max(1.0, po_expected * TOLERANCE_PCT)

        if po_expected > 0 and abs(inv_base - po_expected) > tol:
            reasons.append(
                f"Amount mismatch: Invoice base ₹{inv_base:,.0f} vs "
                f"PO expected ₹{po_expected:,.0f}"
            )

        # ── PO vs GRN(s): quantity check (aggregate across partial GRNs) ──
        po_qty = _total_po_qty(po)
        total_received = sum(_total_grn_qty(g) for g in grns)
        for g in grns:
            gid = g.grn_number or g.filename
            matched_grn_ids.append(gid)

        is_partial = 0 < total_received < po_qty

        if total_received == 0:
            reasons.append("GRN has zero quantity received")
        elif is_partial:
            reasons.append(
                f"Partial delivery: received {total_received} of {po_qty} ordered"
            )
        elif total_received > po_qty:
            reasons.append(
                f"Over-delivery: received {total_received}, ordered {po_qty}"
            )

        # ── GRN vs Invoice: delivered qty vs billed qty ──
        inv_qty = sum(it.get("qty", 0) for it in inv.items)
        if inv_qty > 0 and total_received > 0 and abs(inv_qty - total_received) > 0:
            reasons.append(
                f"Billed qty {inv_qty} ≠ received qty {total_received}"
            )

        # ── Determine final status ──
        if not reasons:
            status = "MATCHED"
        elif is_partial and len([r for r in reasons if "mismatch" in r.lower() or "billed" in r.lower()]) == 0:
            status = "PARTIAL"
        else:
            status = "MISMATCH"

        results.append(MatchResult(
            po_number=po_num,
            invoice_number=inv_num,
            invoice_file=inv.filename,
            status=status,
            reasons=reasons,
            matched_grns=matched_grn_ids,
        ))

    return results


# ---------------------------------------------------------------------------
# 8. Bulk orchestrator
# ---------------------------------------------------------------------------
@dataclass
class FileProgress:
    filename: str
    status: str = "queued"   # queued | processing | done | error
    doc_type: str = ""
    error: str = ""
    doc: NormalizedDoc | None = None


def process_bulk(
    files: list[tuple[str, bytes]],   # [(filename, bytes), ...]
    groq_client: Groq,
    progress_cb=None,                  # optional callback(FileProgress)
) -> dict:
    """
    Main entry point for bulk processing.

    Returns:
    {
        job_id: str,
        processed: int,
        errors: int,
        match_results: [MatchResult.to_dict(), ...],
        group_summary: { po_number: { matched, partial, mismatch, ... } },
        file_statuses: [FileProgress-like dicts],
    }
    """
    job_id = str(uuid.uuid4())[:8].upper()
    logger.info("Bulk job %s started — %d files", job_id, len(files))
    t0 = time.time()

    progresses: dict[str, FileProgress] = {
        fname: FileProgress(filename=fname) for fname, _ in files
    }

    docs: list[NormalizedDoc] = []

    def _process_one(fname: str, fbytes: bytes) -> NormalizedDoc | None:
        p = progresses[fname]
        p.status = "processing"
        if progress_cb:
            progress_cb(p)
        try:
            ftype = detect_file_type(fname)
            text = extract_text(fbytes, ftype)
            doc_type = classify_document(text)
            raw_fields = extract_fields_llm(text, doc_type, groq_client)
            ndoc = normalize_document(raw_fields, doc_type, fname)
            p.status = "done"
            p.doc_type = doc_type
            p.doc = ndoc
            logger.info("  ✓ %s → %s (%s)", fname, doc_type, ftype)
            if progress_cb:
                progress_cb(p)
            return ndoc
        except Exception as exc:
            p.status = "error"
            p.error = str(exc)
            logger.error("  ✗ %s failed: %s", fname, exc)
            if progress_cb:
                progress_cb(p)
            return None

    # Process files in parallel
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_process_one, fname, fbytes): fname for fname, fbytes in files}
        for fut in as_completed(futures):
            result = fut.result()
            if result is not None:
                docs.append(result)

    # Group by PO
    groups = group_by_po(docs)

    # Run 3-way match per group
    all_results: list[MatchResult] = []
    seen_invoices: set[str] = set()

    for po_num, group in groups.items():
        results = match_group(
            po_num=po_num,
            pos=group["PO"],
            grns=group["GRN"],
            invoices=group["INVOICE"],
            seen_invoices=seen_invoices,
        )
        all_results.extend(results)

    # Build group summary
    group_summary: dict[str, dict] = {}
    for r in all_results:
        g = group_summary.setdefault(r.po_number, {
            "MATCHED": 0, "PARTIAL": 0, "MISMATCH": 0,
            "MISSING_PO": 0, "MISSING_GRN": 0, "DUPLICATE": 0,
        })
        g[r.status] = g.get(r.status, 0) + 1

    elapsed = round(time.time() - t0, 2)
    error_count = sum(1 for p in progresses.values() if p.status == "error")

    logger.info(
        "Bulk job %s done in %.2fs — %d docs, %d match results, %d errors",
        job_id, elapsed, len(docs), len(all_results), error_count,
    )

    return {
        "job_id": job_id,
        "elapsed_sec": elapsed,
        "total_files": len(files),
        "processed": len(docs),
        "errors": error_count,
        "match_results": [r.to_dict() for r in all_results],
        "group_summary": group_summary,
        "file_statuses": [
            {
                "filename":       p.filename,
                "status":         p.status,
                "doc_type":       p.doc_type,
                "error":          p.error,
                # Full extracted data — used by main.py to persist to DB
                "raw":            p.doc.raw   if p.doc else {},
                "po_number":      p.doc.po_number      if p.doc else "",
                "grn_number":     p.doc.grn_number     if p.doc else "",
                "invoice_number": p.doc.invoice_number if p.doc else "",
                "vendor":         p.doc.vendor         if p.doc else "",
                "total":          p.doc.total          if p.doc else 0,
                "tax":            p.doc.tax            if p.doc else 0,
                "currency":       p.doc.currency       if p.doc else "INR",
                "items":          p.doc.items          if p.doc else [],
            }
            for p in progresses.values()
        ],
    }
