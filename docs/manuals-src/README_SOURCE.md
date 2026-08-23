# Manual sources

The PDFs in `docs/` are generated from the `.md` files in this folder. Edit the
Markdown, re-run the build, commit both.

```
python build_manual.py                 # rebuild every manual
python build_manual.py Shop_Manual.md  # rebuild one
```

Output lands in `docs/<same-stem>.pdf`.

## Which manual is which

| File | Audience |
| --- | --- |
| `Platform_Admin_Manual.md` | You -- deployment, firmware, secrets, onboarding |
| `Super_Admin_Manual.md` | Client's owner account -- devices, enrollment, settings |
| `Admin_Manual.md` | Client's day-to-day admin |
| `Staff_Manual.md` | Client's read-only teachers / supervisors |
| `School_Manual.md` | Institution type guide |
| `Office_Manual.md` | Institution type guide |
| `Shop_Manual.md` | Institution type guide, includes the cashier role |

Role manuals answer *what can this login do*. Type manuals answer *what does the
system do for this kind of organisation*. Clients get both.

## Markdown subset

The parser in `build_manual.py` deliberately supports only what the manuals use:

| Syntax | Result |
| --- | --- |
| `# Title` + `:key: value` lines | Cover page. Keys: `kicker`, `subtitle`, `audience`, `version`, `footer`. |
| `## Heading` | Numbered section, added to the contents page, with a rule under it |
| `###` / `####` | Sub-headings, not in the contents |
| `- item` | Bullet list |
| `1. item` | Numbered list |
| `\| a \| b \|` | Table. A `\|---\|` separator row is ignored. First column is widened. |
| `> [!WARNING]` / `> [!TIP]` / `> [!NOTE]` | Coloured callout box. Continuation lines start with `>`. |
| `<<<TOC>>>` | Contents page, built from the `##` headings |
| `<<<PAGEBREAK>>>` | Page break |
| `**bold**`, `*italic*`, `` `code` `` | Inline formatting |
| `->` and `--` | Typeset as an arrow and an em dash |

Note that `<` and `>` in body text are escaped automatically -- write them
literally, not as HTML entities.

## Fonts

The build registers Arial from `C:/Windows/Fonts` so arrows and bullets render.
Without it, it falls back to Helvetica and prints a warning; arrows degrade to
`->`. The fallback is there so the build still succeeds off-Windows.
