# Layerly — Link to editable Figma design (local app)

**Version:** 1.5.0 local  |  **Runs locally:** Yes  |  **Native Figma import:** Via included development plugin

This is a complete local implementation of a website-to-editable-Figma workflow, not an SVG export trick. It runs a small local server that launches Chrome, reads the rendered website's DOM and computed styles, captures a page preview and available images, and gives a companion Figma plugin a structured capture. That plugin creates **native frames, rectangles, editable text, image fills, paint styles, supported Auto Layout, and button components**.

It will not perfectly convert all websites. See limitations below.

## 1. Launch Layerly

### macOS

1. Download and **unzip** `Layerly-link-to-design.zip` somewhere permanent, like Desktop or Documents.
2. Install **Google Chrome** and **Python 3** if you do not already have them.
3. Double-click **`Start-Layerly.command`**. On macOS, if it gets blocked, right-click → Open, or open Terminal in this folder and run `bash Start-Layerly.command`.
4. Keep the Terminal window open. Your browser should open **http://localhost:4837**.
5. The first run automatically installs the small Playwright Python package in a private `.venv` folder. No global Python packages are changed.

### Windows

1. Unzip the download into a folder.
2. Install **Google Chrome** and **Python 3** (check "Add Python to PATH" in the Python installer).
3. Double-click **`Start-Layerly-Windows.bat`**.
4. Keep the command window open; go to **http://localhost:4837**.
5. The first run installs the Playwright Python dependency automatically in a local virtual environment.

If you see **Could not launch Chrome**, install the latest Google Chrome. If none of Chrome, Edge or locally installed Chromium exists, Playwright's bundled Chromium can be installed with `.venv/bin/python -m playwright install chromium` (macOS), or `.venv\Scripts\python.exe -m playwright install chromium` (Windows).

## 2. Choose either one-screen workflow

### Directly inside Figma (recommended)

1. Keep the Layerly Terminal/command window running. The browser page may be closed.
2. Open the Layerly plugin in Figma, paste the public URL there, choose Auto Layout, editable text, components, clean layers, images and viewport options.
3. Click **Convert & Import**. The plugin starts capture, waits for it and builds the editable design without sending you to another page.

### In the local browser page

1. Paste the public website URL, set the viewport and options, then click **Convert website**.
2. Use the preview to verify the capture. In Figma, choose **Import latest capture**—you do not paste the URL again.

## 3. Install the Figma plugin (one time only)

1. Open the **Figma desktop app** and create/open a normal **Figma Design** file.
2. **Right-click the canvas** → **Plugins** → **Development** → **Import plugin from manifest…**. You can also find this from the Figma main menu.
3. In the file picker, open the **unzipped Layerly folder** → **`figma-plugin`** → select **`manifest.json`**.
4. Figma adds **Layerly — Website to editable design** under **Plugins → Development**. Run it.
5. Paste a URL directly in the plugin and choose **Convert & Import**, or choose **Import latest capture** if you already converted it in the local page.
6. Figma will create an editable design hierarchy on the canvas. If the connection fails, use the `.layerly` backup picker in the plugin.

> If Figma displays a "Plugin ID" dialog, follow its **Generate ID** instructions before re-importing the manifest; Figma controls plugin IDs. The plugin is only installed locally and is not published in the Figma Community.

## 4. Framer

The **Framer handoff** button downloads the page's HTML for **code integration only**, not a native editable Framer canvas. A pragmatic path for editable Framer layers is Figma import first, then the official Figma-to-Framer plugin. Layerly cannot guarantee that route will preserve every style or interaction.

## What the options do

| Option | Conversion behavior |
| --- | --- |
| Auto Layout | Converts eligible `display:flex` containers into Figma Auto Layout frames only when Figma preserves the measured child positions and sizes. Otherwise, the container remains an editable positioned frame. |
| Auto-height text | Optional. Allows text boxes to grow, but the plugin switches any box that changes height by more than 2px back to fixed sizing to protect alignment. Text is editable either way; the default is off for closer visual matching. |
| Components | Converts identified buttons into native Figma component nodes. Not a full design-system extraction. |
| Clean layer tree | Removes generic, visually empty HTML wrappers while retaining layout and styled containers. |
| Color styles | Extracts common CSS colors into Figma paint styles (up to 24). |
| High-res images | Prefers high-resolution `srcset` candidates and converts reachable PNG/JPEG/GIF/WebP/AVIF assets to Figma-ready JPEG/PNG when Pillow supports the source codec. Reachable external SVG images become editable vectors. Blocked or oversized resources may still be missing. |
| Smart layer names | Uses HTML tags and class/ID text for layer names. |
| Hyperlinks | Attempts to retain link targets on text layers. |
| Local Figma styles | Tries to reuse existing matching paint styles from the current Figma document. |
| Hover detection | Records CSS hover selectors, **not** working interactive component variants. |

## Known limitations (important)

- The link must be a site the capture browser can access. Authentication, paywalls, anti-bot tools, cookie popups, lazy-loading behavior and blocked remote resources may interfere.
- Complex websites will require manual design cleanup. Inline and reachable external SVGs become vectors; readable canvas becomes an image fill. WebGL, icon fonts, animations, iframes, grids, pseudo-elements, filters, and sophisticated responsive layouts are not guaranteed to import perfectly.
- **Full page** means the rendered page at one chosen viewport width. It does not automatically create all responsive breakpoints or crawl every linked page.
- The screenshot preview is not the Figma result. Figma layers are reconstructed from DOM measurements and styles.
- Native `.fig` and native editable `.framer` downloads are **not** generated. Figma editable layers are created by its API via the included plugin.
- Fonts that are unavailable in Figma fall back to available fonts.
- Image assets (including WebP and AVIF where Pillow supports the codec) are embedded as Figma-ready PNG/JPEG only when reachable and within limits. External SVG images are sanitized and imported as vector nodes. Files stay on your computer; the captured website is not uploaded to Layerly.
- This is an independent experimental project; it has not been tested end-to-end inside Figma. It is not affiliated with Figma, Framer, or html.to.design.

## Troubleshooting

- **App doesn't open:** ensure the terminal is still running; visit `http://localhost:4837` manually; close any old Layerly window if port 4837 is already in use.
- **Chrome missing:** install Chrome, reopen the starter script.
- **Figma plugin can't connect:** confirm Layerly is running and open in the same computer; alternatively download the `.layerly` backup and select it in the plugin.
- **Plugin says “Failed to fetch” or “engine offline”:** use Layerly 1.5.0 for both the local engine and plugin. Keep the Layerly Terminal window open, then choose **Retry engine connection** in the plugin. If an older plugin is installed, remove it and re-import this version's `figma-plugin/manifest.json` so Figma refreshes its cached network permissions. Layerly explicitly permits `http://localhost:4837` and listens on both IPv4 and IPv6 loopback.
- **Figma plugin fails:** in Figma, use **Plugins → Development → Open console** to find detailed errors; verify you're using the full extracted plugin folder, not only `manifest.json` by itself.
- **Remote URL blocked:** try an ordinary public website first; some sites refuse headless browsers.

## Developer details

App: `server.py` (Python standard-library HTTP server + Playwright), `app/index.html`, `app/style.css`, `app/main.js`, `app/capture.js`.
Figma plugin: `figma-plugin/manifest.json`, `code.js`, `ui.html`.
Local API: `GET /api/status`, `POST /api/capture`, `GET /api/latest`, `GET /api/preview`, `GET /api/download`.
Server binds only to the machine's IPv4 and IPv6 loopback interfaces (`127.0.0.1:4837` and `[::1]:4837`). The local capture file and preview are stored under `output/`.

## Public-page troubleshooting

For `https://aldena.framer.media/`, enter the URL and click **Convert website**. If an error mentions `ERR_BLOCKED_BY_ADMINISTRATOR`, it means the browser/computer/network running Layerly denied navigation before capture began. It does not prove that Aldena blocks conversion. Open the URL in your ordinary Chrome browser, and if it is restricted by organization policies, use an authorized personal environment. Layerly cannot bypass policies.

Version 1.5 measures element bounds to two decimal places, checks actual Figma Auto Layout geometry before keeping it, retains fixed text bounds when font metrics would reflow, and searches the site's full CSS font stack for an available font. The plugin reports how many flex sections were kept positioned to protect alignment. Videos without posters and unsupported WebGL still require manual reconstruction.
