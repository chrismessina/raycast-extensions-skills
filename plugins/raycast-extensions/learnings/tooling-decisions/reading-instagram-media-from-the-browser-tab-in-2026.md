---
title: "Reading Instagram media in 2026: read the open browser tab through the Raycast Browser Extension, not a download service"
date: 2026-10-30
last_updated: 2026-10-31
applies_to: ["develop"]
trigger: "when you are about to read Instagram media, or any signed-in page, through `BrowserExtension.getContent`, or rely on a third-party downloader API"
category: tooling-decisions
module: BrowserExtension
component: instagram-media-downloader
problem_type: tooling-decisions
applies_when:
  - "Building or maintaining an extension that downloads Instagram posts, reels, stories or highlights"
  - "An integration depends on a third-party 'downloader' API (ab-downloader, btch-downloader, followmeter, fastdl and similar) that returns 401/503 or stops resolving"
  - "Reading any signed-in web page's embedded data with BrowserExtension.getContent, especially a single-page app that changes the URL without reloading"
  - "Instagram's signed-out web query (graphql/query with doc_id) answers HTTP 401 'Please wait a few minutes before you try again'"
tags:
  - instagram
  - browser-extension
  - getcontent
  - meta
  - spa-navigation
  - third-party-api
  - rate-limiting
  - privacy
  - raycast
  - "http-401"
---

# Reading Instagram media in 2026: read the open browser tab through the Raycast Browser Extension, not a download service

## Context

`instagram-media-downloader` resolved media through two anonymous third-party services. Both failed while
[#32976](https://github.com/raycast/extensions/pull/32976) was being built (merged 2026-10-31):

- **Posts and reels used ab-downloader** (`backend1.tioo.eu.org/igdl`, the npm package `ab-downloader`, which
  sends a `btch/<version>` User-Agent copied from `btch-downloader`). It failed most calls: usually HTTP 200 with the
  bare JSON string `"Request Failed With Code 401"`, sometimes a 503, and on one day 503 on every path including its
  root. The npm package is a 433-line axios wrapper with no install scripts; the risk is the server, which sees every
  link and chooses the URL the extension then downloads. `btch-downloader` is the same shape: an open-source client
  for a closed server.
- **Stories and highlights used followmeter.app**, whose domain stopped resolving (whois still listed the domain as
  active, but there were no nameservers), so both story commands failed with `getaddrinfo ENOTFOUND` for every user.

Services like these ask Instagram on the caller's behalf, typically spreading requests across many addresses and
throwaway accounts, which is why they work until they are blocked. Asking Instagram's signed-out web query directly
from the user's Mac (the extension's own pre-July code: `graphql/query`, `doc_id` `8845758582119845`, `X-IG-App-ID`)
needs no middleman, but the first request from a home network can answer HTTP 401
`{"message":"Please wait a few minutes before you try again.","require_login":true,"status":"fail"}`. It is still
useful as a fallback, not as the main path.

Fetching instagram.com with a search-crawler User-Agent also returns the full embedded JSON, and the Threads
extension uses that approach on threads.com. It was rejected here as bot-check circumvention.

## Guidance

**Read the post, story or highlight from the user's own open tab.** `BrowserExtension.getContent({ format: "html",
tabId })` returns the whole document, about 1–2 MB, in 17–66 ms as measured, including the
`<script type="application/json">` blocks Instagram renders the signed-in page from. The CDN links in them are signed
(`oh`/`oe` query parameters, `oe` = hex Unix expiry, days out) and download without cookies. Nothing leaves the Mac but
the media downloads themselves, and stories and highlights, which only exist in a signed-in page, work too.

What to get right:

1. **Read only a tab showing exactly the requested page.** The HTML also carries the user's signed-in feed. Parse the
   tab URL with the same strict parser as the user's input (exact hosts, `/p|reel|reels/<code>` with an optional
   `/<user>/` prefix), compare shortcodes, and read active tabs first. `active` is per window, so read every match
   until one has the whole post (`extensions/instagram-media-downloader/src/browser-tab.ts:67-78`).
2. **Judge every match for completeness; never take the first.** A page names a post in several nodes, and the first
   is often a feed stub. A reel stub has about 30 keys, `media_type: 2` and only the poster image, with no
   `video_versions`; taking it saves the poster as the "video". Require `video_versions` for video, and for a carousel
   require `carousel_media_count === carousel_media.length` and a known `media_type` on every child
   (`src/instagram-post.ts:169`). When two complete nodes disagree, treat it as a miss, not a guess.
3. **Client-side navigation is the common miss, and only the user can fix it.** Clicking a post in Instagram (from the
   feed, a profile grid or the saved page) changes the URL without loading the post's page. The tab then matches the
   shortcode but its HTML holds the previous page: you find a stub (`incomplete`) or no node at all (`not-found`).
   Reloading the tab (⌘R) or opening the link in a new tab fixes it. Say so in the error, and offer an action that
   opens the link in a new tab and polls `getContent` until the page has the post
   (`src/download-media.ts:302`, `watchBrowser`).
4. **Story and highlight shapes differ from posts.** A story page has `xdt_api__v1__feed__reels_media.reels_media[]`;
   match the reel by `user.username` (case-insensitive), and the story is the item whose `pk` equals the id in the
   link. A highlight page has `xdt_api__v1__feed__reels_media__connection.edges[].node` with `id: "highlight:<id>"`
   and every item present (`page_info.has_next_page: false`). Match a story tab by username, not story id: a playing
   story advances the URL to the next story (`src/instagram-reel.ts:49-51`).
5. **Story `video_versions` carry no dimensions.** Each entry has only `type` (101, 102, 103) and `url`. In the
   captured pages every type decoded to the same encode (the URL's base64 `efg` parameter names it, e.g.
   `…dash_baseline_1080p_v1`), so take the first; there is no width to rank by (`src/instagram-post.ts:133`).
6. **Check expiry before downloading.** A tab left open long enough holds links whose `oe` has passed; a whole carousel
   downloads in sequence, so require an hour of headroom and treat anything less as a miss
   (`src/instagram-post.ts:43`).
7. **Bound every Browser Extension call and turn every failure into a miss.** `getTabs` and `getContent` can hang, and
   a host error can throw synchronously; wrap the call in `Promise.resolve().then(op)` and race it against a timeout
   (2 s for tabs, 4 s for content; `src/browser-tab.ts:15-17`). Gate on
   `environment.canAccess(BrowserExtension)`, which also covers Windows, where the API does not exist
   (`src/browser-tab.ts:42`). With the extension installed but the browser not focused, calls fail with "Could not
   connect to the Browser Extension. Make sure a Browser Tab is focused". Opening the link with `open()` focuses the
   browser, and the next poll succeeds.

## Why This Matters

The download services fail for every user at once and without warning, and they see every link the user downloads.
The browser path fails only for the one user whose tab is wrong, in a way the user can fix in a second (reload, or
press the open-in-new-tab action), and the error can say exactly that. Getting step 2 wrong produces the worst failure
here: a success toast for a JPEG poster saved where a video was expected.

## When to Apply

- Any Raycast extension that downloads from Instagram, or reads Threads or another Meta property, whose pages embed
  the same JSON shape.
- Any extension that reads a signed-in page with `getContent`: the exact-tab rule, completeness judgment, bounded calls
  and the client-side-navigation miss are not Instagram-specific.
- Not when the user cannot be expected to have the page open (a background or scheduled command). There the direct
  signed-out query is the only option, and its rate limit is the cost.

## Examples

How the misses read in a log, and what fixes each (`BrowserMissReason` in `src/browser-tab.ts`):

| Miss | Typical cause | User's fix |
| --- | --- | --- |
| `unavailable` | Browser Extension not installed, or Windows | Install it (the extension links to `raycast.com/browser-extension`) |
| `error` (…a Browser Tab is focused) | Browser not running or not focused | Open the link; the opened tab focuses the browser |
| `no-tab` | No tab shows that post | Open the link in a new tab |
| `not-found` / `incomplete` | Reached by clicking inside Instagram | Reload the tab, or open the link in a new tab |
| `expired` | Tab open for days | Reload the tab |

A related development-mode trap hit the highlight view in the same work: an `unmounted` ref set in a `useEffect`
cleanup stayed `true` after Raycast's development renderer replayed the effect, so every read was discarded and the
view never filled. Reset the ref at the top of the effect and cancel each read with its own mount's local flag
(`src/download-instagram-highlight-story.tsx:129`). See [`CONCEPTS.md`](../../../../CONCEPTS.md) → *Development
renderer replay*.

All `src/` paths above are under `extensions/instagram-media-downloader/` in `raycast/extensions`, as of
[#32976](https://github.com/raycast/extensions/pull/32976).
