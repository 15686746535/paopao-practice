# -*- coding: utf-8 -*-
"""Collect Mutopia piano piece metadata (title/composer/mid_url/folder) via advsearch."""
import re, json, time, urllib.request, sys

COMPOSERS = {
    "BurgmullerJFF": 30,
    "BachJS": 30,
    "MozartWA": 22,
    "BeethovenLv": 18,
    "ClementiM": 12,
    "CzernyC": 12,
    "SchulzJAP": 8,
    "BachCPE": 5,
    "BehrF": 6,
}
BASE = "https://www.mutopiaproject.org"

def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if i == tries - 1:
                print(f"  FAIL {url}: {e}", file=sys.stderr)
                return ""
            time.sleep(2)

# row block: title row followed by composer row; later a Download row with .mid
ROW = re.compile(
    r"<tr><td>([^<>]+)</td>\s*<td>by ([^<>]+)</td>\s*<td>(.*?)</td>.*?Download:.*?"
    r'href="([^"]+\.mid)"[^>]*>.*?href="([^"]+/)"[^>]*>',
    re.S,
)

def parse(html):
    out = []
    for m in ROW.finditer(html):
        title, composer, opus, mid, folder = (g.strip() for g in m.groups())
        opus = re.sub(r"<[^>]+>", "", opus).strip()
        out.append({"title": title, "composer": composer, "opus": opus,
                    "mid": mid, "folder": folder})
    return out

def main():
    allitems = []
    for comp, limit in COMPOSERS.items():
        items = []
        startat = 0
        while startat < limit:
            url = (f"{BASE}/cgibin/make-table.cgi?startat={startat}&searchingfor="
                   f"&Composer={comp}&Instrument=Piano&Style=&collection=&id="
                   f"&solo=&recent=&timelength=&timeunit=&lilyversion=&preview=1")
            html = fetch(url)
            batch = parse(html)
            if not batch:
                break
            items.extend(batch)
            if len(batch) < 10:
                break
            startat += 10
            time.sleep(0.4)
        print(f"{comp}: {len(items)} piano pieces")
        for it in items:
            it["composer_key"] = comp
        allitems.extend(items)
        time.sleep(0.3)
    # dedupe by folder
    seen, uniq = set(), []
    for it in allitems:
        if it["folder"] in seen:
            continue
        seen.add(it["folder"])
        uniq.append(it)
    with open(r"D:\钢琴\piano_app\mutopia_catalog.json", "w", encoding="utf-8") as f:
        json.dump(uniq, f, ensure_ascii=False, indent=1)
    print(f"total unique: {len(uniq)}")

if __name__ == "__main__":
    main()
