// The brand of the website: the mark of the social preview, a speech bubble with a
// bell, is the logo in its header and the icon of its tab, so that the website,
// the preview of a link and the hub of the owner show the same picture.
import { describe, expect, it } from "vitest";

import preview from "../.github/social-preview.html?raw";
import logo from "../docs/assets/logo.svg?raw";
import website from "../mkdocs.yml?raw";

/** The drawing of an SVG: the d of each of its paths, in order. */
const paths = (svg: string) =>
  [...svg.matchAll(/<path d="([^"]+)"/g)].map(([, d]) => d);

describe("the brand of the website", () => {
  it("names the logo as the logo and the favicon of the theme", () => {
    // The theme of mkdocs.yml adds to that of the blueprint, which sets no logo.
    const theme = /^theme:\n((?: {2}.*\n)+)/m.exec(website)?.[1] ?? "";
    expect(theme).toMatch(/^ {2}logo: assets\/logo\.svg$/m);
    expect(theme).toMatch(/^ {2}favicon: assets\/logo\.svg$/m);
  });

  it("draws the mark of the social preview", () => {
    const mark = /<div class="logo">(<svg[\s\S]*?<\/svg>)/.exec(preview)?.[1];
    expect(mark).toBeDefined();
    expect(paths(logo)).toHaveLength(3);
    expect(paths(logo)).toEqual(paths(mark ?? ""));
    // The same colors of the bubble.
    const stops = (svg: string) =>
      [...svg.matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map(([, c]) => c);
    expect(stops(logo)).toEqual(stops(mark ?? ""));
    // A name for readers of the screen, and no font or script that a favicon lacks.
    expect(logo).toMatch(/role="img" aria-label="Repo Pager"/);
    expect(logo).not.toMatch(/<script|<text|href="http/);
  });
});
