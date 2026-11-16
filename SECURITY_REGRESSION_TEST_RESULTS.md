# DROPBEYND — Security Regression Test Results

**Date:** 2026-11-16
**Run with:** `npm test` in each project folder.

| Suite | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Backend | 116 | 116 | 0 | 0 |
| Frontend | 22 | 22 | 0 | 0 |

Also run: backend and frontend typecheck (0 errors each) and production build (both succeeded).

**Read this first.** These tests prove the rules and the code paths. They do not prove behaviour in a browser, with a real Clerk session, or against real Cloudinary, Sightengine or OpenAI. The "Kind" column says which:

- **HTTP**: the real route code answering real HTTP requests on localhost, with storage, identity and entitlement simulated.
- **Logic**: a pure function called directly.
- **Captured**: real request-building code, with the outgoing request intercepted instead of sent.
- **Sandbox**: the real script run in a Node sandbox, not a browser.
- **Source**: a check on the source text, to stop a regression being reintroduced.

## 1. Required scenarios

| # | Requirement | Test | Kind | Result |
|---|---|---|---|---|
| 1 | Thumbnails on creator profiles | "a thumbnail is always an image…"; "thumbnail lists use the shared component…" | Logic, Source | Pass |
| 2 | Saved and liked lists | Same two tests (`settings.tsx`) | Logic, Source | Pass |
| 3 | Home cards | "home page cards never put a protected or video address in a plain image" | Logic, Source | Pass |
| 4 | Feed video does not download before playback | "a feed video is not downloaded until the viewer presses play" | Logic, Source | Pass |
| 5 | Protected video seeking / streaming | Backend: range forwarded and authorized (existing HTTP test). Frontend: "the streaming worker adds the token…" | HTTP, Sandbox | Pass. **Streaming in a browser not exercised; feature is off.** |
| 6 | Public content uses public CDN | "public posts upload as public CDN assets…"; "streaming is opt-in…" (`direct` for CDN) | Logic | Pass |
| 7 | Protected content is viewer-authorized | Existing media route tests, plus "every refusal and failure…" | HTTP | Pass |
| 8 | No permanent signed URLs in logs | "scanning an image…"; "scanning a video…"; "download, extraction and scanner failures…"; "error text is reduced…" | Logic with recorded logger | Pass |
| 9 | No permanent signed URLs sent to scanners | "the real Sightengine request uploads the image…"; "scanner source…" | Captured, Source | Pass |
| 10 | Media rate limiting | "media requests are rate limited…"; "byte-range playback has its own larger allowance…"; "the production media route has the limiter…" | HTTP, Source | Pass |
| 11 | API tokens never leave the configured backend | "the API client never sends the session token to another site"; worker tests | Logic, Sandbox, Source | Pass |
| 12 | Media retry after Clerk auth is available | "protected media waits for sign-in to load…" | Logic, Source | Pass. **Not exercised with real Clerk.** |

## 2. New backend tests (12)

| Test | What it establishes |
|---|---|
| Error text is reduced to something safe to log | A failed `ffmpeg` command line becomes "external tool failed (code 1)". URLs, signatures, query-string secrets and file paths are removed from other errors. |
| Scanning an image sends bytes to the scanner and never a URL | The scanner receives a buffer. Only the server-side download sees the stored address. No log entry or result contains a URL or signature. |
| Scanning a video extracts frames from a private local file | The extractor is given a local path; the file exists during extraction and is deleted after; the worst frame decides the verdict. |
| Failures go to review and never put a signed URL in a log | Download failure, extractor failure carrying the signed URL in its message, command and stderr, no frames, and both scanners failing: each ends in manual review, with clean logs and the temporary file removed. |
| The real Sightengine request uploads the image | The actual request code posts to the fixed endpoint with no query string, sends the image as a file field, and has no `url` field. The scanner secret appears in no log. |
| Scanner source check | The signed URL is produced in exactly one place; no log call carries a URL or raw error; external tools receive only the local file. |
| Media requests are rate limited | Anonymous: fourth request in the window gets 429 with `no-store`. A different item, extra query parameters, an unknown id and spoofed headers all still get 429. A refused request reaches neither database nor storage. A signed-in viewer has a larger, separate allowance; one viewer does not affect another. |
| Byte-range playback has its own allowance | Twelve range requests succeed and do not consume the whole-file allowance; the thirteenth gets 429 regardless of the range value. Anonymous range requests are limited sooner and refused before any authorization work. |
| The production route has the limiter | The deployed router is built with it, in the order identify, limit, handle. The key does not read the path, query or parameters. |
| Every refusal and failure is uncacheable; Vary is preserved | 401, 403, 404 (removed, missing, unknown kind, non-Cloudinary address) and 502 all return `no-store`, keep `Origin`, `Authorization` and `Cookie` in `Vary`, and reveal nothing about storage. Refused range requests never reach storage. |
| Public posts upload public; subscriber-only and course uploads protected | The upload rule for every type and visibility, and the delivery address each combination produces. |
| Changing visibility never exposes protected media and never fakes a lock | Create and lock rules; unlock keeps the asset protected; the update route cannot change a media address; no application code changes an asset's delivery type. |

The existing fail-closed moderation test still passes against the rewritten scanner.

## 3. New frontend tests (10)

| Test | What it establishes |
|---|---|
| A thumbnail is always an image | Thumbnail first; image posts are their own thumbnail; a protected video with no thumbnail gives a placeholder; documents, text posts and unknown types give placeholders. |
| Home cards | Plain images never receive an API address or a video address; the avatar is used instead. |
| Thumbnail lists use the shared component | Both list pages use it, it renders no plain image, and no file routes a media address into a plain element through a variable. This closes the gap in the earlier check, which only matched media written directly in a tag. |
| A feed video is not downloaded until play is pressed | Manual trigger for video; images wait for visibility; both players use `preload="none"`, no autoplay, and start the download from the play action; downloads are aborted and object URLs released on cleanup. |
| Protected media waits for sign-in and re-asks | No request before Clerk loads; the download effect re-runs when the user or sign-in state changes; each failure has a message and a correct retry flag. |
| The API client never sends the token to another site | Fourteen hostile or malformed addresses are refused, including look-alike hosts and another backend; validation happens before the token is read. |
| The streaming worker handles only this API's media | Token and range added for the two media paths; eleven other requests untouched; query string dropped; redirects refused. |
| The worker when signed out or misconfigured | No token invented; eight bad prefixes make it handle nothing. |
| Streaming is opt-in | Worker mode only while the worker is active; falls back otherwise; no checked-in configuration enables it or cookie media auth. |
| Post uploads match the post's visibility | The uploader sends the visibility; both post uploaders follow the lock switch; a public file cannot be submitted as subscribers-only. |

Two existing frontend assertions were updated because the code they describe changed shape (the player now calls the loader with `{ kind: "video" }`, and the fetch now carries an abort signal). Neither was loosened.

## 4. One test failure during this work

The first frontend run failed "every request goes through the central API client". The cause was an error message of mine that contained the text `fetch()`, which the source scan counted as a direct call. I reworded the message; the scan was not changed.

## 5. Not verified by any test here

- Rendering of thumbnails, placeholders, progress and error states in a browser.
- Real playback, and that no network request occurs before play.
- A real Clerk session on the media route, and the retry once Clerk loads.
- The service worker in Chrome, Firefox and Safari, especially range requests.
- CORS on a deployed backend for the worker's `Range` and `Authorization` headers.
- Cloudinary refusing an unsigned request for a protected asset.
- Sightengine and OpenAI accepting the new request formats.
- `ffmpeg` and `ffprobe` on the Render host.
- Rate limits under real traffic or across more than one backend instance.

## 6. How to reproduce

Backend folder:

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

Frontend folder: the same three commands.
