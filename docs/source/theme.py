"""
Fonts, colours, and paragraph styles shared by every document.

Each document picks an accent colour in its front matter (`:accent:`); the
rest of the palette is neutral so the whole set reads as one series.
"""

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm

# --- page geometry ---------------------------------------------------------
PAGE_W, PAGE_H = A4
MARGIN_L = MARGIN_R = 20 * mm
MARGIN_T = 24 * mm
MARGIN_B = 20 * mm
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

# --- neutral palette -------------------------------------------------------
INK = colors.HexColor("#0f172a")       # headings
BODY = colors.HexColor("#1e293b")      # running text
MUTED = colors.HexColor("#64748b")     # captions, furniture
FAINT = colors.HexColor("#94a3b8")
RULE = colors.HexColor("#e2e8f0")
PANEL = colors.HexColor("#f8fafc")
CODE_BG = colors.HexColor("#f1f5f9")
WHITE = colors.white

# Callout kinds -> (strong colour, background, label)
CALLOUTS = {
    "NOTE": (colors.HexColor("#2563eb"), colors.HexColor("#eff6ff"), "Note"),
    "TIP": (colors.HexColor("#047857"), colors.HexColor("#ecfdf5"), "Tip"),
    "WARNING": (colors.HexColor("#b91c1c"), colors.HexColor("#fef2f2"), "Important"),
}

# The documentation set, in the order it is printed on every cover.
SERIES = [
    ("platform", "Platform admin"),
    ("super_admin", "Super admin"),
    ("admin", "Admin"),
    ("staff", "Staff"),
    ("school", "School"),
    ("office", "Office"),
    ("shop", "Shop"),
    ("privacy", "Privacy note"),
    ("technical", "Technical"),
]


def mix(c1, c2, t):
    """Blend colour c1 towards c2 by t (0 = c1, 1 = c2)."""
    return colors.Color(
        c1.red + (c2.red - c1.red) * t,
        c1.green + (c2.green - c1.green) * t,
        c1.blue + (c2.blue - c1.blue) * t,
    )


class Accent:
    """One document's accent colour plus the tints derived from it."""

    def __init__(self, hexval):
        self.base = colors.HexColor(hexval)
        self.dark = mix(self.base, colors.black, 0.28)
        self.tint = mix(self.base, WHITE, 0.92)      # table heads, soft panels
        self.soft = mix(self.base, WHITE, 0.80)
        self.hex = self.base.hexval().replace("0x", "#")
        self.dark_hex = self.dark.hexval().replace("0x", "#")


# --- fonts -----------------------------------------------------------------
# Segoe UI reads well at small sizes and has every glyph the manuals use
# (arrows, bullets, the cedi sign). Arial is the Windows fallback; DejaVu the
# Linux one; Helvetica the last resort, which degrades arrows to '->'.
FONT_DIRS = [
    Path("C:/Windows/Fonts"),
    Path("/usr/share/fonts/truetype/msttcorefonts"),
    Path("/usr/share/fonts/truetype/dejavu"),
]
FAMILIES = [
    {"regular": "segoeui.ttf", "bold": "segoeuib.ttf", "italic": "segoeuii.ttf",
     "bolditalic": "segoeuiz.ttf", "semibold": "seguisb.ttf", "light": "segoeuil.ttf"},
    {"regular": "arial.ttf", "bold": "arialbd.ttf", "italic": "ariali.ttf",
     "bolditalic": "arialbi.ttf", "semibold": "arialbd.ttf", "light": "arial.ttf"},
    {"regular": "DejaVuSans.ttf", "bold": "DejaVuSans-Bold.ttf",
     "italic": "DejaVuSans-Oblique.ttf", "bolditalic": "DejaVuSans-BoldOblique.ttf",
     "semibold": "DejaVuSans-Bold.ttf", "light": "DejaVuSans.ttf"},
]
MONO_FACES = [("consola.ttf", "consolab.ttf"), ("cour.ttf", "courbd.ttf"),
              ("DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf")]

F = {"regular": "Helvetica", "bold": "Helvetica-Bold", "italic": "Helvetica-Oblique",
     "bolditalic": "Helvetica-BoldOblique", "semibold": "Helvetica-Bold",
     "light": "Helvetica", "mono": "Courier", "mono_bold": "Courier-Bold"}
UNICODE_OK = False


def _register():
    global UNICODE_OK
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    for fam in FAMILIES:
        for d in FONT_DIRS:
            if not all((d / f).exists() for f in fam.values()):
                continue
            try:
                for key, fn in fam.items():
                    name = f"Doc-{key}"
                    pdfmetrics.registerFont(TTFont(name, str(d / fn)))
                    F[key] = name
                pdfmetrics.registerFontFamily(
                    "Doc-regular", normal="Doc-regular", bold="Doc-bold",
                    italic="Doc-italic", boldItalic="Doc-bolditalic")
                UNICODE_OK = True
                break
            except Exception as exc:  # noqa: BLE001 - fall through to the next family
                print(f"warn: could not register {d}: {exc}", file=sys.stderr)
        if UNICODE_OK:
            break
    if not UNICODE_OK:
        print("warn: no TrueType family found - using Helvetica", file=sys.stderr)

    for reg, bold in MONO_FACES:
        for d in FONT_DIRS:
            if (d / reg).exists() and (d / bold).exists():
                pdfmetrics.registerFont(TTFont("Doc-mono", str(d / reg)))
                pdfmetrics.registerFont(TTFont("Doc-mono-bold", str(d / bold)))
                F["mono"], F["mono_bold"] = "Doc-mono", "Doc-mono-bold"
                return


_register()


# --- paragraph styles ------------------------------------------------------
def styles(accent: Accent):
    s = {}
    s["body"] = ParagraphStyle(
        "body", fontName=F["regular"], fontSize=10, leading=15.2,
        textColor=BODY, spaceAfter=7, alignment=TA_LEFT)
    s["lead"] = ParagraphStyle(
        "lead", parent=s["body"], fontSize=11.2, leading=17, textColor=INK,
        spaceAfter=9)
    s["li"] = ParagraphStyle("li", parent=s["body"], spaceAfter=3.2)
    s["step"] = ParagraphStyle("step", parent=s["body"], spaceAfter=0)
    s["h2"] = ParagraphStyle(
        "h2", fontName=F["semibold"], fontSize=12.4, leading=16.5,
        textColor=INK, spaceBefore=13, spaceAfter=5, keepWithNext=1)
    s["h3"] = ParagraphStyle(
        "h3", fontName=F["semibold"], fontSize=10.4, leading=14.5,
        textColor=colors.HexColor("#334155"), spaceBefore=9, spaceAfter=3,
        keepWithNext=1)
    s["th"] = ParagraphStyle(
        "th", fontName=F["semibold"], fontSize=8.7, leading=11.5,
        textColor=accent.dark)
    s["td"] = ParagraphStyle(
        "td", fontName=F["regular"], fontSize=8.9, leading=12.4, textColor=BODY)
    s["callout"] = ParagraphStyle(
        "callout", parent=s["body"], fontSize=9.5, leading=14, spaceAfter=0)
    s["card_title"] = ParagraphStyle(
        "card_title", fontName=F["semibold"], fontSize=9.4, leading=12,
        textColor=INK)
    s["card_item"] = ParagraphStyle(
        "card_item", parent=s["body"], fontSize=9.3, leading=13.2, spaceAfter=0)
    s["caption"] = ParagraphStyle(
        "caption", fontName=F["regular"], fontSize=8.3, leading=11.5,
        textColor=MUTED, spaceAfter=0)
    s["screen_caption"] = ParagraphStyle(
        "screen_caption", fontName=F["regular"], fontSize=8.2, leading=11,
        textColor=BODY, spaceAfter=0)
    s["toc0"] = ParagraphStyle(
        "toc0", fontName=F["semibold"], fontSize=10.3, leading=15,
        textColor=INK, spaceBefore=5)
    s["toc1"] = ParagraphStyle(
        "toc1", fontName=F["regular"], fontSize=9.1, leading=13,
        textColor=MUTED, leftIndent=18)
    return s
