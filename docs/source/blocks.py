"""
Text-level building blocks: section headings, step lists, callouts, the
can / can't cards, and code blocks. Everything here is a reportlab Flowable
so the page layout in build.py can treat it like any paragraph.
"""

from reportlab.lib import colors
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Flowable, Paragraph, Table, TableStyle

from theme import CALLOUTS, CODE_BG, F, INK, MUTED, RULE, WHITE, mix


class SectionHeading(Flowable):
    """'## 3. Members' -> numbered badge, title, and a rule underneath."""

    BADGE = 24

    def __init__(self, num, markup, plain, accent, style):
        super().__init__()
        self.num, self.plain, self.accent = num, plain, accent
        self.para = Paragraph(markup, style)
        self.spaceBefore, self.spaceAfter = 22, 9
        self.keepWithNext = 1

    def wrap(self, availW, availH):
        self.width = availW
        indent = self.BADGE + 11 if self.num else 0
        _, ph = self.para.wrap(availW - indent, availH)
        self.para_h = ph
        self.height = max(self.BADGE, ph) + 9
        return self.width, self.height

    def draw(self):
        c = self.canv
        top = self.height
        x_text = 0
        if self.num:
            b = self.BADGE
            c.setFillColor(self.accent.base)
            c.roundRect(0, top - b, b, b, 5, stroke=0, fill=1)
            c.setFillColor(WHITE)
            size = 11 if len(self.num) < 3 else 9
            c.setFont(F["semibold"], size)
            c.drawCentredString(b / 2, top - b / 2 - size * 0.36, self.num)
            x_text = b + 11
        y_para = top - max(self.BADGE, self.para_h) + (max(self.BADGE, self.para_h) - self.para_h) / 2
        self.para.drawOn(c, x_text, y_para)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.8)
        c.line(0, 1, self.width, 1)
        c.setStrokeColor(self.accent.base)
        c.setLineWidth(1.8)
        c.line(0, 1, self.BADGE if self.num else 40, 1)


class SubHeading(Paragraph):
    """'### 3.1 Adding one person' -- a Paragraph the TOC can recognise."""

    def __init__(self, markup, plain, style):
        super().__init__(markup, style)
        self.plain = plain


class _Badge(Flowable):
    """Filled circle with a step number, sized to one line of body text."""

    def __init__(self, n, accent, line_h):
        super().__init__()
        self.n, self.accent, self.line_h = n, accent, line_h

    def wrap(self, *_):
        return 18, self.line_h

    def draw(self):
        c = self.canv
        cy = self.line_h / 2 + 0.4
        c.setFillColor(self.accent.base)
        c.circle(8, cy, 7.4, stroke=0, fill=1)
        c.setFillColor(WHITE)
        size = 8.2 if self.n < 10 else 7.2
        c.setFont(F["semibold"], size)
        c.drawCentredString(8, cy - size * 0.35, str(self.n))


class _Box(Flowable):
    """Empty tick box for printable checklists."""

    def __init__(self, accent, line_h):
        super().__init__()
        self.accent, self.line_h = accent, line_h

    def wrap(self, *_):
        return 16, self.line_h

    def draw(self):
        c = self.canv
        s = 9.5
        c.setStrokeColor(self.accent.base)
        c.setLineWidth(1)
        c.setFillColor(WHITE)
        c.roundRect(2, (self.line_h - s) / 2 + 0.3, s, s, 2, stroke=1, fill=1)


def _gutter_table(rows, gutter, width):
    t = Table(rows, colWidths=[gutter, width - gutter], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.6),
    ]))
    t.spaceBefore, t.spaceAfter = 2, 8
    return t


def step_list(items, accent, style, width, start=1):
    line_h = style.leading
    rows = [[_Badge(start + i, accent, line_h), Paragraph(m, style)]
            for i, m in enumerate(items)]
    return _gutter_table(rows, 26, width)


def check_list(items, accent, style, width):
    line_h = style.leading
    rows = [[_Box(accent, line_h), Paragraph(m, style)] for m in items]
    return _gutter_table(rows, 22, width)


class Callout(Flowable):
    """Tinted box with an icon: NOTE (i), TIP (sparkle), WARNING (!)."""

    PAD = 10
    ICON_COL = 34

    def __init__(self, kind, markup, style):
        super().__init__()
        self.kind = kind
        self.color, self.bg, label = CALLOUTS[kind]
        head = f'<font name="{F["semibold"]}" size="8" color="{_hex(self.color)}">{label.upper()}</font>'
        self.head = Paragraph(head, style)
        self.text = Paragraph(markup, style)
        self.spaceBefore, self.spaceAfter = 4, 11

    def wrap(self, availW, availH):
        self.width = availW
        inner = availW - self.ICON_COL - self.PAD - 4
        _, self.hh = self.head.wrap(inner, availH)
        _, self.th = self.text.wrap(inner, availH)
        self.height = self.PAD + self.hh + 1 + self.th + self.PAD
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(self.bg)
        c.setStrokeColor(mix(self.color, WHITE, 0.72))
        c.setLineWidth(0.7)
        c.roundRect(0, 0, self.width, self.height, 6, stroke=1, fill=1)
        c.setFillColor(self.color)
        c.rect(0, 6, 2.6, self.height - 12, stroke=0, fill=1)

        cx, cy, r = 18.5, self.height - self.PAD - 7.5, 8
        c.setFillColor(self.color)
        if self.kind == "WARNING":
            p = c.beginPath()
            p.moveTo(cx, cy + r + 0.5)
            p.lineTo(cx + r + 1, cy - r + 1.5)
            p.lineTo(cx - r - 1, cy - r + 1.5)
            p.close()
            c.drawPath(p, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.setFont(F["bold"], 9)
            c.drawCentredString(cx, cy - 4.6, "!")
        else:
            c.circle(cx, cy, r, stroke=0, fill=1)
            c.setFillColor(WHITE)
            if self.kind == "NOTE":
                c.setFont(F["bold"], 10)
                c.drawCentredString(cx, cy - 3.6, "i")
            else:  # TIP: four-point sparkle
                p = c.beginPath()
                s, w = 5.2, 1.5
                p.moveTo(cx, cy + s)
                p.lineTo(cx + w, cy + w)
                p.lineTo(cx + s, cy)
                p.lineTo(cx + w, cy - w)
                p.lineTo(cx, cy - s)
                p.lineTo(cx - w, cy - w)
                p.lineTo(cx - s, cy)
                p.lineTo(cx - w, cy + w)
                p.close()
                c.drawPath(p, stroke=0, fill=1)

        x = self.ICON_COL
        y = self.height - self.PAD - self.hh
        self.head.drawOn(c, x, y)
        self.text.drawOn(c, x, y - 1 - self.th)


class ListCard(Flowable):
    """'You can' (green ticks) or 'You can't' (grey crosses) card."""

    PAD = 11

    def __init__(self, kind, title, items, styles):
        super().__init__()
        self.kind = kind
        self.title = Paragraph(title, styles["card_title"])
        self.items = [Paragraph(m, styles["card_item"]) for m in items]
        if kind == "can":
            self.bg, self.border = colors.HexColor("#f0fdf4"), colors.HexColor("#bbf7d0")
            self.mark = colors.HexColor("#16a34a")
        else:
            self.bg, self.border = colors.HexColor("#f8fafc"), colors.HexColor("#e2e8f0")
            self.mark = colors.HexColor("#94a3b8")
        self.forced_h = None

    def wrap(self, availW, availH):
        self.width = availW
        inner = availW - 2 * self.PAD - 15
        _, self.title_h = self.title.wrap(availW - 2 * self.PAD, availH)
        self.item_h = [p.wrap(inner, availH)[1] for p in self.items]
        natural = self.PAD + self.title_h + 7 + sum(h + 4 for h in self.item_h) + self.PAD - 4
        self.height = max(natural, self.forced_h or 0)
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(self.bg)
        c.setStrokeColor(self.border)
        c.setLineWidth(0.8)
        c.roundRect(0, 0, self.width, self.height, 7, stroke=1, fill=1)
        y = self.height - self.PAD - self.title_h
        self.title.drawOn(c, self.PAD, y)
        y -= 7
        for p, h in zip(self.items, self.item_h):
            y -= h
            p.drawOn(c, self.PAD + 15, y)
            my = y + h - 7.2          # centre of the first text line
            c.setStrokeColor(self.mark)
            c.setLineWidth(1.5)
            c.setLineCap(1)
            x0 = self.PAD + 1
            if self.kind == "can":
                c.line(x0, my, x0 + 2.8, my - 2.9)
                c.line(x0 + 2.8, my - 2.9, x0 + 8, my + 3.2)
            else:
                c.line(x0 + 1, my + 3, x0 + 7, my - 3)
                c.line(x0 + 1, my - 3, x0 + 7, my + 3)
            y -= 4


class CardPair(Flowable):
    """Two cards side by side, stretched to the same height."""

    GAP = 10

    def __init__(self, left, right):
        super().__init__()
        self.left, self.right = left, right
        self.spaceBefore, self.spaceAfter = 3, 11

    def wrap(self, availW, availH):
        self.width = availW
        half = (availW - self.GAP) / 2
        self.left.forced_h = self.right.forced_h = None
        h = max(self.left.wrap(half, availH)[1], self.right.wrap(half, availH)[1])
        self.left.forced_h = self.right.forced_h = h
        self.left.wrap(half, availH)
        self.right.wrap(half, availH)
        self.half, self.height = half, h
        return self.width, self.height

    def draw(self):
        self.left.drawOn(self.canv, 0, 0)
        self.right.drawOn(self.canv, self.half + self.GAP, 0)


class CodeBlock(Flowable):
    """Monospaced block. Long lines wrap with a hanging indent; tall blocks split."""

    PAD = 9
    SIZE = 8.3
    LEAD = 11.4

    def __init__(self, text, lang="", lines=None):
        super().__init__()
        self.text, self.lang = text, lang
        self.raw = lines if lines is not None else text.rstrip("\n").split("\n")
        self.spaceBefore, self.spaceAfter = 3, 10

    def _wrapped(self, availW):
        cw = stringWidth("M", F["mono"], self.SIZE)
        max_chars = max(20, int((availW - 2 * self.PAD) / cw))
        out = []
        for line in self.raw:
            while len(line) > max_chars:
                cut = line.rfind(" ", 0, max_chars)
                cut = cut if cut > max_chars // 2 else max_chars
                out.append(line[:cut])
                line = "    " + line[cut:].lstrip()
            out.append(line)
        return out

    def wrap(self, availW, availH):
        self.width = availW
        self.lines = self._wrapped(availW)
        self.height = 2 * self.PAD + len(self.lines) * self.LEAD - 2
        return self.width, self.height

    def split(self, availW, availH):
        lines = self._wrapped(availW)
        fit = int((availH - 2 * self.PAD) / self.LEAD)
        if fit < 3 or fit >= len(lines):
            return []
        return [CodeBlock("", self.lang, lines[:fit]), CodeBlock("", "", lines[fit:])]

    def draw(self):
        c = self.canv
        c.setFillColor(CODE_BG)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.7)
        c.roundRect(0, 0, self.width, self.height, 5, stroke=1, fill=1)
        if self.lang:
            c.setFillColor(MUTED)
            c.setFont(F["semibold"], 6.6)
            c.drawRightString(self.width - 8, self.height - 11, self.lang.upper())
        c.setFillColor(INK)
        c.setFont(F["mono"], self.SIZE)
        y = self.height - self.PAD - self.SIZE + 0.5
        for line in self.lines:
            c.drawString(self.PAD, y, line)
            y -= self.LEAD


def _hex(color):
    return color.hexval().replace("0x", "#")
