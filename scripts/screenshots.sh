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
# .github/social-preview.html, and photographs in docs/images/screenshots/ each chat
# of .github/chat.html, by its id such as chat-alarm-en, as <id>.png in Telegram's
# light theme and <id>.dark.png in its dark one: an alarm with 🔁 Rerun and
# 🛠 Start fix, a contribution with ✍️ Draft a reply and its draft with ✅ Send, a
# green release with 🔀 Merge, and the list of topics, each in English and in German.
# What the chats say comes from .github/chat.js, which test/chat.test.ts writes from
# the texts of the pager, so a changed word of the pager changes the pictures.
#
# Each has a fixed clock, size and data, so that the same code renders the same
# pixels: the clock of the browser stands at CLOCK, a chat is 480 pixels of CSS wide
# at twice the pixels, so that it stays sharp across the width of a phone, and what
# it shows comes from this repository, on a network without a way out. Show a
# picture in the README or on the website with a <picture> whose
# <source media="(prefers-color-scheme: dark)"> is the dark one, at full width. The
# bot commits PNG, JPEG, GIF and WebP files, wherever they are; list in
# .github/screenshots-paths.txt the files whose change changes them.
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

# Git Bash on Windows: keep the container's paths and mount the Windows paths.
export MSYS_NO_PATHCONV=1
root="$(pwd -W 2>/dev/null || pwd)"

# The browser: the image of the social preview, which Renovate keeps current, with
# Playwright installed by its hashes. Docker keeps the image until either changes.
browser=repo-pager-screenshots
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
  --volume "$root:/work:ro" \
  "$browser" sh -c 'python3 - >&2 && tar -cf - -C /tmp/out .' >"$work/pictures.tar" <<'PYTHON'
"""Takes the pictures with Playwright, each in the light and the dark theme."""

from datetime import UTC, datetime
from pathlib import Path

from playwright.sync_api import Browser, sync_playwright

OUT = Path("/tmp/out")
# The clock of the browser: every picture shows this moment.
CLOCK = datetime(2026, 1, 15, 10, 0, tzinfo=UTC)
# The page of the chats, which loads nothing but its own chat.js.
CHAT = "file:///work/.github/chat.html"


def shoot(browser: Browser) -> None:
    """Every picture of the project: each chat of the page, in the light and the
    dark theme, without a background around its round corners."""
    for scheme, suffix in (("light", ""), ("dark", ".dark")):
        context = browser.new_context(
            viewport={"width": 560, "height": 800},
            device_scale_factor=2,
            color_scheme=scheme,
            locale="en-US",
            timezone_id="Europe/Berlin",
            reduced_motion="reduce",
        )
        page = context.new_page()
        page.clock.set_fixed_time(CLOCK)
        page.goto(CHAT, wait_until="load")
        page.evaluate("document.fonts.ready")
        chats = page.locator("section.chat").all()
        if not chats:
            message = f"{CHAT} shows no chat; does .github/chat.js load?"
            raise RuntimeError(message)
        for chat in chats:
            name = chat.get_attribute("id")
            chat.screenshot(
                path=OUT / f"{name}{suffix}.png",
                animations="disabled",
                caret="hide",
                omit_background=True,
            )
            print(f"Took {name}{suffix}.png.")
        context.close()


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
