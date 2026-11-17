# payroll/pdf_generator.py
"""Unified one-page, field-faithful payslip PDF renderer.

Consolidated module containing all 8 distinct client-selectable payslip designs,
ReportLab canvas layout engines, text-fitting geometry, and encryption.
"""
from __future__ import annotations

import io
import re
import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from django.conf import settings
from django.utils.text import slugify
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.units import mm
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from .models import PayslipRecord

try:
    from PIL import Image as PILImage
except ImportError:
    PILImage = None

try:
    from svglib.svglib import svg2rlg
except Exception:
    svg2rlg = None

_FONT, _BOLD, _ITALIC = 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique'


def _register_font():
    global _FONT, _BOLD, _ITALIC
    candidates = [
        ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
        (str(Path(__file__).parent / 'fonts' / 'DejaVuSans.ttf'), str(Path(__file__).parent / 'fonts' / 'DejaVuSans-Bold.ttf')),
        (str(Path(__file__).parent / 'pdf_generator' / 'fonts' / 'DejaVuSans.ttf'), str(Path(__file__).parent / 'pdf_generator' / 'fonts' / 'DejaVuSans-Bold.ttf')),
    ]
    for regular, bold in candidates:
        if Path(regular).exists() and Path(bold).exists():
            try:
                pdfmetrics.registerFont(TTFont('PayslipSans', regular))
                pdfmetrics.registerFont(TTFont('PayslipSans-Bold', bold))
                _FONT, _BOLD, _ITALIC = 'PayslipSans', 'PayslipSans-Bold', 'PayslipSans'
                return
            except Exception:
                pass


_register_font()


# =====================================================================
# SHARED FORMATTING & GEOMETRY HELPERS
# =====================================================================
ELLIPSIS = "\u2026"
def fit_font_size(c, text, font, max_size, max_width, min_size=6.0, step=0.25):
    """Largest size in [min_size, max_size] at which `text` fits `max_width`."""
    if not text:
        return max_size
    size = float(max_size)
    while size > min_size and c.stringWidth(text, font, size) > max_width:
        size -= step
    return max(size, min_size)
def truncate_to_width(c, text, font, size, max_width):
    """Hard-truncate with an ellipsis — last resort when even wrapping fails."""
    if not text or c.stringWidth(text, font, size) <= max_width:
        return text
    trimmed = text
    while trimmed and c.stringWidth(trimmed + ELLIPSIS, font, size) > max_width:
        trimmed = trimmed[:-1]
    return (trimmed.rstrip() + ELLIPSIS) if trimmed else ""
def wrap_lines(c, text, font, size, max_width, max_lines=2):
    """Word-wrap `text` into at most `max_lines` lines of `max_width`.

    Honours any newlines already present in the stored address, then wraps
    each of those on word boundaries. Overflow is ellipsized on the last
    line rather than dropped silently.
    """
    if not text:
        return []
    words = []
    for chunk in str(text).splitlines():
        words.extend(chunk.split())
    if not words:
        return []

    lines, current = [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if c.stringWidth(candidate, font, size) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
            if len(lines) == max_lines:
                break
    if len(lines) < max_lines and current:
        lines.append(current)

    # Anything that didn't fit gets folded onto the final line as an ellipsis.
    consumed = " ".join(lines)
    if len(" ".join(words)) > len(consumed):
        lines[-1] = truncate_to_width(c, lines[-1] + " " + ELLIPSIS, font, size, max_width)
    return [truncate_to_width(c, ln, font, size, max_width) for ln in lines]
def draw_fitted(c, x, y, text, font, max_size, max_width, min_size=6.0, align="left"):
    """Draw one line, auto-shrunk (then ellipsized) to fit `max_width`.

    `align` is "left" | "center" | "right"; for center/right, `x` is the
    centre/right edge of the box. Returns the font size actually used, so
    callers can advance their cursor consistently.
    """
    text = (text or "").strip()
    if not text:
        return max_size
    size = fit_font_size(c, text, font, max_size, max_width, min_size)
    text = truncate_to_width(c, text, font, size, max_width)
    c.setFont(font, size)
    if align == "center":
        c.drawCentredString(x, y, text)
    elif align == "right":
        c.drawRightString(x, y, text)
    else:
        c.drawString(x, y, text)
    return size
def draw_block(c, x, y, text, font, max_size, max_width, max_lines=2,
               min_size=6.0, leading_ratio=1.25, align="left",
               single_line_ratio=0.62):
    """Draw a wrapped text block that always fits its reserved box.

    Tries the largest font size at which the text wraps into `max_lines`
    lines; falls back to `min_size` with an ellipsis. Returns the y of the
    baseline *below* the block so the caller's layout stays deterministic
    regardless of how long the client's address is.
    """
    text = (text or "").strip()
    if not text:
        return y

    # Prefer ONE line when a modest shrink is enough — "Acme Pvt Ltd" should
    # stay on a single line rather than wrapping just because it is 2mm wide
    # at the maximum size. Only genuinely long strings fall through to
    # wrapping. This is what keeps short and long clients looking alike.
    single = fit_font_size(c, text, font, max_size, max_width,
                           min_size=max_size * single_line_ratio)
    if c.stringWidth(text, font, single) <= max_width:
        c.setFont(font, single)
        if align == "center":
            c.drawCentredString(x, y, text)
        elif align == "right":
            c.drawRightString(x, y, text)
        else:
            c.drawString(x, y, text)
        return y - single * leading_ratio

    size = float(max_size)
    lines = wrap_lines(c, text, font, size, max_width, max_lines)
    # Shrink until the whole string genuinely fits within max_lines
    # (i.e. wrapping no longer needs to ellipsize anything).
    while size > min_size and any(ELLIPSIS in ln for ln in lines):
        size -= 0.25
        lines = wrap_lines(c, text, font, size, max_width, max_lines)

    c.setFont(font, size)
    leading = size * leading_ratio
    cursor = y
    for line in lines:
        if align == "center":
            c.drawCentredString(x, cursor, line)
        elif align == "right":
            c.drawRightString(x, cursor, line)
        else:
            c.drawString(x, cursor, line)
        cursor -= leading
    return cursor



def client_logo_file(client):
    """The client's logo for the payslip letterhead: Client Management's logo (clients.Client.logo),
    else the old payroll-only copy (ClientProfile.payroll_logo) for clients not moved over yet.
    Returns the file only when it is actually on disk."""
    candidates = [getattr(client, 'logo', None)]
    _profile = getattr(client, 'payroll_profile', None)
    if _profile is not None:
        candidates.append(getattr(_profile, 'payroll_logo', None))
    for f in candidates:
        try:
            if f and f.name and Path(f.path).exists():
                return f
        except Exception:
            continue
    return None


def resized_logo_bytes(logo_path, max_px: int = 420) -> bytes | None:
    if PILImage is None:
        return None
    try:
        with PILImage.open(logo_path) as image:
            image = image.convert('RGBA') if image.mode in ('RGBA', 'LA', 'P') else image.convert('RGB')
            width, height = image.size
            longest = max(width, height)
            if longest > max_px:
                ratio = max_px / longest
                resampling = getattr(PILImage, 'Resampling', PILImage).LANCZOS
                image = image.resize((max(1, round(width * ratio)), max(1, round(height * ratio))), resampling)
            output = io.BytesIO()
            if image.mode == 'RGBA':
                image.save(output, format='PNG', optimize=True)
            else:
                image.save(output, format='JPEG', quality=85, optimize=True)
            return output.getvalue()
    except Exception:
        return None


def _slip_title(record) -> str:
    """Returns 'STIPEND SLIP' for interns / apprentices, 'SALARY SLIP' for regular employees."""
    if getattr(getattr(record, 'employee', None), 'is_intern', False):
        return 'STIPEND SLIP'
    return 'SALARY SLIP'


def _money(value):
    value = Decimal(str(value or 0))
    if not value:
        return ''
    return f"{value.quantize(Decimal('1'), rounding=ROUND_HALF_UP):,.0f}"


def _money_or_zero(value):
    try:
        val = Decimal(str(value or 0))
        return f"{val.quantize(Decimal('1'), rounding=ROUND_HALF_UP):,.0f}"
    except Exception:
        return '0'


def _leave(value):
    try:
        return f"{Decimal(str(value)):,.2f}"
    except Exception:
        return str(value)


def _days(value):
    try:
        n = Decimal(str(value))
        return f'{n:.0f}' if n == n.to_integral_value() else f'{n:,.2f}'
    except Exception:
        return str(value)


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[^A-Za-z0-9\s_-]', '', name or 'Employee').strip()
    return re.sub(r'\s+', '_', name) or 'Employee'


def _password_for(record):
    employee = record.employee
    name = re.sub(r'[^A-Za-z]', '', (employee.full_name or '').split()[0] if employee.full_name else '').upper()
    digits = re.sub(r'\D', '', employee.pan_number or '')
    return f"{name[:4].ljust(4, 'X')}{digits}" if digits else employee.employee_code


def _extract_custom_specs(record):
    custom_earnings = []
    custom_deductions = []
    cc = getattr(record, "custom_components", {})
    if isinstance(cc, dict):
        has_nested = "earnings" in cc or "deductions" in cc
        if has_nested:
            for item in cc.get("earnings", []):
                amt = item.get("amount", 0)
                custom_earnings.append((item.get("name", item.get("code")), amt, item.get("remove_if_zero_valued", True)))
            for item in cc.get("deductions", []):
                if item.get("code") == "ESI":
                    continue  # Handled as dedicated statutory ESI deduction
                amt = item.get("amount", 0)
                custom_deductions.append((item.get("name", item.get("code")), amt, item.get("remove_if_zero_valued", True)))
        else:
            METADATA_KEYS = {"esi_opted", "employer_esi", "employer_esi_in_ctc", "esi_number", "uan_number"}
            for code, val in cc.items():
                if code in METADATA_KEYS:
                    continue
                if isinstance(val, dict):
                    amt = val.get("amount", 0)
                    name = val.get("name", code.replace("_", " ").title())
                    comp_type = str(val.get("type", "EARNING")).upper()
                    if comp_type == "DEDUCTION":
                        custom_deductions.append((name, amt, True))
                    else:
                        custom_earnings.append((name, amt, True))
                else:
                    custom_earnings.append((code.replace("_", " ").title(), val, True))
    return custom_earnings, custom_deductions


_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']


def _two(n): return _ONES[n] if n < 20 else _TENS[n // 10] + ('' if n % 10 == 0 else ' ' + _ONES[n % 10])
def _three(n): return _two(n) if n < 100 else _ONES[n // 100] + ' Hundred' + ('' if n % 100 == 0 else ' ' + _two(n % 100))
def _words(n):
    if not n: return 'Zero'
    result = []
    for divisor, label in ((10_000_000, 'Crore'), (100_000, 'Lakh'), (1000, 'Thousand')):
        part, n = divmod(n, divisor)
        if part: result.append(_three(part) + ' ' + label)
    if n: result.append(_three(n))
    return ' '.join(result)


def amount_in_words(amount):
    rupees = int(Decimal(str(amount)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    return 'Rupees ' + _words(rupees) + ' Only'


def _structure(record):
    try:
        from .models import EmployeeSalaryStructure
    except (ImportError, ValueError):
        from models import EmployeeSalaryStructure
    snapshot = getattr(record, "salary_structure_snapshot", None) if record else None
    batch = getattr(record, "batch", None) if record else None
    obj = None
    if batch and getattr(record, "employee", None):
        last_day = calendar.monthrange(batch.year, batch.month)[1]
        month_end = date(batch.year, batch.month, last_day)
        obj = (
            EmployeeSalaryStructure.objects.filter(
                employee=record.employee,
                effective_from__lte=month_end,
            )
            .order_by("-effective_from", "-created_at")
            .first()
        )
    if obj is None and snapshot is not None:
        obj = snapshot
    return obj, bool(obj.pf_opted) if obj else bool(getattr(record, "epf", 0))


def _encrypt_pdf_inplace(path: Path, password: str) -> None:
    try:
        from pypdf import PdfReader, PdfWriter
        reader = PdfReader(str(path))
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        writer.encrypt(password)
        with path.open('wb') as file:
            writer.write(file)
    except ImportError:
        return


def _draw_lock_icon(c, x, y, size, colour):
    c.saveState()
    c.setStrokeColor(colors.HexColor(colour))
    c.setFillColor(colors.HexColor(colour))
    c.setLineWidth(1.0)
    q = size / 16.0
    # Lock body
    c.roundRect(x + 2 * q, y + 1 * q, 12 * q, 9 * q, 1.5 * q, stroke=1, fill=0)
    # Shackle
    p = c.beginPath()
    p.moveTo(x + 4.5 * q, y + 10 * q)
    p.lineTo(x + 4.5 * q, y + 13 * q)
    p.curveTo(x + 4.5 * q, y + 15.5 * q, x + 11.5 * q, y + 15.5 * q, x + 11.5 * q, y + 13 * q)
    p.lineTo(x + 11.5 * q, y + 10 * q)
    c.drawPath(p, stroke=1, fill=0)
    # Keyhole
    c.circle(x + 8 * q, y + 6 * q, 1.2 * q, stroke=0, fill=1)
    c.rect(x + 7.4 * q, y + 3.5 * q, 1.2 * q, 2.2 * q, stroke=0, fill=1)
    c.restoreState()


def _employer_pf_note(c, structure, cx, y, record=None):
    """One-line employer statutory contribution disclosure (PF / ESI / LWF), drawn in the
    same quiet slate style as the system-generated footer note. Respects independent
    show_employer_contribution_in_payslip and show_employer_esi_in_payslip flags."""
    if not structure and not record:
        return
    client = None
    if record and getattr(record, 'batch', None):
        client = getattr(record.batch, 'client', None)
    if not client and structure:
        employee = getattr(structure, 'employee', None)
        client = getattr(employee, 'client', None) if employee else None
    profile = getattr(client, 'payroll_profile', None) if client else None

    show_pf = True if profile is None else bool(getattr(profile, 'show_employer_contribution_in_payslip', True))
    show_esi = True if profile is None else bool(getattr(profile, 'show_employer_esi_in_payslip', True))
    if not show_pf and not show_esi:
        return

    amount = getattr(structure, 'employer_pf', None) if structure else None
    if record and getattr(record, 'epf', None) is not None and (not structure or getattr(structure, 'pf_opted', True)):
        if getattr(record, 'actual_working_days', None) is not None and getattr(record, 'days_in_month', None) is not None:
            if record.actual_working_days < record.days_in_month:
                amount = record.epf

    emp_esi = getattr(structure, 'employer_esi', None) if structure else None
    if not emp_esi and record:
        emp_esi = getattr(record, 'employer_esi', None)

    emp_lwf = None
    if record and getattr(record, 'lwf', None) and Decimal(str(record.lwf or 0)) > 0 and profile is not None:
        raw_empr_lwf = getattr(profile, 'lwf_employer_amount', None)
        if raw_empr_lwf is not None and Decimal(str(raw_empr_lwf or 0)) > 0:
            emp_lwf = Decimal(str(raw_empr_lwf))

    parts = []
    agencies = []
    if show_pf and amount and amount > 0:
        parts.append(f"Employer PF ₹{_money(amount)}")
        agencies.append("EPFO")
    if show_esi and emp_esi and emp_esi > 0:
        parts.append(f"Employer ESI ₹{_money(emp_esi)}")
        agencies.append("ESIC")
    if (show_pf or show_esi) and emp_lwf and emp_lwf > 0:
        parts.append(f"Employer LWF ₹{_money(emp_lwf)}")
        agencies.append("LWF Board")

    if not parts:
        return
    agency = " & ".join(agencies) if len(agencies) <= 2 else ", ".join(agencies[:-1]) + f" & {agencies[-1]}"
    text = f"{' · '.join(parts)} — Paid by employer to {agency} (for information only, not deducted from salary)"
    c.setFont(_FONT, 7.5)
    c.setFillColor(colors.HexColor('#475569'))
    c.drawCentredString(cx, y, text)


def _get_cycle_period_text(record):
    """Returns pay cycle period text like '21 Sep 2026 – 20 Oct 2026' if non-calendar cycle configured, else None."""
    batch = getattr(record, 'batch', None)
    if not batch:
        return None
    client = getattr(batch, 'client', None)
    profile = getattr(client, 'payroll_profile', None) if client else None
    if not profile:
        return None
    start = getattr(profile, 'cycle_start_day', 1) or 1
    end = getattr(profile, 'cycle_end_day', 0) or 0
    if start == 1 and end == 0:
        return None

    y, m = batch.year, batch.month
    prev_y, prev_m = (y - 1, 12) if m == 1 else (y, m - 1)
    max_prev = calendar.monthrange(prev_y, prev_m)[1]
    clamped_start = min(start, max_prev)
    max_curr = calendar.monthrange(y, m)[1]
    clamped_end = max_curr if end == 0 else min(end, max_curr)
    try:
        d1 = date(prev_y, prev_m, clamped_start)
        d2 = date(y, m, clamped_end)
        return f"{d1.strftime('%d %b %Y')} – {d2.strftime('%d %b %Y')}"
    except Exception:
        return None


def _get_payment_mode_info(record):
    """Returns (mode_text, bank_str) if payment mode display is enabled on client profile, else None."""
    employee = getattr(record, 'employee', None)
    if not employee:
        return None
    batch = getattr(record, 'batch', None)
    client = getattr(batch, 'client', None) if batch else getattr(employee, 'client', None)
    profile = getattr(client, 'payroll_profile', None) if client else None
    if profile and not getattr(profile, 'show_payment_mode_in_payslip', True):
        return None

    mode = getattr(employee, 'effective_payment_mode_display', 'Wire Transfer')
    bank_name = (getattr(employee, 'bank_name', '') or '').strip()
    bank_acc = (getattr(employee, 'bank_account_number', '') or '').strip()
    masked_acc = f"••••{bank_acc[-4:]}" if len(bank_acc) > 4 else bank_acc

    if bank_name and masked_acc:
        bank_str = f"{bank_name} · A/C {masked_acc}"
    elif bank_name:
        bank_str = bank_name
    elif masked_acc:
        bank_str = f"A/C {masked_acc}"
    else:
        bank_str = '—'

    return mode, bank_str


def _get_leave_summary_str(record):
    """If client has track_leave_ledger enabled and closing balance exists, returns 'X (Bal: Y)', else 'X'."""
    leave_used = _leave(record.paid_leave_days)
    batch = getattr(record, 'batch', None)
    client = getattr(batch, 'client', None) if batch else None
    profile = getattr(client, 'payroll_profile', None) if client else None
    if profile and not getattr(profile, 'track_leave_ledger', True):
        return leave_used

    closing = getattr(record, 'leave_closing_balance', None)
    if closing is not None:
        return f"{leave_used} (Bal: {_leave(closing)})"
    return leave_used


def _get_payment_mode_display_text(record):
    """Returns formatted payment mode string (e.g. 'Mode of Payment: Bank Transfer / NEFT / RTGS (HDFC Bank · A/C ••••1234)')
    if enabled on client profile, else None.
    """
    info = _get_payment_mode_info(record)
    if not info:
        return None
    mode, bank_str = info
    if bank_str and bank_str != '—':
        return f"Mode of Payment: {mode} ({bank_str})"
    return f"Mode of Payment: {mode}"


def _get_payment_mode_line(record):
    """Legacy helper: returns ('card', 'Payment Mode', mode_text) or None."""
    info = _get_payment_mode_info(record)
    if not info:
        return None
    return ('card', 'Payment Mode', info[0])



# =====================================================================
# DESIGN 1: Classic Firm Portrait
# =====================================================================
_NAVY, _NAVY2, _NAVY3 = '#102b56', '#183d73', '#0c2345'
_GREEN, _GREEN_T = '#087a35', '#edf8f0'
_RED, _RED_T = '#c61721', '#fff0f1'
_TEXT, _MUTED, _GRID = '#12213b', '#526277', '#e8edf4'

_COMMON_ICONS = {
    'employee-details': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 2v2"/><path d="M7 21v-2a2 2 0 012-2h6a2 2 0 012 2v2"/><path d="M8 2v2"/><circle cx="12" cy="10" r="3"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
    'id': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg>',
    'person': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
    'user': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
    'briefcase': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12h.01"/><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M22 13a18.15 18.15 0 0 1-20 0"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>',
    'briefcase-check': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12h.01"/><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M22 13a18.15 18.15 0 0 1-20 0"/><rect width="20" height="14" x="2" y="6" rx="2"/><path d="m9 12 2 2 4-4"/></svg>',
    'building': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M10 8h4"/><path d="M10 12h4"/></svg>',
    'card': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>',
    'mail': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>',
    'calendar': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>',
    'rupee': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></svg>',
    'calendar-days': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/></svg>',
    'calendar-clock': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 14v2.2l1.6 1"/><path d="M16 2v3"/><path d="M21 7.338V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2.338"/><path d="M3 9h5.859"/><path d="M8 2v3"/><circle cx="16" cy="16" r="6"/></svg>',
    'clock': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6"/><polyline points="12 10 12 12 13 13"/><path d="M16.13 7.13 19 10"/><path d="M18 21v-3a2 2 0 0 0-4 0v3"/></svg>',
    'calendar-check': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
    'calendar-x': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m14 14 4 4"/><path d="m18 14-4 4"/></svg>',
    'calendar-minus': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18h6"/><path d="M16 2v3"/><path d="M21 14V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h8.3"/><path d="M3 9h18"/><path d="M8 2v3"/></svg>',
    'plane': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>',
    'wallet': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>',
    'landmark': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>',
    'shield': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
    'shield-lock': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9.807V6a1 1 0 00-1-1c-2 0-4.49-1.19-6.24-2.72a1.17 1.17 0 00-1.52 0C9.5 3.8 7 5 5 5a1 1 0 00-1 1v7c0 3.88 2.107 6.254 5 7.796"/><path d="M19 17v-2a2 2 0 00-4 0v2"/><rect x="13" y="17" width="8" height="5" rx="1"/></svg>',
    'map-pin': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
    'lock': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    'banknote': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>',
    'calendar-heart': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M12 17.5a2.5 2.5 0 0 0 3.2-2.3c0-1.4-1.8-2.4-3.2-3-1.4.6-3.2 1.6-3.2 3a2.5 2.5 0 0 0 3.2 2.3Z"/></svg>',
    'palmtree': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l2.5-2.5 2.5 2.5H11z"/><path d="M13 7.5a5.5 5.5 0 0 1 5.5 5.5c0 1.6-.5 3-1.3 4"/><path d="M15 12a5 5 0 0 0-5 5v4h4v-4a5 5 0 0 1 5-5h-4Z"/></svg>',
    'beach': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10V3"/><path d="M12 10a5 5 0 0 1 5 5c0 1.5-.5 2.5-1.5 3.5a5 5 0 0 1-3.5 1.5a5 5 0 0 1-3.5-1.5C7.5 17.5 7 16.5 7 15a5 5 0 0 1 5-5Z"/><path d="M2 21h20"/></svg>',
    'sun': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    'umbrella': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 0-9.95 9h11.64L9.74 7.05a10 10 0 0 0 2.26 0L8.05 11H19.95A10 10 0 0 0 12 2Z"/><path d="M12 22a1 1 0 0 0 1-1v-2a1 1 0 0 0-2 0v2a1 1 0 0 0 1 1Z"/></svg>',
    'document': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>',
}

_ICON_ALIASES = {
    'bank': 'landmark',
    'days-in-month': 'calendar-days',
    'working-days': 'calendar-check',
    'lop-days': 'calendar-x',
    'user': 'person',
    'contact': 'employee-details',
}


def _draw_svg_icon(c, kind, x, y, size, colour):
    """Draw the embedded Lucide SVG at an exact square size."""
    if svg2rlg is None:
        return False
    actual_kind = _ICON_ALIASES.get(kind, kind)
    if actual_kind not in _COMMON_ICONS:
        return False
    try:
        svg = _COMMON_ICONS[actual_kind].replace('currentColor', colour)
        drawing = svg2rlg(io.StringIO(svg))
        scale = size / drawing.width
        drawing.scale(scale, scale)
        drawing.drawOn(c, x, y)
        return True
    except Exception:
        return False


# Unified backward compatibility aliases
_draw_lucide = _draw_svg_icon
_draw_lucide_svg = _draw_svg_icon
_LUCIDE_SVG = _COMMON_ICONS


def _draw_icon(c, kind, x, y, size, colour, stroke=1.55):
    """Draw a semantic, professional outline icon in a size×size box.
    Prefers exact Lucide SVG via svglib with fallback to crisp ReportLab canvas vectors.
    """
    if _draw_svg_icon(c, kind, x, y, size, colour):
        return
    actual_kind = _ICON_ALIASES.get(kind, kind)
    actual_kind = {'days-in-month': 'calendar', 'lop-days': 'calendar-minus', 'employee-details': 'person', 'landmark': 'landmark'}.get(actual_kind, actual_kind)
    s, q = size, size / 24.0
    c.saveState(); c.setStrokeColor(colors.HexColor(colour)); c.setFillColor(colors.HexColor(colour))
    c.setLineWidth(stroke * q); c.setLineCap(1); c.setLineJoin(1)
    def line(a,b,d,e): c.line(x+a*q, y+b*q, x+d*q, y+e*q)
    def rect(a,b,w,h,r=2): c.roundRect(x+a*q, y+b*q, w*q, h*q, r*q, stroke=1, fill=0)
    def circle(a,b,r): c.circle(x+a*q, y+b*q, r*q, stroke=1, fill=0)
    def dot(a,b,r=1): c.circle(x+a*q, y+b*q, r*q, stroke=0, fill=1)
    if actual_kind in ('person', 'user'):
        circle(12, 16.5, 3.5); c.arc(x+4*q,y+2*q,x+20*q,y+14*q,0,180)
    elif actual_kind == 'id':
        rect(2,3,20,18); circle(8,14.2,2.2); c.arc(x+5.1*q,y+7*q,x+10.9*q,y+12.6*q,0,180); line(14,15,19,15); line(14,11,19,11)
    elif actual_kind == 'briefcase':
        rect(2,6,20,14); rect(8,3,8,4); line(2,12,22,12); line(10,12,14,12)
    elif actual_kind == 'building':
        rect(4,2,16,20); line(9,2,9,7); line(15,2,15,7)
        for yy in (10,14,18):
            for xx in (8,12,16): dot(xx,yy,.65)
    elif actual_kind == 'card':
        rect(1.5,4,21,16); line(1.5,10,22.5,10); line(5,15,10,15)
    elif actual_kind == 'mail':
        rect(2,4,20,16); line(2,18,12,11); line(22,18,12,11)
    elif actual_kind == 'map-pin':
        c.circle(x+12*q, y+14*q, 7*q, stroke=1, fill=0)
        p = c.beginPath(); p.moveTo(x+5*q, y+14*q); p.curveTo(x+5*q,y+8*q,x+9*q,y+4*q,x+12*q,y+1.5*q); p.curveTo(x+15*q,y+4*q,x+19*q,y+8*q,x+19*q,y+14*q); c.drawPath(p,stroke=1,fill=0)
        dot(12,14,1.75)
    elif actual_kind in ('calendar', 'calendar-minus', 'calendar-days', 'calendar-check', 'calendar-x'):
        rect(3,3,18,18); line(3,16,21,16); line(8,21,8,18); line(16,21,16,18)
        if actual_kind in ('calendar-minus', 'calendar-x'):
            line(8,10,16,10)
            if actual_kind == 'calendar-x': line(12,6,12,14)
        elif actual_kind == 'calendar-check':
            line(7,10,10,7); line(10,7,17,13)
        else:
            for yy in (12,8):
                for xx in (8,12,16): dot(xx,yy,.65)
    elif actual_kind == 'calendar-clock':
        rect(3,3,13,18); line(3,16,16,16); line(7,21,7,18); line(12,21,12,18); circle(18,8,4); line(18,8,18,10.5); line(18,8,20.2,7)
    elif actual_kind == 'plane':
        p = c.beginPath(); p.moveTo(x+2*q,y+10*q); p.lineTo(x+22*q,y+21*q); p.lineTo(x+14*q,y+2*q); p.close(); c.drawPath(p,stroke=1,fill=0); line(2,10,12,12); line(12,12,22,21)
    elif actual_kind == 'rupee':
        c.setFont(_BOLD, size*.77); c.drawCentredString(x+12*q, y+4*q, '₹')
    elif actual_kind == 'wallet':
        rect(2,5,19,15); c.arc(x+2*q,y+14*q,x+8*q,y+20*q,90,180); rect(15,10,7,6,2); dot(18,13,.65)
    elif actual_kind == 'landmark':
        line(3,3,21,3); line(6,3,6,15); line(10,3,10,15); line(14,3,14,15); line(18,3,18,15)
        p = c.beginPath(); p.moveTo(x+12*q,y+22*q); p.lineTo(x+21*q,y+16*q); p.lineTo(x+3*q,y+16*q); p.close(); c.drawPath(p,stroke=1,fill=0)
    elif actual_kind == 'shield':
        p=c.beginPath(); p.moveTo(x+12*q,y+2*q); p.lineTo(x+20*q,y+6*q); p.lineTo(x+20*q,y+14*q); p.curveTo(x+20*q,y+19*q,x+16*q,y+21*q,x+12*q,y+23*q); p.curveTo(x+8*q,y+21*q,x+4*q,y+19*q,x+4*q,y+14*q); p.lineTo(x+4*q,y+6*q); p.close(); c.drawPath(p,stroke=1,fill=0)
    elif actual_kind == 'shield-lock':
        _draw_icon(c,'shield',x,y,size,colour,stroke); rect(8,7,8,7,1); c.arc(x+9.5*q,y+12*q,x+14.5*q,y+17*q,0,180); dot(12,10,.75)
    elif actual_kind in ('lock', 'shield-lock'):
        rect(5,2,14,12,2); c.arc(x+7*q,y+10*q,x+17*q,y+20*q,0,180); dot(12,8,1)
    elif actual_kind == 'money':
        circle(12,12,9); c.setFont(_BOLD,size*.62); c.drawCentredString(x+12*q,y+5*q,'₹')
    else:
        circle(12, 12, 8)
    c.restoreState()


_icon = _draw_icon
_draw_lucide_icon = _draw_icon


def _draw_dot_matrix(c, x, y, cols, rows, spacing=2.3 * mm, color='#c5bede', dot_size=0.38 * mm):
    c.saveState()
    c.setFillColor(colors.HexColor(color))
    for r in range(rows):
        for col in range(cols):
            c.circle(x + col * spacing, y + r * spacing, dot_size, stroke=0, fill=1)
    c.restoreState()


def _build_employee_detail_pairs(record: PayslipRecord, uppercase_labels: bool = False):
    """Builds the standardized 14-field employee detail grid using Design 8's icons
    and pairings as the unified standard across all payslip designs.

    Returns a list of pairs:
    [
        ((left_icon, left_label, left_value), (right_icon, right_label, right_value)),
        ...
    ]
    """
    employee = record.employee
    client = getattr(record.batch, 'client', None) if getattr(record, 'batch', None) else None
    profile = getattr(client, 'payroll_profile', None) if client else None
    structure, _ = _structure(record)
    ctc = _money(structure.ctc_annual) if structure else '—'
    leave_str = _get_leave_summary_str(record)

    def _lbl(text):
        return text.upper() if uppercase_labels else text

    esi_no = getattr(employee, 'esi_number', None)
    show_uan = getattr(profile, 'show_uan_in_payslip', True) if profile else True
    uan_no = getattr(employee, 'uan_number', None)

    # Bank account integration (Option 4)
    pm_info = _get_payment_mode_info(record)
    bank_str = pm_info[1] if pm_info and len(pm_info) > 1 else '—'
    if not bank_str or bank_str == '—':
        b_name = (getattr(employee, 'bank_name', '') or '').strip()
        b_acc = (getattr(employee, 'bank_account_number', '') or '').strip()
        m_acc = f"••••{b_acc[-4:]}" if len(b_acc) > 4 else b_acc
        if b_name and m_acc:
            bank_str = f"{b_name} · A/C {m_acc}"
        elif m_acc:
            bank_str = f"A/C {m_acc}"
        else:
            bank_str = '—'

    if show_uan:
        # Symmetrical 7-row layout with dedicated statutory row: PAN and UAN side-by-side
        sec_field = ('shield', _lbl('ESI Number'), str(esi_no)) if esi_no else ('landmark', _lbl('Bank Account'), bank_str)
        pairs = [
            (('id', _lbl('Employee Code'), employee.employee_code or '—'),
             ('person', _lbl('Employee Name'), employee.full_name or '—')),
            (('briefcase', _lbl('Designation'), employee.position or '—'),
             ('building', _lbl('Department'), employee.department or '—')),
            (('calendar', _lbl('Date of Joining'), str(employee.hire_date or '—')),
             ('mail', _lbl('Email'), employee.email or '—')),
            (('card', _lbl('PAN Number'), employee.pan_number or '—'),
             ('shield', _lbl('UAN Number'), str(uan_no or '—'))),
            (('rupee', _lbl('CTC (Annual)'), str(ctc)),
             ('calendar-days', _lbl('Days in Month'), _days(record.days_in_month))),
            (('calendar-check', _lbl('Working Days'), _days(record.actual_working_days)),
             ('plane', _lbl('Paid Leave'), leave_str)),
            (('calendar-x', _lbl('LOP Days'), _leave(record.lop_days)),
             sec_field),
        ]
    else:
        # Standard 6-row layout with standalone PAN Number (zero UAN)
        pairs = [
            (('id', _lbl('Employee Code'), employee.employee_code or '—'),
             ('person', _lbl('Employee Name'), employee.full_name or '—')),
            (('briefcase', _lbl('Designation'), employee.position or '—'),
             ('building', _lbl('Department'), employee.department or '—')),
            (('card', _lbl('PAN Number'), employee.pan_number or '—'),
             ('mail', _lbl('Email'), employee.email or '—')),
            (('calendar', _lbl('Date of Joining'), str(employee.hire_date or '—')),
             ('rupee', _lbl('CTC (Annual)'), str(ctc))),
            (('calendar-days', _lbl('Days in Month'), _days(record.days_in_month)),
             ('calendar-check', _lbl('Working Days'), _days(record.actual_working_days))),
            (('plane', _lbl('Paid Leave'), leave_str),
             ('calendar-x', _lbl('LOP Days'), _leave(record.lop_days))),
        ]
    return pairs


def _badge(c, kind, x, y, diameter, background, glyph='#ffffff', ring=None):
    c.saveState(); c.setFillColor(colors.HexColor(background)); c.setStrokeColor(colors.HexColor(ring or background)); c.setLineWidth(1 if ring else 0)
    c.circle(x+diameter/2,y+diameter/2,diameter/2-0.5,stroke=1 if ring else 0,fill=1); c.restoreState()
    _icon(c,kind,x+diameter*.16,y+diameter*.16,diameter*.68,glyph,1.75)


def _round(c, x, y, w, h, fill, stroke='#d9e1ea', radius=4*mm, width=.7):
    c.setFillColor(colors.HexColor(fill)); c.setStrokeColor(colors.HexColor(stroke)); c.setLineWidth(width); c.roundRect(x,y,w,h,radius,stroke=1,fill=1)


def _logo(c, client, x, y, max_w, max_h):
    _profile = getattr(client, 'payroll_profile', None)
    logo = client_logo_file(client)
    if logo and PILImage:
        try:
            data = resized_logo_bytes(logo.path)
            if data:
                with PILImage.open(io.BytesIO(data)) as im:
                    iw, ih = im.size
                ratio = min(max_w/iw, max_h/ih); w,h=iw*ratio,ih*ratio
                c.drawImage(ImageReader(io.BytesIO(data)),x+(max_w-w)/2,y+(max_h-h)/2,w,h,mask='auto'); return
        except Exception: pass
    c.setFillColor(colors.white); draw_fitted(c, x+max_w/2, y+max_h/2-4, (client.name or 'COMPANY').upper(), _BOLD, 12, max_w-4, min_size=6, align='center')


def _draw_detail_row(c, y, left, right, icon, label, value):
    # Clean, modern presentation: icon sits directly on the white card without a box tile.
    _icon(c, icon, left + 0.5 * mm, y + 3.6 * mm, 5.2 * mm, '#173862', 1.8)
    baseline = y + 6.0 * mm
    c.setFont(_BOLD, 8.15); c.setFillColor(colors.HexColor('#1b355d')); c.drawString(left + 8.0 * mm, baseline, label)
    # Value cell is fitted to the remaining column width, so long employee
    # names / emails shrink instead of running into the next column.
    c.setFillColor(colors.HexColor(_TEXT))
    val_x = left + 42 * mm
    draw_block(c, val_x, baseline, str(value), _FONT, 8.35,
               max(right - val_x, 10), max_lines=2, min_size=6,
               leading_ratio=1.05)
    # Continuous row separator spanning the column width
    c.setStrokeColor(colors.HexColor(_GRID)); c.setLineWidth(.55)
    c.line(left, y + 1.3 * mm, right, y + 1.3 * mm)


def _draw_money_card(c, x, y, w, h, accent, tint, title, icon, rows):
    _round(c,x,y,w,h,'#ffffff'); header=12*mm
    c.setFillColor(colors.HexColor(tint)); c.roundRect(x+.4,y+h-header,w-.8,header,4*mm,stroke=0,fill=1); c.rect(x+.4,y+h-header,w-.8,header-4*mm,stroke=0,fill=1)
    # Header icons use their section accent directly—no competing round badge.
    _icon(c, icon, x + 5 * mm, y + h - header + 2 * mm, 8 * mm, accent, 1.8)
    c.setFont(_BOLD,10); c.setFillColor(colors.HexColor(accent)); c.drawString(x+15*mm,y+h-header/2-3,title)
    c.setFont(_BOLD,7.6); c.drawRightString(x+w-5*mm,y+h-header/2-2.5,'Amount (₹)')
    row_h=(h-header)/len(rows); yy=y+h-header
    for label,value,kind in rows:
        yy-=row_h
        if kind == 'total':
            # Preserve the money card's rounded lower corners.  A plain rect
            # would square them off, which is especially noticeable on the
            # EARNED SALARY and TOTAL DEDUCTIONS rows.
            c.setFillColor(colors.HexColor(tint))
            bottom_radius = min(4 * mm, row_h / 2)
            c.roundRect(x + .5, yy, w - 1, row_h, bottom_radius, stroke=0, fill=1)
            # Square only the top of the final row; its bottom stays rounded.
            c.rect(x + .5, yy + row_h - bottom_radius, w - 1, bottom_radius, stroke=0, fill=1)
        c.setStrokeColor(colors.HexColor(_GRID)); c.setLineWidth(.55); c.line(x+.5,yy+row_h,x+w-.5,yy+row_h)
        c.setFont(_BOLD if kind else _FONT,8.5); c.setFillColor(colors.HexColor(accent if kind else '#263850')); c.drawString(x+6*mm,yy+row_h/2-3,label)
        c.drawRightString(x+w-6*mm,yy+row_h/2-3,value)


def _build_pdf_bytes_1(record: PayslipRecord, encryption=None) -> bytes:  # noqa: ARG001
    employee, client, batch = record.employee, record.batch.client, record.batch
    structure, pf_opted = _structure(record)
    ctc = _money(structure.ctc_annual) if structure else '—'
    buf=io.BytesIO()
    # ReportLab applies this at document creation, so the returned bytes are
    # password-protected without depending on a separate post-processing tool.
    c=canvas.Canvas(buf, pagesize=A4, encrypt=encryption)
    W,H=A4; margin=8*mm; content=W-2*margin

    # Header: unchanged content, refined presentation.
    c.setFillColor(colors.HexColor(_NAVY)); c.rect(0,H-32*mm,W,32*mm,stroke=0,fill=1)
    c.setFillColor(colors.HexColor(_NAVY2)); p=c.beginPath(); p.moveTo(W*.62,H);p.lineTo(W,H);p.lineTo(W,H-32*mm);p.lineTo(W*.76,H-32*mm);p.close();c.drawPath(p,stroke=0,fill=1)
    _logo(c,client,10*mm,H-26*mm,42*mm,17*mm); c.setStrokeColor(colors.HexColor('#6680a4')); c.line(58*mm,H-27*mm,58*mm,H-7*mm)
    # Header text is fitted, never hardcoded: a very long client name (or a
    # long address) must shrink/wrap inside its own box instead of running
    # under the right-hand "SALARY SLIP" block or off the sheet.
    _title_txt = _slip_title(record)
    _right_block_w = max(
        c.stringWidth(_title_txt, _BOLD, 19),
        c.stringWidth(f'{calendar.month_name[batch.month].upper()} {batch.year}', _BOLD, 10.5),
    )
    _hdr_x = 68 * mm
    _hdr_w = (W - 10 * mm - _right_block_w - 6 * mm) - _hdr_x
    c.setFillColor(colors.white)
    # Wraps to a second line before it shrinks, so a 60-character company
    # name stays readable instead of being ellipsized down to nothing.
    draw_block(c, _hdr_x, H - 13 * mm, (client.name or '').upper(), _BOLD, 14,
               _hdr_w, max_lines=2, min_size=8.5, leading_ratio=1.15)
    _icon(c, 'map-pin', 68 * mm, H - 25 * mm, 5 * mm, '#cfe0fa')
    c.setFillColor(colors.HexColor('#e3ecfa'))
    draw_block(
        c, 75 * mm, H - 22.5 * mm, (client.address or 'Chartered Accountants'),
        _FONT, 8.5, _hdr_w - 7 * mm, max_lines=2, min_size=6.2,
    )
    c.setFont(_BOLD,19);c.setFillColor(colors.white);c.drawRightString(W-10*mm,H-14*mm,_title_txt);c.setFont(_BOLD,10.5);c.setFillColor(colors.HexColor('#72b2ff'));c.drawRightString(W-10*mm,H-22*mm,f'{calendar.month_name[batch.month].upper()} {batch.year}')
    _cycle_text = _get_cycle_period_text(record)
    if _cycle_text:
        c.setFont(_FONT, 7.5); c.setFillColor(colors.HexColor('#c3dafe')); c.drawRightString(W-10*mm, H-26.5*mm, f'Period: {_cycle_text}')

    # Employee details card.
    y=H-37*mm; dh=82*mm; _round(c,margin,y-dh,content,dh,'#ffffff')
    c.setFillColor(colors.HexColor('#f4f7fc'));c.roundRect(margin+.5,y-12*mm,content-1,12*mm,4*mm,stroke=0,fill=1);c.rect(margin+.5,y-12*mm,content-1,8*mm,stroke=0,fill=1)
    # Direct navy outline icon, consistent with the other section headings.
    _icon(c, 'employee-details', margin + 5 * mm, y - 10.3 * mm, 8.5 * mm, _NAVY, 1.8)
    c.setFont(_BOLD,10.5);c.setFillColor(colors.HexColor(_NAVY));c.drawString(margin+16*mm,y-7.4*mm,'EMPLOYEE DETAILS')
    gx = margin + 5 * mm
    mid = margin + content / 2
    detail_pairs = _build_employee_detail_pairs(record, uppercase_labels=False)
    n_rows = len(detail_pairs)
    # Symmetrically balanced padding (5.0mm below header, 5.0mm above card bottom)
    ry_start = y - 25.8 * mm
    ry_end = (y - dh) + 3.7 * mm
    step_y = (ry_start - ry_end) / max(n_rows - 1, 1)

    c.setStrokeColor(colors.HexColor('#dce5f0'))
    c.line(mid, y - 15 * mm, mid, ry_end + 1.3 * mm)

    ry = ry_start
    for (a, b, d), (e, f, g) in detail_pairs:
        _draw_detail_row(c, ry, gx, mid - 4 * mm, a, b, d)
        _draw_detail_row(c, ry, mid + 5 * mm, margin + content - 5 * mm, e, f, g)
        ry -= step_y

    # Earnings / deductions: same fields and calculations as the original renderer.
    custom_earn_specs, custom_ded_specs = _extract_custom_specs(record)
    def rows(spec): return [(name,_money(value) or '0.00',None) for name,value,optional in spec if not(optional and value==0)]
    earn=rows([('Basic + DA',record.basic_da,False),('HRA',record.hra,False),('Leave Travel Allowance',record.lta,True),('Special Allowance',record.special_allowance,False),('NPS Allowance',record.nps_allowance_earned,True),('Variable Pay',record.variable_pay,True),('Commission / Other',record.commission_other,True),('Salary Advance Given',record.salary_advance_disbursed,True),('On Hold Released',record.on_hold_released,True),('Reimbursement',record.reimbursements,True),('Arrears',record.arrears,True)] + custom_earn_specs)
    ded=rows([('EPF',record.epf,not pf_opted),('ESI',getattr(record,'esi',0),True),('VPF',record.vpf,True),('VPF Arrears',record.vpf_arrears,True),('Professional Tax',record.professional_tax,False),('TDS',record.tds,False),('NPS Deduction',record.nps_deduction,True),('NPS Deduction – Arrears',record.nps_deduction_arrears,True),('Loan Deduction',record.loan_deduction,True),('Salary Advance Recovered',record.salary_advance_recovered,True),('On Hold Deducted',record.on_hold_deducted,True),('LWF',record.lwf,True),('Other Deduction',record.other_deduction,True)] + custom_ded_specs)
    earn += [('GROSS SALARY',_money(record.gross_salary) or '0.00','bold'),('EARNED SALARY',_money(record.earned_salary) or '0.00','total')]
    while len(ded)<len(earn)-1: ded.append(('', '', None))
    ded += [('TOTAL DEDUCTIONS',_money(record.total_deductions) or '0.00','total')]
    cy=y-dh-5*mm; card_w=(content-6*mm)/2; card_h=12*mm+len(earn)*8*mm
    _draw_money_card(c,margin,cy-card_h,card_w,card_h,_GREEN,_GREEN_T,'EARNINGS','wallet',earn);_draw_money_card(c,margin+card_w+6*mm,cy-card_h,card_w,card_h,_RED,_RED_T,'DEDUCTIONS','shield',ded)

    # Net, amount words and security cards retain the reference hierarchy.
    # Net salary is a single calm take-home panel instead of a heavy banner.
    _employer_pf_note(c, structure, W/2, cy-card_h-8*mm, record=record)
    ny=cy-card_h-12*mm; nh=25*mm
    _round(c, margin, ny-nh, content, nh, '#ffffff', '#d7e3ef', 5*mm, .8)
    c.setFillColor(colors.HexColor('#edf8f0'))
    c.roundRect(margin+4*mm, ny-nh+4*mm, content-8*mm, nh-8*mm, 3*mm, stroke=0, fill=1)
    c.setFont(_FONT,8.8);c.setFillColor(colors.HexColor('#397053'))
    c.drawString(margin+10*mm,ny-8*mm,'NET SALARY (TAKE-HOME)')
    c.setFont(_BOLD,22);c.setFillColor(colors.HexColor(_GREEN))
    c.drawString(margin+10*mm,ny-19*mm,'₹'+(_money(record.net_salary) or '0.00'))
    pm_text = _get_payment_mode_display_text(record)
    wh = 16.5 * mm
    wy = ny - nh - 5 * mm
    _round(c, margin, wy - wh, content, wh, '#ffffff')
    # Keep the currency mark light: no circular container, only the section's
    # green ₹ outline.  This removes the competing round background.
    _icon(c, 'rupee', margin + 6.5 * mm, wy - 12.5 * mm, 8.5 * mm, _GREEN, 1.8)
    c.setFont(_BOLD, 8.2); c.setFillColor(colors.HexColor(_GREEN)); c.drawString(margin + 23 * mm, wy - 6.5 * mm, 'AMOUNT IN WORDS')
    c.setFont(_BOLD, 9.0); c.setFillColor(colors.HexColor(_TEXT)); c.drawString(margin + 23 * mm, wy - 12.0 * mm, amount_in_words(record.net_salary))

    # Mode of payment kept outside the amount in words section
    if pm_text:
        pmy = wy - wh - 2.5 * mm
        pm_h = 6.5 * mm
        _round(c, margin, pmy - pm_h, content, pm_h, '#f8fafc', '#e2e8f0', 2 * mm, 0.5)
        _icon(c, 'card', margin + 4.5 * mm, pmy - 5.0 * mm, 3.8 * mm, '#173862', 1.5)
        c.setFont(_BOLD, 7.8); c.setFillColor(colors.HexColor('#1b355d'))
        c.drawString(margin + 10.5 * mm, pmy - 4.5 * mm, pm_text)
        fy = max((pmy - pm_h) - 6.0 * mm, 11 * mm)
    else:
        fy = max(wy - wh - 6.0 * mm, 11 * mm)

    # The system-generated note is supporting commentary, not a separate
    # card—keep its space but deliberately omit a surrounding border.
    note = 'This is a system-generated, password-protected salary slip and does not require a signature.'
    note_size, note_icon, note_gap = 7.5, 4.5 * mm, 2.0 * mm
    note_width = pdfmetrics.stringWidth(note, _FONT, note_size)
    note_x = margin + (content - note_icon - note_gap - note_width) / 2
    _icon(c, 'shield-lock', note_x, fy - 0.5 * mm, note_icon, _NAVY, 1.5)
    c.setFont(_FONT, note_size); c.setFillColor(colors.HexColor('#475569'))
    c.drawString(note_x + note_icon + note_gap, fy + 0.8 * mm, note)
    c.showPage();c.save();return buf.getvalue()



# =====================================================================
# DESIGN 2: Modern Dark Sidebar Landscape
# =====================================================================
def _build_pdf_bytes_2(record: PayslipRecord, encryption=None) -> bytes:
    employee, client, batch = record.employee, record.batch.client, record.batch
    structure, pf_opted = _structure(record)
    ctc = _money(structure.ctc_annual) if structure else '—'

    buf = io.BytesIO()
    pagesize = landscape(A4)
    W, H = pagesize
    c = canvas.Canvas(buf, pagesize=pagesize, encrypt=encryption)

    # Color definitions
    SIDEBAR_BG = '#101d36'
    SIDEBAR_MUTED = '#687e9d'
    SIDEBAR_SUBTITLE = '#8ea4c8'
    SIDEBAR_CARD_BG = '#152542'
    SIDEBAR_CARD_BORDER = '#564426'
    GOLD_TEXT = '#f6b840'
    GOLD_LABEL = '#d89f36'

    DARK_NAVY = '#10223d'
    CARD_BG = '#f1f5f9'
    CARD_MUTED = '#6b7c93'
    GREEN_AMOUNT = '#0a8754'
    RED_AMOUNT = '#c63d2b'

    WORDS_BG = '#fbf5eb'
    WORDS_STRIPE = '#d49b35'
    WORDS_LABEL = '#9c7832'

    # Left Sidebar Dimensions
    sw = 88 * mm
    c.setFillColor(colors.HexColor(SIDEBAR_BG))
    c.rect(0, 0, sw, H, stroke=0, fill=1)

    sx = 11 * mm
    inner_w = sw - 2 * sx

    # Top of sidebar: Logo / Company Name
    y = H - 20 * mm
    _profile = getattr(client, 'payroll_profile', None)
    logo = client_logo_file(client)
    drawn_logo = False
    if logo and PILImage and getattr(logo, 'path', None) and Path(logo.path).exists():
        try:
            data = resized_logo_bytes(logo.path)
            if not data:
                raise ValueError('logo resize failed')
            with PILImage.open(io.BytesIO(data)) as im:
                iw, ih = im.size
            ratio = min((inner_w * 0.7) / iw, 14 * mm / ih)
            lw, lh = iw * ratio, ih * ratio
            c.drawImage(ImageReader(io.BytesIO(data)), sx, y - lh, lw, lh, mask='auto')
            # Accent bar under logo
            c.setStrokeColor(colors.HexColor('#007cc3'))
            c.setLineWidth(2.2)
            c.line(sx, y - lh - 2.5 * mm, sx + 20 * mm, y - lh - 2.5 * mm)
            y -= (lh + 6 * mm)
            drawn_logo = True
        except Exception:
            drawn_logo = False

    if not drawn_logo:
        client_name = (client.name or 'COMPANY').strip()
        # Auto-shrunk to the sidebar's inner width so a very long client
        # name wraps/scales instead of bleeding past the sidebar edge.
        c.setFillColor(colors.HexColor('#007cc3'))
        # The block returns its own bottom baseline, so the accent bar and
        # everything after it follow the real height of the wrapped name
        # instead of a fixed 9mm step (which used to strike through line 2).
        y = draw_block(c, sx, y, client_name, _BOLD, 24, inner_w,
                       max_lines=3, min_size=11)
        c.setStrokeColor(colors.HexColor('#007cc3'))
        c.setLineWidth(2.5)
        c.line(sx, y + 1.5 * mm, sx + 22 * mm, y + 1.5 * mm)
        y -= 3 * mm

    # Address / Subtitle
    address_text = (client.address or 'CORPORATE OFFICE').upper()
    c.setFillColor(colors.HexColor(SIDEBAR_MUTED))
    draw_block(c, sx, y - 1 * mm, address_text, _BOLD, 7, inner_w, max_lines=3, min_size=5.6)

    # Employee Section
    y -= 19 * mm
    c.setFont(_BOLD, 7)
    c.setFillColor(colors.HexColor(SIDEBAR_MUTED))
    c.drawString(sx, y, "E M P L O Y E E")

    y -= 7.5 * mm
    c.setFillColor(colors.white)
    y = draw_block(c, sx, y, employee.full_name or '—', _BOLD, 17.5, inner_w,
                   max_lines=2, min_size=10) + 17.5 * 1.25

    y -= 5.5 * mm
    c.setFillColor(colors.HexColor(SIDEBAR_SUBTITLE))
    draw_fitted(c, sx, y, employee.position or '—', _FONT, 9.5, inner_w, min_size=7)

    y -= 4.8 * mm
    c.setFont(_FONT, 8.8)
    c.setFillColor(colors.HexColor(SIDEBAR_SUBTITLE))
    dept = employee.department or '—'
    draw_fitted(c, sx, y, f"Department - {dept}", _FONT, 8.8, inner_w, min_size=6.5)

    _profile = getattr(client, 'payroll_profile', None)
    esi_no = getattr(employee, 'esi_number', None)
    show_uan = getattr(_profile, 'show_uan_in_payslip', True) if _profile else True
    uan_no = getattr(employee, 'uan_number', None) if show_uan else None
    pf_opted = getattr(record, 'pf_applicable', None)
    if pf_opted is None and structure:
        pf_opted = getattr(structure, 'pf_opted', True)

    # Employee Metadata Rows
    meta_rows = [
        ("EMPLOYEE CODE", employee.employee_code or '—'),
        ("PAN NUMBER", employee.pan_number or '—'),
    ]
    if show_uan:
        meta_rows.append(("UAN NUMBER", uan_no or '—'))
    if esi_no:
        meta_rows.append(("ESI NUMBER", esi_no))
    meta_rows.extend([
        ("EMAIL", employee.email or '—'),
        ("DATE OF JOINING", str(employee.hire_date or '—')),
        ("CTC (ANNUAL)", str(ctc)),
    ])


    y -= 13 * mm
    step_meta = min(7.8 * mm, 46 * mm / len(meta_rows))
    for label, val in meta_rows:
        c.setFont(_BOLD, 7)
        c.setFillColor(colors.HexColor(SIDEBAR_MUTED))
        label_w = c.stringWidth(label, _BOLD, 7)
        c.drawString(sx, y, label)
        c.setFillColor(colors.white)
        # Right-aligned value, fitted to whatever room the label leaves.
        draw_fitted(c, sw - sx, y, str(val), _BOLD, 8.2,
                    inner_w - label_w - 3 * mm, min_size=5.8, align='right')
        y -= step_meta

    # Net Take-Home Card at Bottom of Sidebar
    card_h = 32 * mm
    card_y = 15 * mm

    # Employer PF disclosure (sidebar, directly above the net card)
    _profile = getattr(client, 'payroll_profile', None)
    show_emp_pf = getattr(_profile, 'show_employer_contribution_in_payslip', True) if _profile else True
    _amount = getattr(structure, 'employer_pf', None) if structure else None
    if show_emp_pf and _amount and _amount > 0:
        if record and getattr(record, 'epf', None) is not None and getattr(structure, 'pf_opted', True):
            if getattr(record, 'actual_working_days', None) is not None and getattr(record, 'days_in_month', None) is not None:
                if record.actual_working_days < record.days_in_month:
                    _amount = record.epf
        c.setFont(_FONT, 7)
        c.setFillColor(colors.HexColor(SIDEBAR_MUTED))
        c.drawString(sx, card_y + card_h + 5.5 * mm, f"Employer PF ₹{_money(_amount)} — for info, not deducted")
        c.drawString(sx, card_y + card_h + 2 * mm, "Paid by employer to EPFO")

    c.saveState()
    c.setFillColor(colors.HexColor('#13213a'))
    c.setStrokeColor(colors.HexColor('#3d495d'))
    c.setLineWidth(1.0)
    c.roundRect(sx, card_y, inner_w, card_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 7.5)
    c.setFillColor(colors.HexColor(GOLD_LABEL))
    c.drawString(sx + 6 * mm, card_y + card_h - 8 * mm, "N E T   T A K E - H O M E")

    c.setFont(_BOLD, 22)
    c.setFillColor(colors.HexColor(GOLD_TEXT))
    net_str = f"₹{_money(record.net_salary) or '0.00'}"
    c.drawString(sx + 6 * mm, card_y + 7.5 * mm, net_str)

    # ----------------------------------------------------
    # Right Main Area
    # ----------------------------------------------------
    rx = sw + 14 * mm
    rw = (W - 14 * mm) - rx

    # Header Row: Title & Month Pill
    hy = H - 20 * mm
    c.setFont(_BOLD, 16)
    c.setFillColor(colors.HexColor(DARK_NAVY))
    c.drawString(rx, hy, "SALARY SLIP")
    _cycle_text = _get_cycle_period_text(record)
    if _cycle_text:
        c.setFont(_FONT, 7.5)
        c.setFillColor(colors.HexColor('#64748b'))
        c.drawString(rx, hy - 4.5 * mm, f"Attendance: {_cycle_text}")

    month_text = f"{calendar.month_name[batch.month].upper()} {batch.year}"
    pill_font_size = 9.5
    month_w = pdfmetrics.stringWidth(month_text, _BOLD, pill_font_size)
    pill_w = month_w + 16 * mm
    pill_h = 8 * mm
    pill_x = rx + rw - pill_w
    pill_y = hy - 1.8 * mm

    c.saveState()
    c.setFillColor(colors.HexColor('#faefe0'))
    c.roundRect(pill_x, pill_y, pill_w, pill_h, pill_h / 2, stroke=0, fill=1)
    c.restoreState()

    c.setFont(_BOLD, pill_font_size)
    c.setFillColor(colors.HexColor('#8a6d3b'))
    c.drawCentredString(pill_x + pill_w / 2, pill_y + 2.5 * mm, month_text)

    # Dark divider line under header
    c.setStrokeColor(colors.HexColor(DARK_NAVY))
    c.setLineWidth(1.5)
    c.line(rx, hy - 6 * mm, rx + rw, hy - 6 * mm)

    # Attendance Metric Cards (4 cards)
    att_y = hy - 26 * mm
    att_h = 17 * mm
    gap = 4 * mm
    card_w = (rw - 3 * gap) / 4

    leave_str = _get_leave_summary_str(record)
    metrics = [
        ("DAYS IN MONTH", _days(record.days_in_month)),
        ("WORKING DAYS", _days(record.actual_working_days)),
        ("PAID LEAVE", leave_str),
        ("LOP DAYS", _leave(record.lop_days)),
    ]

    for idx, (label, val) in enumerate(metrics):
        cx = rx + idx * (card_w + gap)
        c.saveState()
        c.setFillColor(colors.HexColor(CARD_BG))
        c.roundRect(cx, att_y, card_w, att_h, 3 * mm, stroke=0, fill=1)
        c.restoreState()

        c.setFont(_BOLD, 7)
        c.setFillColor(colors.HexColor(CARD_MUTED))
        c.drawString(cx + 4.5 * mm, att_y + att_h - 5.8 * mm, label)

        c.setFillColor(colors.HexColor(DARK_NAVY))
        draw_fitted(c, cx + 4.5 * mm, att_y + 3.8 * mm, str(val), _BOLD, 13, card_w - 7 * mm, min_size=7)

    # Earnings & Deductions Tables
    table_top = att_y - 11 * mm
    col_gap = 10 * mm
    col_w = (rw - col_gap) / 2

    # Column Headers
    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(DARK_NAVY))
    # Earnings header
    c.drawString(rx, table_top, "EARNINGS")
    c.drawRightString(rx + col_w, table_top, "₹")
    # Deductions header
    c.drawString(rx + col_w + col_gap, table_top, "DEDUCTIONS")
    c.drawRightString(rx + 2 * col_w + col_gap, table_top, "₹")

    # Header underline
    c.setStrokeColor(colors.HexColor(DARK_NAVY))
    c.setLineWidth(1.6)
    c.line(rx, table_top - 2.5 * mm, rx + col_w, table_top - 2.5 * mm)
    c.line(rx + col_w + col_gap, table_top - 2.5 * mm, rx + 2 * col_w + col_gap, table_top - 2.5 * mm)

    # Build rows based on exact field rules
    def rows(spec):
        return [(name, _money(value) or '0.00') for name, value, optional in spec if not (optional and value == 0)]

    custom_earn_specs, custom_ded_specs = _extract_custom_specs(record)
    earn_list = rows([
        ('Basic + DA', record.basic_da, False),
        ('HRA', record.hra, False),
        ('Leave Travel Allowance', record.lta, True),
        ('Special Allowance', record.special_allowance, False),
        ('NPS Allowance', record.nps_allowance_earned, True),
        ('Variable Pay', record.variable_pay, True),
        ('Commission / Other', record.commission_other, True),
        ('Salary Advance Given', record.salary_advance_disbursed, True),
        ('On Hold Released', record.on_hold_released, True),
        ('Reimbursement', record.reimbursements, True),
        ('Arrears', record.arrears, True),
    ] + custom_earn_specs)

    ded_list = rows([
        ('EPF', record.epf, not pf_opted),
        ('ESI', getattr(record, 'esi', 0), True),
        ('VPF', record.vpf, True),
        ('VPF Arrears', record.vpf_arrears, True),
        ('Professional Tax', record.professional_tax, False),
        ('TDS', record.tds, False),
        ('NPS Deduction', record.nps_deduction, True),
        ('NPS Deduction – Arrears', record.nps_deduction_arrears, True),
        ('Loan Deduction', record.loan_deduction, True),
        ('Salary Advance Recovered', record.salary_advance_recovered, True),
        ('On Hold Deducted', record.on_hold_deducted, True),
        ('LWF', record.lwf, True),
        ('Other Deduction', record.other_deduction, True),
    ] + custom_ded_specs)

    row_h = 8.2 * mm
    max_len = max(len(earn_list), len(ded_list))

    curr_y = table_top - 8.5 * mm
    for i in range(max_len):
        # Earnings item
        if i < len(earn_list):
            ename, evalue = earn_list[i]
            c.setFont(_FONT, 8.8)
            c.setFillColor(colors.HexColor(DARK_NAVY))
            c.drawString(rx, curr_y, ename)
            c.drawRightString(rx + col_w, curr_y, evalue)

        # Deductions item
        if i < len(ded_list):
            dname, dvalue = ded_list[i]
            c.setFont(_FONT, 8.8)
            c.setFillColor(colors.HexColor(DARK_NAVY))
            c.drawString(rx + col_w + col_gap, curr_y, dname)
            c.drawRightString(rx + 2 * col_w + col_gap, curr_y, dvalue)

        curr_y -= row_h

    # Totals section
    total_line_y = curr_y + 2.5 * mm
    c.setStrokeColor(colors.HexColor(DARK_NAVY))
    c.setLineWidth(1.6)
    c.line(rx, total_line_y, rx + col_w, total_line_y)
    c.line(rx + col_w + col_gap, total_line_y, rx + 2 * col_w + col_gap, total_line_y)

    curr_y -= 2 * mm
    # GROSS SALARY & TOTAL DEDUCTIONS
    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(DARK_NAVY))
    c.drawString(rx, curr_y, "GROSS SALARY")
    c.drawRightString(rx + col_w, curr_y, _money(record.gross_salary) or '0.00')

    c.drawString(rx + col_w + col_gap, curr_y, "TOTAL DEDUCTIONS")
    c.setFillColor(colors.HexColor(RED_AMOUNT))
    c.drawRightString(rx + 2 * col_w + col_gap, curr_y, _money(record.total_deductions) or '0.00')

    curr_y -= row_h
    # EARNED SALARY
    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(DARK_NAVY))
    c.drawString(rx, curr_y, "EARNED SALARY")
    c.setFillColor(colors.HexColor(GREEN_AMOUNT))
    c.drawRightString(rx + col_w, curr_y, _money(record.earned_salary) or '0.00')

    # AMOUNT IN WORDS Box
    pm_text = _get_payment_mode_display_text(record)
    words_h = 13.5 * mm
    words_y = 20 * mm if pm_text else 17 * mm
    c.saveState()
    c.setFillColor(colors.HexColor(WORDS_BG))
    c.roundRect(rx, words_y, rw, words_h, 2.5 * mm, stroke=0, fill=1)
    # Left amber stripe
    c.setFillColor(colors.HexColor(WORDS_STRIPE))
    c.rect(rx, words_y, 3.5 * mm, words_h, stroke=0, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 7.2)
    c.setFillColor(colors.HexColor(WORDS_LABEL))
    c.drawString(rx + 7.5 * mm, words_y + words_h - 4.8 * mm, "AMOUNT IN WORDS")

    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(DARK_NAVY))
    c.drawString(rx + 7.5 * mm, words_y + 3.5 * mm, amount_in_words(record.net_salary))

    # Mode of payment kept outside the amount in words section
    if pm_text:
        pmy = words_y - 2.0 * mm
        pm_h = 5.8 * mm
        c.saveState()
        c.setFillColor(colors.HexColor('#fffbeb'))
        c.setStrokeColor(colors.HexColor('#fde68a'))
        c.setLineWidth(0.6)
        c.roundRect(rx, pmy - pm_h, rw, pm_h, 2.0 * mm, stroke=1, fill=1)
        c.restoreState()
        _draw_icon(c, 'card', rx + 3.0 * mm, pmy - 4.4 * mm, 3.5 * mm, WORDS_LABEL)
        c.setFont(_BOLD, 7.2)
        c.setFillColor(colors.HexColor(DARK_NAVY))
        c.drawString(rx + 8.5 * mm, pmy - 4.2 * mm, pm_text)
        fy = 6.2 * mm
    else:
        fy = 9.0 * mm

    # Footer note
    _draw_lock_icon(c, rx, fy - 0.5 * mm, 3.2 * mm, '#8a99a8')
    c.setFont(_FONT, 7.0)
    c.setFillColor(colors.HexColor('#8a99a8'))
    c.drawString(rx + 5.0 * mm, fy, "This is a system-generated, password-protected salary slip and does not require a signature.")

    c.showPage()
    c.save()
    return buf.getvalue()



# =====================================================================
# DESIGN 3: Emerald Cards Portrait
# =====================================================================
def _build_pdf_bytes_3(record: PayslipRecord, encryption=None) -> bytes:
    employee, client, batch = record.employee, record.batch.client, record.batch
    structure, pf_opted = _structure(record)
    ctc = _money(structure.ctc_annual) if structure else '—'

    buf = io.BytesIO()
    pagesize = A4
    W, H = pagesize
    c = canvas.Canvas(buf, pagesize=pagesize, encrypt=encryption)

    # Color Palette
    PAGE_BG = '#0b1220'
    CARD_BG = '#0d172a'
    CARD_BORDER = '#1e2b42'
    CYAN_ACCENT = '#38bdf8'
    CYAN_BRIGHT = '#22d3ee'
    SLATE_LABEL = '#64748b'
    TEXT_WHITE = '#ffffff'
    GREEN_STROKE = '#10b981'
    GREEN_FILL = '#063327'
    GREEN_TEXT = '#34d399'
    RED_STROKE = '#ef4444'
    RED_FILL = '#381419'
    RED_TEXT = '#f87171'

    # Fill Page Background
    c.setFillColor(colors.HexColor(PAGE_BG))
    c.rect(0, 0, W, H, stroke=0, fill=1)

    margin = 12 * mm
    content_w = W - 2 * margin

    # ----------------------------------------------------
    # Header: Logo (left) & Salary Slip + Month Pill (right)
    # ----------------------------------------------------
    header_y = H - 18 * mm
    _profile = getattr(client, 'payroll_profile', None)
    logo = client_logo_file(client)
    drawn_logo = False
    name_bottom = None
    if logo and PILImage and getattr(logo, 'path', None) and Path(logo.path).exists():
        try:
            data = resized_logo_bytes(logo.path)
            if not data:
                raise ValueError('logo resize failed')
            with PILImage.open(io.BytesIO(data)) as im:
                iw, ih = im.size
            ratio = min(42 * mm / iw, 14 * mm / ih)
            lw, lh = iw * ratio, ih * ratio
            c.drawImage(ImageReader(io.BytesIO(data)), margin, header_y - lh, lw, lh, mask='auto')
            drawn_logo = True
        except Exception:
            drawn_logo = False

    if not drawn_logo:
        client_name = (client.name or 'COMPANY').strip()
        # Reserve everything left of the right-hand SALARY SLIP / month pill.
        name_w = content_w - 42 * mm
        c.setFillColor(colors.HexColor(CYAN_ACCENT))
        # Track the block's real bottom so the address sits BELOW the wrapped
        # name instead of at a fixed offset that a 2-line name overlaps.
        # 13pt max keeps a 2-line name inside the fixed header band, so the
        # address below and the details card keep their exact positions.
        name_bottom = draw_block(c, margin, header_y - 6 * mm, client_name, _BOLD, 22,
                                 name_w, max_lines=2, min_size=9, leading_ratio=1.1)

    # Address / Subtitle
    address_text = (client.address or 'CORPORATE OFFICE')
    c.setFillColor(colors.HexColor('#7286a5'))
    # Fixed baseline: the header band is a constant height for every client,
    # so nothing below it can ever be pushed off the page.
    addr_y = header_y - 19 * mm
    draw_block(c, margin, addr_y, address_text, _FONT, 7.5,
               content_w - 46 * mm, max_lines=2, min_size=6.0, leading_ratio=1.15)

    # Header Right
    c.setFont(_BOLD, 8)
    c.setFillColor(colors.HexColor('#798da3'))
    c.drawRightString(W - margin, header_y - 2 * mm, "SALARY SLIP")

    month_text = f"{calendar.month_name[batch.month].upper()} {batch.year}"
    pill_font_size = 8.5
    month_w = pdfmetrics.stringWidth(month_text, _BOLD, pill_font_size)
    pill_w = month_w + 14 * mm
    pill_h = 7 * mm
    pill_x = W - margin - pill_w
    pill_y = header_y - 15 * mm

    c.saveState()
    c.setFillColor(colors.HexColor('#0c233e'))
    c.setStrokeColor(colors.HexColor('#0284c7'))
    c.setLineWidth(0.8)
    c.roundRect(pill_x, pill_y, pill_w, pill_h, pill_h / 2, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, pill_font_size)
    c.setFillColor(colors.HexColor(CYAN_ACCENT))
    c.drawCentredString(pill_x + pill_w / 2, pill_y + 2.2 * mm, month_text)
    _cycle_text = _get_cycle_period_text(record)
    if _cycle_text:
        c.setFont(_FONT, 7.2)
        c.setFillColor(colors.HexColor('#94a3b8'))
        c.drawRightString(W - margin, header_y - 23.5 * mm, f"Period: {_cycle_text}")

    # ----------------------------------------------------
    # Employee Details Card
    # ----------------------------------------------------
    # The details card starts below whatever height the (possibly wrapped)
    # name + address block actually consumed — never a fixed offset that a
    # long client name would overlap.
    card1_top = header_y - 27 * mm
    card1_h = 62 * mm
    card1_y = card1_top - card1_h

    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(margin, card1_y, content_w, card1_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    # Section Title
    c.setFont(_BOLD, 7.8)
    c.setFillColor(colors.HexColor(CYAN_ACCENT))
    c.drawString(margin + 6 * mm, card1_top - 8 * mm, "E M P L O Y E E   D E T A I L S")

    # Grid of details: 2 columns, 6 or 7 rows
    left_col_x = margin + 6 * mm
    right_col_x = margin + content_w / 2 + 3 * mm

    detail_pairs = _build_employee_detail_pairs(record, uppercase_labels=True)
    details_grid = [((l1, v1), (l2, v2)) for (i1, l1, v1), (i2, l2, v2) in detail_pairs]

    row_y = card1_top - 15 * mm
    step_y = (card1_h - 18 * mm) / len(details_grid)
    for (l_label, l_val), (r_label, r_val) in details_grid:
        # Left column
        col_w = content_w / 2 - 9 * mm
        c.setFont(_BOLD, 6.8)
        c.setFillColor(colors.HexColor(SLATE_LABEL))
        c.drawString(left_col_x, row_y, l_label)
        c.setFillColor(colors.HexColor(TEXT_WHITE))
        # Fitted so a long name/email can't spill into the right column.
        draw_fitted(c, left_col_x, row_y - 4.2 * mm, str(l_val), _BOLD, 8.5, col_w, min_size=6)

        # Right column
        c.setFont(_BOLD, 6.8)
        c.setFillColor(colors.HexColor(SLATE_LABEL))
        c.drawString(right_col_x, row_y, r_label)
        c.setFillColor(colors.HexColor(TEXT_WHITE))
        draw_fitted(c, right_col_x, row_y - 4.2 * mm, str(r_val), _BOLD, 8.5,
                    (margin + content_w - 6 * mm) - right_col_x, min_size=6)

        row_y -= step_y

    # ----------------------------------------------------
    # Earnings & Deductions Tables (Two Cards Side-by-Side)
    # ----------------------------------------------------
    tables_top = card1_y - 5 * mm
    table_card_h = 80 * mm
    table_card_y = tables_top - table_card_h
    card_gap = 5 * mm
    table_w = (content_w - card_gap) / 2

    # Left Card: Earnings
    earn_x = margin
    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(earn_x, table_card_y, table_w, table_card_h, 3.5 * mm, stroke=1, fill=1)

    # Right Card: Deductions
    ded_x = margin + table_w + card_gap
    c.roundRect(ded_x, table_card_y, table_w, table_card_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    # Earnings Header
    c.setFont(_BOLD, 9.2)
    c.setFillColor(colors.HexColor(TEXT_WHITE))
    c.drawString(earn_x + 6 * mm, tables_top - 8 * mm, "Earnings")
    c.setFont(_FONT, 7.5)
    c.setFillColor(colors.HexColor(SLATE_LABEL))
    c.drawRightString(earn_x + table_w - 6 * mm, tables_top - 8 * mm, "Amount (₹)")

    # Deductions Header
    c.setFont(_BOLD, 9.2)
    c.setFillColor(colors.HexColor(TEXT_WHITE))
    c.drawString(ded_x + 6 * mm, tables_top - 8 * mm, "Deductions")
    c.setFont(_FONT, 7.5)
    c.setFillColor(colors.HexColor(SLATE_LABEL))
    c.drawRightString(ded_x + table_w - 6 * mm, tables_top - 8 * mm, "Amount (₹)")

    # Build data rows using standard rules
    def rows(spec):
        return [(name, _money(value) or '0.00') for name, value, optional in spec if not (optional and value == 0)]

    custom_earn_specs, custom_ded_specs = _extract_custom_specs(record)
    earn_list = rows([
        ('Basic + DA', record.basic_da, False),
        ('HRA', record.hra, False),
        ('Leave Travel Allowance', record.lta, True),
        ('Special Allowance', record.special_allowance, False),
        ('NPS Allowance', record.nps_allowance_earned, True),
        ('Variable Pay', record.variable_pay, True),
        ('Commission / Other', record.commission_other, True),
        ('Salary Advance Given', record.salary_advance_disbursed, True),
        ('On Hold Released', record.on_hold_released, True),
        ('Reimbursement', record.reimbursements, True),
        ('Arrears', record.arrears, True),
    ] + custom_earn_specs)

    ded_list = rows([
        ('EPF', record.epf, not pf_opted),
        ('ESI', getattr(record, 'esi', 0), True),
        ('VPF', record.vpf, True),
        ('VPF Arrears', record.vpf_arrears, True),
        ('Professional Tax', record.professional_tax, False),
        ('TDS', record.tds, False),
        ('NPS Deduction', record.nps_deduction, True),
        ('NPS Deduction – Arrears', record.nps_deduction_arrears, True),
        ('Loan Deduction', record.loan_deduction, True),
        ('Salary Advance Recovered', record.salary_advance_recovered, True),
        ('On Hold Deducted', record.on_hold_deducted, True),
        ('LWF', record.lwf, True),
        ('Other Deduction', record.other_deduction, True),
    ] + custom_ded_specs)

    row_h = 7.6 * mm
    curr_earn_y = tables_top - 17 * mm
    for name, val in earn_list:
        c.setFont(_FONT, 8.5)
        c.setFillColor(colors.HexColor('#e2e8f0'))
        c.drawString(earn_x + 6 * mm, curr_earn_y, name)
        c.setFont(_BOLD, 8.5)
        c.setFillColor(colors.HexColor(TEXT_WHITE))
        c.drawRightString(earn_x + table_w - 6 * mm, curr_earn_y, val)
        curr_earn_y -= row_h

    curr_ded_y = tables_top - 17 * mm
    for name, val in ded_list:
        c.setFont(_FONT, 8.5)
        c.setFillColor(colors.HexColor('#e2e8f0'))
        c.drawString(ded_x + 6 * mm, curr_ded_y, name)
        c.setFont(_BOLD, 8.5)
        c.setFillColor(colors.HexColor(TEXT_WHITE))
        c.drawRightString(ded_x + table_w - 6 * mm, curr_ded_y, val)
        curr_ded_y -= row_h

    # Earnings Bottom Summary: Gross Salary & Earned Salary
    # Align pills in same row as per reference image
    gross_y = table_card_y + 19 * mm
    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(TEXT_WHITE))
    c.drawString(earn_x + 6 * mm, gross_y, "Gross Salary")
    c.drawRightString(earn_x + table_w - 6 * mm, gross_y, _money(record.gross_salary) or '0.00')

    # Earned Salary Pill + Total Deductions Pill - SAME ROW
    pill_y = table_card_y + 5 * mm  # shared Y for both pills - reference alignment
    pill_inner_w = table_w - 10 * mm

    # Earned Salary Pill (left)
    c.saveState()
    c.setFillColor(colors.HexColor(GREEN_FILL))
    c.setStrokeColor(colors.HexColor(GREEN_STROKE))
    c.setLineWidth(0.8)
    c.roundRect(earn_x + 5 * mm, pill_y, pill_inner_w, 8 * mm, 2.5 * mm, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(GREEN_TEXT))
    c.drawString(earn_x + 9 * mm, pill_y + 2.5 * mm, "Earned Salary")
    c.drawRightString(earn_x + 5 * mm + pill_inner_w - 4 * mm, pill_y + 2.5 * mm, _money(record.earned_salary) or '0.00')

    # Total Deductions Pill (right) - SAME ROW as Earned Salary
    c.saveState()
    c.setFillColor(colors.HexColor(RED_FILL))
    c.setStrokeColor(colors.HexColor(RED_STROKE))
    c.setLineWidth(0.8)
    c.roundRect(ded_x + 5 * mm, pill_y, pill_inner_w, 8 * mm, 2.5 * mm, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(RED_TEXT))
    c.drawString(ded_x + 9 * mm, pill_y + 2.5 * mm, "Total Deductions")
    c.drawRightString(ded_x + 5 * mm + pill_inner_w - 4 * mm, pill_y + 2.5 * mm, _money(record.total_deductions) or '0.00')

    # ----------------------------------------------------
    # Net Salary (Take-Home) Card with Stylized Rupee Watermark
    # ----------------------------------------------------
    _employer_pf_note(c, structure, W/2, table_card_y - 7.5*mm, record=record)
    net_card_top = table_card_y - 9 * mm
    net_card_h = 22 * mm
    net_card_y = net_card_top - net_card_h

    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(margin, net_card_y, content_w, net_card_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    # Left text
    c.setFont(_BOLD, 7.5)
    c.setFillColor(colors.HexColor(CYAN_ACCENT))
    c.drawString(margin + 8 * mm, net_card_top - 7.5 * mm, "N E T   S A L A R Y   ( T A K E - H O M E )")

    c.setFont(_BOLD, 21)
    c.setFillColor(colors.HexColor(CYAN_BRIGHT))
    c.drawString(margin + 8 * mm, net_card_y + 5.5 * mm, f"₹{_money(record.net_salary) or '0.00'}")

    # Right side: Large Rupee Watermark
    c.setFont(_BOLD, 46)
    c.setFillColor(colors.HexColor('#141f36'))
    c.drawRightString(W - margin - 8 * mm, net_card_y + 3.5 * mm, "₹")

    # ----------------------------------------------------
    # Amount In Words Card
    # ----------------------------------------------------
    pm_text = _get_payment_mode_display_text(record)
    words_card_top = net_card_y - 3 * mm
    words_card_h = 12 * mm
    words_card_y = words_card_top - words_card_h

    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(margin, words_card_y, content_w, words_card_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 6.8)
    c.setFillColor(colors.HexColor(SLATE_LABEL))
    c.drawString(margin + 8 * mm, words_card_top - 4.5 * mm, "A M O U N T   I N   W O R D S")

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEXT_WHITE))
    c.drawString(margin + 8 * mm, words_card_y + 2.8 * mm, amount_in_words(record.net_salary))

    # Mode of payment kept outside the amount in words section
    if pm_text:
        pmy = words_card_y - 2.0 * mm
        pm_h = 5.5 * mm
        c.saveState()
        c.setFillColor(colors.HexColor(CARD_BG))
        c.setStrokeColor(colors.HexColor(CARD_BORDER))
        c.setLineWidth(0.6)
        c.roundRect(margin, pmy - pm_h, content_w, pm_h, 2.5 * mm, stroke=1, fill=1)
        c.restoreState()
        _draw_icon(c, 'card', margin + 5 * mm, pmy - 4.3 * mm, 3.6 * mm, SLATE_LABEL)
        c.setFont(_FONT, 7.5)
        c.setFillColor(colors.HexColor(TEXT_WHITE))
        c.drawString(margin + 11.5 * mm, pmy - 3.8 * mm, pm_text)
        fy = max((pmy - pm_h) - 5.5 * mm, 8 * mm)
    else:
        fy = max(words_card_y - 5.5 * mm, 8 * mm)

    # ----------------------------------------------------
    # Footer Disclaimer
    # ----------------------------------------------------
    disclaimer_text = "This is a system-generated, password-protected salary slip and does not require a signature."
    _draw_lock_icon(c, margin + 15 * mm, fy - 0.5 * mm, 3.5 * mm, '#475569')
    c.setFont(_FONT, 7.2)
    c.setFillColor(colors.HexColor('#475569'))
    c.drawString(margin + 20 * mm, fy, disclaimer_text)

    c.showPage()
    c.save()
    return buf.getvalue()



# =====================================================================
# DESIGN 4: Corporate Blue Grid Portrait
# =====================================================================
def _build_pdf_bytes_4(record: PayslipRecord, encryption=None) -> bytes:
    employee, client, batch = record.employee, record.batch.client, record.batch
    structure, pf_opted = _structure(record)
    ctc = _money(structure.ctc_annual) if structure else '—'

    buf = io.BytesIO()
    pagesize = A4
    W, H = pagesize
    c = canvas.Canvas(buf, pagesize=pagesize, encrypt=encryption)

    # ----------------------------------------------------
    # Double Page Border
    # ----------------------------------------------------
    c.setStrokeColor(colors.HexColor('#1f2937'))
    # Outer thin border
    c.setLineWidth(1.2)
    c.rect(7 * mm, 7 * mm, W - 14 * mm, H - 14 * mm, stroke=1, fill=0)
    # Inner border
    c.setLineWidth(0.6)
    c.rect(8.8 * mm, 8.8 * mm, W - 17.6 * mm, H - 17.6 * mm, stroke=1, fill=0)

    content_x = 13 * mm
    content_w = W - 2 * content_x

    # ----------------------------------------------------
    # Header: Logo & Address
    # ----------------------------------------------------
    y = H - 24 * mm
    _profile = getattr(client, 'payroll_profile', None)
    logo = client_logo_file(client)
    drawn_logo = False
    if logo and PILImage and getattr(logo, 'path', None) and Path(logo.path).exists():
        try:
            data = resized_logo_bytes(logo.path)
            if not data:
                raise ValueError('logo resize failed')
            with PILImage.open(io.BytesIO(data)) as im:
                iw, ih = im.size
            ratio = min(48 * mm / iw, 15 * mm / ih)
            lw, lh = iw * ratio, ih * ratio
            lx = (W - lw) / 2
            c.drawImage(ImageReader(io.BytesIO(data)), lx, y - lh, lw, lh, mask='auto')
            y -= (lh + 2 * mm)
            drawn_logo = True
        except Exception:
            drawn_logo = False

    if not drawn_logo:
        client_name = (client.name or 'COMPANY').strip()
        c.setFillColor(colors.HexColor('#007cc3'))
        y = draw_block(c, W / 2, y - 6 * mm, client_name, _BOLD, 22, content_w,
                       max_lines=2, min_size=11, align='center') - 1 * mm

    # Address
    address_text = (client.address or 'CORPORATE OFFICE').upper()
    c.setFillColor(colors.HexColor('#1f2937'))
    y = draw_block(c, W / 2, y, address_text, _FONT, 8.5, content_w,
                   max_lines=2, min_size=6.5, align='center') + 8.5 * 1.25

    # Double horizontal line below header
    y -= 5 * mm
    c.setStrokeColor(colors.HexColor('#1f2937'))
    c.setLineWidth(0.7)
    c.line(content_x, y, content_x + content_w, y)
    c.line(content_x, y - 1.2 * mm, content_x + content_w, y - 1.2 * mm)

    # ----------------------------------------------------
    # Title: SALARY SLIP FOR THE MONTH OF ...
    # ----------------------------------------------------
    y -= 7 * mm
    c.setFont(_BOLD, 10.5)
    c.setFillColor(colors.HexColor('#111827'))
    month_name = calendar.month_name[batch.month].upper()
    title_text = f"SALARY SLIP FOR THE MONTH OF {month_name} {batch.year}"
    _cycle_text = _get_cycle_period_text(record)
    if _cycle_text:
        title_text += f" ({_cycle_text})"
    c.drawCentredString(W / 2, y, title_text)

    # Line below title
    y -= 4 * mm
    c.setLineWidth(0.8)
    c.line(content_x, y, content_x + content_w, y)

    # ----------------------------------------------------
    # Employee Details Section
    # ----------------------------------------------------
    y -= 6.5 * mm
    c.setFont(_BOLD, 9)
    c.setFillColor(colors.HexColor('#111827'))
    c.drawCentredString(W / 2, y, "E M P L O Y E E   D E T A I L S")

    y -= 3.5 * mm
    c.setLineWidth(0.8)
    c.line(content_x, y, content_x + content_w, y)

    # Grid specifications: 4 columns
    # Col 1: Label (38mm)
    # Col 2: Value (54mm)
    # Col 3: Label (38mm)
    # Col 4: Value (54mm)
    col1_w = 38 * mm
    col2_w = 54 * mm
    col3_w = 38 * mm
    col4_w = content_w - (col1_w + col2_w + col3_w)

    x0 = content_x
    x1 = x0 + col1_w
    x2 = x1 + col2_w
    x3 = x2 + col3_w
    x4 = x0 + content_w

    detail_pairs = _build_employee_detail_pairs(record, uppercase_labels=False)
    details_data = [(l1, v1, l2, v2) for (i1, l1, v1), (i2, l2, v2) in detail_pairs]

    row_h = 6.0 * mm if len(details_data) > 6 else 6.8 * mm
    grid_top = y
    c.setStrokeColor(colors.HexColor('#374151'))
    c.setLineWidth(0.6)

    curr_row_y = grid_top
    for r_idx, (l1, v1, l2, v2) in enumerate(details_data):
        row_bottom = curr_row_y - row_h

        # Horizontal bottom border of row
        c.line(x0, row_bottom, x4, row_bottom)

        # Text baseline
        text_y = row_bottom + 2.2 * mm

        # Col 1
        c.setFont(_FONT, 8.5)
        c.setFillColor(colors.HexColor('#1f2937'))
        c.drawString(x0 + 2.5 * mm, text_y, l1)

        # Col 2 — fitted to the ruled cell so long values stay inside it.
        draw_fitted(c, x1 + 2.5 * mm, text_y, str(v1), _BOLD, 8.5, col2_w - 5 * mm, min_size=5.8)

        # Col 3
        c.setFont(_FONT, 8.5)
        c.drawString(x2 + 2.5 * mm, text_y, l2)

        # Col 4
        draw_fitted(c, x3 + 2.5 * mm, text_y, str(v2), _BOLD, 8.5, col4_w - 5 * mm, min_size=5.8)

        curr_row_y = row_bottom

    # Vertical grid lines
    grid_bottom = curr_row_y
    for vx in (x0, x1, x2, x3, x4):
        c.line(vx, grid_top, vx, grid_bottom)

    # ----------------------------------------------------
    # Earnings & Deductions Tables (Bordered Classic Grid)
    # ----------------------------------------------------
    y = grid_bottom - 6 * mm
    card_gap = 5 * mm
    table_w = (content_w - card_gap) / 2

    earn_x0 = content_x
    earn_x1 = earn_x0 + table_w

    ded_x0 = content_x + table_w + card_gap
    ded_x1 = ded_x0 + table_w

    def rows(spec):
        return [(name, _money(value) or '0.00') for name, value, optional in spec if not (optional and value == 0)]

    custom_earn_specs, custom_ded_specs = _extract_custom_specs(record)
    earn_list = rows([
        ('Basic + DA', record.basic_da, False),
        ('HRA', record.hra, False),
        ('Leave Travel Allowance', record.lta, True),
        ('Special Allowance', record.special_allowance, False),
        ('NPS Allowance', record.nps_allowance_earned, True),
        ('Variable Pay', record.variable_pay, True),
        ('Commission / Other', record.commission_other, True),
        ('Salary Advance Given', record.salary_advance_disbursed, True),
        ('On Hold Released', record.on_hold_released, True),
        ('Reimbursement', record.reimbursements, True),
        ('Arrears', record.arrears, True),
    ] + custom_earn_specs)

    ded_list = rows([
        ('EPF', record.epf, not pf_opted),
        ('ESI', getattr(record, 'esi', 0), True),
        ('VPF', record.vpf, True),
        ('VPF Arrears', record.vpf_arrears, True),
        ('Professional Tax', record.professional_tax, False),
        ('TDS', record.tds, False),
        ('NPS Deduction', record.nps_deduction, True),
        ('NPS Deduction – Arrears', record.nps_deduction_arrears, True),
        ('Loan Deduction', record.loan_deduction, True),
        ('Salary Advance Recovered', record.salary_advance_recovered, True),
        ('On Hold Deducted', record.on_hold_deducted, True),
        ('LWF', record.lwf, True),
        ('Other Deduction', record.other_deduction, True),
    ] + custom_ded_specs)

    tbl_row_h = 6.6 * mm

    # Draw Table Header (Both Tables)
    header_h = 7.0 * mm
    header_top = y
    header_bottom = header_top - header_h

    # Earnings Header Background
    c.setFillColor(colors.HexColor('#f3f4f6'))
    c.rect(earn_x0, header_bottom, table_w, header_h, stroke=1, fill=1)
    # Deductions Header Background
    c.rect(ded_x0, header_bottom, table_w, header_h, stroke=1, fill=1)

    c.setFont(_BOLD, 7.8)
    c.setFillColor(colors.HexColor('#111827'))
    # Earnings header text - changed as per request
    c.drawString(earn_x0 + 3 * mm, header_bottom + 2.4 * mm, "EARNINGS")
    c.drawRightString(earn_x1 - 3 * mm, header_bottom + 2.4 * mm, "AMOUNT (₹)")
    # Deductions header text - changed as per request
    c.drawString(ded_x0 + 3 * mm, header_bottom + 2.4 * mm, "DEDUCTIONS")
    c.drawRightString(ded_x1 - 3 * mm, header_bottom + 2.4 * mm, "AMOUNT (₹)")

    # Data Rows
    max_rows = max(len(earn_list), len(ded_list))
    curr_tbl_y = header_bottom

    for i in range(max_rows):
        r_bottom = curr_tbl_y - tbl_row_h
        text_baseline = r_bottom + 2.2 * mm

        # Left Table (Earnings)
        c.setFillColor(colors.HexColor('#ffffff'))
        c.rect(earn_x0, r_bottom, table_w, tbl_row_h, stroke=1, fill=0)
        if i < len(earn_list):
            ename, evalue = earn_list[i]
            c.setFont(_FONT, 8.5)
            c.setFillColor(colors.HexColor('#1f2937'))
            c.drawString(earn_x0 + 3 * mm, text_baseline, ename)
            c.drawRightString(earn_x1 - 3 * mm, text_baseline, evalue)

        # Right Table (Deductions)
        c.rect(ded_x0, r_bottom, table_w, tbl_row_h, stroke=1, fill=0)
        if i < len(ded_list):
            dname, dvalue = ded_list[i]
            c.setFont(_FONT, 8.5)
            c.setFillColor(colors.HexColor('#1f2937'))
            c.drawString(ded_x0 + 3 * mm, text_baseline, dname)
            c.drawRightString(ded_x1 - 3 * mm, text_baseline, dvalue)

        curr_tbl_y = r_bottom

    # Summary Rows:
    # Left: GROSS SALARY
    # Right: TOTAL DEDUCTIONS
    r_bottom = curr_tbl_y - tbl_row_h
    text_baseline = r_bottom + 2.2 * mm

    c.rect(earn_x0, r_bottom, table_w, tbl_row_h, stroke=1, fill=0)
    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor('#111827'))
    c.drawString(earn_x0 + 3 * mm, text_baseline, "GROSS SALARY")
    c.drawRightString(earn_x1 - 3 * mm, text_baseline, _money(record.gross_salary) or '0.00')

    c.rect(ded_x0, r_bottom, table_w, tbl_row_h, stroke=1, fill=0)
    c.drawString(ded_x0 + 3 * mm, text_baseline, "TOTAL DEDUCTIONS")
    c.drawRightString(ded_x1 - 3 * mm, text_baseline, _money(record.total_deductions) or '0.00')

    curr_tbl_y = r_bottom

    # Next row: EARNED SALARY on left
    r_bottom = curr_tbl_y - tbl_row_h
    text_baseline = r_bottom + 2.2 * mm

    c.rect(earn_x0, r_bottom, table_w, tbl_row_h, stroke=1, fill=0)
    c.setFont(_BOLD, 8.5)
    c.drawString(earn_x0 + 3 * mm, text_baseline, "EARNED SALARY")
    c.drawRightString(earn_x1 - 3 * mm, text_baseline, _money(record.earned_salary) or '0.00')

    # ----------------------------------------------------
    # NET SALARY (TAKE-HOME) Box with Drop Shadow
    # ----------------------------------------------------
    net_w = 112 * mm
    net_h = 20 * mm
    net_x = (W - net_w) / 2
    _employer_pf_note(c, structure, W/2, r_bottom - 5.5*mm, record=record)
    net_y = r_bottom - 26 * mm

    # Shadow (Offset by 2mm bottom-right)
    c.saveState()
    c.setFillColor(colors.HexColor('#b5bdc7'))
    c.rect(net_x + 1.8 * mm, net_y - 1.8 * mm, net_w, net_h, stroke=0, fill=1)

    # Front Box
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor('#111827'))
    c.setLineWidth(1.1)
    c.rect(net_x, net_y, net_w, net_h, stroke=1, fill=1)
    c.restoreState()

    # Net Salary Content
    c.setFont(_BOLD, 7.8)
    c.setFillColor(colors.HexColor('#111827'))
    c.drawCentredString(W / 2, net_y + net_h - 5.8 * mm, "N E T   S A L A R Y   ( T A K E - H O M E )")

    c.setFont(_BOLD, 18.0)
    c.setFillColor(colors.HexColor('#111827'))
    c.drawCentredString(W / 2, net_y + 4.2 * mm, f"₹{_money(record.net_salary) or '0.00'}")

    # ----------------------------------------------------
    # AMOUNT IN WORDS Box
    # ----------------------------------------------------
    pm_text = _get_payment_mode_display_text(record)
    words_h = 13.5 * mm
    words_y = net_y - words_h - 4.5 * mm

    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor('#111827'))
    c.setLineWidth(0.8)
    c.rect(content_x, words_y, content_w, words_h, stroke=1, fill=0)
    c.restoreState()

    c.setFont(_BOLD, 7.2)
    c.setFillColor(colors.HexColor('#111827'))
    c.drawCentredString(W / 2, words_y + words_h - 4.8 * mm, "A M O U N T   I N   W O R D S")

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor('#111827'))
    c.drawCentredString(W / 2, words_y + 3.2 * mm, amount_in_words(record.net_salary))

    # Mode of payment kept outside the amount in words section
    if pm_text:
        pmy = words_y - 2.0 * mm
        pm_h = 5.5 * mm
        c.saveState()
        c.setFillColor(colors.HexColor('#f9fafb'))
        c.setStrokeColor(colors.HexColor('#111827'))
        c.setLineWidth(0.5)
        c.rect(content_x, pmy - pm_h, content_w, pm_h, stroke=1, fill=1)
        c.restoreState()
        c.setFont(_BOLD, 7.5)
        c.setFillColor(colors.HexColor('#111827'))
        c.drawCentredString(W / 2, pmy - 3.8 * mm, pm_text)
        fy = max((pmy - pm_h) - 5.5 * mm, 12 * mm)
    else:
        fy = max(words_y - 5.5 * mm, 12 * mm)

    # ----------------------------------------------------
    # Footer
    # ----------------------------------------------------
    disclaimer = "This is a system-generated, password-protected salary slip and does not require a signature."
    f_size = 7.2
    f_width = pdfmetrics.stringWidth(disclaimer, _ITALIC, f_size)
    total_footer_w = f_width + 6 * mm
    fx = (W - total_footer_w) / 2

    _draw_lock_icon(c, fx, fy - 0.5 * mm, 3.5 * mm, '#4b5563')
    c.setFont(_ITALIC, f_size)
    c.setFillColor(colors.HexColor('#4b5563'))
    c.drawString(fx + 5.0 * mm, fy, disclaimer)

    c.showPage()
    c.save()
    return buf.getvalue()



# =====================================================================
# DESIGN 5: Executive Dual-Column Landscape
# =====================================================================



def _draw_icon_badge(c, kind, x, y, size, shape='square'):
    c.saveState()
    c.setFillColor(colors.HexColor('#eff6ff'))
    c.setStrokeColor(colors.HexColor('#bfdbfe'))
    c.setLineWidth(0.7)
    if shape == 'circle':
        c.circle(x + size / 2, y + size / 2, size / 2, stroke=1, fill=1)
    else:
        c.roundRect(x, y, size, size, 1.8 * mm, stroke=1, fill=1)
    c.restoreState()
    # Icon slightly larger and centered for better visual weight
    _draw_lucide_icon(c, kind, x + size * 0.18, y + size * 0.18, size * 0.64, '#0369a1')


def _build_pdf_bytes_5(record: PayslipRecord, encryption=None) -> bytes:
    employee, client, batch = record.employee, record.batch.client, record.batch
    structure, pf_opted = _structure(record)
    ctc = _money(structure.ctc_annual) if structure else '—'

    buf = io.BytesIO()
    pagesize = A4
    W, H = pagesize
    c = canvas.Canvas(buf, pagesize=pagesize, encrypt=encryption)

    # Color Palette
    PAGE_BG = '#f4f7fb'
    CARD_BG = '#ffffff'
    CARD_BORDER = '#dbe5f0'
    PRIMARY_BLUE = '#0265cb'
    DARK_NAVY = '#0b3a75'
    TEXT_MAIN = '#0f172a'
    SLATE_MUTED = '#64748b'
    GREEN_PILL_BG = '#edfbf2'
    GREEN_PILL_TEXT = '#0f7643'
    RED_PILL_BG = '#fff1f2'
    RED_PILL_TEXT = '#b91c1c'

    # Fill Page Background
    c.setFillColor(colors.HexColor(PAGE_BG))
    c.rect(0, 0, W, H, stroke=0, fill=1)

    margin = 12 * mm
    content_w = W - 2 * margin

    # ----------------------------------------------------
    # Top Header Card with Wave Curve
    # ----------------------------------------------------
    header_top = H - 10 * mm
    header_h = 28 * mm
    header_y = header_top - header_h

    # White Header Card
    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(margin, header_y, content_w, header_h, 3.5 * mm, stroke=1, fill=1)

    # Top-right swoosh/wave decoration inside header
    c.saveState()
    p_clip = c.beginPath()
    p_clip.roundRect(margin, header_y, content_w, header_h, 3.5 * mm)
    c.clipPath(p_clip, stroke=0)

    p1 = c.beginPath()
    p1.moveTo(W - margin - 45 * mm, header_top)
    p1.curveTo(W - margin - 35 * mm, header_y + 16 * mm, W - margin - 15 * mm, header_y + 8 * mm, W - margin, header_y + 12 * mm)
    p1.lineTo(W - margin, header_top)
    p1.close()
    c.setFillColor(colors.HexColor('#dbeafe'))
    c.drawPath(p1, stroke=0, fill=1)

    p2 = c.beginPath()
    p2.moveTo(W - margin - 25 * mm, header_top)
    p2.curveTo(W - margin - 18 * mm, header_y + 20 * mm, W - margin - 8 * mm, header_y + 18 * mm, W - margin, header_y + 20 * mm)
    p2.lineTo(W - margin, header_top)
    p2.close()
    c.setFillColor(colors.HexColor('#bfdbfe'))
    c.drawPath(p2, stroke=0, fill=1)
    c.restoreState()
    c.restoreState()

    # Left: Client Logo (dynamic, no hardcoded tagline)
    _profile = getattr(client, 'payroll_profile', None)
    logo = client_logo_file(client)
    drawn_logo = False
    logo_w, logo_h = 38 * mm, 12 * mm
    logo_y = header_top - 6 * mm
    if logo and PILImage and getattr(logo, 'path', None) and Path(logo.path).exists():
        try:
            data = resized_logo_bytes(logo.path)
            if not data:
                raise ValueError('logo resize failed')
            with PILImage.open(io.BytesIO(data)) as im:
                iw, ih = im.size
            ratio = min(logo_w / iw, logo_h / ih)
            lw, lh = iw * ratio, ih * ratio
            c.drawImage(ImageReader(io.BytesIO(data)), margin + 6 * mm, logo_y - lh, lw, lh, mask='auto')
            drawn_logo = True
            lh = lh
        except Exception:
            drawn_logo = False

    if not drawn_logo:
        client_name = (client.name or 'COMPANY').strip()
        c.setFillColor(colors.HexColor('#007cc3'))
        # 48mm is where the vertical divider sits — never draw past it.
        draw_block(c, margin + 6 * mm, logo_y - 6 * mm, client_name, _BOLD, 20,
                   38 * mm, max_lines=4, min_size=7.5, leading_ratio=1.15)
        lh = 10 * mm

    # Vertical Divider Line (only if we have logo or name)
    div_x = margin + 48 * mm
    c.setStrokeColor(colors.HexColor('#cbd5e1'))
    c.setLineWidth(0.7)
    c.line(div_x, header_y + 4 * mm, div_x, header_top - 4 * mm)

    # Address - dynamically from client.address, no hardcoded tagline
    # Word-wrapped into the space between the divider and the right-hand
    # SALARY SLIP block — no more [:50] hard slicing mid-word.
    c.setFillColor(colors.HexColor(SLATE_MUTED))
    addr_w = (W - margin - 34 * mm) - (div_x + 5 * mm)
    # single_line_ratio=0.95: prefer wrapping to 2-3 readable lines rather than
    # squeezing a long address onto one tiny 5pt line.
    draw_block(c, div_x + 5 * mm, header_top - 11 * mm, (client.address or ''),
               _FONT, 7.8, addr_w, max_lines=3, min_size=6.0,
               leading_ratio=1.2, single_line_ratio=0.95)

    # Right: SALARY SLIP & Month Button
    c.setFont(_BOLD, 7.5)
    c.setFillColor(colors.HexColor(SLATE_MUTED))
    c.drawRightString(W - margin - 8 * mm, header_top - 7.5 * mm, "S A L A R Y   S L I P")

    month_text = f"{calendar.month_name[batch.month].upper()} {batch.year}"
    btn_font_size = 8.2
    month_w = pdfmetrics.stringWidth(month_text, _BOLD, btn_font_size)
    btn_w = month_w + 16 * mm
    btn_h = 7.2 * mm
    btn_x = W - margin - btn_w - 6 * mm
    btn_y = header_top - 20 * mm

    c.saveState()
    c.setFillColor(colors.HexColor(PRIMARY_BLUE))
    c.roundRect(btn_x, btn_y, btn_w, btn_h, btn_h / 2, stroke=0, fill=1)
    c.restoreState()

    _draw_lucide_icon(c, 'calendar', btn_x + 3 * mm, btn_y + 1.6 * mm, 4 * mm, '#ffffff')
    c.setFont(_BOLD, btn_font_size)
    c.setFillColor(colors.white)
    c.drawString(btn_x + 8.5 * mm, btn_y + 2.2 * mm, month_text)
    _cycle_text = _get_cycle_period_text(record)
    if _cycle_text:
        c.setFont(_FONT, 7.2)
        c.setFillColor(colors.HexColor(SLATE_MUTED))
        c.drawRightString(W - margin - 8 * mm, header_top - 24 * mm, f"Period: {_cycle_text}")

    # ----------------------------------------------------
    # Employee Details Card (3 Columns)
    # ----------------------------------------------------
    card1_top = header_y - 5 * mm
    card1_h = 72 * mm
    card1_y = card1_top - card1_h

    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(margin, card1_y, content_w, card1_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    _draw_icon_badge(c, 'user', margin + 6 * mm, card1_top - 11.5 * mm, 8 * mm, shape='circle')
    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(DARK_NAVY))
    c.drawString(margin + 17 * mm, card1_top - 7.8 * mm, "EMPLOYEE DETAILS")

    c.setStrokeColor(colors.HexColor('#e8edf4'))
    c.setLineWidth(0.6)
    c.line(margin + 6 * mm, card1_top - 14 * mm, margin + content_w - 6 * mm, card1_top - 14 * mm)

    col_w = (content_w - 12 * mm) / 3
    col1_x = margin + 6 * mm
    col2_x = col1_x + col_w
    col3_x = col2_x + col_w

    c.setStrokeColor(colors.HexColor('#f1f5f9'))
    c.line(col2_x - 3 * mm, card1_top - 16 * mm, col2_x - 3 * mm, card1_y + 6 * mm)
    c.line(col3_x - 3 * mm, card1_top - 16 * mm, col3_x - 3 * mm, card1_y + 6 * mm)

    _prof5 = getattr(client, 'payroll_profile', None)
    show_uan5 = getattr(_prof5, 'show_uan_in_payslip', True) if _prof5 else True
    uan_no5 = getattr(employee, 'uan_number', None)
    esi_no5 = getattr(employee, 'esi_number', None)

    # Bank account integration (Option 4)
    pm_info5 = _get_payment_mode_info(record)
    bank_str5 = pm_info5[1] if pm_info5 and len(pm_info5) > 1 else '—'
    if not bank_str5 or bank_str5 == '—':
        b_name5 = (getattr(employee, 'bank_name', '') or '').strip()
        b_acc5 = (getattr(employee, 'bank_account_number', '') or '').strip()
        m_acc5 = f"••••{b_acc5[-4:]}" if len(b_acc5) > 4 else b_acc5
        if b_name5 and m_acc5:
            bank_str5 = f"{b_name5} · A/C {m_acc5}"
        elif m_acc5:
            bank_str5 = f"A/C {m_acc5}"
        else:
            bank_str5 = '—'

    leave_str = _get_leave_summary_str(record)

    if show_uan5:
        sec5_field = ("ESI NUMBER", str(esi_no5)) if esi_no5 else ("BANK ACCOUNT", bank_str5)
        grid_data = [
            (("EMPLOYEE CODE", employee.employee_code or '—'),
             ("EMPLOYEE NAME", employee.full_name or '—'),
             ("DESIGNATION", employee.position or '—')),
            (("DEPARTMENT", employee.department or '—'),
             ("PAN NUMBER", employee.pan_number or '—'),
             ("UAN NUMBER", str(uan_no5 or '—'))),
            (("EMAIL", employee.email or '—'),
             ("DATE OF JOINING", str(employee.hire_date or '—')),
             ("CTC (ANNUAL)", str(ctc))),
            (("DAYS IN MONTH", _days(record.days_in_month)),
             ("WORKING DAYS", _days(record.actual_working_days)),
             ("PAID LEAVE", leave_str)),
            (("LOP DAYS", _leave(record.lop_days)),
             sec5_field,
             (None, None)),
        ]
    else:
        grid_data = [
            (("EMPLOYEE CODE", employee.employee_code or '—'),
             ("EMPLOYEE NAME", employee.full_name or '—'),
             ("DESIGNATION", employee.position or '—')),
            (("DEPARTMENT", employee.department or '—'),
             ("PAN NUMBER", employee.pan_number or '—'),
             ("EMAIL", employee.email or '—')),
            (("DATE OF JOINING", str(employee.hire_date or '—')),
             ("CTC (ANNUAL)", str(ctc)),
             ("DAYS IN MONTH", _days(record.days_in_month))),
            (("WORKING DAYS", _days(record.actual_working_days)),
             ("PAID LEAVE", leave_str),
             ("LOP DAYS", _leave(record.lop_days))),
        ]

    r_y = card1_top - 19 * mm
    step_y = min(12 * mm, (card1_h - 18 * mm) / len(grid_data))
    for (l1, v1), (l2, v2), (l3, v3) in grid_data:
        if l1:
            c.setFont(_BOLD, 6.5)
            c.setFillColor(colors.HexColor(SLATE_MUTED))
            c.drawString(col1_x, r_y, l1)
            c.setFillColor(colors.HexColor(TEXT_MAIN))
            draw_fitted(c, col1_x, r_y - 4.5 * mm, str(v1), _BOLD, 8.5, col_w - 5 * mm, min_size=6)

        if l2:
            c.setFont(_BOLD, 6.5)
            c.setFillColor(colors.HexColor(SLATE_MUTED))
            c.drawString(col2_x, r_y, l2)
            c.setFillColor(colors.HexColor(TEXT_MAIN))
            draw_fitted(c, col2_x, r_y - 4.5 * mm, str(v2), _BOLD, 8.5, col_w - 5 * mm, min_size=6)

        if l3:
            c.setFont(_BOLD, 6.5)
            c.setFillColor(colors.HexColor(SLATE_MUTED))
            c.drawString(col3_x, r_y, l3)
            c.setFillColor(colors.HexColor(TEXT_MAIN))
            draw_fitted(c, col3_x, r_y - 4.5 * mm, str(v3), _BOLD, 8.5, col_w - 5 * mm, min_size=6)

        r_y -= step_y

    # ----------------------------------------------------
    # Earnings & Deductions Tables
    # ----------------------------------------------------
    tables_top = card1_y - 5 * mm
    table_card_h = 88 * mm
    table_card_y = tables_top - table_card_h
    card_gap = 5 * mm
    table_w = (content_w - card_gap) / 2

    earn_x = margin
    ded_x = margin + table_w + card_gap

    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(earn_x, table_card_y, table_w, table_card_h, 3.5 * mm, stroke=1, fill=1)
    c.roundRect(ded_x, table_card_y, table_w, table_card_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    _draw_icon_badge(c, 'wallet', earn_x + 6 * mm, tables_top - 10.5 * mm, 7.5 * mm, shape='square')
    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(DARK_NAVY))
    c.drawString(earn_x + 16 * mm, tables_top - 7.4 * mm, "EARNINGS")
    c.setFont(_FONT, 7.5)
    c.setFillColor(colors.HexColor(SLATE_MUTED))
    c.drawRightString(earn_x + table_w - 6 * mm, tables_top - 7.4 * mm, "Amount (₹)")

    _draw_icon_badge(c, 'shield', ded_x + 6 * mm, tables_top - 10.5 * mm, 7.5 * mm, shape='square')
    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(DARK_NAVY))
    c.drawString(ded_x + 16 * mm, tables_top - 7.4 * mm, "DEDUCTIONS")
    c.setFont(_FONT, 7.5)
    c.setFillColor(colors.HexColor(SLATE_MUTED))
    c.drawRightString(ded_x + table_w - 6 * mm, tables_top - 7.4 * mm, "Amount (₹)")

    c.setStrokeColor(colors.HexColor('#e8edf4'))
    c.setLineWidth(0.6)
    c.line(earn_x + 6 * mm, tables_top - 13 * mm, earn_x + table_w - 6 * mm, tables_top - 13 * mm)
    c.line(ded_x + 6 * mm, tables_top - 13 * mm, ded_x + table_w - 6 * mm, tables_top - 13 * mm)

    def rows(spec):
        return [(name, _money(value) or '0.00') for name, value, optional in spec if not (optional and value == 0)]

    custom_earn_specs, custom_ded_specs = _extract_custom_specs(record)
    earn_list = rows([
        ('Basic + DA', record.basic_da, False),
        ('HRA', record.hra, False),
        ('Leave Travel Allowance', record.lta, True),
        ('Special Allowance', record.special_allowance, False),
        ('NPS Allowance', record.nps_allowance_earned, True),
        ('Variable Pay', record.variable_pay, True),
        ('Commission / Other', record.commission_other, True),
        ('Salary Advance Given', record.salary_advance_disbursed, True),
        ('On Hold Released', record.on_hold_released, True),
        ('Reimbursement', record.reimbursements, True),
        ('Arrears', record.arrears, True),
    ] + custom_earn_specs)

    ded_list = rows([
        ('EPF', record.epf, not pf_opted),
        ('ESI', getattr(record, 'esi', 0), True),
        ('VPF', record.vpf, True),
        ('VPF Arrears', record.vpf_arrears, True),
        ('Professional Tax', record.professional_tax, False),
        ('TDS', record.tds, False),
        ('NPS Deduction', record.nps_deduction, True),
        ('NPS Deduction – Arrears', record.nps_deduction_arrears, True),
        ('Loan Deduction', record.loan_deduction, True),
        ('Salary Advance Recovered', record.salary_advance_recovered, True),
        ('On Hold Deducted', record.on_hold_deducted, True),
        ('LWF', record.lwf, True),
        ('Other Deduction', record.other_deduction, True),
    ] + custom_ded_specs)

    row_h = 7.4 * mm
    curr_e_y = tables_top - 19 * mm
    for ename, evalue in earn_list:
        c.setFont(_FONT, 8.2)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(earn_x + 6 * mm, curr_e_y, ename)
        c.setFont(_BOLD, 8.2)
        c.drawRightString(earn_x + table_w - 6 * mm, curr_e_y, evalue)
        curr_e_y -= row_h

    curr_d_y = tables_top - 19 * mm
    for dname, dvalue in ded_list:
        c.setFont(_FONT, 8.2)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(ded_x + 6 * mm, curr_d_y, dname)
        c.setFont(_BOLD, 8.2)
        c.drawRightString(ded_x + table_w - 6 * mm, curr_d_y, dvalue)
        curr_d_y -= row_h

    gross_y = table_card_y + 18 * mm
    c.setStrokeColor(colors.HexColor('#e8edf4'))
    c.line(earn_x + 6 * mm, gross_y + 4.5 * mm, earn_x + table_w - 6 * mm, gross_y + 4.5 * mm)

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(earn_x + 6 * mm, gross_y, "Gross Salary")
    c.drawRightString(earn_x + table_w - 6 * mm, gross_y, _money(record.gross_salary) or '0.00')

    pill_w = table_w - 10 * mm
    pill_y = table_card_y + 5 * mm
    c.saveState()
    c.setFillColor(colors.HexColor(GREEN_PILL_BG))
    c.roundRect(earn_x + 5 * mm, pill_y, pill_w, 8 * mm, 2.5 * mm, stroke=0, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 8.2)
    c.setFillColor(colors.HexColor(GREEN_PILL_TEXT))
    c.drawString(earn_x + 8 * mm, pill_y + 2.5 * mm, "EARNED SALARY")
    c.drawRightString(earn_x + 5 * mm + pill_w - 4 * mm, pill_y + 2.5 * mm, _money(record.earned_salary) or '0.00')

    c.saveState()
    c.setFillColor(colors.HexColor(RED_PILL_BG))
    c.roundRect(ded_x + 5 * mm, pill_y, pill_w, 8 * mm, 2.5 * mm, stroke=0, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 8.2)
    c.setFillColor(colors.HexColor(RED_PILL_TEXT))
    c.drawString(ded_x + 8 * mm, pill_y + 2.5 * mm, "TOTAL DEDUCTIONS")
    c.drawRightString(ded_x + 5 * mm + pill_w - 4 * mm, pill_y + 2.5 * mm, _money(record.total_deductions) or '0.00')

    _employer_pf_note(c, structure, W/2, table_card_y - 8.5*mm, record=record)
    net_top = table_card_y - 13 * mm
    net_h = 26 * mm
    net_y = net_top - net_h

    c.saveState()
    c.setFillColor(colors.HexColor(PRIMARY_BLUE))
    c.roundRect(margin, net_y, content_w, net_h, 3.5 * mm, stroke=0, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 7.5)
    c.setFillColor(colors.HexColor('#bfdbfe'))
    c.drawString(margin + 8 * mm, net_top - 8 * mm, "N E T   S A L A R Y   ( T A K E - H O M E )")

    c.setFont(_BOLD, 22)
    c.setFillColor(colors.white)
    c.drawString(margin + 8 * mm, net_y + 6 * mm, f"₹{_money(record.net_salary) or '0.00'}")

    c.setFont(_BOLD, 46)
    c.setFillColor(colors.HexColor('#1d76dd'))
    c.drawRightString(W - margin - 8 * mm, net_y + 3.5 * mm, "₹")

    pm_text = _get_payment_mode_display_text(record)
    words_top = net_y - 5 * mm
    words_h = 16 * mm
    words_y = words_top - words_h

    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(margin, words_y, content_w, words_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    _draw_icon_badge(c, 'document', margin + 6 * mm, words_y + 4 * mm, 8 * mm, shape='square')

    c.setFont(_BOLD, 6.8)
    c.setFillColor(colors.HexColor(SLATE_MUTED))
    c.drawString(margin + 17 * mm, words_top - 5.5 * mm, "A M O U N T   I N   W O R D S")

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(margin + 17 * mm, words_y + 3.8 * mm, amount_in_words(record.net_salary))

    # Mode of payment kept outside the amount in words section
    if pm_text:
        pmy = words_y - 2.5 * mm
        pm_h = 6.0 * mm
        c.saveState()
        c.setFillColor(colors.HexColor('#f8fafc'))
        c.setStrokeColor(colors.HexColor(CARD_BORDER))
        c.setLineWidth(0.6)
        c.roundRect(margin, pmy - pm_h, content_w, pm_h, 2.5 * mm, stroke=1, fill=1)
        c.restoreState()
        _draw_icon(c, 'card', margin + 5 * mm, pmy - 4.6 * mm, 3.8 * mm, PRIMARY_BLUE)
        c.setFont(_BOLD, 7.5)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(margin + 11.5 * mm, pmy - 4.2 * mm, pm_text)
        fy = max((pmy - pm_h) - 6.0 * mm, 12 * mm)
    else:
        fy = max(words_y - 6.0 * mm, 12 * mm)
    _draw_lucide_icon(c, 'shield', margin, fy - 1 * mm, 4.0 * mm, PRIMARY_BLUE)
    c.setFont(_FONT, 7.2)
    c.setFillColor(colors.HexColor(SLATE_MUTED))
    disclaimer = "This is a system-generated, password-protected salary slip and does not require a signature."
    c.drawString(margin + 6 * mm, fy, disclaimer)

    disc_w = pdfmetrics.stringWidth(disclaimer, _FONT, 7.2)
    c.setStrokeColor(colors.HexColor('#cbd5e1'))
    c.setLineWidth(0.6)
    c.line(margin + 7 * mm + disc_w, fy + 1 * mm, W - margin, fy + 1 * mm)

    c.showPage()
    c.save()
    return buf.getvalue()



# =====================================================================
# DESIGN 6: Warm Slate Rounded Badges Portrait
# =====================================================================



def _build_pdf_bytes_6(record: PayslipRecord, encryption=None) -> bytes:
    employee, client, batch = record.employee, record.batch.client, record.batch
    structure, pf_opted = _structure(record)
    ctc = _money(structure.ctc_annual) if structure else '—'

    buf = io.BytesIO()
    W, H = A4
    c = canvas.Canvas(buf, pagesize=A4, encrypt=encryption)

    PAGE_BG = '#fcf8f3'
    FOREST_GREEN = '#2d4a3e'
    FOREST_DARK = '#1e3a2f'
    TERRACOTTA = '#b85c3a'
    WARM_OLIVE = '#c19a6b'
    BEIGE_HEADER = '#fdf6e8'
    CARD_BG = '#ffffff'
    CARD_HEADER_BG = '#f8f5ee'
    CARD_BORDER = '#e8e0d0'
    SAGE_TILE_BG = '#e8efe6'
    SAGE_TILE_BORDER = '#c8d8c5'
    TEXT_MAIN = '#2d3748'
    SLATE_MUTED = '#718096'
    ROW_LINE = '#edf2f7'

    LAVENDER_BG = '#ede8f8'
    LAVENDER_BORDER = '#d6cceb'
    VIOLET_TEXT = '#3c2d6b'
    VIOLET_BADGE = '#5b4a9e'
    AMBER_BG = '#fef6e0'
    AMBER_BADGE = '#f0b429'
    AMBER_TEXT = '#975a16'

    c.setFillColor(colors.HexColor(PAGE_BG))
    c.rect(0, 0, W, H, stroke=0, fill=1)

    margin = 11 * mm
    content_w = W - 2 * margin

    # ===== HEADER: Reverted to previous organic forest green style =====
    # Top-right deep forest green organic curved shape
    c.saveState()
    p_green = c.beginPath()
    p_green.moveTo(W - 78 * mm, H)
    p_green.curveTo(W - 75 * mm, H - 18 * mm, W - 65 * mm, H - 35 * mm, W - 40 * mm, H - 35 * mm)
    p_green.lineTo(W, H - 35 * mm)
    p_green.lineTo(W, H)
    p_green.close()
    c.setFillColor(colors.HexColor(FOREST_GREEN))
    c.drawPath(p_green, stroke=0, fill=1)

    c.setFont(_BOLD, 12)
    c.setFillColor(colors.white)
    c.drawRightString(W - 12 * mm, H - 16 * mm, "SALARY SLIP")

    month_text = f"{calendar.month_name[batch.month].upper()} {batch.year}"
    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor('#d8c8b4'))
    c.drawRightString(W - 12 * mm, H - 23 * mm, month_text)
    _cycle_text = _get_cycle_period_text(record)
    if _cycle_text:
        c.setFont(_FONT, 6.8)
        c.setFillColor(colors.HexColor('#ecdcc9'))
        c.drawRightString(W - 12 * mm, H - 27.5 * mm, f"Period: {_cycle_text}")

    c.setStrokeColor(colors.HexColor('#d8c8b4'))
    c.setLineWidth(1.2)
    c.line(W - 32 * mm, H - 26 * mm, W - 12 * mm, H - 26 * mm)
    c.restoreState()

    # Top-left terracotta arc + concentric lines + olive blob (previous design)
    c.saveState()
    c.setFillColor(colors.HexColor(TERRACOTTA))
    c.circle(0, H - 38 * mm, 12 * mm, stroke=0, fill=1)
    c.setStrokeColor(colors.HexColor('#d6c9b3'))
    c.setLineWidth(0.8)
    c.circle(-4 * mm, H - 10 * mm, 20 * mm, stroke=1, fill=0)
    c.circle(-4 * mm, H - 10 * mm, 26 * mm, stroke=1, fill=0)
    c.setFillColor(colors.HexColor(WARM_OLIVE))
    c.circle(W * 0.56, H - 4 * mm, 13 * mm, stroke=0, fill=1)
    c.restoreState()

    # Logo and company info
    logo_y = H - 21 * mm
    _profile = getattr(client, 'payroll_profile', None)
    logo = client_logo_file(client)
    drawn_logo = False
    if logo and PILImage and getattr(logo, 'path', None) and Path(logo.path).exists():
        try:
            data = resized_logo_bytes(logo.path)
            if not data:
                raise ValueError('logo resize failed')
            with PILImage.open(io.BytesIO(data)) as im:
                iw, ih = im.size
            ratio = min(34 * mm / iw, 12 * mm / ih)
            lw, lh = iw * ratio, ih * ratio
            c.drawImage(ImageReader(io.BytesIO(data)), 14 * mm, logo_y - lh + 3 * mm, lw, lh, mask='auto')
            drawn_logo = True
        except Exception:
            drawn_logo = False

    if not drawn_logo:
        client_name = (client.name or 'COMPANY').strip()
        c.setFillColor(colors.HexColor('#2d6a4f'))
        # div_x (62mm) is the divider — the name block stops before it.
        draw_block(c, 14 * mm, logo_y, client_name, _BOLD, 20,
                   44 * mm, max_lines=4, min_size=7.5, leading_ratio=1.15)

    div_x = 62 * mm
    c.setStrokeColor(colors.HexColor('#e2d5c0'))
    c.setLineWidth(0.6)
    c.line(div_x, logo_y - 10 * mm, div_x, logo_y + 6 * mm)

    c.setFillColor(colors.HexColor('#5a4a3a'))
    # The dark decorative panel occupies the right ~35% of the header, so the
    # centre column must stop before it — otherwise long names/addresses run
    # underneath it and become unreadable.
    _hdr_w = (W * 0.63) - (div_x + 6 * mm)
    # Wrap instead of ellipsize, and let the address follow the name's real
    # bottom so a 2-line name never overlaps it.
    name_bottom = draw_block(c, div_x + 6 * mm, logo_y + 3 * mm,
                             (client.name or 'INFOSYS').upper(), _BOLD, 9.5, _hdr_w,
                             max_lines=2, min_size=6.5, leading_ratio=1.15)

    addr_y = min(logo_y - 5.5 * mm, name_bottom - 0.5 * mm)
    _draw_icon(c, 'map-pin', div_x + 5.5 * mm, addr_y - 1 * mm, 3.8 * mm, '#5a4a3a')
    c.setFillColor(colors.HexColor('#6b5a4a'))
    draw_block(c, div_x + 10 * mm, addr_y,
               (client.address or 'Banashankari, Bangalore'), _FONT, 7.8,
               _hdr_w - 4 * mm, max_lines=2, min_size=6.0, leading_ratio=1.2)

    # ===== EMPLOYEE DETAILS CARD =====
    card1_top = H - 42 * mm
    card1_h = 78 * mm
    card1_y = card1_top - card1_h

    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.7)
    c.roundRect(margin, card1_y, content_w, card1_h, 4 * mm, stroke=1, fill=1)

    # Header background
    c.setFillColor(colors.HexColor(CARD_HEADER_BG))
    c.roundRect(margin, card1_top - 12 * mm, content_w, 12 * mm, 4 * mm, stroke=0, fill=1)
    c.rect(margin, card1_top - 12 * mm, content_w, 6 * mm, stroke=0, fill=1)
    c.restoreState()

    # Header icon
    c.saveState()
    c.setFillColor(colors.HexColor('#6b5f4a'))
    c.circle(margin + 9 * mm, card1_top - 6 * mm, 4.2 * mm, stroke=0, fill=1)
    _draw_icon(c, 'person', margin + 6.5 * mm, card1_top - 8.5 * mm, 5 * mm, '#ffffff')
    c.restoreState()

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor('#5a4f3a'))
    c.drawString(margin + 16 * mm, card1_top - 7.2 * mm, "EMPLOYEE DETAILS")

    half_w = (content_w - 1 * mm) / 2
    col1_x = margin + 5 * mm
    col2_x = margin + half_w + 4 * mm

    details_list = _build_employee_detail_pairs(record, uppercase_labels=False)

    r_y = card1_top - 19 * mm
    step_y = min(9.5 * mm, (card1_h - 18 * mm) / len(details_list))

    for (i1, l1, v1), (i2, l2, v2) in details_list:
        # Vertical divider between columns (full height of details)
        if r_y == card1_top - 19 * mm:
            c.setStrokeColor(colors.HexColor(ROW_LINE))
            c.setLineWidth(0.5)
            c.line(margin + half_w, card1_top - 14 * mm, margin + half_w, card1_y + 3 * mm)

        # Horizontal separator
        c.setStrokeColor(colors.HexColor(ROW_LINE))
        c.setLineWidth(0.4)
        c.line(col1_x, r_y - 3.2 * mm, col1_x + half_w - 8 * mm, r_y - 3.2 * mm)
        c.line(col2_x, r_y - 3.2 * mm, col2_x + half_w - 8 * mm, r_y - 3.2 * mm)

        # Col1
        c.saveState()
        c.setFillColor(colors.HexColor(SAGE_TILE_BG))
        c.setStrokeColor(colors.HexColor(SAGE_TILE_BORDER))
        c.setLineWidth(0.5)
        c.roundRect(col1_x, r_y - 1.2 * mm, 5.2 * mm, 5.2 * mm, 1.1 * mm, stroke=1, fill=1)
        c.restoreState()
        _draw_icon(c, i1, col1_x + 0.5 * mm, r_y - 0.6 * mm, 4.2 * mm, '#2f4a3a')

        c.setFont(_FONT, 7.5)
        c.setFillColor(colors.HexColor('#4a5568'))
        c.drawString(col1_x + 8.5 * mm, r_y, l1)
        # Fitted instead of the old [:22] hard slice (which cut names mid-word).
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        draw_block(c, col1_x + 32 * mm, r_y, str(v1), _BOLD, 7.8,
                   half_w - 36 * mm, max_lines=2, min_size=5.8, leading_ratio=1.05)

        # Col2
        c.saveState()
        c.setFillColor(colors.HexColor(SAGE_TILE_BG))
        c.setStrokeColor(colors.HexColor(SAGE_TILE_BORDER))
        c.setLineWidth(0.5)
        c.roundRect(col2_x, r_y - 1.2 * mm, 5.2 * mm, 5.2 * mm, 1.1 * mm, stroke=1, fill=1)
        c.restoreState()
        _draw_icon(c, i2, col2_x + 0.5 * mm, r_y - 0.6 * mm, 4.2 * mm, '#2f4a3a')

        c.setFont(_FONT, 7.5)
        c.setFillColor(colors.HexColor('#4a5568'))
        c.drawString(col2_x + 8.5 * mm, r_y, l2)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        draw_block(c, col2_x + 32 * mm, r_y, str(v2), _BOLD, 7.8,
                   half_w - 36 * mm, max_lines=2, min_size=5.8, leading_ratio=1.05)

        r_y -= step_y

    # ===== EARNINGS & DEDUCTIONS - DYNAMIC HEIGHT TO AVOID EMPTY SPACE =====
    def rows(spec):
        return [(name, _money(value) or '0.00') for name, value, optional in spec if not (optional and value == 0)]

    custom_earn_specs, custom_ded_specs = _extract_custom_specs(record)
    earn_list = rows([
        ('Basic + DA', record.basic_da, False),
        ('HRA', record.hra, False),
        ('Leave Travel Allowance', record.lta, True),
        ('Special Allowance', record.special_allowance, False),
        ('NPS Allowance', record.nps_allowance_earned, True),
        ('Variable Pay', record.variable_pay, True),
        ('Commission / Other', record.commission_other, True),
        ('Salary Advance Given', record.salary_advance_disbursed, True),
        ('On Hold Released', record.on_hold_released, True),
        ('Reimbursement', record.reimbursements, True),
        ('Arrears', record.arrears, True),
    ] + custom_earn_specs)

    ded_list = rows([
        ('EPF', record.epf, not pf_opted),
        ('ESI', getattr(record, 'esi', 0), True),
        ('VPF', record.vpf, True),
        ('VPF Arrears', record.vpf_arrears, True),
        ('Professional Tax', record.professional_tax, False),
        ('TDS', record.tds, False),
        ('NPS Deduction', record.nps_deduction, True),
        ('NPS Deduction – Arrears', record.nps_deduction_arrears, True),
        ('Loan Deduction', record.loan_deduction, True),
        ('Salary Advance Recovered', record.salary_advance_recovered, True),
        ('On Hold Deducted', record.on_hold_deducted, True),
        ('LWF', record.lwf, True),
        ('Other Deduction', record.other_deduction, True),
    ] + custom_ded_specs)

    row_h = 7.2 * mm
    max_rows = max(len(earn_list), len(ded_list), 1)
    # Dynamic height: header 11mm + rows + gross 8mm + pill 9mm + padding 6mm
    table_h = 11 * mm + max_rows * row_h + 18 * mm
    tables_top = card1_y - 5 * mm
    table_y = tables_top - table_h
    card_gap = 4 * mm
    table_w = (content_w - card_gap) / 2

    earn_x = margin
    ded_x = margin + table_w + card_gap

    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor('#e2d5c0'))
    c.setLineWidth(0.6)
    c.roundRect(earn_x, table_y, table_w, table_h, 3.5 * mm, stroke=1, fill=1)
    c.roundRect(ded_x, table_y, table_w, table_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    # Earnings header - mint
    c.saveState()
    c.setFillColor(colors.HexColor('#eef6ef'))
    c.roundRect(earn_x, tables_top - 11 * mm, table_w, 11 * mm, 3.5 * mm, stroke=0, fill=1)
    c.rect(earn_x, tables_top - 11 * mm, table_w, 5 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor('#2d5a4a'))
    c.circle(earn_x + 8 * mm, tables_top - 5.5 * mm, 4.5 * mm, stroke=0, fill=1)
    _draw_icon(c, 'wallet', earn_x + 5.5 * mm, tables_top - 8 * mm, 5 * mm, '#ffffff')
    c.restoreState()

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor('#2d5a4a'))
    c.drawString(earn_x + 15 * mm, tables_top - 6.8 * mm, "EARNINGS")
    c.setFont(_BOLD, 7.0)
    c.setFillColor(colors.HexColor('#5a7a6a'))
    c.drawRightString(earn_x + table_w - 5 * mm, tables_top - 6.8 * mm, "Amount (₹)")

    c.setStrokeColor(colors.HexColor('#d6e8d6'))
    c.setLineWidth(0.5)
    c.line(earn_x, tables_top - 11 * mm, earn_x + table_w, tables_top - 11 * mm)

    # Deductions header - peach
    c.saveState()
    c.setFillColor(colors.HexColor('#fdf0e8'))
    c.roundRect(ded_x, tables_top - 11 * mm, table_w, 11 * mm, 3.5 * mm, stroke=0, fill=1)
    c.rect(ded_x, tables_top - 11 * mm, table_w, 5 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor(TERRACOTTA))
    c.circle(ded_x + 8 * mm, tables_top - 5.5 * mm, 4.5 * mm, stroke=0, fill=1)
    _draw_icon(c, 'shield', ded_x + 5.5 * mm, tables_top - 8 * mm, 5 * mm, '#ffffff')
    c.restoreState()

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor('#8a4a2f'))
    c.drawString(ded_x + 15 * mm, tables_top - 6.8 * mm, "DEDUCTIONS")
    c.setFont(_BOLD, 7.0)
    c.setFillColor(colors.HexColor('#a86a4a'))
    c.drawRightString(ded_x + table_w - 5 * mm, tables_top - 6.8 * mm, "Amount (₹)")

    c.setStrokeColor(colors.HexColor('#f0d5c5'))
    c.setLineWidth(0.5)
    c.line(ded_x, tables_top - 11 * mm, ded_x + table_w, tables_top - 11 * mm)

    curr_e_y = tables_top - 17 * mm
    for idx, (ename, evalue) in enumerate(earn_list):
        if idx > 0:
            c.setStrokeColor(colors.HexColor('#e8e8e8'))
            c.setDash(1, 1.5)
            c.setLineWidth(0.3)
            c.line(earn_x + 4 * mm, curr_e_y + 4.2 * mm, earn_x + table_w - 4 * mm, curr_e_y + 4.2 * mm)
            c.setDash()
        c.setFont(_FONT, 7.8)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(earn_x + 5 * mm, curr_e_y, ename)
        c.setFont(_BOLD, 7.8)
        c.drawRightString(earn_x + table_w - 5 * mm, curr_e_y, evalue)
        curr_e_y -= row_h

    curr_d_y = tables_top - 17 * mm
    for idx, (dname, dvalue) in enumerate(ded_list):
        if idx > 0:
            c.setStrokeColor(colors.HexColor('#e8e8e8'))
            c.setDash(1, 1.5)
            c.setLineWidth(0.3)
            c.line(ded_x + 4 * mm, curr_d_y + 4.2 * mm, ded_x + table_w - 4 * mm, curr_d_y + 4.2 * mm)
            c.setDash()
        c.setFont(_FONT, 7.8)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(ded_x + 5 * mm, curr_d_y, dname)
        c.setFont(_BOLD, 7.8)
        c.drawRightString(ded_x + table_w - 5 * mm, curr_d_y, dvalue)
        curr_d_y -= row_h

    # Gross Salary - light mint background - PLACED DIRECTLY ABOVE Earned Salary as per reference
    pill_h = 9 * mm
    pill_y = table_y
    gross_h = 8 * mm
    gross_y = pill_y + pill_h + 0.5 * mm  # directly above pill, no empty gap
    c.saveState()
    c.setFillColor(colors.HexColor('#e6f0e8'))
    c.setStrokeColor(colors.HexColor('#c8d8c5'))
    c.setLineWidth(0.4)
    c.rect(earn_x, gross_y, table_w, gross_h, stroke=1, fill=1)
    c.restoreState()
    c.setFont(_BOLD, 8.0)
    c.setFillColor(colors.HexColor('#2d5a4a'))
    c.drawString(earn_x + 5 * mm, gross_y + 2.5 * mm, "GROSS SALARY")
    c.drawRightString(earn_x + table_w - 5 * mm, gross_y + 2.5 * mm, _money(record.gross_salary) or '0.00')

    # Earned & Total same row - as per earlier fix
    pill_w = table_w

    # Earned - dark green
    c.saveState()
    c.setFillColor(colors.HexColor('#5a8a72'))
    c.roundRect(earn_x, pill_y, pill_w, pill_h, 3.5 * mm, stroke=0, fill=1)
    c.rect(earn_x, pill_y + 3.5 * mm, pill_w, 3.5 * mm, stroke=0, fill=1)
    c.restoreState()
    c.setFont(_BOLD, 8.0)
    c.setFillColor(colors.white)
    c.drawString(earn_x + 5 * mm, pill_y + 3 * mm, "EARNED SALARY")
    c.setFont(_BOLD, 9.5)
    c.drawRightString(earn_x + table_w - 5 * mm, pill_y + 3 * mm, _money(record.earned_salary) or '0.00')

    # Total Deductions - light pink
    c.saveState()
    c.setFillColor(colors.HexColor('#f9d5c8'))
    c.roundRect(ded_x, pill_y, pill_w, pill_h, 3.5 * mm, stroke=0, fill=1)
    c.rect(ded_x, pill_y + 3.5 * mm, pill_w, 3.5 * mm, stroke=0, fill=1)
    c.restoreState()
    c.setFont(_BOLD, 7.5)
    c.setFillColor(colors.HexColor('#8a2a2a'))
    c.drawString(ded_x + 5 * mm, pill_y + 3 * mm, "TOTAL DEDUCTIONS")
    c.setFont(_BOLD, 9.5)
    c.setFillColor(colors.HexColor('#a82a2a'))
    c.drawRightString(ded_x + table_w - 5 * mm, pill_y + 3 * mm, _money(record.total_deductions) or '0.00')

    # ===== NET SALARY - Lavender with improved design =====
    _employer_pf_note(c, structure, W/2, table_y - 8.5*mm, record=record)
    net_top = table_y - 13 * mm
    net_h = 24 * mm
    net_y = net_top - net_h

    c.saveState()
    c.setFillColor(colors.HexColor(LAVENDER_BG))
    c.roundRect(margin, net_y, content_w, net_h, 4 * mm, stroke=0, fill=1)

    # Dot matrix left - 3 cols x 7 rows, light purple - improved spacing
    _draw_dot_matrix(c, margin + 3.5 * mm, net_y + 2.5 * mm, 3, 8, spacing=2.1 * mm, color='#c4b5e3', dot_size=0.38 * mm)

    # Purple rupee badge - FIXED: properly centered rupee icon inside circle
    badge_x = margin + 13 * mm
    badge_center_x = badge_x + 6 * mm
    badge_center_y = net_y + net_h / 2
    # Shadow
    c.setFillColor(colors.HexColor('#c9bfe6'))
    c.circle(badge_center_x + 0.7 * mm, badge_center_y - 0.7 * mm, 6.2 * mm, stroke=0, fill=1)
    # Main badge
    c.setFillColor(colors.HexColor(VIOLET_BADGE))
    c.circle(badge_center_x, badge_center_y, 6.2 * mm, stroke=0, fill=1)
    # Rupee icon - properly centered using SVG
    _draw_icon(c, 'rupee', badge_center_x - 3.1 * mm, badge_center_y - 3.1 * mm, 6.2 * mm, '#ffffff')

    # Vertical divider
    c.setStrokeColor(colors.HexColor('#d6cceb'))
    c.setLineWidth(0.6)
    c.line(badge_x + 15 * mm, net_y + 3 * mm, badge_x + 15 * mm, net_top - 3 * mm)

    c.setFont(_BOLD, 7.0)
    c.setFillColor(colors.HexColor('#6b5a9a'))
    c.drawString(badge_x + 19 * mm, net_top - 7.5 * mm, "NET SALARY (TAKE-HOME)")

    c.setFont(_BOLD, 23)
    c.setFillColor(colors.HexColor(VIOLET_TEXT))
    c.drawString(badge_x + 19 * mm, net_y + 4.5 * mm, f"₹{_money(record.net_salary) or '0.00'}")

    # Right illustration removed per user request - clean minimal lavender card
    # No blob, no banknote - just dot matrix, rupee badge, and text

    # ===== AMOUNT IN WORDS - IMPROVED DESIGN =====
    pm_text = _get_payment_mode_display_text(record)
    words_top = net_y - 4 * mm
    words_h = 14.5 * mm
    words_y = words_top - words_h

    c.saveState()
    # Light beige background with subtle border
    c.setFillColor(colors.HexColor('#fef9ec'))
    c.setStrokeColor(colors.HexColor('#f3e8c8'))
    c.setLineWidth(0.6)
    c.roundRect(margin, words_y, content_w, words_h, 3.5 * mm, stroke=1, fill=1)

    # Amber badge - improved with proper centering
    amt_badge_cx = margin + 10 * mm
    amt_badge_cy = words_y + words_h / 2
    # Shadow
    c.setFillColor(colors.HexColor('#fde68a'))
    c.circle(amt_badge_cx + 0.5 * mm, amt_badge_cy - 0.5 * mm, 5.2 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor(AMBER_BADGE))
    c.circle(amt_badge_cx, amt_badge_cy, 5.2 * mm, stroke=0, fill=1)
    _draw_icon(c, 'rupee', amt_badge_cx - 2.6 * mm, amt_badge_cy - 2.6 * mm, 5.2 * mm, '#ffffff')

    # Vertical divider
    c.setStrokeColor(colors.HexColor('#f3e8c8'))
    c.setLineWidth(0.6)
    c.line(margin + 19 * mm, words_y + 2.5 * mm, margin + 19 * mm, words_top - 2.5 * mm)

    c.setFont(_BOLD, 6.5)
    c.setFillColor(colors.HexColor(AMBER_TEXT))
    c.drawString(margin + 23 * mm, words_top - 5 * mm, "AMOUNT IN WORDS")

    c.setFont(_BOLD, 8.4)
    c.setFillColor(colors.HexColor('#1e293b'))
    # Wrap text if too long
    words_text = amount_in_words(record.net_salary)
    c.drawString(margin + 23 * mm, words_y + 3.5 * mm, words_text)
    c.restoreState()

    # Mode of payment kept outside the amount in words section
    if pm_text:
        pmy = words_y - 2.5 * mm
        pm_h = 6.0 * mm
        c.saveState()
        c.setFillColor(colors.HexColor('#fef9ec'))
        c.setStrokeColor(colors.HexColor('#f3e8c8'))
        c.setLineWidth(0.6)
        c.roundRect(margin, pmy - pm_h, content_w, pm_h, 2.0 * mm, stroke=1, fill=1)
        c.restoreState()
        _draw_icon(c, 'card', margin + 6 * mm, pmy - 4.6 * mm, 3.8 * mm, AMBER_TEXT)
        c.setFont(_BOLD, 7.4)
        c.setFillColor(colors.HexColor('#1e293b'))
        c.drawString(margin + 12.0 * mm, pmy - 4.2 * mm, pm_text)

    # ===== FOOTER - Improved note design =====
    fy = 8.0 * mm
    c.saveState()
    c.setFillColor(colors.HexColor('#eef2f8'))
    c.roundRect(margin, fy - 1 * mm, content_w, 9.5 * mm, 2.5 * mm, stroke=0, fill=1)

    # Lock badge - blue circle with lock icon
    c.setFillColor(colors.HexColor('#dbeafe'))
    c.setStrokeColor(colors.HexColor('#93c5fd'))
    c.setLineWidth(0.5)
    c.circle(margin + 8 * mm, fy + 4.5 * mm, 5 * mm, stroke=1, fill=1)
    _draw_icon(c, 'shield-lock', margin + 5 * mm, fy + 1.5 * mm, 6 * mm, '#2563eb')

    # Vertical divider
    c.setStrokeColor(colors.HexColor('#cbd5e1'))
    c.setLineWidth(0.5)
    c.line(margin + 16 * mm, fy + 0.5 * mm, margin + 16 * mm, fy + 8.5 * mm)

    c.setFont(_FONT, 6.8)
    c.setFillColor(colors.HexColor('#475569'))
    c.drawString(margin + 20 * mm, fy + 5.5 * mm, "This is a system-generated, password-protected salary slip")
    c.drawString(margin + 20 * mm, fy + 2.0 * mm, "and does not require a signature.")

    # Dot matrix right
    _draw_dot_matrix(c, W - margin - 20 * mm, fy + 1 * mm, 5, 3, spacing=2.2 * mm, color='#a3b4cc', dot_size=0.35 * mm)
    c.restoreState()

    c.showPage()
    c.save()
    return buf.getvalue()



# =====================================================================
# DESIGN 7: Multi-Ledger Audit Breakdown Portrait
# =====================================================================
def _build_pdf_bytes_7(record: PayslipRecord, encryption=None) -> bytes:
    employee, client, batch = record.employee, record.batch.client, record.batch
    structure, pf_opted = _structure(record)
    ctc = _money(structure.ctc_annual) if structure else '—'

    buf = io.BytesIO()
    pagesize = A4
    W, H = pagesize
    c = canvas.Canvas(buf, pagesize=pagesize, encrypt=encryption)

    # Color Palette
    PAGE_BG = '#f8fafc'
    PURPLE_PRIMARY = '#47448e'
    RIBBON_PURPLE = '#625eb6'
    PALE_LAVENDER = '#f3f0fb'
    CARD_BG = '#ffffff'
    CARD_BORDER = '#e2e8f0'
    TEXT_MAIN = '#1f2937'
    SLATE_MUTED = '#64748b'

    TEAL_HEADER = '#e6f7f5'
    TEAL_ACCENT = '#0f766e'
    ROSE_HEADER = '#fef1f2'
    ROSE_ACCENT = '#be123c'

    BLUE_NET_BG = '#edf2fe'
    BLUE_NET_SHAPE = '#6985e9'
    BLUE_NET_TEXT = '#1e40af'

    # Fill Page Background
    c.setFillColor(colors.HexColor(PAGE_BG))
    c.rect(0, 0, W, H, stroke=0, fill=1)

    margin = 11 * mm
    content_w = W - 2 * margin

    # ----------------------------------------------------
    # Header: Geometric Purple Split Banner
    # ----------------------------------------------------
    header_top = H - 8 * mm
    header_h = 28 * mm
    header_y = header_top - header_h

    # White Header Base Card
    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor('#e2e8f0'))
    c.setLineWidth(0.8)
    c.roundRect(margin, header_y, content_w, header_h, 3.5 * mm, stroke=1, fill=1)

    # Clip inside header card for diagonal shapes
    p_clip = c.beginPath()
    p_clip.roundRect(margin, header_y, content_w, header_h, 3.5 * mm)
    c.clipPath(p_clip, stroke=0)

    # Top-left deep purple polygon
    p_purple = c.beginPath()
    p_purple.moveTo(margin, header_top)
    p_purple.lineTo(margin + 52 * mm, header_top)
    p_purple.lineTo(margin + 42 * mm, header_y)
    p_purple.lineTo(margin, header_y)
    p_purple.close()
    c.setFillColor(colors.HexColor(PURPLE_PRIMARY))
    c.drawPath(p_purple, stroke=0, fill=1)

    # Top-right faint lavender polygon
    p_lav = c.beginPath()
    p_lav.moveTo(W - margin - 50 * mm, header_top)
    p_lav.lineTo(W - margin, header_top)
    p_lav.lineTo(W - margin, header_y)
    p_lav.lineTo(W - margin - 62 * mm, header_y)
    p_lav.close()
    c.setFillColor(colors.HexColor(PALE_LAVENDER))
    c.drawPath(p_lav, stroke=0, fill=1)
    c.restoreState()

    # Client logo in top-left purple area
    logo_y = header_top - 16 * mm
    _profile = getattr(client, 'payroll_profile', None)
    logo = client_logo_file(client)
    drawn_logo = False
    logo_file = getattr(logo, 'path', None) if logo else None

    if logo_file and PILImage and Path(logo_file).exists():
        try:
            data = resized_logo_bytes(logo_file)
            if not data:
                raise ValueError('logo resize failed')
            with PILImage.open(io.BytesIO(data)) as im:
                iw, ih = im.size
            ratio = min(36 * mm / iw, 13 * mm / ih)
            lw, lh = iw * ratio, ih * ratio
            c.drawImage(ImageReader(io.BytesIO(data)), margin + 4 * mm, logo_y - lh + 2 * mm, lw, lh, mask='auto')
            drawn_logo = True
        except Exception:
            drawn_logo = False

    if not drawn_logo:
        client_name = (client.name or 'INFOSYS').strip()
        c.setFillColor(colors.white)
        # Constrained to the coloured left panel: at most 3 lines, so a long
        # name can never spill below the panel's bottom edge.
        draw_block(c, margin + 5 * mm, logo_y - 1 * mm, client_name, _BOLD, 20,
                   42 * mm, max_lines=3, min_size=7.5, leading_ratio=1.12)

    # Vertical divider REMOVED per user request - no line
    div_x = margin + 50 * mm

    # Client Title & Address next to divider
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    # Stop short of the right-hand SALARY SLIP / month block.
    # Measure the actual right-hand block (SALARY SLIP / month) rather than
    # guessing a fixed inset — that guess is what let long names collide.
    _title_txt = _slip_title(record)
    _right_w = max(
        c.stringWidth(_title_txt, _BOLD, 13),
        c.stringWidth(f'{calendar.month_name[batch.month].upper()} {batch.year}', _BOLD, 8.5),
        30 * mm,
    )
    _hdr_w = (W - margin - 8 * mm - _right_w - 4 * mm) - (div_x + 6 * mm)
    # Wrap onto a 2nd line rather than ellipsizing: the header band is 28mm
    # tall, so name (2 lines) + address (2 lines) both fit with room to spare.
    name_bottom = draw_block(c, div_x + 6 * mm, header_top - 9 * mm,
                             (client.name or 'INFOSYS').upper(), _BOLD, 9, _hdr_w,
                             max_lines=2, min_size=6.5, leading_ratio=1.15)

    # Address follows the real bottom of the (possibly 2-line) name.
    addr_y = min(header_top - 18.5 * mm, name_bottom - 0.5 * mm)
    _draw_icon(c, 'map-pin', div_x + 5.5 * mm, addr_y - 1.5 * mm, 4 * mm, '#4b5563')
    c.setFillColor(colors.HexColor('#4b5563'))
    draw_block(c, div_x + 11 * mm, addr_y,
               (client.address or 'Banashankari, Bangalore'), _FONT, 7.8,
               _hdr_w - 5 * mm, max_lines=2, min_size=6.0, leading_ratio=1.2)

    # Right: SALARY SLIP & Month
    c.setFont(_BOLD, 13)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawRightString(W - margin - 8 * mm, header_top - 11 * mm, _title_txt)

    month_text = f"{calendar.month_name[batch.month].upper()} {batch.year}"
    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor('#4338ca'))
    c.drawRightString(W - margin - 8 * mm, header_top - 18 * mm, month_text)
    _cycle_text = _get_cycle_period_text(record)
    if _cycle_text:
        c.setFont(_FONT, 6.8)
        c.setFillColor(colors.HexColor('#6366f1'))
        c.drawRightString(W - margin - 8 * mm, header_top - 23.5 * mm, f"Period: {_cycle_text}")

    # Accent underline
    c.setStrokeColor(colors.HexColor('#4338ca'))
    c.setLineWidth(1.2)
    c.line(W - margin - 30 * mm, header_top - 21 * mm, W - margin - 8 * mm, header_top - 21 * mm)

    # Dot matrix top-right like reference (faint)
    _draw_dot_matrix(c, W - margin - 18 * mm, header_top - 6 * mm, 4, 3, spacing=2.2 * mm, color='#ede9fe')

    # ----------------------------------------------------
    # Employee Details Card with Vertical Purple Ribbon
    # ----------------------------------------------------
    card1_top = header_y - 5 * mm
    card1_h = 74 * mm
    card1_y = card1_top - card1_h
    ribbon_w = 14 * mm

    c.saveState()
    # White Card Body
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(margin, card1_y, content_w, card1_h, 3.5 * mm, stroke=1, fill=1)

    # Purple Left Ribbon
    c.saveState()
    p_ribbon = c.beginPath()
    p_ribbon.roundRect(margin, card1_y, ribbon_w, card1_h, 3.5 * mm)
    c.clipPath(p_ribbon, stroke=0)
    c.setFillColor(colors.HexColor(RIBBON_PURPLE))
    c.rect(margin, card1_y, ribbon_w, card1_h, stroke=0, fill=1)

    # Bow-tie / Badge icon at top of ribbon
    _draw_icon(c, 'briefcase', margin + 4.2 * mm, card1_top - 11 * mm, 5.5 * mm, '#ffffff')

    # Vertical text "EMPLOYEE DETAILS"
    c.saveState()
    c.setFont(_BOLD, 7.8)
    c.setFillColor(colors.white)
    c.translate(margin + 9.5 * mm, card1_y + 16 * mm)
    c.rotate(90)
    c.drawString(0, 0, "EMPLOYEE DETAILS")
    c.restoreState()

    # Dot matrix at bottom of ribbon
    _draw_dot_matrix(c, margin + 3.2 * mm, card1_y + 4 * mm, 3, 4, spacing=2.2 * mm, color='#8f8bc9')
    c.restoreState()
    c.restoreState()

    # 2 Columns of detail items with square icon tiles
    inner_x = margin + ribbon_w + 5 * mm
    inner_w = content_w - ribbon_w - 10 * mm
    half_w = inner_w / 2
    col1_x = inner_x
    col2_x = inner_x + half_w

    details_list = _build_employee_detail_pairs(record, uppercase_labels=False)

    r_y = card1_top - 11 * mm
    step_y = min(10.5 * mm, (card1_h - 14 * mm) / len(details_list))

    for (i1, l1, v1), (i2, l2, v2) in details_list:
        # Col 1 icon tile
        c.saveState()
        c.setFillColor(colors.HexColor('#f5f3ff'))
        c.setStrokeColor(colors.HexColor('#ede9fe'))
        c.setLineWidth(0.5)
        c.roundRect(col1_x, r_y - 2 * mm, 6 * mm, 6 * mm, 1.4 * mm, stroke=1, fill=1)
        _draw_icon(c, i1, col1_x + 0.8 * mm, r_y - 1.2 * mm, 4.4 * mm, '#7c3aed')
        c.restoreState()

        c.setFont(_FONT, 7.8)
        c.setFillColor(colors.HexColor('#1e293b'))
        c.drawString(col1_x + 9 * mm, r_y, l1)
        c.setFillColor(colors.HexColor('#0f172a'))
        # Value starts right after the label and may wrap to a 2nd line —
        # the row step is 10.5mm, so a long name fits without truncation.
        draw_block(c, col1_x + 34 * mm, r_y, str(v1), _BOLD, 7.8,
                   half_w - 37 * mm, max_lines=2, min_size=5.8, leading_ratio=1.1)

        # Col 2 icon tile - reference light lavender
        c.saveState()
        c.setFillColor(colors.HexColor('#f5f3ff'))
        c.setStrokeColor(colors.HexColor('#ede9fe'))
        c.setLineWidth(0.5)
        c.roundRect(col2_x, r_y - 2 * mm, 6 * mm, 6 * mm, 1.4 * mm, stroke=1, fill=1)
        _draw_icon(c, i2, col2_x + 0.8 * mm, r_y - 1.2 * mm, 4.4 * mm, '#7c3aed')
        c.restoreState()

        c.setFont(_FONT, 8)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(col2_x + 9 * mm, r_y, l2)
        draw_block(c, col2_x + 34 * mm, r_y, str(v2), _BOLD, 8,
                   half_w - 37 * mm, max_lines=2, min_size=5.8, leading_ratio=1.1)

        # Divider line between rows
        c.setStrokeColor(colors.HexColor('#f1f5f9'))
        c.setLineWidth(0.5)
        c.line(col1_x + 9 * mm, r_y - 4.5 * mm, col1_x + half_w - 4 * mm, r_y - 4.5 * mm)
        c.line(col2_x + 9 * mm, r_y - 4.5 * mm, col2_x + half_w - 4 * mm, r_y - 4.5 * mm)

        r_y -= step_y

    # ----------------------------------------------------
    # Earnings & Deductions Tables (Side by Side Cards) - DYNAMIC HEIGHT
    # ----------------------------------------------------
    def rows(spec):
        return [(name, _money(value) or '0.00') for name, value, optional in spec if not (optional and value == 0)]

    custom_earn_specs, custom_ded_specs = _extract_custom_specs(record)
    earn_list = rows([
        ('Basic + DA', record.basic_da, False),
        ('HRA', record.hra, False),
        ('Leave Travel Allowance', record.lta, True),
        ('Special Allowance', record.special_allowance, False),
        ('NPS Allowance', record.nps_allowance_earned, True),
        ('Variable Pay', record.variable_pay, True),
        ('Commission / Other', record.commission_other, True),
        ('Salary Advance Given', record.salary_advance_disbursed, True),
        ('On Hold Released', record.on_hold_released, True),
        ('Reimbursement', record.reimbursements, True),
        ('Arrears', record.arrears, True),
    ] + custom_earn_specs)

    ded_list = rows([
        ('EPF', record.epf, not pf_opted),
        ('ESI', getattr(record, 'esi', 0), True),
        ('VPF', record.vpf, True),
        ('VPF Arrears', record.vpf_arrears, True),
        ('Professional Tax', record.professional_tax, False),
        ('TDS', record.tds, False),
        ('NPS Deduction', record.nps_deduction, True),
        ('NPS Deduction – Arrears', record.nps_deduction_arrears, True),
        ('Loan Deduction', record.loan_deduction, True),
        ('Salary Advance Recovered', record.salary_advance_recovered, True),
        ('On Hold Deducted', record.on_hold_deducted, True),
        ('LWF', record.lwf, True),
        ('Other Deduction', record.other_deduction, True),
    ] + custom_ded_specs)

    row_h = 7.4 * mm
    max_rows = max(len(earn_list), len(ded_list), 1)
    table_h = 12 * mm + max_rows * row_h + 18 * mm
    tables_top = card1_y - 5 * mm
    table_y = tables_top - table_h
    card_gap = 5 * mm
    table_w = (content_w - card_gap) / 2

    earn_x = margin
    ded_x = margin + table_w + card_gap

    # Left Card (Earnings)
    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor(CARD_BORDER))
    c.setLineWidth(0.8)
    c.roundRect(earn_x, table_y, table_w, table_h, 3.5 * mm, stroke=1, fill=1)
    # Right Card (Deductions)
    c.roundRect(ded_x, table_y, table_w, table_h, 3.5 * mm, stroke=1, fill=1)

    # Shaded Header Areas
    c.saveState()
    p_eh = c.beginPath()
    p_eh.roundRect(earn_x, tables_top - 12 * mm, table_w, 12 * mm, 3.5 * mm)
    c.clipPath(p_eh, stroke=0)
    c.setFillColor(colors.HexColor(TEAL_HEADER))
    c.rect(earn_x, tables_top - 12 * mm, table_w, 12 * mm, stroke=0, fill=1)
    c.restoreState()

    c.saveState()
    p_dh = c.beginPath()
    p_dh.roundRect(ded_x, tables_top - 12 * mm, table_w, 12 * mm, 3.5 * mm)
    c.clipPath(p_dh, stroke=0)
    c.setFillColor(colors.HexColor(ROSE_HEADER))
    c.rect(ded_x, tables_top - 12 * mm, table_w, 12 * mm, stroke=0, fill=1)
    c.restoreState()
    c.restoreState()

    # Earnings Header Content
    c.saveState()
    c.setFillColor(colors.HexColor(TEAL_ACCENT))
    c.circle(earn_x + 9 * mm, tables_top - 6 * mm, 4.5 * mm, stroke=0, fill=1)
    _draw_icon(c, 'wallet', earn_x + 6.2 * mm, tables_top - 8.8 * mm, 5.6 * mm, '#ffffff')
    c.restoreState()

    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(TEAL_ACCENT))
    c.drawString(earn_x + 16 * mm, tables_top - 7.2 * mm, "EARNINGS")
    c.setFont(_FONT, 7.5)
    c.drawRightString(earn_x + table_w - 6 * mm, tables_top - 7.2 * mm, "Amount (₹)")

    # Deductions Header Content
    c.saveState()
    c.setFillColor(colors.HexColor(ROSE_ACCENT))
    c.circle(ded_x + 9 * mm, tables_top - 6 * mm, 4.5 * mm, stroke=0, fill=1)
    _draw_icon(c, 'shield', ded_x + 6.2 * mm, tables_top - 8.8 * mm, 5.6 * mm, '#ffffff')
    c.restoreState()

    c.setFont(_BOLD, 8.8)
    c.setFillColor(colors.HexColor(ROSE_ACCENT))
    c.drawString(ded_x + 16 * mm, tables_top - 7.2 * mm, "DEDUCTIONS")
    c.setFont(_FONT, 7.5)
    c.drawRightString(ded_x + table_w - 6 * mm, tables_top - 7.2 * mm, "Amount (₹)")

        # rows already computed above with dynamic height
    curr_e_y = tables_top - 19 * mm
    for idx, (ename, evalue) in enumerate(earn_list):
        if idx > 0:
            c.setStrokeColor(colors.HexColor('#f1f5f9'))
            c.setDash(1, 1.5)
            c.setLineWidth(0.3)
            c.line(earn_x + 5 * mm, curr_e_y + 4.5 * mm, earn_x + table_w - 5 * mm, curr_e_y + 4.5 * mm)
            c.setDash()
        c.setFont(_FONT, 7.9)
        c.setFillColor(colors.HexColor('#1e293b'))
        c.drawString(earn_x + 6 * mm, curr_e_y, ename)
        c.setFont(_BOLD, 8)
        c.setFillColor(colors.HexColor('#0f172a'))
        c.drawRightString(earn_x + table_w - 6 * mm, curr_e_y, evalue)
        curr_e_y -= row_h

    curr_d_y = tables_top - 19 * mm
    for idx, (dname, dvalue) in enumerate(ded_list):
        if idx > 0:
            c.setStrokeColor(colors.HexColor('#fdf2f4'))
            c.setDash(1, 1.5)
            c.setLineWidth(0.3)
            c.line(ded_x + 5 * mm, curr_d_y + 4.5 * mm, ded_x + table_w - 5 * mm, curr_d_y + 4.5 * mm)
            c.setDash()
        c.setFont(_FONT, 7.9)
        c.setFillColor(colors.HexColor('#1e293b'))
        c.drawString(ded_x + 6 * mm, curr_d_y, dname)
        c.setFont(_BOLD, 8)
        c.setFillColor(colors.HexColor('#0f172a'))
        c.drawRightString(ded_x + table_w - 6 * mm, curr_d_y, dvalue)
        curr_d_y -= row_h

    # Gross Salary - directly above Earned pill, no gap (like Design 6)
    pill_h = 9 * mm
    pill_y = table_y
    gross_h = 8 * mm
    gross_y = pill_y + pill_h + 0.5 * mm
    pill_w = table_w

    c.saveState()
    c.setFillColor(colors.HexColor('#e6f7f5'))
    c.setStrokeColor(colors.HexColor('#b2dfdb'))
    c.setLineWidth(0.4)
    c.rect(earn_x, gross_y, table_w, gross_h, stroke=1, fill=1)
    c.restoreState()
    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEAL_ACCENT))
    c.drawString(earn_x + 6 * mm, gross_y + 2.5 * mm, "GROSS SALARY")
    c.drawRightString(earn_x + table_w - 6 * mm, gross_y + 2.5 * mm, _money(record.gross_salary) or '0.00')

    # Earned Salary & Total Deductions - SAME ROW at bottom
    c.saveState()
    c.setFillColor(colors.HexColor(TEAL_ACCENT))
    c.roundRect(earn_x, pill_y, pill_w, pill_h, 3 * mm, stroke=0, fill=1)
    c.rect(earn_x, pill_y + 3 * mm, pill_w, 3 * mm, stroke=0, fill=1)
    c.restoreState()
    c.setFont(_BOLD, 8.2)
    c.setFillColor(colors.white)
    c.drawString(earn_x + 6 * mm, pill_y + 3 * mm, "EARNED SALARY")
    c.setFont(_BOLD, 9.5)
    c.drawRightString(earn_x + table_w - 6 * mm, pill_y + 3 * mm, _money(record.earned_salary) or '0.00')

    c.saveState()
    c.setFillColor(colors.HexColor('#ffe4e6'))
    c.roundRect(ded_x, pill_y, pill_w, pill_h, 3 * mm, stroke=0, fill=1)
    c.rect(ded_x, pill_y + 3 * mm, pill_w, 3 * mm, stroke=0, fill=1)
    c.restoreState()
    c.setFont(_BOLD, 7.5)
    c.setFillColor(colors.HexColor(ROSE_ACCENT))
    c.drawString(ded_x + 6 * mm, pill_y + 3 * mm, "TOTAL DEDUCTIONS")
    c.setFont(_BOLD, 9.5)
    c.drawRightString(ded_x + table_w - 6 * mm, pill_y + 3 * mm, _money(record.total_deductions) or '0.00')

    # ----------------------------------------------------
    # Net Salary (Take-Home) Card (Split Geometric)
    # ----------------------------------------------------
    _employer_pf_note(c, structure, W/2, table_y - 8.5*mm, record=record)
    net_top = table_y - 13 * mm
    net_h = 26 * mm
    net_y = net_top - net_h

    c.saveState()
    c.setFillColor(colors.HexColor(BLUE_NET_BG))
    c.setStrokeColor(colors.HexColor('#dbeafe'))
    c.setLineWidth(0.8)
    c.roundRect(margin, net_y, content_w, net_h, 3.5 * mm, stroke=1, fill=1)

    # Right diagonal royal blue polygon
    c.saveState()
    p_blue_clip = c.beginPath()
    p_blue_clip.roundRect(margin, net_y, content_w, net_h, 3.5 * mm)
    c.clipPath(p_blue_clip, stroke=0)

    p_rblue = c.beginPath()
    p_rblue.moveTo(W - margin - 46 * mm, net_top)
    p_rblue.lineTo(W - margin, net_top)
    p_rblue.lineTo(W - margin, net_y)
    p_rblue.lineTo(W - margin - 60 * mm, net_y)
    p_rblue.close()
    c.setFillColor(colors.HexColor(BLUE_NET_SHAPE))
    c.drawPath(p_rblue, stroke=0, fill=1)

    # Blue polygon only - NOTE ICON REMOVED per user request (clean minimal)
    c.restoreState()

    # Blue Rupee badge on left - improved centered SVG
    badge_cx = margin + 12 * mm
    badge_cy = net_y + net_h / 2
    c.setFillColor(colors.HexColor('#c9c6ff'))
    c.circle(badge_cx + 0.6 * mm, badge_cy - 0.6 * mm, 5.2 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor('#2563eb'))
    c.circle(badge_cx, badge_cy, 5.2 * mm, stroke=0, fill=1)
    _draw_icon(c, 'rupee', badge_cx - 2.6 * mm, badge_cy - 2.6 * mm, 5.2 * mm, '#ffffff')

    # Divider line next to badge
    c.setStrokeColor(colors.HexColor('#bfdbfe'))
    c.setLineWidth(0.7)
    c.line(margin + 20 * mm, net_y + 4 * mm, margin + 20 * mm, net_top - 4 * mm)

    # Text content
    c.setFont(_BOLD, 7.5)
    c.setFillColor(colors.HexColor(BLUE_NET_TEXT))
    c.drawString(margin + 25 * mm, net_top - 8.5 * mm, "NET SALARY (TAKE-HOME)")

    c.setFont(_BOLD, 22)
    c.setFillColor(colors.HexColor(BLUE_NET_TEXT))
    c.drawString(margin + 25 * mm, net_y + 5.5 * mm, f"₹{_money(record.net_salary) or '0.00'}")

    # Dot matrix in center
    _draw_dot_matrix(c, margin + 85 * mm, net_y + 5 * mm, 5, 5, spacing=2.5 * mm, color='#93c5fd')
    c.restoreState()

    # ----------------------------------------------------
    # Amount in Words Card (Warm Cream)
    # ----------------------------------------------------
    pm_text = _get_payment_mode_display_text(record)
    words_top = net_y - 5 * mm
    words_h = 16 * mm
    words_y = words_top - words_h

    c.saveState()
    c.setFillColor(colors.HexColor('#fef9ed'))
    c.setStrokeColor(colors.HexColor('#fde68a'))
    c.setLineWidth(0.8)
    c.roundRect(margin, words_y, content_w, words_h, 3.5 * mm, stroke=1, fill=1)

    # Amber badge with Rupee sign - improved SVG centered
    w_badge_cx = margin + 10 * mm
    w_badge_cy = words_y + words_h / 2
    c.setFillColor(colors.HexColor('#fde68a'))
    c.circle(w_badge_cx + 0.5 * mm, w_badge_cy - 0.5 * mm, 4.7 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor('#f59e0b'))
    c.circle(w_badge_cx, w_badge_cy, 4.7 * mm, stroke=0, fill=1)
    _draw_icon(c, 'rupee', w_badge_cx - 2.35 * mm, w_badge_cy - 2.35 * mm, 4.7 * mm, '#ffffff')

    # Divider line
    c.setStrokeColor(colors.HexColor('#fde68a'))
    c.setLineWidth(0.7)
    c.line(margin + 18 * mm, words_y + 3 * mm, margin + 18 * mm, words_top - 3 * mm)

    c.setFont(_BOLD, 6.8)
    c.setFillColor(colors.HexColor('#b45309'))
    c.drawString(margin + 22 * mm, words_top - 5.5 * mm, "AMOUNT IN WORDS")

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(margin + 22 * mm, words_y + 3.8 * mm, amount_in_words(record.net_salary))
    c.restoreState()

    # Mode of payment kept outside the amount in words section
    if pm_text:
        pmy = words_y - 2.5 * mm
        pm_h = 6.0 * mm
        c.saveState()
        c.setFillColor(colors.HexColor('#fef9ed'))
        c.setStrokeColor(colors.HexColor('#fde68a'))
        c.setLineWidth(0.6)
        c.roundRect(margin, pmy - pm_h, content_w, pm_h, 2.0 * mm, stroke=1, fill=1)
        c.restoreState()
        _draw_icon(c, 'card', margin + 6 * mm, pmy - 4.6 * mm, 3.8 * mm, '#b45309')
        c.setFont(_BOLD, 7.2)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(margin + 12.0 * mm, pmy - 4.2 * mm, pm_text)

    # ----------------------------------------------------
    # Footer
    # ----------------------------------------------------
    fy = 8.0 * mm
    c.saveState()
    c.setFillColor(colors.HexColor('#f1f5f9'))
    c.roundRect(margin, fy - 1 * mm, content_w, 9.5 * mm, 2.5 * mm, stroke=0, fill=1)

    # Purple shield badge with outer ring like reference
    c.setFillColor(colors.HexColor('#ede9fe'))
    c.circle(margin + 6 * mm, fy + 3.5 * mm, 5 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor(RIBBON_PURPLE))
    c.circle(margin + 6 * mm, fy + 3.5 * mm, 3.8 * mm, stroke=0, fill=1)
    _draw_icon(c, 'shield', margin + 3.8 * mm, fy + 1.2 * mm, 4.4 * mm, '#ffffff')

    c.setFont(_FONT, 6.8)
    c.setFillColor(colors.HexColor(SLATE_MUTED))
    c.drawString(margin + 14 * mm, fy + 4 * mm, "This is a system-generated, password-protected salary slip")
    c.drawString(margin + 14 * mm, fy + 0.8 * mm, "and does not require a signature.")

    # Dot matrix on the right
    _draw_dot_matrix(c, W - margin - 22 * mm, fy - 0.5 * mm, 5, 3, spacing=2.5 * mm, color='#94a3b8')
    c.restoreState()

    c.showPage()
    c.save()
    return buf.getvalue()



# =====================================================================
# DESIGN 8: Compact Payout Summary Landscape
# =====================================================================
def _build_pdf_bytes_8(record: PayslipRecord, encryption=None) -> bytes:
    employee, client, batch = record.employee, record.batch.client, record.batch
    structure, pf_opted = _structure(record)
    ctc = _money(structure.ctc_annual) if structure else '—'

    buf = io.BytesIO()
    pagesize = A4
    W, H = pagesize
    c = canvas.Canvas(buf, pagesize=pagesize, encrypt=encryption)

    # Color Palette: Clean Monochrome - EXACTLY as reference
    BORDER_COLOR = '#000000'
    TEXT_MAIN = '#000000'
    TEXT_MUTED = '#4b5563'
    CARD_BG = '#ffffff'

    margin = 14 * mm
    content_w = W - 2 * margin

    # ----------------------------------------------------
    # Header: Logo (left) & Salary Slip + Month Pill (right) - EXACT reference
    # ----------------------------------------------------
    header_top = H - 12 * mm
    logo_y = header_top - 4 * mm

    _profile = getattr(client, 'payroll_profile', None)
    logo = client_logo_file(client)
    drawn_logo = False
    if logo and PILImage and getattr(logo, 'path', None) and Path(logo.path).exists():
        try:
            data = resized_logo_bytes(logo.path)
            if not data:
                raise ValueError('logo resize failed')
            with PILImage.open(io.BytesIO(data)) as im:
                iw, ih = im.size
            ratio = min(42 * mm / iw, 14 * mm / ih)
            lw, lh = iw * ratio, ih * ratio
            c.drawImage(ImageReader(io.BytesIO(data)), margin, logo_y - lh, lw, lh, mask='auto')
            drawn_logo = True
            logo_bottom = logo_y - lh
        except Exception:
            drawn_logo = False

    if not drawn_logo:
        client_name = (client.name or 'INFOSYS').strip()
        c.setFillColor(colors.HexColor('#007cc3'))
        # Capped at 2 lines with a tight leading so the name block always ends
        # above the fixed address baseline below.
        draw_block(c, margin, logo_y - 6 * mm, client_name, _BOLD, 22,
                   content_w - 46 * mm, max_lines=2, min_size=10, leading_ratio=1.1)
        logo_bottom = logo_y - 14 * mm

    address_text = (client.address or 'BANASHANKARI, BANGALORE').upper()
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    # Fixed baseline keeps the header a constant height for every client.
    draw_block(c, margin, min(logo_bottom - 4.5 * mm, header_top - 18 * mm),
               address_text, _BOLD, 7.8, content_w - 46 * mm,
               max_lines=2, min_size=6.0, leading_ratio=1.2)

    c.setFont(_BOLD, 8)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawRightString(W - margin, header_top - 5 * mm, "S A L A R Y   S L I P")

    month_text = f"{calendar.month_name[batch.month].upper()} {batch.year}"
    pill_font_size = 9
    month_w = pdfmetrics.stringWidth(month_text, _BOLD, pill_font_size)
    pill_w = month_w + 14 * mm
    pill_h = 7.5 * mm
    pill_x = W - margin - pill_w
    pill_y = header_top - 18 * mm

    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor(BORDER_COLOR))
    c.setLineWidth(1.0)
    c.roundRect(pill_x, pill_y, pill_w, pill_h, pill_h / 2, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, pill_font_size)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawCentredString(pill_x + pill_w / 2, pill_y + 2.4 * mm, month_text)
    _cycle_text = _get_cycle_period_text(record)
    if _cycle_text:
        c.setFont(_FONT, 7.2)
        c.setFillColor(colors.HexColor(TEXT_MUTED))
        c.drawRightString(W - margin, header_top - 24 * mm, f"Period: {_cycle_text}")

    # ----------------------------------------------------
    # Employee Details Card - EXACT reference layout
    # ----------------------------------------------------
    card1_top = header_top - 27 * mm
    card1_h = 80 * mm
    card1_y = card1_top - card1_h

    c.saveState()
    c.setFillColor(colors.HexColor(CARD_BG))
    c.setStrokeColor(colors.HexColor(BORDER_COLOR))
    c.setLineWidth(1.0)
    c.roundRect(margin, card1_y, content_w, card1_h, 3.5 * mm, stroke=1, fill=1)

    badge_w = 44 * mm
    badge_h = 6.8 * mm
    badge_x = margin + 5 * mm
    badge_y = card1_top - 12 * mm
    c.setFillColor(colors.HexColor(BORDER_COLOR))
    c.roundRect(badge_x, badge_y, badge_w, badge_h, 2.5 * mm, stroke=0, fill=1)
    c.setFont(_BOLD, 7.5)
    c.setFillColor(colors.white)
    c.drawCentredString(badge_x + badge_w / 2, badge_y + 2.2 * mm, "EMPLOYEE DETAILS")
    c.restoreState()

    half_w = (content_w - 20 * mm) / 2
    col1_x = margin + 10 * mm
    col2_x = col1_x + half_w + 6 * mm

    # Using SAME icons as other files for consistency, but layout exact as reference
    details_list = _build_employee_detail_pairs(record, uppercase_labels=True)

    r_y = card1_top - 18 * mm
    step_y = min(9.8 * mm, (card1_h - 18 * mm) / len(details_list))

    for (i1, l1, v1), (i2, l2, v2) in details_list:
        _draw_icon(c, i1, col1_x, r_y - 2.5 * mm, 5.2 * mm, BORDER_COLOR)
        c.setFont(_BOLD, 6.5)
        c.setFillColor(colors.HexColor(TEXT_MUTED))
        c.drawString(col1_x + 8 * mm, r_y + 1 * mm, l1)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        draw_fitted(c, col1_x + 8 * mm, r_y - 3 * mm, str(v1), _BOLD, 8.5,
                    half_w - 10 * mm, min_size=6)

        _draw_icon(c, i2, col2_x, r_y - 2.5 * mm, 5.2 * mm, BORDER_COLOR)
        c.setFont(_BOLD, 6.5)
        c.setFillColor(colors.HexColor(TEXT_MUTED))
        c.drawString(col2_x + 8 * mm, r_y + 1 * mm, l2)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        draw_fitted(c, col2_x + 8 * mm, r_y - 3 * mm, str(v2), _BOLD, 8.5,
                    half_w - 10 * mm, min_size=6)

        r_y -= step_y

    # ----------------------------------------------------
    # Earnings & Deductions Tables - EXACT reference
    # ----------------------------------------------------
    tables_top = card1_y - 5 * mm
    table_h = 88 * mm
    table_y = tables_top - table_h
    card_gap = 5 * mm
    table_w = (content_w - card_gap) / 2

    earn_x = margin
    ded_x = margin + table_w + card_gap

    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor(BORDER_COLOR))
    c.setLineWidth(1.0)
    c.roundRect(earn_x, table_y, table_w, table_h, 3.5 * mm, stroke=1, fill=1)
    c.roundRect(ded_x, table_y, table_w, table_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(earn_x + 6 * mm, tables_top - 8 * mm, "EARNINGS")
    c.drawString(ded_x + 6 * mm, tables_top - 8 * mm, "DEDUCTIONS")

    c.setFont(_FONT, 8)
    c.drawRightString(earn_x + table_w - 6 * mm, tables_top - 8 * mm, "Amount (₹)")
    c.drawRightString(ded_x + table_w - 6 * mm, tables_top - 8 * mm, "Amount (₹)")

    def rows(spec):
        return [(name, _money(value) or '0.00') for name, value, optional in spec if not (optional and value == 0)]

    custom_earn_specs, custom_ded_specs = _extract_custom_specs(record)
    earn_list = rows([
        ('Basic + DA', record.basic_da, False),
        ('HRA', record.hra, False),
        ('Leave Travel Allowance', record.lta, True),
        ('Special Allowance', record.special_allowance, False),
        ('NPS Allowance', record.nps_allowance_earned, True),
        ('Variable Pay', record.variable_pay, True),
        ('Commission / Other', record.commission_other, True),
        ('Salary Advance Given', record.salary_advance_disbursed, True),
        ('On Hold Released', record.on_hold_released, True),
        ('Reimbursement', record.reimbursements, True),
        ('Arrears', record.arrears, True),
    ] + custom_earn_specs)

    ded_list = rows([
        ('EPF', record.epf, not pf_opted),
        ('ESI', getattr(record, 'esi', 0), True),
        ('VPF', record.vpf, True),
        ('VPF Arrears', record.vpf_arrears, True),
        ('Professional Tax', record.professional_tax, False),
        ('TDS', record.tds, False),
        ('NPS Deduction', record.nps_deduction, True),
        ('NPS Deduction – Arrears', record.nps_deduction_arrears, True),
        ('Loan Deduction', record.loan_deduction, True),
        ('Salary Advance Recovered', record.salary_advance_recovered, True),
        ('On Hold Deducted', record.on_hold_deducted, True),
        ('LWF', record.lwf, True),
        ('Other Deduction', record.other_deduction, True),
    ] + custom_ded_specs)

    row_h = 7.4 * mm
    curr_e_y = tables_top - 18 * mm
    for ename, evalue in earn_list:
        c.circle(earn_x + 7.5 * mm, curr_e_y + 1.2 * mm, 0.6 * mm, stroke=0, fill=1)
        c.setFont(_FONT, 8.5)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(earn_x + 10 * mm, curr_e_y, ename)
        c.setFont(_BOLD, 8.5)
        c.drawRightString(earn_x + table_w - 6 * mm, curr_e_y, evalue)
        curr_e_y -= row_h

    curr_d_y = tables_top - 18 * mm
    for dname, dvalue in ded_list:
        c.circle(ded_x + 7.5 * mm, curr_d_y + 1.2 * mm, 0.6 * mm, stroke=0, fill=1)
        c.setFont(_FONT, 8.5)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(ded_x + 10 * mm, curr_d_y, dname)
        c.setFont(_BOLD, 8.5)
        c.drawRightString(ded_x + table_w - 6 * mm, curr_d_y, dvalue)
        curr_d_y -= row_h

    c.saveState()
    c.setStrokeColor(colors.HexColor('#9ca3af'))
    c.setLineWidth(0.6)
    c.setDash(2, 2)
    c.line(earn_x + 6 * mm, table_y + 26 * mm, earn_x + table_w - 6 * mm, table_y + 26 * mm)
    c.line(ded_x + 6 * mm, table_y + 26 * mm, ded_x + table_w - 6 * mm, table_y + 26 * mm)
    c.restoreState()

    pill_bottom_y = table_y + 5 * mm
    pill_w = table_w - 10 * mm

    gross_y = pill_bottom_y + 13 * mm
    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(earn_x + 6 * mm, gross_y, "GROSS SALARY")
    c.drawRightString(earn_x + table_w - 6 * mm, gross_y, _money(record.gross_salary) or '0.00')

    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor(BORDER_COLOR))
    c.setLineWidth(1.0)
    c.roundRect(earn_x + 5 * mm, pill_bottom_y, pill_w, 8.5 * mm, 2.5 * mm, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(earn_x + 9 * mm, pill_bottom_y + 2.7 * mm, "EARNED SALARY")
    c.drawRightString(earn_x + 5 * mm + pill_w - 4 * mm, pill_bottom_y + 2.7 * mm, _money(record.earned_salary) or '0.00')

    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor(BORDER_COLOR))
    c.setLineWidth(1.0)
    c.roundRect(ded_x + 5 * mm, pill_bottom_y, pill_w, 8.5 * mm, 2.5 * mm, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(ded_x + 9 * mm, pill_bottom_y + 2.7 * mm, "TOTAL DEDUCTIONS")
    c.drawRightString(ded_x + 5 * mm + pill_w - 4 * mm, pill_bottom_y + 2.7 * mm, _money(record.total_deductions) or '0.00')

    # ----------------------------------------------------
    # Net Salary Card - EXACT reference
    # ----------------------------------------------------
    _employer_pf_note(c, structure, W/2, table_y - 8.5*mm, record=record)
    net_top = table_y - 13 * mm
    net_h = 26 * mm
    net_y = net_top - net_h

    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor(BORDER_COLOR))
    c.setLineWidth(1.0)
    c.roundRect(margin, net_y, content_w, net_h, 3.5 * mm, stroke=1, fill=1)

    c.setFont(_BOLD, 46)
    c.setFillColor(colors.HexColor('#d1d5db'))
    c.drawRightString(W - margin - 12 * mm, net_y + 4 * mm, "₹")
    c.restoreState()

    c.setFont(_BOLD, 7.8)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(margin + 8 * mm, net_top - 8 * mm, "N E T   S A L A R Y   ( T A K E - H O M E )")

    c.setFont(_BOLD, 23)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(margin + 8 * mm, net_y + 5.5 * mm, f"₹{_money(record.net_salary) or '0.00'}")

    # ----------------------------------------------------
    # Amount in Words Card - EXACT reference
    # ----------------------------------------------------
    pm_text = _get_payment_mode_display_text(record)
    words_top = net_y - 5 * mm
    words_h = 16 * mm
    words_y = words_top - words_h

    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor(BORDER_COLOR))
    c.setLineWidth(1.0)
    c.roundRect(margin, words_y, content_w, words_h, 3.5 * mm, stroke=1, fill=1)
    c.restoreState()

    c.setFont(_BOLD, 7.2)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(margin + 8 * mm, words_top - 5.5 * mm, "A M O U N T   I N   W O R D S")

    c.setFont(_BOLD, 8.5)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(margin + 8 * mm, words_y + 3.8 * mm, amount_in_words(record.net_salary))

    # Mode of payment kept outside the amount in words section
    if pm_text:
        pmy = words_y - 2.5 * mm
        pm_h = 6.0 * mm
        c.saveState()
        c.setFillColor(colors.white)
        c.setStrokeColor(colors.HexColor(BORDER_COLOR))
        c.setLineWidth(0.8)
        c.roundRect(margin, pmy - pm_h, content_w, pm_h, 2.5 * mm, stroke=1, fill=1)
        c.restoreState()
        _draw_icon(c, 'card', margin + 6 * mm, pmy - 4.6 * mm, 3.8 * mm, BORDER_COLOR)
        c.setFont(_BOLD, 7.5)
        c.setFillColor(colors.HexColor(TEXT_MAIN))
        c.drawString(margin + 12.5 * mm, pmy - 4.2 * mm, pm_text)
        fy = max((pmy - pm_h) - 6.0 * mm, 12 * mm)
    else:
        fy = max(words_y - 6.0 * mm, 12 * mm)

    # ----------------------------------------------------
    # Footer - EXACT reference
    # ----------------------------------------------------
    _draw_icon(c, 'lock', margin + 35 * mm, fy - 0.5 * mm, 3.8 * mm, BORDER_COLOR)

    c.setFont(_FONT, 7.2)
    c.setFillColor(colors.HexColor(TEXT_MAIN))
    c.drawString(margin + 42 * mm, fy, "This is a system-generated, password-protected salary slip and does not require a signature.")

    c.showPage()
    c.save()
    return buf.getvalue()



# =====================================================================
# PUBLIC API & CONTRACT ADAPTERS
# =====================================================================
def _render_and_save_record(record: PayslipRecord, builder) -> str:
    client, employee = record.batch.client, record.employee
    from .models import get_payroll_storage_abs_path
    output = get_payroll_storage_abs_path(client, record.batch.year, record.batch.month, category="payslips")
    output.mkdir(parents=True, exist_ok=True)
    path = output / f"{employee.employee_code}.pdf"
    password = _password_for(record)
    encryption = StandardEncryption(
        userPassword=password,
        ownerPassword=password,
        canPrint=1,
        canModify=0,
        canCopy=0,
        canAnnotate=0,
    )
    path.write_bytes(builder(record, encryption=encryption))
    record.pdf_path = str(path)
    record.pdf_password = password
    record.status = PayslipRecord.STATUS_APPROVED
    record.save(update_fields=['pdf_path', 'pdf_password', 'status', 'updated_at'])
    return str(path)


class _DesignAdapter:
    """Compatibility adapter exposing module-like API for views preview & generation."""
    def __init__(self, design_id: int, builder):
        self.design_id = design_id
        self._build_pdf_bytes = builder

    def generate_payslip_pdf(self, record: PayslipRecord) -> str:
        return _render_and_save_record(record, self._build_pdf_bytes)


DESIGN_BUILDERS = {
    1: _build_pdf_bytes_1,
    2: _build_pdf_bytes_2,
    3: _build_pdf_bytes_3,
    4: _build_pdf_bytes_4,
    5: _build_pdf_bytes_5,
    6: _build_pdf_bytes_6,
    7: _build_pdf_bytes_7,
    8: _build_pdf_bytes_8,
}

DESIGN_MODULES = {
    i: _DesignAdapter(i, builder)
    for i, builder in DESIGN_BUILDERS.items()
}


def generate_payslip_pdf(record: PayslipRecord) -> str:
    """Dispatches to the design selected on record.batch.client.payroll_profile.pdf_design.
    Preserves STATUS_EMAIL_SENT invariant so already-emailed slips are never re-queued.
    """
    original_status = record.status
    _profile = getattr(record.batch.client, 'payroll_profile', None)
    design = getattr(_profile, 'pdf_design', 1) if _profile else 1
    adapter = DESIGN_MODULES.get(design, DESIGN_MODULES[1])
    pdf_path = adapter.generate_payslip_pdf(record)

    if original_status == PayslipRecord.STATUS_EMAIL_SENT:
        record.status = PayslipRecord.STATUS_EMAIL_SENT
        record.save(update_fields=['status'])

    return pdf_path
