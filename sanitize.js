(function(global){
  const ALLOWED_TAGS = ['b','i','em','strong','a','p','br','ul','ol','li'];
  const ALLOWED_ATTR = { a: ['href','target','rel'] };
  function sanitizeHTML(input){
    if (input === undefined || input === null) return '';
    return DOMPurify.sanitize(input, {ALLOWED_TAGS, ALLOWED_ATTR});
  }
  global.sanitizeHTML = sanitizeHTML;
})(window);
