#!/usr/bin/env python3
"""
Render the Markdown sources in this folder to the PDFs in docs/for-clients/
and docs/for-operators/.

Usage:
    python build.py                  # build every document
    python build.py Shop_Manual      # build one (stem or filename)

The input is a small, deliberate subset of Markdown -- see README.md here.
"""

import argparse
import html
import re
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate, Frame, ListFlowable, ListItem, NextPageTemplate, PageBreak,
    PageTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

import theme
from blocks import (
    Callout, CardPair, CodeBlock, ListCard, SectionHeading, SubHeading,
    check_list, step_list,
)
from theme import (
    CONTENT_W, F, INK, MARGIN_B, MARGIN_L, MARGIN_R, MARGIN_T, MUTED, PAGE_H,
    PAGE_W, RULE, SERIES, WHITE, Accent, mix, styles,
)
from visuals import Screenshot, draw_fingerprint, led_cell, screen_gallery

SRC_DIR = Path(__file__).resolve().parent
DOCS_DIR = SRC_DIR.parent
OUTPUTS = {"clients": DOCS_DIR / "for-clients", "operators": DOCS_DIR / "for-operators"}
SYSTEM = "ESP32 Fingerprint Attendance System"


# --- inline markdown -------------------------------------------------------
SENT = "\x00%d\x00"


def inline(text, accent, chips=True):
    """Inline subset -> reportlab markup.

    Code spans and links are lifted out first and restored last, so nothing
    inside them is rewritten: '--project-ref' must not become an em dash and
    '0 21 * * *' must keep its asterisks. Typographic substitution runs before
    html.escape because '->' contains a '>' that escaping would hide.
    """
    held = []

    def hold(markup):
        held.append(markup)
        return SENT % (len(held) - 1)

    def code(m):
        c = html.escape(m.group(1), quote=False)
        return hold(f'<font name="{F["mono"]}" size="8.7" color="#0f172a" '
                    f'backColor="#eef2f7">&nbsp;{c}&nbsp;</font>')

    def link(m):
        return hold(f'<a href="{html.escape(m.group(2))}" color="{accent.hex}">'
                    f'{html.escape(m.group(1), quote=False)}</a>')

    out = re.sub(r"`([^`]+)`", code, text)
    out = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", link, out)
    out = re.sub(r"(?<=\d)--(?=\d)", "–", out)      # ranges: 1--3
    out = out.replace("--", "—")
    if theme.UNICODE_OK:
        out = out.replace("->", "→")
    out = html.escape(out, quote=False)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", out)
    out = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", out)
    if chips:
        # Quoted ALL-CAPS words are things the device screen says: show them
        # the way the screen does -- light text on black.
        out = re.sub(
            r'"([A-Z0-9][A-Z0-9 /?!.%:\-]*[A-Z0-9?!%])"',
            lambda m: (f'<font name="{F["mono_bold"]}" size="8.4" color="#e8f1ff" '
                       f'backColor="#111827">&nbsp;{m.group(1)}&nbsp;</font>'),
            out)
    for i, h in enumerate(held):
        out = out.replace(SENT % i, h)
    return out


def plain(text):
    """Heading text for bookmarks and the running header: no markup."""
    t = re.sub(r"[`*]", "", text).replace("--", "—").replace("->", "→")
    return t


# --- tables ----------------------------------------------------------------
def column_widths(rows, explicit):
    n = len(rows[0])
    if explicit and len(explicit) == n:
        total = sum(explicit)
        return [CONTENT_W * w / total for w in explicit]
    weights = []
    for i in range(n):
        lens = [len(re.sub(r"[`*]", "", r[i])) for r in rows if i < len(r)]
        mean = sum(lens) / len(lens)
        weights.append(min(max(0.55 * mean + 0.45 * max(lens), 7), 70))
    total = sum(weights)
    widths = [CONTENT_W * w / total for w in weights]
    floor = 22 * mm if n > 2 else 30 * mm
    short = [i for i, w in enumerate(widths) if w < floor]
    if short and len(short) < n:
        deficit = sum(floor - widths[i] for i in short)
        long_ = [i for i in range(n) if i not in short]
        long_total = sum(widths[i] for i in long_)
        for i in short:
            widths[i] = floor
        for i in long_:
            widths[i] -= deficit * widths[i] / long_total
    return widths


def make_table(rows, st, accent, explicit=None):
    n = len(rows[0])
    rows = [(r + [""] * n)[:n] for r in rows]
    widths = column_widths(rows, explicit)
    header, body = rows[0], rows[1:]
    is_light = header[0].strip().lower() in ("light", "sensor light")

    data = [[Paragraph(inline(c, accent, chips=False), st["th"]) for c in header]]
    for r in body:
        cells = []
        for i, c in enumerate(r):
            m = inline(c, accent)
            if i == 0 and is_light:
                cells.append(led_cell(m, c, st["td"], widths[0] - 14))
            else:
                cells.append(Paragraph(m, st["td"]))
        data.append(cells)

    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT",
              cornerRadii=(5, 5, 5, 5))
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), accent.tint),
        ("LINEBELOW", (0, 0), (-1, 0), 0.9, accent.soft),
        ("BOX", (0, 0), (-1, -1), 0.7, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE" if is_light else "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5.6),
    ]
    for i in range(1, len(data) - 1):
        style.append(("LINEBELOW", (0, i), (-1, i), 0.5, RULE))
    t.setStyle(TableStyle(style))
    t.spaceBefore, t.spaceAfter = 3, 11
    return t


# --- parser ----------------------------------------------------------------
BLOCK_START = re.compile(r"^([-*]\s|\d+[.)]\s|#{2,4}\s|\||>|<<<|:::|```|!\[|<!--)")


def parse(md, accent, st):
    lines = md.replace("\r\n", "\n").split("\n")
    meta, flow, toc = {}, [], []
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and lines[i].startswith("# "):
        meta["title"] = lines[i][2:].strip()
        i += 1
        while i < len(lines) and lines[i].strip().startswith(":"):
            k, _, v = lines[i].strip()[1:].partition(":")
            meta[k.strip()] = v.strip()
            i += 1
    if "accent" in meta:
        accent.__init__(meta["accent"])
        st.update(styles(accent))

    bullets, numbers, checks, table = [], [], [], []
    number_start = [1]
    pending_cols = None
    cards = []
    fig = 0

    def flush():
        nonlocal pending_cols
        if bullets:
            flow.append(ListFlowable(
                [ListItem(Paragraph(b, st["li"]), leftIndent=15, value="•")
                 for b in bullets],
                bulletType="bullet", bulletColor=accent.base, bulletFontSize=10,
                bulletFontName=F["regular"], leftIndent=15, bulletDedent=12,
                spaceBefore=1, spaceAfter=8))
            bullets.clear()
        if numbers:
            flow.append(step_list(numbers, accent, st["step"], CONTENT_W,
                                  start=number_start[0]))
            numbers.clear()
        if checks:
            flow.append(check_list(checks, accent, st["step"], CONTENT_W))
            checks.clear()
        if table:
            flow.append(make_table(table[:], st, accent, pending_cols))
            table.clear()
            pending_cols = None

    def flush_cards():
        if len(cards) == 2:
            flow.append(CardPair(*cards))
        elif cards:
            cards[0].spaceBefore, cards[0].spaceAfter = 3, 11
            flow.append(cards[0])
        cards.clear()

    while i < len(lines):
        line = lines[i].strip()
        raw = lines[i]

        if line == "":
            flush()
            i += 1
            continue

        if line.startswith("```"):
            flush(); flush_cards()
            lang = line[3:].strip()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i].rstrip())
                i += 1
            flow.append(CodeBlock("\n".join(buf), lang))
            i += 1
            continue

        if line.startswith(":::") and line != ":::":
            flush()
            kind, _, arg = line[3:].strip().partition(" ")
            i += 1
            body = []
            while i < len(lines) and lines[i].strip() != ":::":
                if lines[i].strip():
                    body.append(re.sub(r"^[-*]\s+", "", lines[i].strip()))
                i += 1
            i += 1
            if kind in ("can", "cannot"):
                title = arg or ("You can" if kind == "can" else "You can’t")
                cards.append(ListCard(kind, inline(title, accent, False),
                                      [inline(b, accent) for b in body], st))
                if len(cards) == 2:
                    flush_cards()
            elif kind == "screens":
                flush_cards()
                entries = []
                for b in body:
                    parts = [p.strip() for p in b.split("|")]
                    entries.append((parts[:-1], inline(parts[-1], accent)))
                flow.append(screen_gallery(entries, st, CONTENT_W,
                                           cols=int(arg) if arg.isdigit() else 3))
            continue
        flush_cards()

        if line == "<<<PAGEBREAK>>>":
            flush(); flow.append(PageBreak()); i += 1
            continue
        if line == "<<<TOC>>>":
            flush(); flow.append("__TOC__"); i += 1
            continue

        m = re.match(r"^<!--\s*cols:\s*([\d\s]+)-->$", line)
        if m:
            flush()
            pending_cols = [int(x) for x in m.group(1).split()]
            i += 1
            continue
        if line.startswith("<!--"):
            while i < len(lines) and "-->" not in lines[i]:
                i += 1
            i += 1
            continue

        m = re.match(r"^!\[(.*?)\]\((.+?)\)(?:\{(\d+)%\})?$", line)
        if m:
            flush()
            fig += 1
            path = (SRC_DIR / m.group(2)).resolve()
            if not path.exists():
                print(f"warn: missing image {m.group(2)}", file=sys.stderr)
            cap = (f'<font name="{F["semibold"]}" color="#334155">Figure {fig}</font>'
                   f'&nbsp;&nbsp;{inline(m.group(1), accent)}')
            frac = int(m.group(3)) / 100 if m.group(3) else 1.0
            flow.append(Screenshot(path, cap, st["caption"], frac))
            i += 1
            continue

        m = re.match(r"^(#{2,4})\s+(.*)$", line)
        if m:
            flush()
            level, text = len(m.group(1)), m.group(2).strip()
            if level == 2:
                nm = re.match(r"^(\d+)\.\s+(.*)$", text)
                num, title = (nm.group(1), nm.group(2)) if nm else (None, text)
                toc.append(title)
                h = SectionHeading(num, inline(title, accent, False), plain(title),
                                   accent, ParagraphStyle(
                                       "h1", fontName=F["semibold"], fontSize=17,
                                       leading=21, textColor=INK))
                h.toc_text = f"{num}.&nbsp;&nbsp;{inline(title, accent, False)}" if num \
                    else inline(title, accent, False)
                flow.append(h)
            elif level == 3:
                nm = re.match(r"^(\d+(?:\.\d+)+)\s+(.*)$", text)
                if nm:
                    markup = (f'<font color="{accent.hex}">{nm.group(1)}</font>'
                              f'&nbsp;&nbsp;{inline(nm.group(2), accent, False)}')
                else:
                    markup = inline(text, accent, False)
                sh = SubHeading(markup, plain(text), st["h2"])
                sh.toc_text = inline(text, accent, False)
                flow.append(sh)
            else:
                flow.append(Paragraph(inline(text, accent, False), st["h3"]))
            i += 1
            continue

        m = re.match(r"^>\s*\[!(WARNING|TIP|NOTE)\]\s*(.*)$", line)
        if m:
            flush()
            kind, text = m.group(1), m.group(2).strip()
            i += 1
            while i < len(lines) and lines[i].strip().startswith(">"):
                text += " " + lines[i].strip().lstrip(">").strip()
                i += 1
            flow.append(Callout(kind, inline(text, accent), st["callout"]))
            continue

        if line.startswith(">>"):
            flush()
            text = line[2:].strip()
            i += 1
            while i < len(lines) and lines[i].strip() and not BLOCK_START.match(lines[i].strip()):
                text += " " + lines[i].strip()
                i += 1
            flow.append(Paragraph(inline(text, accent), st["lead"]))
            continue

        if line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                if bullets or numbers or checks:
                    table_hold = table[:]
                    flush()
                    table.extend(table_hold)
                table.append(cells)
            i += 1
            continue

        # continuation of the previous list item (indented line)
        if raw[:1] in (" ", "\t") and (bullets or numbers or checks):
            target = checks or numbers or bullets
            target[-1] += " " + inline(line, accent)
            i += 1
            continue

        m = re.match(r"^[-*]\s+\[ \]\s+(.*)$", line)
        if m:
            if bullets or numbers or table:
                flush()
            checks.append(inline(m.group(1), accent))
            i += 1
            continue
        m = re.match(r"^(\d+)[.)]\s+(.*)$", line)
        if m:
            if bullets or checks or table:
                flush()
            if not numbers:
                # A list resumed after a code block or callout keeps the
                # number written in the source ("4." stays 4).
                number_start[0] = int(m.group(1))
            numbers.append(inline(m.group(2), accent))
            i += 1
            continue
        m = re.match(r"^[-*]\s+(.*)$", line)
        if m:
            if numbers or checks or table:
                flush()
            bullets.append(inline(m.group(1), accent))
            i += 1
            continue

        flush()
        para = line
        i += 1
        while i < len(lines) and lines[i].strip() and not BLOCK_START.match(lines[i].strip()):
            para += " " + lines[i].strip()
            i += 1
        flow.append(Paragraph(inline(para, accent), st["body"]))

    flush()
    flush_cards()
    return meta, flow, toc


# --- document template -----------------------------------------------------
class NumberedCanvas(rl_canvas.Canvas):
    """Defers page output so every page can print 'Page n of N'."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._states = []

    def showPage(self):
        self._states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._states)
        for state in self._states:
            self.__dict__.update(state)
            if self._pageNumber > 1:
                self.setFont(F["regular"], 7.6)
                self.setFillColor(MUTED)
                self.drawRightString(PAGE_W - MARGIN_R, MARGIN_B - 17,
                                     f"Page {self._pageNumber - 1} of {total - 1}")
            super().showPage()
        super().save()


class ManualDoc(BaseDocTemplate):
    def __init__(self, path, meta, accent, toc_titles):
        super().__init__(
            str(path), pagesize=A4,
            leftMargin=MARGIN_L, rightMargin=MARGIN_R,
            topMargin=MARGIN_T, bottomMargin=MARGIN_B,
            title=meta.get("title", path.stem), author=SYSTEM,
            subject=meta.get("subtitle", ""), creator="docs/source/build.py")
        self.meta, self.accent, self.toc_titles = meta, accent, toc_titles
        self.toc_depth = int(meta.get("toc_depth", "1"))
        frame = Frame(MARGIN_L, MARGIN_B, CONTENT_W, PAGE_H - MARGIN_T - MARGIN_B,
                      id="body", leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate("cover", [frame], onPage=self.draw_cover),
            PageTemplate("body", [frame], onPageEnd=self.draw_furniture),
        ])
        self.current = self.header = ""
        self.seen_first = False
        self.keyn = 0
        self.has_level0 = False

    # multiBuild re-runs the whole story until the contents page stops
    # changing; counters must restart each pass or the TOC keys never settle.
    def beforeDocument(self):
        self.current = self.header = ""
        self.seen_first = False
        self.keyn = 0
        self.has_level0 = False

    # running header: the section in force at the top of the page
    def handle_pageBegin(self):
        super().handle_pageBegin()
        self.header = self.current
        self.seen_first = False

    def afterFlowable(self, f):
        first = not self.seen_first
        self.seen_first = True
        if isinstance(f, SectionHeading):
            self.current = f.plain
            if first:
                self.header = f.plain
            key = f"k{self.keyn}"
            self.keyn += 1
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.plain, key, level=0, closed=False)
            self.has_level0 = True
            if getattr(f, "toc_text", None):
                self.notify("TOCEntry", (0, f.toc_text, self.page - 1, key))
        elif isinstance(f, SubHeading) and self.has_level0:
            key = f"k{self.keyn}"
            self.keyn += 1
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.plain, key, level=1, closed=True)
            if self.toc_depth >= 2:
                self.notify("TOCEntry", (1, f.toc_text, self.page - 1, key))

    def draw_furniture(self, c, doc):
        c.saveState()
        a = self.accent
        y = PAGE_H - 13 * mm
        c.setFillColor(a.base)
        c.roundRect(MARGIN_L, y - 0.6, 5.5, 5.5, 1.4, stroke=0, fill=1)
        c.setFont(F["semibold"], 7.8)
        c.setFillColor(INK)
        c.drawString(MARGIN_L + 10, y, self.meta.get("title", ""))
        c.setFont(F["regular"], 7.8)
        c.setFillColor(MUTED)
        if self.header:
            c.drawRightString(PAGE_W - MARGIN_R, y, self.header)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.line(MARGIN_L, y - 5, PAGE_W - MARGIN_R, y - 5)
        c.line(MARGIN_L, MARGIN_B - 8, PAGE_W - MARGIN_R, MARGIN_B - 8)
        c.setFont(F["regular"], 7.6)
        c.drawString(MARGIN_L, MARGIN_B - 17, self.meta.get("footer", SYSTEM))
        c.restoreState()

    def draw_cover(self, c, doc):
        m, a = self.meta, self.accent
        c.saveState()
        panel_y = PAGE_H * 0.43
        c.setFillColor(a.base)
        c.rect(0, panel_y, PAGE_W, PAGE_H - panel_y, stroke=0, fill=1)
        c.setFillColor(a.dark)
        c.setFillAlpha(0.35)
        c.rect(0, panel_y, PAGE_W, 5, stroke=0, fill=1)
        c.setFillAlpha(1)
        p = c.beginPath()
        p.rect(0, panel_y + 5, PAGE_W, PAGE_H - panel_y)
        c.saveState()
        c.clipPath(p, stroke=0, fill=0)
        draw_fingerprint(c, PAGE_W * 0.80, PAGE_H * 0.72, 250, WHITE,
                         seed=sum(map(ord, m.get("title", ""))))
        c.restoreState()

        # system name, top left
        c.setFillColor(WHITE)
        c.setFont(F["semibold"], 9)
        c.drawString(MARGIN_L, PAGE_H - 20 * mm, SYSTEM)
        c.setFillAlpha(0.35)
        c.rect(MARGIN_L, PAGE_H - 22.5 * mm, 16 * mm, 1.2, stroke=0, fill=1)
        c.setFillAlpha(1)

        # title block, stacked up from the bottom of the panel
        wtxt = 128 * mm
        sub = Paragraph(inline(m.get("subtitle", ""), a, False), ParagraphStyle(
            "cs", fontName=F["regular"], fontSize=12.5, leading=17.5,
            textColor=mix(WHITE, a.base, 0.12)))
        title = Paragraph(inline(m.get("title", ""), a, False), ParagraphStyle(
            "ct", fontName=F["semibold"], fontSize=33, leading=37, textColor=WHITE))
        _, sh = sub.wrap(wtxt, 200)
        _, th = title.wrap(wtxt, 300)
        y = panel_y + 17 * mm
        sub.drawOn(c, MARGIN_L, y)
        y += sh + 7
        title.drawOn(c, MARGIN_L, y)
        y += th + 11
        kicker = m.get("kicker", "").upper()
        if kicker:
            c.setFont(F["semibold"], 7.6)
            kw = stringWidth(kicker, F["semibold"], 7.6) + 16
            c.setFillColor(WHITE)
            c.setFillAlpha(0.18)
            c.roundRect(MARGIN_L, y, kw, 15, 7.5, stroke=0, fill=1)
            c.setFillAlpha(1)
            c.drawString(MARGIN_L + 8, y + 4.6, kicker)

        # who it's for / version (left), what's inside (right)
        def label(x, yy, text):
            c.setFont(F["semibold"], 7.2)
            c.setFillColor(a.base)
            c.drawString(x, yy, text.upper())

        top = panel_y - 15 * mm
        left_w = 58 * mm
        yy = top
        for lab, key in (("Who it’s for", "audience"), ("Version", "version")):
            if not m.get(key):
                continue
            label(MARGIN_L, yy, lab)
            para = Paragraph(inline(m[key], a, False), ParagraphStyle(
                "cm", fontName=F["regular"], fontSize=10, leading=14, textColor=INK))
            _, ph = para.wrap(left_w, 100)
            para.drawOn(c, MARGIN_L, yy - 5 - ph)
            yy -= ph + 22

        rx = MARGIN_L + left_w + 12 * mm
        rw = PAGE_W - MARGIN_R - rx
        label(rx, top, "In this guide")
        items = self.toc_titles
        cols = 2 if len(items) > 14 else 1
        per = -(-len(items) // cols)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.line(rx - 6 * mm, top + 6, rx - 6 * mm, top - 22 - per * 15.5)
        colw = rw / cols
        for idx, t in enumerate(items):
            col, row = divmod(idx, per)
            x = rx + col * colw
            ty = top - 16 - row * 15.5
            c.setFont(F["semibold"], 8.4)
            c.setFillColor(a.base)
            c.drawRightString(x + 11, ty, str(idx + 1))
            c.setFont(F["regular"], 9.2)
            c.setFillColor(INK)
            txt = plain(t)
            while stringWidth(txt, F["regular"], 9.2) > colw - 22 and len(txt) > 4:
                txt = txt[:-2].rstrip() + "…" if not txt.endswith("…") else txt[:-2] + "…"
            c.drawString(x + 17, ty, txt)

        # the documentation set
        c.setFont(F["semibold"], 7)
        c.setFillColor(MUTED)
        c.drawString(MARGIN_L, 34 * mm, "THE DOCUMENTATION SET")
        x, y = MARGIN_L, 26 * mm
        cur = m.get("series", "")
        for sid, name in SERIES:
            w = stringWidth(name, F["semibold"], 7.3) + 14
            if x + w > PAGE_W - MARGIN_R:
                x, y = MARGIN_L, y - 19
            if sid == cur:
                c.setFillColor(a.base)
                c.roundRect(x, y, w, 14, 7, stroke=0, fill=1)
                c.setFillColor(WHITE)
            else:
                c.setStrokeColor(RULE)
                c.setLineWidth(0.8)
                c.roundRect(x, y, w, 14, 7, stroke=1, fill=0)
                c.setFillColor(MUTED)
            c.setFont(F["semibold"], 7.3)
            c.drawCentredString(x + w / 2, y + 4.4, name)
            x += w + 5
        c.restoreState()


def build(md_path: Path):
    accent = Accent("#1d4ed8")
    st = styles(accent)
    meta, flow, toc = parse(md_path.read_text(encoding="utf-8"), accent, st)
    out_dir = OUTPUTS.get(meta.get("output", "clients"), OUTPUTS["clients"])
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / (md_path.stem + ".pdf")

    doc = ManualDoc(out, meta, accent, toc)
    story = [Spacer(1, 1), NextPageTemplate("body"), PageBreak()]
    for f in flow:
        if f == "__TOC__":
            head = SectionHeading(None, "Contents", "Contents", accent, ParagraphStyle(
                "h1", fontName=F["semibold"], fontSize=17, leading=21, textColor=INK))
            head.spaceBefore = 0
            story.append(head)
            tocf = TableOfContents(
                levelStyles=[st["toc0"], st["toc1"]], dotsMinLevel=0,
                tableStyle=TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0.5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0.5),
                ]))
            story += [Spacer(1, 4), tocf, Spacer(1, 10)]
        else:
            story.append(f)
    doc.multiBuild(story, canvasmaker=NumberedCanvas)
    return out, doc.page


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("targets", nargs="*", help="document stems or .md files")
    args = ap.parse_args()
    if args.targets:
        files = [SRC_DIR / (t if t.endswith(".md") else t + ".md") for t in args.targets]
    else:
        files = sorted(p for p in SRC_DIR.glob("*.md") if p.name != "README.md")
    for f in files:
        out, pages = build(f)
        rel = out.relative_to(DOCS_DIR)
        print(f"built  {str(rel):<45} {pages - 1:>3} pages  {out.stat().st_size // 1024:>5} KB")


if __name__ == "__main__":
    main()
