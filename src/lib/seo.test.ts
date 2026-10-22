import { beforeEach, describe, expect, test } from "vitest";
import {
  INDEX_ROBOTS,
  NOINDEX_ROBOTS,
  SITE_URL,
  applySeo,
  breadcrumbList,
} from "./seo";

/**
 * `applySeo` runs against the real `document`, and the project has no DOM test
 * environment, so this file installs the smallest shim that exercises it:
 * elements with attributes, children, and the one selector shape the module
 * uses (`tag[attr="value"]`). What matters here is the behaviour — one
 * canonical per route, description and robots updated in place rather than
 * duplicated, and no JSON-LD left behind after the route unmounts.
 */

class FakeElement {
  tagName: string;
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = "";

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value);
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  appendChild(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  matches(selector: string) {
    const match = /^([a-z]+)\[([a-z-]+)="(.*)"\]$/.exec(selector);
    if (!match) return false;
    const [, tag, attr, value] = match;
    return this.tagName === tag.toUpperCase() && this.attributes[attr] === value;
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

function installDocument() {
  const head = new FakeElement("head");
  (globalThis as unknown as { document: unknown }).document = {
    head,
    title: "",
    createElement: (tagName: string) => new FakeElement(tagName),
  };
  return head;
}

const contentOf = (head: FakeElement, selector: string) =>
  head.querySelector(selector)?.getAttribute("content") ?? null;

const hrefOf = (head: FakeElement, selector: string) =>
  head.querySelector(selector)?.getAttribute("href") ?? null;

const countOf = (head: FakeElement, selector: string) =>
  head.children.filter((child) => child.matches(selector)).length;

describe("applySeo", () => {
  let head: FakeElement;

  beforeEach(() => {
    head = installDocument();
  });

  test("writes the route's title, description and canonical", () => {
    const doc = (globalThis as unknown as { document: { title: string } })
      .document;
    applySeo({
      title: "Terms of Service — Nexa Meet",
      description: "The terms that govern your use of Nexa Meet.",
      path: "/terms",
    });

    expect(doc.title).toBe("Terms of Service — Nexa Meet");
    expect(contentOf(head, 'meta[name="description"]')).toBe(
      "The terms that govern your use of Nexa Meet.",
    );
    expect(hrefOf(head, 'link[rel="canonical"]')).toBe(`${SITE_URL}/terms`);
    expect(contentOf(head, 'meta[property="og:url"]')).toBe(
      `${SITE_URL}/terms`,
    );
    expect(contentOf(head, 'meta[name="robots"]')).toBe(INDEX_ROBOTS);
    expect(contentOf(head, 'meta[property="og:image"]')).toBe(
      `${SITE_URL}/og.png`,
    );
  });

  test("updates the existing tags instead of adding duplicates", () => {
    head.appendChild(new FakeElement("meta")).setAttribute("name", "description");
    head.appendChild(new FakeElement("link")).setAttribute("rel", "canonical");

    applySeo({ title: "Home", description: "Home page.", path: "/" });
    applySeo({ title: "Privacy", description: "Privacy page.", path: "/privacy" });

    expect(countOf(head, 'meta[name="description"]')).toBe(1);
    expect(countOf(head, 'link[rel="canonical"]')).toBe(1);
    expect(hrefOf(head, 'link[rel="canonical"]')).toBe(`${SITE_URL}/privacy`);
    expect(contentOf(head, 'meta[name="description"]')).toBe("Privacy page.");
  });

  test("a path-less page (404) claims no canonical", () => {
    applySeo({
      title: "Page not found",
      description: "No such page.",
      robots: NOINDEX_ROBOTS,
    });

    expect(hrefOf(head, 'link[rel="canonical"]')).toBeNull();
    expect(contentOf(head, 'meta[property="og:url"]')).toBeNull();
    expect(contentOf(head, 'meta[name="robots"]')).toBe(NOINDEX_ROBOTS);
  });

  test("injects JSON-LD and removes it when the route unmounts", () => {
    const cleanup = applySeo({
      title: "Terms of Service — Nexa Meet",
      description: "The terms.",
      path: "/terms",
      jsonLd: [breadcrumbList("Terms of Service", "/terms")],
    });

    const scripts = head.children.filter(
      (child) => child.tagName === "SCRIPT",
    );
    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0].textContent)).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, item: `${SITE_URL}/` },
        { position: 2, item: `${SITE_URL}/terms` },
      ],
    });

    cleanup();
    expect(head.children.filter((c) => c.tagName === "SCRIPT")).toHaveLength(0);
    // The tags the next route needs are left in place.
    expect(hrefOf(head, 'link[rel="canonical"]')).toBe(`${SITE_URL}/terms`);
  });
});
