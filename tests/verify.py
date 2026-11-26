#!/usr/bin/env python3
"""One command for "check what I changed".

It looks at the files that differ from the base branch, picks the checks that belong to them (the table RULES below:
the list that used to be prose in CLAUDE.md), runs them one after another and prints one line per check. Every check's
full output goes to tests/out/verify/<name>.log; only the result and a failed check's FAIL lines are printed, so a
long run reads as a few lines.

    python3 tests/verify.py                 the checks for what changed against origin/main (also uncommitted files)
    python3 tests/verify.py --list          only say what would run, and why
    python3 tests/verify.py --quick         leave out everything that needs a ComfyUI (listed as "not run")
    python3 tests/verify.py --all           every check there is (about an hour)
    python3 tests/verify.py --only layering only the checks whose name contains the word (with --all or a change)
    python3 tests/verify.py --base REF      compare with another branch or commit
    python3 tests/verify.py js/rg_keys.js   the checks for these files, whatever their diff says

Exit code: 0 all passed, 1 a check failed, 3 nothing failed but a check that was due could not run.

The real-ComfyUI checks need the test ComfyUI: `bash tests/setup_real_comfy.sh` installs it (about 5 GB) into
/tmp/comfy_src, or point COMFY_DIR at one (RG_MODELS: the models folder that has Select object's stand-in model, when
it is not ComfyUI's own; the script makes that model when it is missing). This script starts it (CPU, 127.0.0.1:8188), restarts it when Python
or locale files changed (ComfyUI reads those at start), and starts it again when it is found down before a check.
A failed check is never run a second time: a check that only passes on the second try is a bug in the check.

Adding a check: one line in RULES. A rule fires when a changed file matches one of its paths and, where the rule has
a pattern, the changed lines of those files match it. The patterns are deliberately loose: a check too many costs
minutes, a missing one costs a bug.
"""
import argparse
import fnmatch
import os
import re
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out", "verify")
URL = "http://127.0.0.1:8188/"
BOTH = ("", "vue")                      # legacy nodes and Nodes 2.0
ANY_JS = ("js/*.js", "js/editor/*.js")
EXPAND = r"addExpandButton|rg-expand|__rgRehost|hookTextarea|MutationObserver"

# (check, the argument sets it runs with, paths, pattern in the changed lines or None, why)
# Kinds, by the check's name: test_*.py with "comfy" = needs a ComfyUI checkout; real_* / i18n / examples = need the
# running ComfyUI; the rest need neither.
RULES = [
    ("run_py.sh", ("",), ("*.py", "tests/test_*.py", "tests/stubs.py", "locales/*", "tests/i18n_en/*", "example_workflows/*"), None,
     "Python, locale or example files changed"),
    ("run_ui.sh", ("",), ANY_JS + ("tests/ui_*.cjs", "tests/harness/*", "tests/tooltip_rules.cjs"), None,
     "the editor's files changed"),
    ("test_select.py", ("",), ("region_select.py", "tests/make_fake_sam.py"), None, "Select object changed"),
    ("test_control.py", ("",), ("control.py", "pose_map.py", "pose_detect.py"), None, "Control or the pose code changed"),
    ("test_tiled.py", ("",), ("tiled_diffusion.py", "regional_lora.py"), None, "tiled sampling or the regional engine changed"),
    ("real_smoke.cjs", BOTH, ANY_JS + ("*.py",), None, "the pack's code changed"),
    ("real_run_wildcards.cjs", BOTH, ("wildcards.py", "region_genie.py", "regional_lora.py", "js/editor/sizeRow.js", "js/editor/model.js", "js/editor/lifecycle.js"), None,
     "a real run, the size row, old workflows or wildcards may be touched"),
    ("real_fields_popups.cjs", BOTH, ("js/editor/*.js", "js/rg_shared.js", "js/region_genie.js"), None, "the editor changed"),
    ("real_save_image.cjs", BOTH, ("save_image.py", "js/save_image.js", "gen_params.py"), None, "the save node changed"),
    ("real_tooltips.cjs", BOTH, ANY_JS + ("*.py", "tests/tooltip_rules.cjs"), r"title|tooltip|keyTitle|keyed\(", "a tooltip changed"),
    ("real_settings.cjs", ("",), ("js/rg_settings_window.js", "js/rg_keys.js"), None, "the settings window or the shortcut list changed"),
    ("real_settings.cjs", ("",), ANY_JS, r"\bSET\.|RegionGenie\.|SETTINGS_PAGES|addSetting", "a Setting changed"),
    ("real_sockets.cjs", BOTH, ("js/editor/sockets.js", "js/editor/sizeRow.js", "js/editor/lifecycle.js", "js/editor/graph.js"), None,
     "sockets, the size inputs or loading / saving of the node changed"),
    ("real_sockets.cjs", BOTH, ("region_genie.py",), r"INPUT_TYPES|RETURN_|OUTPUT_|\"required\"|\"optional\"", "the node's inputs / outputs changed"),
    ("real_llm_settings.cjs", BOTH, ("llm_enhance.py", "js/rg_llm.js"), None, "the LLM settings changed"),
    ("real_llm_settings.cjs", BOTH, ANY_JS, r"[lL][lL][mM]", "LLM code in the editor changed"),
    ("real_pose_input.cjs", BOTH, ("js/editor/pose.js", "pose_detect.py", "pose_map.py"), None, "the Pose tool or pose detection changed"),
    ("real_number_wheel.cjs", BOTH, ANY_JS, r"wheel|type\s*=\s*[\"']number|numField|rg-num", "a number field or wheel handling changed"),
    ("real_attention.cjs", BOTH, ANY_JS, r"textarea|keydown", "a text field or its key handling changed"),
    ("real_text_boxes.cjs", ("", "vue", "classic", "vue classic"), ("js/region_genie.js", "js/rg_shared.js", "js/rg_llm.js", "js/editor/footer.js", "js/editor/state.js", "js/editor/keys.js"), None,
     "the node's text boxes, Undo or the bottom bar may be touched"),
    ("real_text_boxes.cjs", ("", "vue", "classic", "vue classic"), ANY_JS, EXPAND, "the buttons in a text box's corner changed"),
    ("real_mode_switch.cjs", ("",), ANY_JS, EXPAND, "the buttons in a text box's corner or the watching of text boxes changed"),
    ("real_tiled_upscale.cjs", BOTH, ("js/tiled_upscale.js",), None, "the Tiled Upscale node's script changed"),
    ("real_tiled_upscale.cjs", BOTH, ("tiled_diffusion.py",), r"INPUT_TYPES|\"required\"|\"optional\"|tooltip", "the Tiled Upscale node's inputs changed"),
    ("real_layering.cjs", BOTH, ("js/editor/popups.js", "js/editor/big.js", "js/editor/style.js", "js/rg_tooltip.js", "js/rg_menu.js", "js/rg_colorpicker.js", "wildcards.py"), None,
     "a pop-up, the large editor, the tooltip, a menu or the style sheet changed"),
    ("real_layering.cjs", BOTH, ANY_JS, r"z-index|zIndex|textarea|autocomplete|openMenu|openFloatPopup", "a z-index, a text field or a menu changed"),
    ("real_scene_popup_place.cjs", BOTH, ("js/editor/popups.js", "js/editor/llm.js"), r"editScene|placeBy|popLayout|autoPlace|rg-row scene", "where a pop-up opens changed"),
    ("real_image_compare.cjs", BOTH, ("image_compare.py", "js/image_compare.js"), None, "the Image Compare node changed"),
    ("real_menu_search.cjs", BOTH, ("js/rg_shared.js",), r"deepSearch|menuSearch|MenuSearch|ContextMenu|contextMenu|pickLora|rg-ff-", "a list menu or its search changed"),
    ("i18n_extract.cjs --check", ("",), ("*.py",), r"tooltip|RETURN_NAMES|DISPLAY_NAME|display_name|INPUT_TYPES", "a node text may have changed"),
    ("i18n_extract.cjs --check", ("",), ANY_JS, r"\bSET\.|RegionGenie\.|SETTINGS_PAGES", "a Setting's text may have changed"),
    ("i18n_extract.cjs --check", ("",), ("locales/*", "tests/i18n_en/*", "js/rg_i18n.js"), None, "translations changed"),
    ("real_i18n.cjs", BOTH, ("locales/*", "tests/i18n_en/*", "js/rg_i18n.js"), None, "translations changed"),
    ("make_examples.cjs check", ("",), ("example_workflows/*", "tests/make_examples.cjs", "js/editor/sockets.js", "region_genie.py"), None,
     "the example workflows, the sockets or the node's saved data may be touched"),
]
NEEDS_CHECKOUT = ("test_select.py", "test_control.py", "test_tiled.py")
TIMEOUT = 1200                           # seconds for one check


def sh(*cmd):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True).stdout


def needs(check):
    """What a check needs: 'server' (the running ComfyUI), 'checkout' (ComfyUI's code) or ''."""
    if check.startswith(("real_", "i18n_extract", "make_examples")):
        return "server"
    return "checkout" if check in NEEDS_CHECKOUT else ""


def changed(base):
    mb = sh("git", "merge-base", "HEAD", base).strip() or base
    files = set(sh("git", "diff", "--name-only", mb).split()) | set(sh("git", "ls-files", "--others", "--exclude-standard").split())
    return mb, sorted(files)


def match(path, patterns):
    # "*.py" means the pack's top level only; "locales/*" means everything below it
    for p in patterns:
        if p.endswith("/*") and "/" in p[:-2] or p in ("locales/*", "example_workflows/*"):
            if path.startswith(p[:-1]):
                return True
        elif fnmatch.fnmatchcase(path, p) and path.count("/") == p.count("/"):
            return True
    return False


def diff_lines(mb, files):
    """The added and removed lines of these files (a new, uncommitted file: all of it)."""
    text = sh("git", "diff", "-U0", mb, "--", *files) if mb else ""
    lines = [l[1:] for l in text.splitlines() if l[:1] in "+-" and not l.startswith(("+++", "---"))]
    for f in files:
        if mb and not sh("git", "ls-files", "--", f).strip():
            try:
                lines += open(os.path.join(ROOT, f), errors="ignore").read().splitlines()
            except OSError:
                pass
    return "\n".join(lines)


def plan(files, mb, everything, forced):
    """[(check, args, [why, …])] in the order of RULES, plus a changed test itself."""
    steps = {}

    def add(check, args, why):
        s = steps.setdefault(check, {"args": [], "why": []})
        s["args"] += [a for a in args if a not in s["args"]]
        if why not in s["why"]:
            s["why"].append(why)

    for check, args, paths, pattern, why in RULES:
        hit = [f for f in files if match(f, paths)]
        if everything:
            add(check, args, "--all")
        elif hit and (not pattern or forced or re.search(pattern, diff_lines(mb, hit))):
            add(check, args, why + " (" + ", ".join(hit[:3]) + (", …" if len(hit) > 3 else "") + ")")
    for f in files:                                            # a changed test is run itself
        name = os.path.basename(f)
        if not f.startswith("tests/") or not os.path.exists(os.path.join(ROOT, f)):
            continue
        if re.fullmatch(r"real_\w+\.cjs", name):
            args = next((a for c, a, *_ in RULES if c == name), ("",))
            add(name, args, "the test itself changed")
        elif name in NEEDS_CHECKOUT:
            add(name, ("",), "the test itself changed")
    return [(c, s["args"], s["why"]) for c, s in steps.items()]


def syntax(files):
    """node --check / py_compile for every changed source file. Returns the failures as text."""
    bad = []
    for f in files:
        full = os.path.join(ROOT, f)
        if not os.path.isfile(full):
            continue
        if f.endswith(".js"):
            r = subprocess.run(["node", "--check", "--input-type=module"], stdin=open(full), capture_output=True, text=True)
        elif f.endswith(".cjs"):
            r = subprocess.run(["node", "--check", full], capture_output=True, text=True)
        elif f.endswith(".py"):
            r = subprocess.run([sys.executable, "-m", "py_compile", full], capture_output=True, text=True)
        else:
            continue
        if r.returncode:
            bad.append(f + ": " + (r.stderr.strip().splitlines() or ["syntax error"])[-1])
    return bad


def server_up():
    try:
        urllib.request.urlopen(URL + "system_stats", timeout=3).read()
        return True
    except Exception:
        return False


def start_server(comfy, restart=False):
    if restart:
        subprocess.run(["pkill", "-f", "main.py --cpu"])
        for _ in range(20):
            if not server_up():
                break
            time.sleep(0.5)
    if server_up():
        return True
    log = open(os.path.join(comfy, "comfy.log"), "w")
    subprocess.Popen([sys.executable, "main.py", "--cpu", "--listen", "127.0.0.1", "--port", "8188"], cwd=comfy,
                     stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    for _ in range(120):
        if server_up():
            return True
        time.sleep(2)
    return False


def run(check, arg, env):
    """Run one check. Returns (ok, seconds, FAIL lines, log path)."""
    parts = check.split()
    name = parts[0]
    if name.endswith(".sh"):
        cmd = ["bash", os.path.join("tests", name)]
    elif name.endswith(".py"):
        cmd = [sys.executable, os.path.join("tests", name)]
    else:
        cmd = ["node", os.path.join("tests", name)] + parts[1:]
    cmd += arg.split()
    label = (name.rsplit(".", 1)[0] + " " + " ".join(parts[1:] + arg.split())).strip()
    path = os.path.join(OUT, label.replace(" ", "_").replace("-", "") + ".log")
    t = time.time()
    with open(path, "w") as log:
        try:
            code = subprocess.run(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, env=env, timeout=TIMEOUT).returncode
        except subprocess.TimeoutExpired:
            code = -1
            log.write(f"\nFAIL timed out after {TIMEOUT} s\n")
    text = open(path, errors="ignore").read().splitlines()
    fails = [l for l in text if l.startswith("FAIL")]
    if code and not fails:                                     # a crash: the last lines say why
        fails = [l for l in text if l.strip()][-4:]
    return code == 0, time.time() - t, fails, path, label


def main():
    ap = argparse.ArgumentParser(description="Run the checks that belong to what changed.")
    ap.add_argument("files", nargs="*")
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()

    if a.files:
        mb, files = "", [os.path.relpath(os.path.abspath(f), ROOT) for f in a.files]
    else:
        mb, files = changed(a.base)
    steps = plan(files, mb, a.all, bool(a.files))
    if a.only:
        steps = [s for s in steps if a.only in s[0]]
    runs = [(c, arg, why) for c, args, why in steps for arg in args]
    print(f"{len(files)} changed file(s) against {a.base}" if not a.files else f"{len(files)} file(s) given", end="")
    print(f": {len(runs)} check run(s)" + (" (--all)" if a.all else ""))
    if a.list:
        for c, args, why in steps:
            modes = ", ".join(x or "legacy" for x in args) if len(args) > 1 or args[0] else ""
            print(f"  {c}" + (f"  [{modes}]" if modes else ""))
            for w in why:
                print(f"      {w}")
        return 0

    os.makedirs(OUT, exist_ok=True)
    failed, not_run, passed = [], [], 0
    bad = syntax(files if not a.all else [f for f in sh("git", "ls-files").split() if f.endswith((".js", ".cjs", ".py"))])
    print(("FAIL  syntax\n        " + "\n        ".join(bad)) if bad else "PASS  syntax")
    if bad:
        failed.append("syntax")
    else:
        passed += 1

    comfy = os.environ.get("COMFY_DIR") or "/tmp/comfy_src"
    have = os.path.isfile(os.path.join(comfy, "main.py"))
    env = dict(os.environ, COMFY_DIR=comfy)
    if os.path.isdir("/opt/node-tools/node_modules") and "NODE_PATH" not in env:
        env["NODE_PATH"] = "/opt/node-tools/node_modules"
    restart = any(f.endswith(".py") and "/" not in f or f.startswith("locales/") for f in files)
    # Select object's model: the random-weight stand-in (tests/make_fake_sam.py, 1.75 GB), made once. RG_MODELS says
    # where it is when ComfyUI finds it through its extra_model_paths.yaml; else it goes into ComfyUI's own models
    env.setdefault("RG_MODELS", os.path.join(comfy, "models"))
    sam = os.path.join(env["RG_MODELS"], "checkpoints", "sam3.1_multiplex_fp16.safetensors")
    if have and not a.quick and not os.path.isfile(sam) and any(c in ("test_select.py", "real_smoke.cjs") for c, _, _ in runs):
        print("      (making the stand-in SAM 3.1 model: a minute or two)", flush=True)
        subprocess.run([sys.executable, "tests/make_fake_sam.py", sam], cwd=ROOT, env=env, capture_output=True)
    started = False
    for check, arg, _ in runs:
        need = needs(check)
        label = (check.split()[0].rsplit(".", 1)[0] + " " + " ".join(check.split()[1:]) + " " + arg).strip()
        if need and (a.quick or not have):
            not_run.append(label + (": --quick" if a.quick else f": no ComfyUI in {comfy} (bash tests/setup_real_comfy.sh)"))
            continue
        if need == "server":
            if not started:
                ok = start_server(comfy, restart)
                started = True
            else:
                ok = server_up() or (print("      (ComfyUI was down: started again)") or start_server(comfy))
            if not ok:
                not_run.append(label + f": ComfyUI did not start (see {comfy}/comfy.log)")
                continue
        ok, secs, fails, path, label = run(check, arg, env)
        print(f"{'PASS' if ok else 'FAIL'}  {label}  ({secs:.0f} s)", flush=True)
        if ok:
            passed += 1
        else:
            failed.append(label)
            for l in fails[:8]:
                print("        " + l[:300])
            if len(fails) > 8:
                print(f"        … {len(fails) - 8} more")
            print("        log: " + os.path.relpath(path, ROOT))
    for n in not_run:
        print("NOT RUN  " + n)
    print(f"\n{passed} passed, {len(failed)} failed, {len(not_run)} not run")
    return 1 if failed else 3 if not_run else 0


if __name__ == "__main__":
    sys.exit(main())
