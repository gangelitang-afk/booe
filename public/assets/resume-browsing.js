(() => {
  const storageKey = 'booe:last-visited';
  const pages = Object.freeze({
    "gate": "认识止一",
    "lab": "实验室",
    "play": "一起玩",
    "talk": "来信",
    "india": "印度社会观察",
    "antigravity": "Antigravity 观察",
    "axioms": "43 条决策公理",
    "procurement": "采购机会看板",
    "twenty-four": "24 点",
    "ink-field": "墨流 · 四时行卷"
  });
  const currentPage = location.pathname.replace(/\/$/, '').split('/').pop().replace(/\.html$/, '');
  const isKnownPage = (page) => Object.hasOwn(pages, page);
  const resume = document.getElementById('resume-browsing');

  const recordVisit = () => {
    try { localStorage.setItem(storageKey, currentPage); } catch { /* Browsing still works without storage. */ }
  };

  const showLastPage = () => {
    resume.hidden = true;
    try {
      const page = localStorage.getItem(storageKey);
      if (!isKnownPage(page)) return;
      resume.href = page + '.html';
      resume.textContent = '接着逛 · ' + pages[page];
      resume.hidden = false;
    } catch { /* Hide the shortcut when storage is unavailable. */ }
  };

  if (resume) {
    showLastPage();
    addEventListener('pageshow', showLastPage);
  } else if (isKnownPage(currentPage)) {
    recordVisit();
    addEventListener('pageshow', recordVisit);
  }
})();
