# GitHub Lifelines

Type a GitHub username and get a poster of their public projects. Each repo is a line that runs from the day it was created to its last push, coloured by its main language.

**Live:** https://pravin.github.io/lifelines/ · share a poster with `?u=<login>` (add `&forks=1` to include forks).

## How it works

- It's a static page: plain HTML, CSS and JavaScript. There's no build step, no server and no libraries.
- Your browser calls the public GitHub REST API directly (`/users/{u}` and `/users/{u}/repos`, up to 3 pages of 100 repos). Only public data is read. Nothing is stored on a server, and responses are cached in your tab's `sessionStorage`.
- Unauthenticated API calls are limited to 60 an hour per IP address. One poster uses 2–4 calls. If you hit the limit, the page tells you when it resets.
- Big accounts are trimmed to the 40 most interesting non-fork projects (by stars, lifespan, size and recent activity), and the poster says "showing 40 of N". There's a toggle to include forks.
- The poster is one SVG. **Download PNG** rebuilds that SVG with the IBM Plex Mono fonts and the avatar embedded as data URLs, draws it to a canvas at 2× and saves it. The canvas never loads a cross-origin image, so it can always be exported.
- **Share** uses the native share sheet (with the PNG attached where the browser supports it), plus X, LinkedIn and copy-link.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/?u=pravin
```

When you're testing locally you can avoid the rate limit by creating `debug-token.js` (it's gitignored and only loaded on localhost):

```js
window.LL_DEBUG_TOKEN = "<output of `gh auth token`>";
```

## Files

- `index.html`, `style.css`, `js/app.js`: the page, fetching, interaction, export and sharing
- `js/lifelines.js`: turns repos into a model and renders the poster SVG (pure functions)
- `sample.json`: snapshot of @pravin for the example poster on the landing page (`tools/make-sample.sh` refreshes it)
- `og.png`: social preview image, rendered from `tools/og.html` with `tools/shot.mjs`
- `tools/shot.mjs`: dependency-free headless-Chrome screenshot and PNG-export check (Node 22+)
- `fonts/`: IBM Plex Mono and Inter (SIL Open Font License, see `fonts/OFL-*.txt`)

## Deploy

`.github/workflows/pages.yml` publishes the repo root to GitHub Pages on every push to `main`.

## License

MIT © 2026 Pravin Paratey. Fonts are under the SIL OFL 1.1.
