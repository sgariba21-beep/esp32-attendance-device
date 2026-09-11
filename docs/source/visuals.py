"""
Drawn illustrations: the device's OLED screen, the sensor light, framed
dashboard screenshots, and the fingerprint motif on the covers.

The OLED mock follows the firmware's own layout (renderIdleScreen /
renderCard): a size-2 headline on row 0, size-1 lines on rows 24, 36, and 48
of a 128 x 64 panel, with the same character limits -- so what the manual
shows is what the device can actually display.
"""

import random
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Flowable, Paragraph, Table, TableStyle

from theme import F, MUTED, RULE, WHITE

# --- the sensor light ------------------------------------------------------
LED_COLOURS = {
    "blue": colors.HexColor("#2563eb"),
    "purple": colors.HexColor("#9333ea"),
    "green": colors.HexColor("#16a34a"),
    "red": colors.HexColor("#dc2626"),
    "yellow": colors.HexColor("#eab308"),
}


def parse_light(text):
    """'Breathing yellow' -> ('yellow', 'breathing'). None if no colour word."""
    t = text.lower()
    colour = next((c for c in LED_COLOURS if c in t), None)
    if not colour:
        return None
    if re.search(r"\b(five|5|quick)\b.*flash", t):
        pattern = "burst"
    elif "breath" in t:
        pattern = "breathing"
    elif "blink" in t:
        pattern = "blinking"
    elif "flash" in t:
        pattern = "flash"
    else:
        pattern = "solid"
    return colour, pattern


class LedIcon(Flowable):
    W, H = 20, 12

    def __init__(self, colour, pattern):
        super().__init__()
        self.col, self.pattern = LED_COLOURS[colour], pattern

    def wrap(self, *_):
        return self.W, self.H

    def draw(self):
        c = self.canv
        cx, cy = 8, self.H / 2
        if self.pattern == "burst":
            c.setFillColor(self.col)
            for i in range(5):
                c.circle(2 + i * 3.9, cy, 1.45, stroke=0, fill=1)
            return
        if self.pattern == "breathing":
            for r, a in ((6.3, 0.16), (4.8, 0.32)):
                c.setFillColor(self.col)
                c.setFillAlpha(a)
                c.circle(cx, cy, r, stroke=0, fill=1)
            c.setFillAlpha(1)
            c.circle(cx, cy, 3.1, stroke=0, fill=1)
        elif self.pattern == "blinking":
            c.setStrokeColor(self.col)
            c.setLineWidth(1)
            c.setDash(1.4, 1.4)
            c.circle(cx, cy, 5.3, stroke=1, fill=0)
            c.setDash()
            c.setFillColor(self.col)
            c.circle(cx, cy, 2.9, stroke=0, fill=1)
        elif self.pattern == "flash":
            c.setStrokeColor(self.col)
            c.setLineWidth(0.9)
            c.setLineCap(1)
            for dx, dy in ((0, 1), (0.87, 0.5), (0.87, -0.5), (0, -1), (-0.87, -0.5), (-0.87, 0.5)):
                c.line(cx + dx * 4.6, cy + dy * 4.6, cx + dx * 6.4, cy + dy * 6.4)
            c.setFillColor(self.col)
            c.circle(cx, cy, 3.3, stroke=0, fill=1)
        else:
            c.setFillColor(self.col)
            c.setFillAlpha(0.2)
            c.circle(cx, cy, 5.6, stroke=0, fill=1)
            c.setFillAlpha(1)
            c.circle(cx, cy, 4, stroke=0, fill=1)


def led_cell(markup, raw, style, width):
    """Table cell content: light icon + label. Falls back to plain text."""
    parsed = parse_light(raw)
    if not parsed:
        return Paragraph(markup, style)
    t = Table([[LedIcon(*parsed), Paragraph(markup, style)]],
              colWidths=[LedIcon.W + 4, max(20, width - LedIcon.W - 4)])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


# --- the OLED screen -------------------------------------------------------
class OledScreen(Flowable):
    """A 128 x 64 SSD1306 panel in a bezel, centred in the available width."""

    PANEL_W = 112          # points across the lit area
    BEZEL = 5
    ROWS = (24, 36, 48)    # firmware y positions of the size-1 lines

    def __init__(self, lines):
        super().__init__()
        self.lines = [l.strip() for l in lines]

    def wrap(self, availW, availH):
        self.width = availW
        self.scale = self.PANEL_W / 128.0
        self.panel_h = 64 * self.scale
        self.height = self.panel_h + 2 * self.BEZEL
        return self.width, self.height

    def draw(self):
        c, s = self.canv, self.scale
        w = self.PANEL_W + 2 * self.BEZEL
        x0 = (self.width - w) / 2
        c.setFillColor(colors.HexColor("#1f2937"))
        c.roundRect(x0, 0, w, self.height, 5, stroke=0, fill=1)
        px, py = x0 + self.BEZEL, self.BEZEL
        c.setFillColor(colors.black)
        c.rect(px, py, self.PANEL_W, self.panel_h, stroke=0, fill=1)

        ink = colors.HexColor("#e8f1ff")
        c.setFillColor(ink)
        top = py + self.panel_h
        # Consolas advance is 0.55 em; size the fonts so one character spans
        # 12 px (text size 2) or 6 px (text size 1), like the Adafruit font.
        if self.lines and self.lines[0]:
            size = 12 * s / 0.55
            c.setFont(F["mono_bold"], size)
            c.drawString(px + 1 * s, top - 13.5 * s, self.lines[0][:10])
        small = 6 * s / 0.55
        c.setFont(F["mono"], small)
        for row, text in zip(self.ROWS, self.lines[1:]):
            if text:
                c.drawString(px + 1 * s, top - (row + 7) * s, text[:21])


def screen_gallery(entries, styles, width, cols=3):
    """entries: list of (lines, caption_markup). Returns a grid Table."""
    cells = []
    for lines, caption in entries:
        cells.append([OledScreen(lines), Paragraph(caption, styles["screen_caption"])])
    rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
    if rows and len(rows[-1]) < cols:
        rows[-1] += [""] * (cols - len(rows[-1]))
    col_w = width / cols
    t = Table(rows, colWidths=[col_w] * cols, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    t.spaceBefore, t.spaceAfter = 4, 6
    return t


# --- screenshots -----------------------------------------------------------
class Screenshot(Flowable):
    """Dashboard capture with rounded corners, a hairline frame, and a caption."""

    RADIUS = 6

    def __init__(self, path: Path, caption_markup, style, frac=1.0):
        super().__init__()
        self.path, self.frac = path, frac
        self.caption = Paragraph(caption_markup, style)
        self.img = ImageReader(str(path)) if path.exists() else None
        self.spaceBefore, self.spaceAfter = 6, 12

    def wrap(self, availW, availH):
        self.width = availW
        self.img_w = availW * self.frac
        ratio = 60 / self.img_w
        if self.img:
            iw, ih = self.img.getSize()
            ratio = ih / iw
        self.img_h = self.img_w * ratio
        _, self.cap_h = self.caption.wrap(self.img_w, availH)
        # Rather than leave a large gap at the foot of a page, shrink a
        # capture that nearly fits -- down to 72% of its natural size.
        room = availH - 6 - self.cap_h - self.spaceBefore
        if self.img_h > room >= self.img_h * 0.72:
            self.img_h = room
            self.img_w = room / ratio
            _, self.cap_h = self.caption.wrap(self.img_w, availH)
        self.height = self.img_h + 6 + self.cap_h
        return self.width, self.height

    def draw(self):
        c = self.canv
        x = (self.width - self.img_w) / 2
        y = self.cap_h + 6
        r = self.RADIUS
        c.setFillColor(colors.HexColor("#0f172a"))
        c.setFillAlpha(0.07)
        c.roundRect(x + 1.5, y - 2, self.img_w, self.img_h, r, stroke=0, fill=1)
        c.setFillAlpha(1)
        if self.img:
            c.saveState()
            p = c.beginPath()
            p.roundRect(x, y, self.img_w, self.img_h, r)
            c.clipPath(p, stroke=0, fill=0)
            c.drawImage(self.img, x, y, self.img_w, self.img_h)
            c.restoreState()
        else:
            c.setFillColor(colors.HexColor("#f1f5f9"))
            c.roundRect(x, y, self.img_w, self.img_h, r, stroke=0, fill=1)
            c.setFillColor(MUTED)
            c.setFont(F["regular"], 8)
            c.drawCentredString(x + self.img_w / 2, y + self.img_h / 2 - 3,
                                f"Screenshot not found: {self.path.name}")
        c.setStrokeColor(RULE)
        c.setLineWidth(0.8)
        c.roundRect(x, y, self.img_w, self.img_h, r, stroke=1, fill=0)
        self.caption.drawOn(c, x, 0)


# --- cover motif -----------------------------------------------------------
def draw_fingerprint(c, cx, cy, rmax, colour, seed=7):
    """Broken concentric ellipses, drawn faintly, that read as a fingerprint."""
    rnd = random.Random(seed)
    c.saveState()
    c.setStrokeColor(colour)
    c.setLineCap(1)
    r = 9.0
    while r < rmax:
        c.setLineWidth(2.1)
        c.setStrokeAlpha(0.10 + 0.05 * rnd.random())
        rx, ry = r, r * 1.28
        ang = rnd.uniform(0, 360)
        total = 0
        while total < 330:
            seg = rnd.uniform(40, 150)
            gap = rnd.uniform(8, 26)
            c.arc(cx - rx, cy - ry, cx + rx, cy + ry, ang, seg)
            ang += seg + gap
            total += seg + gap
        r += 8.5
    c.restoreState()
