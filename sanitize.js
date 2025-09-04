(function (global) {
  // DOMPurify is loaded separately from a vetted CDN bundle
  const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'];
  const ALLOWED_ATTR = { a: ['href', 'target', 'rel'] };

  function sanitizeHTML(input) {
    if (input == null) return '';
    return global.DOMPurify.sanitize(input, { ALLOWED_TAGS, ALLOWED_ATTR });
  }

  global.sanitizeHTML = sanitizeHTML;
})(globalThis);
