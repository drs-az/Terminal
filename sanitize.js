(function(global){
  function sanitize(input){
    if (input === undefined || input === null) return '';
    const div = document.createElement('div');
    div.innerHTML = input;
    return div.textContent || '';
  }
  global.sanitize = sanitize;
})(window);
