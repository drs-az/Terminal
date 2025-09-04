(function(global){
  function clean(node, allowedTags, allowedAttrs){
    const children = Array.from(node.children);
    for(const child of children){
      const tag = child.tagName.toLowerCase();
      if(!allowedTags.has(tag)){
        // Replace the node with its children
        child.replaceWith(...Array.from(child.childNodes));
      }else{
        const attrs = Array.from(child.attributes);
        const allowed = allowedAttrs[tag] || [];
        for(const attr of attrs){
          if(!allowed.includes(attr.name.toLowerCase())){
            child.removeAttribute(attr.name);
          }
        }
        clean(child, allowedTags, allowedAttrs);
      }
    }
  }

  function sanitize(dirty, opts){
    opts = opts || {};
    const allowedTags = new Set((opts.ALLOWED_TAGS || []).map(t=>t.toLowerCase()));
    const allowedAttrs = {};
    for(const key in (opts.ALLOWED_ATTR || {})){
      allowedAttrs[key.toLowerCase()] = (opts.ALLOWED_ATTR[key] || []).map(a=>a.toLowerCase());
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(dirty, 'text/html');
    clean(doc.body, allowedTags, allowedAttrs);
    return doc.body.innerHTML;
  }

  global.DOMPurify = {sanitize};
})(typeof window !== 'undefined' ? window : globalThis);
