/* Shared by the app and the build: a short fixed key for one suggestion, report or edit from the sheet,
   so the owner's approve/reject decisions in data/moderation.csv can be matched to it. */
(function (root) {
  function feedbackKey(name, type, link, notes) {
    var s = [name, type, link, notes].map(function (x) { return String(x || '').replace(/\s+/g, ' ').trim().toLowerCase(); }).join('|');
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'k' + h.toString(36);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { feedbackKey: feedbackKey };
  else root.feedbackKey = feedbackKey;
})(this);
