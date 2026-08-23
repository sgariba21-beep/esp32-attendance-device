#!/usr/bin/env python3
"""
Render the manual sources in this folder to PDFs in docs/.

Usage:
    python build_manual.py            # build every .md in this folder
    python build_manual.py Shop_Manual.md

The input is a small, deliberate subset of Markdown -- see README_SOURCE.md.
"""

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

SRC_DIR = Path(__file__).resolve().parent
OUT_DIR = SRC_DIR.parent

# --- palette ---------------------------------------------------------------
INK = colors.HexColor("#111827")
BODY = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
ACCENT = colors.HexColor("#1d4ed8")
RULE = colors.HexColor("#e5e7eb")
TABLE_HEAD_BG = colors.HexColor("#f3f4f6")
TABLE_ALT_BG = colors.HexColor("#fafafa")

CALLOUTS = {
    "WARNING": (colors.HexColor("#b91c1c"), colors.HexColor("#fef2f2"), "Important"),
    "TIP": (colors.HexColor("#047857"), colors.HexColor("#ecfdf5"), "Tip"),
    "NOTE": (ACCENT, colors.HexColor("#eff6ff"), "Note"),
}

PAGE_W, PAGE_H = A4
MARGIN_L = MARGIN_R = 20 * mm
MARGIN_T = 20 * mm
MARGIN_B = 18 * mm
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R


# --- fonts -----------------------------------------------------------------
# The base-14 Helvetica reportlab defaults to is WinAnsi-encoded and has no
# U+2192, so arrows render as blanks. Register Arial (TrueType, full Unicode)
# when it is present and fall back to Helvetica + ASCII arrows when it is not,
# so the build still succeeds on a machine without the Windows font set.
FONT_DIRS = [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/msttcorefonts")]
FONT_REGULAR, FONT_BOLD, FONT_ITALIC = "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"
FONT_MONO = "Courier"
UNICODE_OK = False


def register_fonts():
    global FONT_REGULAR, FONT_BOLD, FONT_ITALIC, UNICODE_OK
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    faces = {"Doc": "arial.ttf", "Doc-Bold": "arialbd.ttf", "Doc-Italic": "ariali.ttf"}
    for d in FONT_DIRS:
        if not all((d / f).exists() for f in faces.values()):
            continue
        try:
            for name, fn in faces.items():
                pdfmetrics.registerFont(TTFont(name, str(d / fn)))
            pdfmetrics.registerFontFamily(
                "Doc", normal="Doc", bold="Doc-Bold", italic="Doc-Italic",
                boldItalic="Doc-Bold")
            FONT_REGULAR, FONT_BOLD, FONT_ITALIC = "Doc", "Doc-Bold", "Doc-Italic"
            UNICODE_OK = True
            return
        except Exception as exc:  # noqa: BLE001 - fall back, don't fail the build
            print(f"warn: could not register {d}: {exc}", file=sys.stderr)
    print("warn: Arial not found - using Helvetica, arrows fall back to '->'",
          file=sys.stderr)


register_fonts()


# --- styles ----------------------------------------------------------------
def build_styles():
    ss = getSampleStyleSheet()
    s = {}
    s["cover_kicker"] = ParagraphStyle(
        "cover_kicker", parent=ss["Normal"], fontName=FONT_BOLD,
        fontSize=9.5, leading=13, textColor=ACCENT, alignment=TA_CENTER,
        spaceAfter=10,
    )
    s["cover_title"] = ParagraphStyle(
        "cover_title", parent=ss["Normal"], fontName=FONT_BOLD,
        fontSize=27, leading=33, textColor=INK, alignment=TA_CENTER, spaceAfter=8,
    )
    s["cover_sub"] = ParagraphStyle(
        "cover_sub", parent=ss["Normal"], fontName=FONT_REGULAR,
        fontSize=12, leading=17, textColor=MUTED, alignment=TA_CENTER, spaceAfter=6,
    )
    s["cover_meta"] = ParagraphStyle(
        "cover_meta", parent=ss["Normal"], fontName=FONT_REGULAR,
        fontSize=9.5, leading=14, textColor=MUTED, alignment=TA_CENTER,
    )
    s["h1"] = ParagraphStyle(
        "h1", parent=ss["Normal"], fontName=FONT_BOLD,
        fontSize=15.5, leading=20, textColor=INK, spaceBefore=17, spaceAfter=7,
        keepWithNext=1,
    )
    s["h2"] = ParagraphStyle(
        "h2", parent=ss["Normal"], fontName=FONT_BOLD,
        fontSize=11.5, leading=15.5, textColor=INK, spaceBefore=12, spaceAfter=4,
        keepWithNext=1,
    )
    s["h3"] = ParagraphStyle(
        "h3", parent=ss["Normal"], fontName=FONT_BOLD,
        fontSize=10, leading=14, textColor=colors.HexColor("#374151"),
        spaceBefore=9, spaceAfter=3, keepWithNext=1,
    )
    s["body"] = ParagraphStyle(
        "body", parent=ss["Normal"], fontName=FONT_REGULAR,
        fontSize=9.7, leading=14.4, textColor=BODY, spaceAfter=6, alignment=TA_LEFT,
    )
    s["li"] = ParagraphStyle("li", parent=s["body"], spaceAfter=2.5)
    s["callout"] = ParagraphStyle(
        "callout", parent=s["body"], fontSize=9.4, leading=13.8, spaceAfter=0,
    )
    s["callout_head"] = ParagraphStyle(
        "callout_head", parent=s["body"], fontName=FONT_BOLD,
        fontSize=8.2, leading=11, spaceAfter=2.5,
    )
    s["th"] = ParagraphStyle(
        "th", parent=ss["Normal"], fontName=FONT_BOLD,
        fontSize=8.7, leading=11.6, textColor=INK,
    )
    s["td"] = ParagraphStyle(
        "td", parent=ss["Normal"], fontName=FONT_REGULAR,
        fontSize=8.7, leading=11.6, textColor=BODY,
    )
    s["toc_item"] = ParagraphStyle(
        "toc_item", parent=s["body"], fontSize=10, leading=16, spaceAfter=0,
    )
    return s


STYLES = build_styles()


# --- inline markdown -------------------------------------------------------
CODE_SENTINEL = "\x00%d\x00"


def inline(text: str) -> str:
    """Convert the inline subset to reportlab markup.

    Code spans are lifted out FIRST and restored last, so nothing inside a
    backtick span is rewritten. Without that, '--project-ref' picks up an em
    dash and a cron string like '0 22 * * *' loses its asterisks to the italic
    rule -- both of which silently corrupt commands a reader would copy.

    Typographic substitution also has to run before html.escape: '->' contains
    a '>' that escaping would turn into '&gt;', so the arrow would never match.
    """
    spans = []

    def lift(m):
        spans.append(m.group(1))
        return CODE_SENTINEL % (len(spans) - 1)

    out = re.sub(r"`([^`]+)`", lift, text)

    # A range between digits ("steps 2--6") takes an en dash; everywhere else
    # "--" is a parenthetical em dash.
    out = re.sub(r"(?<=\d)--(?=\d)", "–", out)
    out = out.replace("--", "—")
    if UNICODE_OK:
        out = out.replace("->", "→")
    out = html.escape(out, quote=False)

    # **bold** then *italic* -- the sentinels carry no '*', so spans are safe.
    out = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", out)
    out = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", out)

    for i, code in enumerate(spans):
        out = out.replace(
            CODE_SENTINEL % i,
            f'<font face="{FONT_MONO}" size="8.6" color="#b91c1c">'
            f"{html.escape(code, quote=False)}</font>",
        )
    return out


# --- block helpers ---------------------------------------------------------
def make_table(rows):
    header, *body = rows
    ncols = len(header)
    data = [[Paragraph(inline(c), STYLES["th"]) for c in header]]
    for r in body:
        r = (r + [""] * ncols)[:ncols]
        data.append([Paragraph(inline(c), STYLES["td"]) for c in r])

    # Column widths: first column gets more room when there are 2-3 columns.
    if ncols == 2:
        widths = [CONTENT_W * 0.34, CONTENT_W * 0.66]
    elif ncols == 3:
        widths = [CONTENT_W * 0.26, CONTENT_W * 0.30, CONTENT_W * 0.44]
    else:
        widths = [CONTENT_W / ncols] * ncols

    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEAD_BG),
        ("LINEBELOW", (0, 0), (-1, 0), 0.7, colors.HexColor("#d1d5db")),
        ("GRID", (0, 0), (-1, -1), 0.35, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), TABLE_ALT_BG))
    t.setStyle(TableStyle(style))
    return t


def make_callout(kind, text):
    color, bg, label = CALLOUTS[kind]
    inner = [
        Paragraph(f'<font color="{color.hexval()}">{label.upper()}</font>',
                  STYLES["callout_head"]),
        Paragraph(inline(text), STYLES["callout"]),
    ]
    t = Table([[inner]], colWidths=[CONTENT_W], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, color),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def make_list(items, ordered):
    # A bullet list whose items all start with "[ ]" is a checklist: strip the
    # marker and use an open box as the bullet, so it prints as something a
    # reader can actually tick.
    checklist = (not ordered and items
                 and all(i.startswith("[ ]") for i in items))
    if checklist:
        items = [i[3:].lstrip() for i in items]

    lis = [ListItem(Paragraph(inline(i), STYLES["li"]), leftIndent=13)
           for i in items]

    if checklist:
        bullet_char = "□" if UNICODE_OK else "[ ]"
    else:
        bullet_char = "•" if UNICODE_OK else "-"

    return ListFlowable(
        lis,
        bulletType="1" if ordered else "bullet",
        start="1" if ordered else bullet_char,
        bulletFormat="%s." if ordered else None,
        bulletFontName=FONT_BOLD if ordered else FONT_REGULAR,
        bulletFontSize=10 if checklist else 9,
        bulletColor=ACCENT if ordered else (MUTED if not checklist else BODY),
        bulletOffsetY=0 if ordered else -1,
        leftIndent=18 if checklist else 16,
        bulletDedent=16 if checklist else 14,
        spaceBefore=1,
        spaceAfter=7,
    )


# --- parser ----------------------------------------------------------------
def parse(md: str):
    """Returns (meta, flowables). meta = title/subtitle/audience/version."""
    lines = md.split("\n")
    meta = {}
    flow = []
    toc = []

    i = 0
    # front-matter style header block
    while i < len(lines) and lines[i].strip() == "":
        i += 1
    if i < len(lines) and lines[i].startswith("# "):
        meta["title"] = lines[i][2:].strip()
        i += 1
        while i < len(lines) and lines[i].strip().startswith(":"):
            k, _, v = lines[i].strip()[1:].partition(":")
            meta[k.strip()] = v.strip()
            i += 1

    def flush_list(buf, ordered):
        if buf:
            flow.append(make_list(buf, ordered))
            buf.clear()

    bullets, numbers, table_rows = [], [], []

    def flush_table():
        if table_rows:
            flow.append(make_table(table_rows))
            flow.append(Spacer(1, 8))
            table_rows.clear()

    def flush_all():
        flush_list(bullets, False)
        flush_list(numbers, True)
        flush_table()

    while i < len(lines):
        raw = lines[i]
        line = raw.strip()

        if line == "":
            flush_all()
            i += 1
            continue

        if line == "<<<PAGEBREAK>>>":
            flush_all()
            flow.append(PageBreak())
            i += 1
            continue

        if line == "<<<TOC>>>":
            flush_all()
            flow.append("__TOC__")
            i += 1
            continue

        # headings
        m = re.match(r"^(#{2,4})\s+(.*)$", line)
        if m:
            flush_all()
            level = len(m.group(1))
            text = m.group(2).strip()
            key = {2: "h1", 3: "h2", 4: "h3"}[level]
            if level == 2:
                toc.append(text)
                flow.append(Paragraph(inline(text), STYLES[key]))
                flow.append(HRule())
            else:
                flow.append(Paragraph(inline(text), STYLES[key]))
            i += 1
            continue

        # callout
        m = re.match(r"^>\s*\[!(WARNING|TIP|NOTE)\]\s*(.*)$", line)
        if m:
            flush_all()
            kind = m.group(1)
            text = m.group(2).strip()
            i += 1
            while i < len(lines) and lines[i].strip().startswith(">"):
                text += " " + lines[i].strip().lstrip(">").strip()
                i += 1
            flow.append(make_callout(kind, text))
            flow.append(Spacer(1, 9))
            continue

        # table row
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                i += 1
                continue
            flush_list(bullets, False)
            flush_list(numbers, True)
            table_rows.append(cells)
            i += 1
            continue

        # numbered
        m = re.match(r"^\d+[.)]\s+(.*)$", line)
        if m:
            flush_list(bullets, False)
            flush_table()
            numbers.append(m.group(1))
            i += 1
            continue

        # bullet
        m = re.match(r"^[-*]\s+(.*)$", line)
        if m:
            flush_list(numbers, True)
            flush_table()
            bullets.append(m.group(1))
            i += 1
            continue

        # paragraph
        flush_all()
        para = line
        i += 1
        while (i < len(lines) and lines[i].strip() != ""
               and not re.match(r"^([-*]\s|\d+[.)]\s|#{2,4}\s|\||>|<<<)",
                                lines[i].strip())):
            para += " " + lines[i].strip()
            i += 1
        flow.append(Paragraph(inline(para), STYLES["body"]))

    flush_all()
    return meta, flow, toc


class HRule(Spacer):
    """Thin rule under a section heading."""

    def __init__(self):
        Spacer.__init__(self, CONTENT_W, 5)

    def draw(self):
        self.canv.setStrokeColor(RULE)
        self.canv.setLineWidth(0.7)
        self.canv.line(0, 3.5, CONTENT_W, 3.5)


# --- page furniture --------------------------------------------------------
def make_painter(meta):
    title = meta.get("title", "")
    audience = meta.get("audience", "")

    def cover(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(ACCENT)
        canvas.rect(0, PAGE_H - 6 * mm, PAGE_W, 6 * mm, stroke=0, fill=1)
        canvas.restoreState()

    def later(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.6)
        # header
        canvas.line(MARGIN_L, PAGE_H - MARGIN_T + 8, PAGE_W - MARGIN_R,
                    PAGE_H - MARGIN_T + 8)
        canvas.setFont(FONT_REGULAR, 7.6)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_L, PAGE_H - MARGIN_T + 12, title)
        if audience:
            canvas.drawRightString(PAGE_W - MARGIN_R, PAGE_H - MARGIN_T + 12,
                                   audience)
        # footer
        canvas.line(MARGIN_L, MARGIN_B - 6, PAGE_W - MARGIN_R, MARGIN_B - 6)
        canvas.drawString(MARGIN_L, MARGIN_B - 15,
                          meta.get("footer", "ESP32 Fingerprint Attendance System"))
        canvas.drawRightString(PAGE_W - MARGIN_R, MARGIN_B - 15,
                               f"Page {canvas.getPageNumber() - 1}")
        canvas.restoreState()

    return cover, later


def build_cover(meta):
    out = [Spacer(1, 52 * mm)]
    if meta.get("kicker"):
        out.append(Paragraph(inline(meta["kicker"]).upper(), STYLES["cover_kicker"]))
    out.append(Paragraph(inline(meta.get("title", "")), STYLES["cover_title"]))
    if meta.get("subtitle"):
        out.append(Paragraph(inline(meta["subtitle"]), STYLES["cover_sub"]))
    out.append(Spacer(1, 8 * mm))

    rule = Table([[""]], colWidths=[38 * mm], rowHeights=[2])
    rule.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACCENT)]))
    rule.hAlign = "CENTER"
    out.append(rule)
    out.append(Spacer(1, 8 * mm))

    meta_lines = []
    if meta.get("audience"):
        meta_lines.append(meta["audience"])
    if meta.get("version"):
        meta_lines.append(meta["version"])
    if meta_lines:
        out.append(Paragraph("<br/>".join(inline(m) for m in meta_lines),
                             STYLES["cover_meta"]))
    return out


def render_toc(toc):
    out = [Paragraph("Contents", STYLES["h1"]), HRule(), Spacer(1, 4)]
    for t in toc:
        out.append(Paragraph(inline(t), STYLES["toc_item"]))
    out.append(Spacer(1, 6))
    return out


def build(md_path: Path):
    meta, flow, toc = parse(md_path.read_text(encoding="utf-8"))
    out_path = OUT_DIR / (md_path.stem + ".pdf")

    doc = BaseDocTemplate(
        str(out_path), pagesize=A4,
        leftMargin=MARGIN_L, rightMargin=MARGIN_R,
        topMargin=MARGIN_T, bottomMargin=MARGIN_B,
        title=meta.get("title", md_path.stem),
        author=meta.get("footer", "ESP32 Fingerprint Attendance System"),
        subject=meta.get("subtitle", ""),
    )
    cover_paint, later_paint = make_painter(meta)
    frame = Frame(MARGIN_L, MARGIN_B, CONTENT_W,
                  PAGE_H - MARGIN_T - MARGIN_B, id="body")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[frame], onPage=cover_paint),
        PageTemplate(id="body", frames=[frame], onPage=later_paint),
    ])

    story = build_cover(meta)
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())

    expanded = []
    for f in flow:
        if f == "__TOC__":
            expanded.extend(render_toc(toc))
        else:
            expanded.append(f)
    story.extend(expanded)

    doc.build(story)
    return out_path


def main():
    targets = sys.argv[1:]
    files = ([SRC_DIR / t for t in targets] if targets
             else sorted(SRC_DIR.glob("*.md")))
    files = [f for f in files if f.name != "README_SOURCE.md"]
    for f in files:
        p = build(f)
        print(f"built  {p.name}  ({p.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
