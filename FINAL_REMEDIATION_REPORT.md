# DROPBEYND — Final Pre-Staging Remediation Report

**Date:** 2026-11-16
**Scope:** the findings in `POST_IMPLEMENTATION_REVIEW.md` (R1–R5, S1–S4, A1, A3) and the public/protected upload split.
**Status:** implemented and verified locally. Nothing was deployed, migrated or run against a real service.

## Verification summary

| Check | Result |
|---|---|
| Backend `npm test` | 116 of 116 pass (was 104) |
| Backend `npm run typecheck` | 0 errors |
| Backend `npm run build` | Succeeded |
| Frontend `npm test` | 22 of 22 pass (was 12) |
| Frontend `npm run typecheck` | 0 errors |
| Frontend `npm run build` | Succeeded; `media-sw.js` is in the output |

Everything above ran on this machine against simulated Cloudinary, Clerk, Razorpay and scanners. No browser, real Clerk session, real Cloudinary account or deployment was involved. `SECURITY_REGRESSION_TEST_RESULTS.md` says, test by test, what was really exercised.

## 1. Issues fixed

### R1 — broken thumbnails

- **Cause:** three places used `thumbnailUrl ?? mediaUrl` in a plain image. For a post with no thumbnail that put a session-protected API address, or a video address, into an `<img>`.
- **Fix:** one rule (`pickThumbnail` in `src/lib/media-logic.ts`) and one component (`src/components/post-thumbnail.tsx`). It shows the thumbnail, or the post itself when it is an image, through the authorizing image component; otherwise a neutral placeholder. A video or document address is never used as an image.
- **Where:** `creator/profile.tsx` (own posts), `settings.tsx` (saved and liked lists), `home.tsx` (cards). Home cards render a plain image, so they never receive an API address; they fall back to the creator's avatar.
- Public Cloudinary addresses are still loaded straight from the CDN.

### R2, R3, R4 — media loading

- **Video is not downloaded because it is in the feed.** Both custom players and the course player fetch nothing until play is pressed. The element uses `preload="none"`; only the poster is shown.
- **Images load when they come near the screen** (400 px margin), not all at once.
- **Progress and errors.** A download shows a percentage. Failures have specific messages (sign in, subscribe, no longer available, too many requests, connection) and a "Try again" button where retrying can help.
- **Cleanup.** A download is cancelled, and its object URL released, when the element is removed or the address changes.
- **Streaming and seeking** for protected video: see section 2. It is implemented as an opt-in that is switched off.

### R5 / A3 — media refused before sign-in finished loading

The loader now waits for Clerk to finish loading before asking, and asks again when the viewer's sign-in state changes. Previously a request made too early was sent without a token, refused, and never repeated.

### S1, S2 — signed Cloudinary URLs in logs and sent to scanners

`src/lib/moderation.ts` was rewritten:

- The server downloads the media itself. The signed URL exists in one line of code and is never returned, logged or passed on.
- Scanners receive **image bytes**: Sightengine as a file upload (credentials in the request body, not the address), OpenAI as inline data.
- Video is saved to a private temporary file; `ffprobe`/`ffmpeg` are given that local path, never a URL. The file is always deleted.
- Errors are reduced by `safeErrorText()` before logging: URLs, signatures and file paths are removed, and a failed tool's command line is dropped.
- Fail-closed behaviour is unchanged: no scanner, or any failure, sends the post to manual review.

### S3 — media rate limiting

A separate limiter (`createMediaLimiter` in `src/lib/rateLimits.ts`) runs after the viewer is identified and before the database or storage is touched.

| Per minute | Signed in | Anonymous (per address) |
|---|---|---|
| Whole-file requests | 300 | 60 |
| Byte-range requests | 1500 | 240 |

- The key is the user id, or the client address when signed out. It does not include the path, query or any client-controlled header, so changing parameters does not give a new allowance.
- Range requests have their own larger allowance, so playback and seeking are not throttled. Adding a `Range` header only moves a request to another bounded allowance.
- Over the limit: 429, `code: RATE_LIMITED`, `Cache-Control: no-store`.

These numbers are my defaults, not measured values. Adjust after observing staging.

### S4 — response headers

- `Vary` is now added to, not replaced, so the CORS layer's `Vary: Origin` survives.
- Every response from the media route is `no-store` unless it is a successful one: 401, 403, 404 (all kinds), 429 and 502.
- Refused range requests never reach Cloudinary (already true; now also tested for the limiter path).

### A1 — token sent to third-party addresses

`apiFetch` validates the address before it reads the token and throws for anything that is not this app's API. All 40-odd call sites already pass API addresses; the two direct Cloudinary uploads never used `apiFetch`.

### Task 6 — public and protected uploads

- The signing endpoint accepts `visibility` for post uploads. `public` stores a normal CDN asset; anything else is protected. Course material is always protected; avatars and covers are always public.
- The post form passes the state of the "subscribers only" switch to the uploader.
- **Creating** a subscriber-only post with a public asset is refused (400, `MEDIA_NOT_PROTECTED`). The form also blocks this before submitting and asks for a fresh upload.
- **Locking** an existing public post whose media is a public asset is refused (409). The asset is not converted. See section 3.
- **Unlocking** is allowed. The asset stays protected and is served to everyone through the API, so nothing is ever moved to public storage.
- Posts that were already locked are not affected by unrelated edits.
- No code in the application changes an asset's delivery type. A test enforces this.

## 2. Issues that need infrastructure changes

| Item | What is needed | State now |
|---|---|---|
| Streaming and seeking for protected video | Browser verification of the service-worker mode on staging, **or** hosting the API on the site's own domain for cookie auth, **or** a video provider with per-viewer signed playback | Opt-in worker mode is implemented and unit-tested but **off**. Default is download-on-play: correct, but a large video must finish downloading before it plays and is held in memory. |
| `VITE_MEDIA_COOKIE_AUTH` | API on the same site as the frontend, and a browser check that Clerk's cookie reaches it | Off. Not enabled, as instructed. |
| Rate limits across multiple backend instances | A shared store (Redis) for the limiter | In-memory per instance. Correct for a single Render instance. |
| Protected media bandwidth | All protected bytes pass through the backend | Inherent to per-viewer authorization without a streaming provider. Public media does not pass through the backend. |

Details and the comparison of approaches are in `MEDIA_PERFORMANCE_ARCHITECTURE.md`.

## 3. Issues that need your explicit approval

1. **Existing Cloudinary assets.** Everything uploaded before the "authenticated" change is still a public CDN asset, including media of locked posts. Fixing that is `protect-existing-media.ts --apply`, which has never been run and will not be without a dry run shown to you and your approval.
2. **Converting an asset when a creator locks a public post.** Refused today. Allowing it means one Cloudinary rename per post (public to authenticated). That modifies a stored asset, so I did not implement it.
3. **Turning on worker streaming** (`VITE_MEDIA_STREAMING=service-worker`) on staging for browser testing.
4. **Media rate-limit numbers** in the table above.
5. Carried over, unchanged: regenerate the live Razorpay secret that was pasted in chat; provide Test Mode keys; decide the legacy-subscriber grace period.

## 4. Trade-offs you should know about

- **Public posts are public at the CDN from upload.** Before this change every post upload was protected. Now a public post's file can be fetched by anyone who has its address, including while it awaits moderation and after it is removed. The address is unguessable and is only shown to the uploader until approval, but removal does not take the file off the CDN. This follows from "public content uses public CDN delivery"; deleting the asset on removal would close it and is a small follow-up.
- **Scanning cost.** The server now downloads each scanned file (up to 15 MB image, 120 MB video; larger goes to manual review) and needs `ffmpeg`/`ffprobe` on the host for video. Without them video goes to manual review.
- **Locking an old public post** no longer works (409). Creators must post again as subscriber-only.

## 5. Simulated versus genuinely exercised

| Genuinely exercised (real code, run here) | Simulated |
|---|---|
| Media route, access decision, limiter, headers, over real HTTP on localhost | Cloudinary (stand-in returns bytes) |
| Scanner orchestration, temp-file handling, error sanitising | Sightengine and OpenAI servers; `ffmpeg`/`ffprobe` |
| The real Sightengine request builder (captured, not sent) | Clerk identity (a test header) |
| Thumbnail, load-timing, failure and API-target rules | A browser: no rendering, playback, IntersectionObserver or service-worker runtime |
| The service worker's logic, run in a Node sandbox | Real service-worker behaviour, especially range requests from `<video>` |
| Full typecheck and production build of both apps | Any deployment |

**Not verified anywhere:** thumbnails rendering in a browser, video playback and progress, the retry after Clerk loads, worker streaming, Cloudinary rejecting unsigned requests for protected assets, Sightengine accepting the upload form.

## 6. Files changed in this round

Backend: `src/lib/moderation.ts` (rewritten), `src/lib/rateLimits.ts`, `src/lib/mediaAccess.ts`, `src/routes/media.ts`, `src/routes/cloudinary.ts`, `src/routes/content.ts`, `src/app.ts` (comment), `src/lib/security.test.ts`.

Frontend: new `src/lib/media-logic.ts`, `src/lib/media-streaming.ts`, `src/components/post-thumbnail.tsx`, `public/media-sw.js`; rewritten `src/components/protected-media.tsx`; edited `src/lib/api-base.ts`, `src/lib/api.ts`, `src/main.tsx`, `src/pages/feed.tsx`, `src/pages/creator-profile.tsx`, `src/pages/creator/profile.tsx`, `src/pages/settings.tsx`, `src/pages/home.tsx`, `src/pages/creator/posts/new.tsx`, `src/components/upload/dropzone-uploader.tsx`, `.env.example`, `src/lib/api-base.test.ts`.

Complete diffs against the original archives (cumulative, all phases): `FINAL_REMEDIATION_DIFF_backend.patch`, `FINAL_REMEDIATION_DIFF_frontend.patch`.

## 7. Not done

- No deployment, migration, Cloudinary change or Razorpay call.
- No git commit: these folders are not repositories. The changes must go to a `staging` branch, not `main`.
- Lesson files, avatars and covers are still not scanned (unchanged, previously recorded).
