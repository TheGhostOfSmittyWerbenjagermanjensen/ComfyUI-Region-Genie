"""The translations in locales/<language>/ against the English reference in tests/i18n_en/ (no ComfyUI needed).

Every language must have exactly the reference's entries, with the same number of lines in each text, the special
characters of ComfyUI's translation engine written its literal way, and one translation per name / dropdown choice.
The reference itself is checked against a running ComfyUI by tests/real_i18n.cjs (node tests/i18n_extract.cjs rewrites it).
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "tests", "i18n_en")
LOC = os.path.join(ROOT, "locales")
FILES = ("nodeDefs.json", "settings.json", "main.json")
# ComfyUI's languages (Settings > Language); a folder with another name would never be shown
KNOWN = {"zh", "zh-TW", "ru", "ja", "ko", "fr", "es", "ar", "tr", "pt-BR", "fa", "he", "it"}
LITERAL = re.compile(r"\{'[^']*'\}")          # vue-i18n's literal form: {'@'} {'{'} {'}'} {'|'}

fails = []


def check(name, ok, detail=""):
    if not ok:
        fails.append(name)
    print(("ok   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))


def flat(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from flat(v, f"{path}/{k}")
    else:
        yield path, o


def load(folder, name):
    with open(os.path.join(folder, name), encoding="utf-8") as f:
        return json.load(f)


def plain(text):
    """A translated text as ComfyUI shows it (literal forms resolved)."""
    return LITERAL.sub(lambda m: m.group(0)[2:-2], text)


ref = {name: dict(flat(load(REF, name))) for name in FILES}
check("the English reference has node texts, Settings and dropdown choices",
      len(ref["nodeDefs.json"]) > 150 and len(ref["settings.json"]) > 200 and len(ref["main.json"]) > 30)

langs = sorted(d for d in os.listdir(LOC) if os.path.isdir(os.path.join(LOC, d))) if os.path.isdir(LOC) else []
check(f"locales/ has languages ({', '.join(langs)})", bool(langs))
check("no English locale (English comes from the code; a copy would go stale and pass through the translation engine)", "en" not in langs)

for lang in langs:
    folder = os.path.join(LOC, lang)
    check(f"{lang}: a language ComfyUI offers", lang in KNOWN)
    names = {}                                   # English input / output name -> its translations
    for name in FILES:
        try:
            got = dict(flat(load(folder, name)))
        except (OSError, ValueError) as e:
            check(f"{lang}/{name}: readable JSON", False, str(e))
            continue
        want = ref[name]
        missing = [k for k in want if k not in got]
        extra = [k for k in got if k not in want]
        check(f"{lang}/{name}: every entry of the reference is translated ({len(want)})", not missing, "; ".join(missing[:5]))
        check(f"{lang}/{name}: no entry that the pack no longer has", not extra, "; ".join(extra[:5]))
        both = [k for k in want if k in got]
        bad = [k for k in both if not isinstance(got[k], str) or not got[k].strip()]
        check(f"{lang}/{name}: no empty text", not bad, "; ".join(bad[:5]))
        both = [k for k in both if isinstance(got[k], str)]
        bad = [k for k in both if got[k].count("\n") != want[k].count("\n")]
        check(f"{lang}/{name}: each text has as many lines as the English one (one item per line)", not bad, "; ".join(bad[:5]))
        bad = [k for k in both if re.search(r"[@{}|]", LITERAL.sub("", got[k]))]
        check(f"{lang}/{name}: @ {{ }} | are written the literal way, like {{'@'}} (raw, they break ComfyUI's translation engine)",
              not bad, "; ".join(bad[:5]))
        bad = [k for k in both if re.findall(r"[@{}|]", want[k]) and sorted(re.findall(r"[@{}|]", want[k])) != sorted(re.findall(r"[@{}|]", plain(got[k])))]
        check(f"{lang}/{name}: texts with @ {{ }} | keep them", not bad, "; ".join(bad[:5]))
        bad = [k for k in both if want[k].endswith(" ✨") != got[k].endswith(" ✨")]
        check(f"{lang}/{name}: node names keep their ✨", not bad, "; ".join(bad[:5]))
        if name == "nodeDefs.json":
            for k in both:
                if re.search(r"/(inputs|outputs)/[^/]+/name$", k):
                    names.setdefault(want[k], set()).add(got[k])
    bad = [f"{k}: {' / '.join(sorted(v))}" for k, v in names.items() if len(v) > 1]
    check(f"{lang}: an input / output name has one translation on every node", not bad, "; ".join(bad[:5]))
    # a dropdown choice reads the same on the node and in Settings
    try:
        choices = load(folder, "main.json").get("regionGenie", {}).get("choices", {})
        settings = load(folder, "settings.json")
        en_settings = load(REF, "settings.json")
        bad = []
        for sid, s in en_settings.items():
            for key, english in s.get("options", {}).items():
                if english in choices and settings.get(sid, {}).get("options", {}).get(key) != choices[english]:
                    bad.append(f"{sid}: {english}")
        check(f"{lang}: a dropdown choice has the same translation on the node and in Settings", not bad, "; ".join(bad[:5]))
    except (OSError, ValueError):
        pass

print()
print("ALL PASS" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
