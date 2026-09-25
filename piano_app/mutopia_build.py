# -*- coding: utf-8 -*-
"""Download Mutopia piano MIDI+RDF, convert to ABC via WSL midi2abc, fix headers, write meta.json."""
import json, re, subprocess, time, urllib.request, os, sys, html as htmlmod

CATALOG = r"D:\钢琴\piano_app\mutopia_catalog.json"
OUTDIR = r"D:\钢琴\曲库\mutopia"
WORK = r"C:\Users\71469\AppData\Local\Temp\mutopia_work"
PER_COMPOSER_CAP = {"BurgmullerJFF": 25, "BachJS": 28, "MozartWA": 18, "BeethovenLv": 16,
                    "CzernyC": 16, "BachCPE": 5, "ClementiM": 0, "SchulzJAP": 0, "BehrF": 4}
COMPOSER_NAMES = {
    "BachJS": "Johann Sebastian Bach", "BachCPE": "C. P. E. Bach",
    "BeethovenLv": "Ludwig van Beethoven", "MozartWA": "Wolfgang Amadeus Mozart",
    "ClementiM": "Muzio Clementi", "BurgmullerJFF": "J. F. F. Burgmüller",
    "CzernyC": "Carl Czerny", "SchulzJAP": "J. A. P. Schulz", "BehrF": "Franz Behr",
}
TOTAL_CAP = 115

def fetch_bin(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                return None
            time.sleep(2)

def wsl_midi2abc(win_path_in, win_path_out):
    cmd = f'midi2abc "$(wslpath \'{win_path_in}\')" -o "$(wslpath \'{win_path_out}\')"'
    r = subprocess.run(["wsl", "-e", "bash", "-c", cmd], capture_output=True, text=True, timeout=120)
    return r.returncode == 0

def rdf_field(rdf, tag):
    m = re.search(rf"<mp:{tag}>(.*?)</mp:{tag}>", rdf, re.S)
    return htmlmod.unescape(m.group(1)).strip() if m else ""

def main():
    os.makedirs(OUTDIR, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    with open(CATALOG, encoding="utf-8") as f:
        catalog = json.load(f)

    counts, picked = {}, []
    for it in catalog:
        ck = it["composer_key"]
        cap = PER_COMPOSER_CAP.get(ck, 10)
        if counts.get(ck, 0) >= cap:
            continue
        picked.append(it)
        counts[ck] = counts.get(ck, 0) + 1
    picked = picked[:TOTAL_CAP]
    print(f"picked {len(picked)} pieces")

    meta, seen_titles = [], set()
    ok, fail = 0, 0
    for i, it in enumerate(picked):
        base = re.sub(r"\.mid$", "", it["mid"].rsplit("/", 1)[-1])
        fname = f"{it['composer_key']}_{base}.abc"
        mid_p = os.path.join(WORK, f"{i}.mid")
        rdf_p = os.path.join(WORK, f"{i}.rdf")
        abc_p = os.path.join(WORK, f"{i}.abc")
        data = fetch_bin(it["mid"])
        if not data or len(data) < 100:
            fail += 1; continue
        with open(mid_p, "wb") as f: f.write(data)
        rdf_b = fetch_bin(it["mid"].rsplit("/", 1)[0] + "/" + base + ".rdf")
        rdf = rdf_b.decode("utf-8", "replace") if rdf_b else ""

        title = rdf_field(rdf, "title") or it["title"]
        licence = rdf_field(rdf, "licence") or "Unknown (Mutopia)"
        dedup_key = (title.lower(), fname.lower())
        if dedup_key in seen_titles:
            continue
        seen_titles.add(dedup_key)

        if not wsl_midi2abc(mid_p, abc_p) or not os.path.exists(abc_p):
            print(f"convert fail: {fname}"); fail += 1; continue
        with open(abc_p, encoding="utf-8", errors="replace") as f:
            body = f.read()
        # validate/repair: require X: and K:
        if not re.search(r"^X:", body, re.M) or not re.search(r"^K:", body, re.M):
            print(f"missing header: {fname}"); fail += 1; continue
        # replace T: line, inject C: after it
        disp_composer = COMPOSER_NAMES.get(it["composer_key"], it["composer_key"])
        body = re.sub(r"^T:.*$", f"T: {title}", body, count=1, flags=re.M)
        if re.search(r"^C:", body, re.M):
            body = re.sub(r"^C:.*$", f"C: {disp_composer}", body, count=1, flags=re.M)
        else:
            body = re.sub(r"^(T: .*)$", rf"\1\nC: {disp_composer}", body, count=1, flags=re.M)
        src_note = (f"% Source: Mutopia Project, {it['folder']}\n"
                    f"% License: {licence}\n"
                    f"% Converted from Mutopia MIDI via midi2abc (Mutopia no longer serves .abc)\n")
        body = re.sub(r"^(X: .*)$", rf"\1\n{src_note}", body, count=1, flags=re.M)

        out_p = os.path.join(OUTDIR, fname)
        with open(out_p, "w", encoding="utf-8", newline="\n") as f:
            f.write(body)
        meta.append({"file": fname, "title": title,
                     "composer": disp_composer,
                     "license": licence,
                     "source": it["folder"],
                     "opus": it.get("opus", ""),
                     "origin": "converted from Mutopia MIDI via midi2abc"})
        ok += 1
        if (i + 1) % 10 == 0:
            print(f"  progress {i+1}/{len(picked)} ok={ok} fail={fail}")
        time.sleep(0.3)

    # zero-size cleanup (paranoia)
    for fn in os.listdir(OUTDIR):
        p = os.path.join(OUTDIR, fn)
        if os.path.isfile(p) and os.path.getsize(p) == 0:
            os.remove(p)
    with open(os.path.join(OUTDIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    from collections import Counter
    print("done ok=", ok, "fail=", fail)
    print("by composer:", dict(Counter(m["composer"] for m in meta)))
    print("by license:", dict(Counter(m["license"] for m in meta)))

if __name__ == "__main__":
    main()
