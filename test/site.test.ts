import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript build script, without type declarations.
import { buildSite, PAGES, slugify } from "../scripts/build-site.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("the docs site", () => {
  it("builds every page, and every link points at a page or a file that exists", async () => {
    const out = mkdtempSync(join(tmpdir(), "holdsend-site-"));
    const pages: string[] = await buildSite(out);
    expect(pages.length).toBeGreaterThan(10);
    expect(existsSync(join(out, ".nojekyll"))).toBe(true);

    for (const page of pages) {
      const html = readFileSync(join(out, page), "utf8");
      expect(html, page).toMatch(/<title>[^<]*HoldSend[^<]*<\/title>/);
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        if (href!.startsWith("#")) {
          expect(html, `${page} links to missing anchor ${href}`).toContain(`id="${href!.slice(1)}"`);
          continue;
        }
        const repoPath = /^https:\/\/github\.com\/zyakuhq\/holdsend\/(?:blob|tree)\/main\/([^#]+)/.exec(href!);
        if (repoPath) {
          expect(existsSync(join(root, repoPath[1]!)), `${page} links to missing ${repoPath[1]}`).toBe(true);
          continue;
        }
        if (/^[a-z]+:/i.test(href!)) continue;
        const [path, anchor] = href!.split("#");
        const target = resolve(dirname(join(out, page)), path!);
        expect(existsSync(target), `${page} links to missing ${href}`).toBe(true);
        if (anchor && target.endsWith(".html")) {
          expect(readFileSync(target, "utf8"), `${page} links to missing anchor ${href}`).toContain(`id="${anchor}"`);
        }
      }
    }
  });

  it("lists every decision and every audit", () => {
    const listed = new Set<string>(PAGES.flatMap(([, pages]: [string, [string, string][]]) => pages.map(([, source]) => source)));
    for (const dir of ["docs/decisions", "docs/audits"]) {
      for (const name of readdirSync(join(root, dir)).filter((n) => n.endsWith(".md"))) {
        expect(listed.has(`${dir}/${name}`), `${dir}/${name} is not in PAGES of scripts/build-site.mjs`).toBe(true);
      }
    }
  });

  it("gives headings the ids GitHub gives them", () => {
    const seen = new Map();
    expect(slugify("What 1.0 needs before the README changes", seen)).toBe("what-10-needs-before-the-readme-changes");
    expect(slugify("The stored item format", seen)).toBe("the-stored-item-format");
    expect(slugify("0.2 to 0.3 (not released yet)", seen)).toBe("02-to-03-not-released-yet");
    expect(slugify("Limits", seen)).toBe("limits");
    expect(slugify("Limits", seen)).toBe("limits-1");
  });
});
