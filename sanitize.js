(function (global) {
  // DOMPurify is loaded separately from a vetted CDN bundle when available
  const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'];
  const ALLOWED_ATTR = { a: ['href', 'target', 'rel'] };

  function basicEscape(str) {
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function sanitizeHTML(input) {
    if (input == null) return '';
    const str = String(input);
    if (global.DOMPurify && typeof global.DOMPurify.sanitize === 'function') {
      return global.DOMPurify.sanitize(str, { ALLOWED_TAGS, ALLOWED_ATTR });
    }
    // Fallback to basic escaping if DOMPurify failed to load
    return basicEscape(str);
  }

  global.sanitizeHTML = sanitizeHTML;
})(globalThis);
