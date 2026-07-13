# Duplicate-content guardrails

This site is data-driven: everything Frank edits in the CMS lives in `content.json`,
and `index.html` renders those lists (testimonials, pricing, FAQ, etc.) on page load.

## Background: the original duplicate bug (fixed)

The reported duplicate testimonials/pricing were **a code bug, not a CMS mistake**. The
list containers (`#testi-grid`, `#pricing-grid`, `#faq-list`, `#credentials-list`) ship
with static fallback content (so the page still shows something if JS or the fetch fails),
but the render code **appended** the `content.json` entries **without first clearing** the
container. So every JS-enabled visitor got static + CMS = each entry rendered twice
(reproduced on the live site: 6 testimonials, 8 pricing cards, 10 FAQ, 16 credentials —
all doubled). `content.json` itself was clean the whole time.

The fix (Layer 2 below) clears each container before injecting CMS content, so the doubling
can't happen. The other two layers guard against a *different* future risk: a real duplicate
being entered in the CMS.

There are **three independent layers** so a duplicate can neither be deployed nor rendered.

## Layer 1 — Deploy gate (stops duplicates reaching the live site)

`scripts/validate-content.js` scans `content.json` for duplicate entries in:
testimonials, pricing, FAQ, credentials, and research articles.

It runs in two places:

- **Netlify build** (`netlify.toml`) — `command = "node scripts/validate-content.js"`.
  If duplicates are found the build fails and Netlify keeps the previous clean version
  live. **This is the real gate.**
- **GitHub Actions** (`.github/workflows/validate-content.yml`) — puts a visible red ✕ on
  the commit Decap creates when Frank clicks Publish, and covers any future PR workflow.

Run it locally anytime:

```
npm run validate          # or: node scripts/validate-content.js
```

Exit codes: `0` clean · `1` duplicates found (deploy blocked) · `2` unreadable/invalid JSON.

## Layer 2 — Render defense (this is what fixed the original bug)

`index.html` now clears each list container **before** injecting CMS content, then
de-duplicates with `uniqBy(...)`. The clear removes the static fallback so it is never
shown alongside the CMS copy (the original doubling bug), and the dedupe means even a
duplicate that reached `content.json` renders only once. The clear happens only on a
successful fetch, so if `content.json` fails to load the static fallback still shows.
Verified on the live page: rendered counts went from 6/8/10/16 back to the correct
3/4/5/8.

## Layer 3 — Freshness (caching)

So a publish always shows immediately and a stale/duplicate copy is never served:

- `index.html` fetches `content.json?v=<timestamp>` with `cache: 'no-store'`.
- `netlify.toml` sends `Cache-Control: public, max-age=0, must-revalidate` for
  `/content.json`. Netlify purges its CDN on every deploy, so this guarantees the
  newest file is served.

This wasn't the cause of the original bug (that was the render issue in Layer 2), but it
removes caching as a way for a stale or fixed copy to linger after a publish.

## Reusing this for other clients (template)

All three layers are self-contained and travel with the site. To stand up a new client:

1. Copy this repo (`index.html`, `content.json`, `admin/`, `scripts/`, `netlify.toml`,
   `.github/`, `package.json`).
2. Edit `content.json` for the new client (or let them edit via the CMS).
3. Point a new Netlify site at the repo. The guardrails are already wired — no per-client
   setup. `scripts/validate-content.js` and the `uniqBy()` render logic are generic and
   key off collection names, so they work unchanged as long as the JSON shape matches.

If you later centralize, `scripts/validate-content.js` is the one file to share/version
across all client repos (e.g. as a tiny npm package or a git submodule).

## What counts as a "duplicate"

Two tiers, chosen to be foolproof: **block** only on high-confidence duplicates (so a
legitimate publish is never wrongly stopped), and **warn** on fuzzy near-duplicates (so a
human still sees them, but the deploy is never blocked).

- **Block** = case- and whitespace-insensitive exact match.
- **Warn** = looser match that also ignores punctuation, emoji, and spacing
  (e.g. `6 Sessions` vs `6 Sessions.` vs `6  sessions ✨`). Prints in the build log; never fails the build.

| Collection   | Blocks deploy when…                    | Warns when…                          |
|--------------|----------------------------------------|--------------------------------------|
| Testimonials | same name **and** quote                | same name; near-identical quote      |
| Pricing      | same "Sessions" label (e.g. two "6 Sessions") | near-identical sessions label |
| FAQ          | same question                          | near-identical question              |
| Credentials  | identical credential text              | —                                    |
| Research     | same URL, or same title                | —                                    |

Tune the rules in the `COLLECTIONS` array at the top of `scripts/validate-content.js`
(add `severity: 'warn'` to downgrade a rule, `loose: true` for fuzzy matching).

## One thing to confirm

`netlify.toml` sets `publish = "."` (the site is served from the repo root). If your
Netlify **Publish directory** is currently set to something else in the Netlify UI, make
them match — `netlify.toml` overrides the UI.
