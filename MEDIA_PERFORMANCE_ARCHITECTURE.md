# DROPBEYND — Media Performance Architecture

**Date:** 2026-11-16
**Status:** implemented locally; not exercised in a browser or against real services.

## 1. The constraint

Protected media is authorized for the viewer on every request. An `<img>` or `<video>` element cannot send an `Authorization` header, and the API (Render) is on a different site from the frontend (Vercel), so Clerk's session cookie does not reliably reach it. Something therefore has to attach the viewer's identity to the request. That choice decides performance.

## 2. How media is delivered now

| Media | Path | Passes through backend |
|---|---|---|
| Avatars, covers, thumbnails | Browser to Cloudinary CDN | No |
| Public post, uploaded as public | Browser to Cloudinary CDN | No |
| Public post whose file is a protected asset (unlocked later) | Browser to API to Cloudinary | Yes |
| Subscriber-only post, course lesson | Browser to API to Cloudinary, authorized per request | Yes |

### When bytes are requested

| Element | Trigger | Before the trigger |
|---|---|---|
| Public image | Browser lazy loading | Nothing |
| Protected image | Within 400 px of the screen, and Clerk loaded | Neutral block |
| Public video | Play pressed (`preload="none"`) | Poster (a still rendered by Cloudinary) |
| Protected video | Play pressed | Poster or neutral block; **zero requests** |

### Default protected-video path: download on play

Play starts an authorized download with a progress percentage; playback begins when it completes. The download is cancelled and memory released when the player leaves the page.

Honest limits of this path:

- The whole file downloads before playback. Post uploads are capped at 50 MB and course files at 100 MB.
- The file is held in browser memory while the player exists.
- Seeking works only after the download finishes.

This is not streaming, and it is not presented as streaming.

## 3. Approaches compared

| Approach | Streams and seeks | Viewer-bound | Needs | Verdict |
|---|---|---|---|---|
| **A. Download on play** (default) | No | Yes, every request | Nothing | **In use.** Always works. |
| **B. Service worker adds the token** | Yes | Yes, every range request | Browser verification | **Implemented, off.** Only option that needs no hosting or provider change. |
| **C. API on the site's own domain, Clerk cookie** | Yes, natively | Yes | Custom domain (for example `api.` on the same registrable domain), Clerk configured for it, browser verification | Best long-term for this stack. Infrastructure change. `VITE_MEDIA_COOKIE_AUTH` stays off until then. |
| **D. Video provider with per-viewer signed playback** (Mux, Cloudflare Stream, Bunny) | Yes, adaptive bitrate | Short-lived token per viewer | New provider, re-upload or migration, cost | Best quality and lowest backend load. Largest change. |
| **E. Cloudinary token-based authentication** | Yes | Time-limited, not strictly viewer-bound | Cloudinary premium feature and a custom delivery domain | Not available on the current plan as far as I can tell; confirm with Cloudinary before relying on it. |
| **F. Short-lived signed link in the page** | Yes | **No**: anyone with the link can use it until it expires | Nothing | **Rejected.** This is the bearer-link design that was removed. |
| **G. Link bound to IP address** | Yes | No: shared networks share it, mobile addresses change | Nothing | **Rejected.** |

## 4. The service-worker option (B)

Files: `public/media-sw.js`, `src/lib/media-streaming.ts`. Switch: `VITE_MEDIA_STREAMING=service-worker` at build time. Default: off.

How it works:

1. The page registers the worker with the API's media prefix.
2. A `<video>` element points at the plain media address and makes its own range requests.
3. The worker intercepts only `GET <api>/api/media/post/<id>` and `/lesson/<id>`, asks the page for a fresh Clerk token, and re-issues the request with `Authorization` and the original `Range`.
4. The server authorizes each of those requests exactly as before.

Safeguards, all covered by tests:

- The worker ignores every other request. It does not handle other paths, methods, origins or look-alike hosts.
- A missing, non-HTTPS or malformed prefix makes it handle nothing.
- The token is given only to this origin's controlling worker, and the worker sends it only to the media prefix, with redirects refused.
- If the worker is not in control (first visit, unsupported browser, registration failure), the app silently uses path A.

Why it is off:

- It was run only in a Node sandbox. No browser has executed it.
- Range requests from media elements through a service worker have browser-specific behaviour, Safari in particular.
- The backend's CORS configuration must allow the `Range` and `Authorization` request headers from the frontend's origin. This was not checked against a deployed backend.

To evaluate on staging: set the switch on a staging build, sign in, open a subscriber-only video in Chrome, Firefox and Safari, and confirm in the network tab that playback starts quickly, uses `206` responses, and seeking works. Also confirm a signed-out or non-subscribed viewer gets no video.

## 5. Rate limits and streaming

A playing video makes many range requests. They are counted separately from whole-file requests (1500 per minute signed in, 240 anonymous) so normal playback is not throttled. These are starting values, not measurements.

## 6. Memory and cleanup

- One object URL per loaded protected item; released on unmount or address change.
- In-flight downloads are aborted on unmount.
- Not done: releasing a played video that has scrolled far off screen while its player is still mounted. A long feed session with many played protected videos will hold them in memory. Low effort to add if staging shows it matters.

## 7. Recommendation

1. Go to staging on path A. It is correct and needs nothing.
2. On staging, test path B in the three main browsers. If it holds, enable it.
3. Plan path C (API on your own domain) as the durable fix; it also removes the cross-site cookie dependence elsewhere.
4. Consider path D if video becomes a core product feature or backend bandwidth becomes a cost.

## 8. Scanner performance

The moderation scanner now downloads each file to the server (15 MB image limit, 120 MB video limit) and needs `ffmpeg` and `ffprobe` installed on the backend host for video. If they are missing, or a file exceeds the limit, the post goes to manual review. Check that Render's image includes them before relying on automatic video moderation.
