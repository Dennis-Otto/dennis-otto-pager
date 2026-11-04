#!/usr/bin/env bash
# Renders the pictures of this repository in place, for the screenshot bot. After a
# change of main that touches a file of .github/screenshots-paths.txt, after every
# release and every week, the Screenshots workflow runs this script and opens a pull
# request with each picture whose pixels changed; one whose pixels stayed the same
# keeps its file. To see what it would change, run it, then
# `python3 .github/blueprint.py screenshots restore`, which gives every picture that
# looks the same its committed file back, lists the others and corrects the width and
# the height that the pages name for one of another size. It needs Pillow:
# `python3 -m pip install --require-hashes -r .github/screenshots-requirements.txt`.
#
# It renders the social preview, .github/social-preview.png, from
# .github/social-preview.html, and photographs in docs/images/screenshots/, each as
# <name>.png in the light theme and <name>.dark.png in the dark one:
#
# - website: the home page of the website, which it builds with the tools in
#   .venv-docs, as CONTRIBUTING.md sets them up.
#
# Each has a fixed clock, size and data, so that the same code renders the same
# pixels: the clock of the browser stands at CLOCK, its window is 1280×800, and what
# it shows comes from this repository, on a network without a way out. Show a
# picture in the README or on the website with a <picture> whose
# <source media="(prefers-color-scheme: dark)"> is the dark one, and add the pictures of the project in shoot() below: another page, a dialog
# or a feature at work. The bot commits PNG, JPEG, GIF and WebP files, wherever they
# are; list in .github/screenshots-paths.txt the files whose change changes them.
#
# It needs Docker: the browser is the Chromium of the social preview's image, which
# Playwright drives, hash-pinned in .github/screenshots-browser-requirements.txt.
# The blueprint brought it once; it belongs to this project.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

bash scripts/social-preview.sh

pictures=docs/images/screenshots

work="$(mktemp -d)"
# The containers and their network, by a name of this run.
run="screenshots-$$"
cleanup() {
  docker rm --force "$run-browser" >/dev/null 2>&1 || true
  docker network rm "$run" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# The website, built as the Docs workflow builds it, with the tools of its preview.
mkdocs=""
for candidate in .venv-docs/bin/mkdocs .venv-docs/Scripts/mkdocs.exe; do
  if [[ -x "$candidate" ]]; then
    mkdocs="$candidate"
    break
  fi
done
if [[ -z "$mkdocs" ]]; then
  echo "The pictures of the website need its tools in .venv-docs; install them as CONTRIBUTING.md shows." >&2
  exit 1
fi
mkdir "$work/site"
if ! log="$(NO_MKDOCS_2_WARNING=true "$mkdocs" build --site-dir "$work/site" 2>&1)"; then
  printf '%s\n' "$log" >&2
  echo "The website fails to build with $mkdocs; the log above says why." >&2
  exit 1
fi

# Git Bash on Windows: keep the container's paths and mount the Windows paths.
export MSYS_NO_PATHCONV=1
root="$(pwd -W 2>/dev/null || pwd)"
site="$(cd "$work/site" && (pwd -W 2>/dev/null || pwd))"

# The browser: the image of the social preview, which Renovate keeps current, with
# Playwright installed by its hashes. Docker keeps the image until either changes.
browser=dennis-otto-pager-screenshots
if ! log="$(docker build --quiet --tag "$browser" --file - .github 2>&1 <<DOCKERFILE
FROM $(sed -n 's/^FROM //p' .github/social-preview/Dockerfile)
COPY screenshots-browser-requirements.txt /tmp/
RUN pip install --quiet --disable-pip-version-check --root-user-action=ignore \
  --break-system-packages --require-hashes -r /tmp/screenshots-browser-requirements.txt
DOCKERFILE
)"; then
  printf '%s\n' "$log" >&2
  echo "Building the browser of the pictures failed." >&2
  exit 1
fi
# A network without a way out: what the pictures show comes from this repository
# alone, never from a server on the internet that answers differently each time.
docker network create --internal "$run" >/dev/null

# The browser runs in a container on the same network, takes the pictures in /tmp/out
# and hands them over through stdout, so that they belong to whoever runs this.
if ! docker run --rm --interactive --name "$run-browser" --network "$run" \
  --volume "$root:/work:ro" --volume "$site:/site:ro" \
  "$browser" sh -c 'python3 - >&2 && tar -cf - -C /tmp/out .' >"$work/pictures.tar" <<'PYTHON'
"""Takes the pictures with Playwright, each in the light and the dark theme."""

import subprocess
import sys
import time
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

OUT = Path("/tmp/out")
# The clock of the browser: every picture shows this moment.
CLOCK = datetime(2026, 1, 15, 10, 0, tzinfo=UTC)
SIZE = {"width": 1280, "height": 800}


def wait_for(url: str, seconds: int = 600) -> None:
    """Waits until the server at url answers with success."""
    deadline = time.monotonic() + seconds
    while True:
        try:
            with urllib.request.urlopen(url, timeout=10):
                return
        except OSError:
            if time.monotonic() > deadline:
                raise
            time.sleep(2)


def photograph(
    browser: Browser,
    name: str,
    url: str,
    *,
    ready: Callable[[Page], object] = lambda _: None,
    prepare: Callable[[Page], object] = lambda _: None,
    state: dict | None = None,
) -> None:
    """Takes url as name.png in the light theme and name.dark.png in the dark one,
    once ready has seen what the picture shows."""
    for scheme, suffix in (("light", ""), ("dark", ".dark")):
        context = browser.new_context(
            viewport=SIZE,
            device_scale_factor=1,
            color_scheme=scheme,
            locale="en-US",
            timezone_id="Europe/Berlin",
            reduced_motion="reduce",
            storage_state=state,
        )
        page = context.new_page()
        page.clock.set_fixed_time(CLOCK)
        prepare(page)
        # A page that a server still builds may need another load.
        for attempt in range(1, 4):
            response = page.goto(url, wait_until="networkidle")
            if response is not None and not response.ok:
                message = f"{url} answered with the status {response.status}."
                raise RuntimeError(message)
            try:
                ready(page)
                break
            except PlaywrightTimeoutError:
                if attempt == 3:
                    raise
                print(f"{url} was not ready; it loads again.")
        page.wait_for_load_state("networkidle")
        page.evaluate("document.fonts.ready")
        page.screenshot(
            path=OUT / f"{name}{suffix}.png", animations="disabled", caret="hide"
        )
        context.close()
        print(f"Took {name}{suffix}.png of {url}.")


def shoot(browser: Browser) -> None:
    """Every picture of the project."""
    # The website, served from the folder that the script built it in.
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "--bind", "127.0.0.1", "8000"],
        cwd="/site",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for("http://127.0.0.1:8000/", seconds=30)
        photograph(browser, "website", "http://127.0.0.1:8000/")
    finally:
        server.terminate()


OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as playwright:
    # The Chromium of the image, also while Renovate has moved the image a version
    # ahead of Playwright. Its letters have gray edges: the colored ones of LCD text
    # come out differently from run to run.
    found = sorted(Path("/ms-playwright").glob("chromium-*/chrome-linux*/chrome"))
    browser = playwright.chromium.launch(
        executable_path=str(found[-1]) if found else None,
        args=["--disable-lcd-text", "--force-color-profile=srgb"],
    )
    shoot(browser)
    browser.close()
PYTHON
then
  echo "Taking the pictures failed; the lines above say why." >&2
  exit 1
fi
mkdir -p "$pictures"
tar -xf "$work/pictures.tar" -C "$pictures"
echo "Rendered the pictures in $pictures."
