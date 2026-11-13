// The tooltip rules the owner set (round 13), as a check:
//  1. A tooltip that explains several things (options, states, outputs) puts each item on its own line.
//  2. Every sentence starts with a capital letter, also the text after a ":", unless its first word is the name of a
//     field / option / feature that is itself lowercase (scene_prompt_positive, 'image', png, generate …).
// lintTooltip(text, names) returns the problems found (empty when the tooltip follows the rules).
"use strict";

// lowercase words that may start a sentence: names of fields, options, files, units … (plus anything with _ - . / or digits)
const NAMES = new Set(("auto generate edit png webp jpeg jpg avif json none sidecar inside separate whole only image latent model "
    + "clip vae positive negative prompt masks mask index feather invert elements bboxes width height on off x px mp e.g i.e "
    + "etc vs ctrl alt shift enter esc tab region regions scene text object character background control "
    + "denoise strength start end until separation lasso fill wand brush eraser select shape").split(" "));
const isName = (w, names) => {
    const bare = w.replace(/^[('"‘“[]+|[)'"’”\].,;:!?…]+$/g, "");
    if (!bare) return true;
    if (/^['"‘“]/.test(w)) return true;                          // a quoted name: 'image', "positive"
    if (/[_\-./\d<>%=×+]/.test(bare)) return true;                // scene_prompt_positive, 8-bit, x16, .json, %date%
    if (/^[^a-z]/.test(bare)) return true;                        // starts with a capital, a digit or a symbol
    return NAMES.has(bare.toLowerCase()) || (names && names.has(bare));
};
// sentences: after ". " / "! " / "? " / ": " / a line start; not after "e.g." "i.e." "etc." "vs." or a decimal point
function sentenceStarts(line) {
    const out = [];
    const re = /(^|(?<!\b(?:e\.g|i\.e|etc|vs|approx|incl|no|cf))(?<!\.)[.!?](?<!\.\.\.)\s+|:\s+)(?=(\S+))/g;
    let m;
    while ((m = re.exec(line))) {
        if (m[0] === "") re.lastIndex++;                               // the line start (nothing consumed)
        const pre = line.slice(0, m.index + m[1].length);
        if (/\d\.\s+$/.test(pre) && /^\d/.test(m[2])) continue;   // 1. 2. numbering / decimals
        if (/https?:$/.test(line.slice(0, m.index + 1))) continue; // a URL's "https:"
        out.push({ word: m[2], at: m.index + m[1].length, colon: m[1].includes(":") });
    }
    return out;
}
// an item label at the start of a sentence: "On:", "png:", "inside the model (one pass):", "Keep the edits:"
const ITEM = /(?:^|[.;!?]\s+)([^.:;!?()\n]{1,48}?(?:\([^)\n]{0,40}\))?):\s+(?!\/\/)/g;
function lintTooltip(text, names) {
    const problems = [];
    for (const line of String(text || "").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        const label = /^[^:.;!?]{1,48}?(?:\([^)]{0,40}\))?:\s/.test(t);   // "ask before replacing: …": an option name as the item's label
        for (const s of sentenceStarts(t)) {
            if (label && s.at === 0) continue;
            if (!isName(s.word, names)) problems.push(`lowercase start "${s.word}"${s.colon ? " after a colon" : ""}: …${t.slice(Math.max(0, s.at - 30), s.at + 30)}…`);
        }
        const items = [...t.matchAll(ITEM)].filter((m) => !/https?$/.test(m[1]) && !/\d$/.test(m[1].trim()));
        if (items.length >= 2) problems.push(`${items.length} items on one line (${items.map((m) => m[1].trim()).join(" | ")}): put each on its own line`);
    }
    return problems;
}
module.exports = { lintTooltip, isName, sentenceStarts };
