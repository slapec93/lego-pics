# 🧱 LEGO Pics

Download official LEGO element ("photoreal spin") photos, two ways:

1. **From a BrickLink inventory XML** — for every item (part id + BrickLink colour id)
   it resolves the LEGO element id (PCC) via the Rebrickable elements database and
   downloads its photos.
2. **From a BrickLink part id** — scrapes the part's colour/PCC table on BrickLink
   and downloads photos for the colours you pick.

Images come from LEGO's CDN:
`https://www.lego.com/cdn/product-assets/element.spin.photoreal/{pcc}/0000{n}.png`
(`n` = 1…8; not every element has all 8 frames).

Built as a Node core + an Electron GUI. The inventory pipeline also runs headless
via the CLI.

---

## How the ID resolution works

```
Inventory XML                     BrickLink part id
  ITEMID + COLOR(BrickLink)          |
        |                            v
        |                   scrape bricklink.com/catalogColors  ──► [{color, PCC}]
        v                            |
  BrickLink colour ──► Rebrickable colour   (assets/colors.json)
        |
  part_num + Rebrickable colour ──► element id (PCC)   (elements.csv)
        |   (falls back to design_id for mould variants, e.g. 3069 → 3069b)
        v
   download 0000{1..8}.png  ◄────────┘
```

### Two data sources

| Source | What it gives | Where it comes from |
|---|---|---|
| `assets/colors.json` | BrickLink colour id → Rebrickable colour id + name | Baked from Rebrickable's colours page (see below) |
| `assets/elements.csv` | part + Rebrickable colour → element id (PCC) | [Rebrickable downloads](https://rebrickable.com/downloads/) (`elements.csv`) |

Both are **bundled** in `assets/`, so the app works out of the box. You can point at a
newer `elements.csv` via **Browse…** (or `--csv`) when Rebrickable updates it.

BrickLink's `catalogColors` page gives the PCC directly, so mode 2 needs neither file.

---

## Setup

```bash
npm install
```

That's it — both data files (`assets/elements.csv` and `assets/colors.json`) are
bundled, so there's nothing else to download. Refresh `elements.csv` from Rebrickable's
[downloads page](https://rebrickable.com/downloads/) only when you want newer parts
(drop it in `assets/`, or pick it via **Browse…**). To refresh the colour map, see
"Regenerating the colour map" below.

## Run the app

```bash
npm start
```

- Set **elements.csv** and an **output folder** (remembered between runs).
- **From Inventory XML:** pick the `.xml`, click **Analyze** (see matched/unmatched
  items), then **Download**.
- **From BrickLink Part ID:** type an id (e.g. `3001`), **Look up colors**, tick the
  colours you want, **Download selected**.

Output layout:

```
<output>/6901_Blue_Violet/6584690_00001.png …          # inventory mode
<output>/3001/White_300101/300101_00001.png …          # bricklink mode
```

## Run headless (inventory only)

```bash
node cli/index.js inventory \
  --xml "~/Downloads/inv blue violet.xml" \
  --csv "~/Downloads/elements.csv" \
  --out ./out \
  --concurrency 4
```

(BrickLink mode needs a real browser to scrape, so it lives in the GUI.)

---

## LEGO CDN rate limiting — what I found

There is **no published rate-limit policy** for the
`lego.com/cdn/product-assets/element.spin.photoreal/…` image endpoint — it's a
public CDN asset path (Akamai-fronted), not a documented API.

Empirically (measured while building this):

- **30 concurrent GETs → all HTTP 200 in ~290 ms.** No throttling, no `429`, no
  `Retry-After` observed at that burst level.
- 404 is common and normal — it just means that frame index doesn't exist for the
  element (many have fewer than 8 frames).

So the CDN is tolerant for this kind of use. This app still stays polite by default:

- **Bounded concurrency** (default 4, configurable 1–16).
- **Small randomised jitter** between a PCC's frame requests.
- **Exponential backoff** on `429`/`503`, honouring `Retry-After` if present.

If you ever download thousands of parts, keep concurrency modest (≤8) and let it run;
that's well within what the CDN served without complaint.

**BrickLink** (the `catalogColors` scrape) is the more sensitive endpoint — it's a
normal web page, not a CDN. Mode 2 loads exactly **one page per part id**, so it's
naturally gentle; avoid hammering it in a tight loop.

**Rebrickable's `/colors/` page** is behind Cloudflare's "verify you are human"
(Turnstile) challenge and cannot be scraped by an automated browser — which is why
the colour map is baked once from a saved copy of the page rather than fetched live.

---

## Regenerating the colour map

Because Rebrickable's colours page is Cloudflare-protected, refresh it from a saved
copy (a one-time manual step, needed only when LEGO adds new colours):

1. Open <https://rebrickable.com/colors/> in your browser, solve the check.
2. **File → Save As → "Web Page, Single File" (`.mhtml`)** (or HTML) to e.g.
   `~/Downloads/colors.mhtml`.
3. Rebuild the map:
   ```bash
   npm run colors -- "~/Downloads/colors.mhtml"
   ```
   This decodes the page (MHTML is a sandboxed MIME archive, so it's decoded in Node
   rather than run in the browser), extracts BrickLink↔Rebrickable colour ids, and
   writes `assets/colors.json`.

---

## Project layout

```
src/core/        pure Node logic (no Electron): parse XML, index elements,
                 colour map, resolve PCCs, download images
src/scrape/      browser-side extractors + MHTML decoder
electron/        main process, preload, config, Cloudflare-free scraper (BrowserWindow)
renderer/        GUI (HTML/CSS/JS)
cli/             headless inventory downloader
scripts/         parse-saved-rb.js (rebuild colour map), smoke-app.js
test/            unit tests (node --test)
assets/          colors.json (generated, committed)
```

## Tests

```bash
npm test
```
