# Document sources

Every PDF in `docs/for-clients/` and `docs/for-operators/` is built from the
Markdown file of the same name in this folder. Edit the Markdown, rebuild, and
commit both.

```
python build.py                   # rebuild every document
python build.py Shop_Manual       # rebuild one (stem or filename)
```

Requirements: Python 3.10+ and `pip install reportlab` (which brings Pillow).

| File | Role |
|---|---|
| `build.py` | Parser, page layout, cover, contents page, running header and footer |
| `blocks.py` | Section headings, step lists, callouts, can / can't cards, code blocks |
| `visuals.py` | The OLED screen mock-ups, sensor-light icons, framed screenshots, cover motif |
| `theme.py` | Fonts, the neutral palette, per-document accents, paragraph styles |

## Front matter

The first line is `# Title`; the `:key: value` lines under it set up the cover
and the build.

| Key | Meaning |
|---|---|
| `kicker` | Small label above the title, e.g. *Role guide* |
| `subtitle` | One line under the title |
| `audience` | "Who it's for" on the cover |
| `version` | "Version" on the cover |
| `accent` | The document's colour, as a hex value. Each document in the set has its own. |
| `series` | Which chip to highlight in the cover's documentation-set strip: `platform`, `super_admin`, `admin`, `staff`, `school`, `office`, `shop`, `privacy`, `technical` |
| `output` | `clients` -> `docs/for-clients/`, `operators` -> `docs/for-operators/` |
| `toc_depth` | `1` lists sections on the contents page; `2` adds sub-sections |
| `footer` | Footer text. Defaults to the system name. |

## Markdown subset

The parser deliberately supports only what the documents use.

| Syntax | Result |
|---|---|
| `## 3. Title` | Numbered section: badge, rule, contents entry, PDF bookmark, running header |
| `### 3.1 Title` | Sub-section with an accent-coloured number; in the contents at `toc_depth: 2` |
| `####` | Minor heading, not in the contents |
| `>> text` | Lead paragraph, set slightly larger -- use once, at the top of a section |
| `- item` | Bullet list. Indented lines continue the item above. |
| `1. item` | Numbered steps in circles. A list resumed after a code block keeps its number. |
| `- [ ] item` | Printable checklist with tick boxes |
| `\| a \| b \|` | Table. Column widths are estimated from the content. |
| `<!-- cols: 30 70 -->` | On the line before a table: explicit column proportions |
| A table whose first header is `Light` | Each row gets a drawn sensor-light icon, parsed from the colour and pattern words (*solid*, *breathing*, *blinking*, *flash*, *five quick flashes*) |
| `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]` | Callout box. Continuation lines start with `>`. |
| `::: can` ... `:::` then `::: cannot` ... `:::` | Side-by-side "You can" / "You can't" cards. Text after the keyword replaces the card title. |
| `::: screens` ... `:::` | A grid of OLED screen mock-ups, one per line: `LINE 1 \| line 2 \| line 3 \| line 4 \| caption`. Line 1 is the large headline; supply as many lines as the screen shows, then the caption. `::: screens 4` sets four per row. |
| `![Caption](../../images/file.jpg)` | Framed screenshot with a numbered caption. Add `{60%}` after it to narrow it. |
| ```` ```sql ```` ... ```` ``` ```` | Code block; the language is printed in its corner |
| `<<<TOC>>>` | The contents page |
| `<<<PAGEBREAK>>>` | Page break |
| `**bold**`, `*italic*`, `` `code` ``, `[text](https://…)` | Inline formatting and links |
| `"NO MATCH"` | Quoted ALL-CAPS text is set as an OLED chip -- light on black -- because it's what the scanner's screen says |
| `->` and `--` | An arrow and an em dash; `1--3` between digits becomes an en dash |

Write `<` and `>` literally; they're escaped for you.

The OLED mock-ups follow the firmware's layout (`renderIdleScreen` /
`renderCard`): a large headline of up to 10 characters, then small lines of up
to 21. Longer text is cut off, just as it is on the device.

## House style

- **Check it against the code.** Every label, limit, and behaviour in these
  documents was verified against the dashboard and firmware source. When the app
  changes, change the document in the same commit.
- **Name things as the dashboard does.** Buttons, pages, and fields in **bold**,
  spelled exactly as on screen: **Add member**, **Set active**, **Record sale**.
- **Quote the scanner in caps.** Screen text goes in quotes and capitals --
  "PRESENT", "NO MATCH" -- so it renders as a screen chip.
- **Talk to the reader.** Second person, short sentences, one idea per step.
  Put what to do before why.
- **British spelling in prose** (*organisation*, *enrol*, *colour*), but keep
  the dashboard's own spelling for its labels (**Enrollment**, **Catalog**).
- **Use the default vocabulary** -- Member, Group, Unit, Period, Staff -- and
  remind readers once, near the start, that their institution may have renamed
  them.

## Fonts

The build uses Segoe UI and Consolas from `C:/Windows/Fonts`, falling back to
Arial, then DejaVu on Linux, then Helvetica (which loses the arrow glyph). A
warning is printed if it falls back.
