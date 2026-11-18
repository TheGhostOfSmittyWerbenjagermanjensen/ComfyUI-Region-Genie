# Translations

ComfyUI reads these folders when it starts and shows the texts in the language chosen under **Settings > Language**
(restart ComfyUI after changing a file). English is not here: it comes from the code.

| Folder | Language | State |
|---|---|---|
| `zh` | Chinese (simplified) | Machine-drafted, not yet reviewed by a native speaker |
| `ja` | Japanese | Machine-drafted, not yet reviewed by a native speaker |
| `ko` | Korean | Machine-drafted, not yet reviewed by a native speaker |
| `es` | Spanish | Machine-drafted, not yet reviewed by a native speaker |

## What is translated

- `nodeDefs.json`: node names, descriptions, input / output names and their tooltips.
- `settings.json`: the names, tooltips and options under Settings > Region Genie.
- `main.json`: the Settings section names (`settingsCategories`) and the choices of the nodes' dropdowns
  (`regionGenie.choices`; ComfyUI has no key for those, `js/rg_i18n.js` applies them).
- `glossary.json`: the terms a language settled on. ComfyUI does not read it; it keeps the wording consistent.

Not translated yet: the Region Genie editor itself (toolbar, region list, pop-ups, menus, hints), the buttons the pack
draws inside Settings (Check, New, Delete, the model-file fields), and the texts made during a run (`region_info`,
notes, error messages). Tooltips name those editor labels in English on purpose, as that is what is on screen.

## Correcting a translation

Edit the text in the language's file and keep the key. Rules the test checks:

- Same keys as the English reference, `tests/i18n_en/`; no empty text.
- A multi-line tooltip keeps its number of lines (one item per line: `name: Description.`).
- The characters `@ { } |` are syntax for ComfyUI's translation engine: written raw they break the text. Write them
  as `{'@'}` `{'{'}` `{'}'}` `{'|'}` (only the wildcard example `{a|b}` needs this).
- An input / output name has one translation on every node, and a dropdown choice reads the same on the node
  (`main.json`) and in Settings (`settings.json`).
- Only what is shown changes. The values saved in a workflow and sent with a run stay English.

```bash
python3 tests/test_i18n.py
```

## Adding a language

Copy `tests/i18n_en/*.json` into `locales/<code>/` and translate every value. The code must be one ComfyUI offers:
`zh`, `zh-TW`, `ru`, `ja`, `ko`, `fr`, `es`, `ar`, `tr`, `pt-BR`, `fa`, `he`, `it`.

## After changing an English text or a Setting

With ComfyUI running in English (see `tests/README.md`):

```bash
node tests/i18n_extract.cjs
```

It rewrites `tests/i18n_en/`. `git diff tests/i18n_en` then shows what changed; update those entries in every
language, and `python3 tests/test_i18n.py` reports entries that are missing or no longer exist.
