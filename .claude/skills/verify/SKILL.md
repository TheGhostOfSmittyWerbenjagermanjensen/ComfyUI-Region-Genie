---
name: verify
description: Check a change to Region Genie before committing or pushing. Runs exactly the tests that belong to the changed files (syntax, stub tests, real-ComfyUI browser tests) and prints one line per check. Use before every commit of code, before a push, and when asked to "run the tests" or "verify".
---

# Verify a change

One command picks the checks from the files that changed, runs them and prints a short summary:

```bash
python3 tests/verify.py
```

- `--list`: only say what would run, and why. Start here to see how long it will take.
- `--quick`: leave out everything that needs a ComfyUI (seconds to a few minutes). Use it while working.
- no option: also the real-ComfyUI checks (minutes to an hour, by the change). Use it before a push.
- `--all`: every check (about an hour). Use it before a release, or after changing `tests/verify.py`.
- `--only <word>`, `--base <ref>`, or file names: see the header of `tests/verify.py`.

Run a long one in the background with its output in a file, and read only that file's lines: the script already
keeps every check's full output in `tests/out/verify/<name>.log` and prints only results and FAIL lines.

## The test ComfyUI

The real checks drive a browser against a ComfyUI on `127.0.0.1:8188` (CPU, no model files). The script starts and
restarts it by itself. It looks in `COMFY_DIR`, else `/tmp/comfy_src`. When there is none (a new cloud session):

```bash
bash tests/setup_real_comfy.sh
```

(about 5 GB, a few minutes). Without it the real checks are listed as NOT RUN and the exit code is 3: say so in the
report, never count them as passed.

## Rules

- A failed check is a finding. Read its log, fix the cause, run that check again (`--only <name>`). Never run a check
  again in the hope it passes, never add a wait or a retry to make it pass, never skip or delete a check to get green.
- After three rounds of fixing with the same check still failing: stop and tell the owner what fails and what was tried.
- A test file that this change edits or deletes is named in the report, with the reason (the behavior changed on
  purpose, or the test was wrong). The tests judge the change, so the owner must see when the judge was changed too.
- A new feature gets its check in the same change; a bug the owner reports gets a check that fails without the fix.
  A new check file gets a line in `RULES` in `tests/verify.py` (and in `tests/run_ui.sh` / `run_py.sh` for stub tests).

## What this does not cover

- How a UI change looks: take a picture with the real ComfyUI and look at it (`tests/shot_readme.cjs` shows how a
  page is opened and driven), in legacy mode and Nodes 2.0.
- Firefox (`bash tests/setup_firefox.sh`, `tests/firefox_*.cjs`), a 4K screen, and every GPU run: those go into the
  report as not tested and, where it matters, into `docs/HARDWARE-CHECKLIST.md`.
