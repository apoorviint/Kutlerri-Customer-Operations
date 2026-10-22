import sanitizeHtml from "sanitize-html";

/**
 * Email text is untrusted. This keeps ordinary formatting and removes everything that can run or phone home
 * (scripts, event handlers, forms, styles, iframes, javascript: links). The browser also shows it in a sandboxed frame.
 */
export function sanitizeEmailHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  return sanitizeHtml(html, {
    allowedTags: ["a", "b", "strong", "i", "em", "u", "br", "p", "div", "span", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "td", "th", "img", "hr", "pre", "code"],
    allowedAttributes: { a: ["href", "title"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  });
}
