(() => {
  const puzzles = [
    [1, 2, 3, 4], [2, 2, 6, 6], [1, 3, 4, 6], [3, 3, 8, 8],
    [1, 5, 5, 5], [2, 3, 4, 5], [2, 5, 5, 9], [3, 4, 6, 8],
    [1, 2, 7, 8], [2, 2, 3, 9], [4, 4, 7, 7], [1, 6, 6, 8],
    [2, 3, 5, 7], [3, 5, 7, 9], [4, 5, 6, 7], [1, 3, 7, 9]
  ];

  // Keep results as exact fractions so expressions with thirds can reach 24.
  function calculate([a, b], op, [c, d]) {
    switch (op) {
      case '+': return [a * d + b * c, b * d];
      case '-': return [a * d - b * c, b * d];
      case '*': return [a * c, b * d];
      case '/': return c === 0 ? null : [a * d, b * c];
    }
  }

  const isTwentyFour = ([numerator, denominator]) => numerator === 24 * denominator;
  const symbols = { '+': '+', '-': '−', '*': '×', '/': '÷' };

  function solve(items, first = '') {
    if (items.length === 1) {
      return isTwentyFour(items[0].value) ? { answer: items[0].text, first } : null;
    }
    for (const [i, left] of items.entries()) {
      for (const [j, right] of items.entries()) {
        if (i === j) continue;
        const rest = items.filter((_, index) => index !== i && index !== j);
        for (const [op, symbol] of Object.entries(symbols)) {
          const value = calculate(left.value, op, right.value);
          if (!value) continue;
          const step = left.text + ' ' + symbol + ' ' + right.text;
          const answer = solve([...rest, { value, text: '(' + step + ')' }], first || step);
          if (answer) return answer;
        }
      }
    }
    return null;
  }

  const normalize = (text) => text.replace(/−/g, '-').replace(/[×＊]/g, '*')
    .replace(/[÷／]/g, '/').replace(/（/g, '(').replace(/）/g, ')');

  function checkExpression(input, numbers) {
    const text = normalize(input);
    if (/[^1-9+*/()\s-]/.test(text)) throw new Error('请只使用题目数字、四则运算符和括号。');
    const tokens = text.match(/[1-9]+|[+*/()-]/g) || [];
    const used = tokens.filter(token => /^[1-9]+$/.test(token)).sort().join(',');
    if (used !== [...numbers].sort().join(',')) throw new Error('请把题目的四个数字各用一次。');

    let index = 0;
    const invalid = () => new Error('算式还不完整，请检查运算符和括号。');
    function term() {
      const token = tokens[index++];
      if (/^[1-9]$/.test(token || '')) return [Number(token), 1];
      if (token !== '(') throw invalid();
      const value = expression();
      if (tokens[index++] !== ')') throw invalid();
      return value;
    }
    function combine(readOperand, operators) {
      let value = readOperand();
      while (operators.includes(tokens[index])) {
        const op = tokens[index++];
        value = calculate(value, op, readOperand());
        if (!value) throw new Error('除数不能为 0，请换一种算法。');
      }
      return value;
    }
    const product = () => combine(term, ['*', '/']);
    const expression = () => combine(product, ['+', '-']);
    const result = expression();
    if (index !== tokens.length) throw invalid();
    return isTwentyFour(result);
  }

  const form = document.getElementById('game');
  const input = document.getElementById('expression');
  const tiles = document.getElementById('numbers');
  const result = document.getElementById('result');
  const hint = document.getElementById('hint');
  let remaining = [];
  let current = -1;
  let solution;
  let puzzle;

  function message(text = '', state = '') {
    result.textContent = text;
    result.dataset.state = state;
  }

  function updateInput() {
    const used = normalize(input.value).match(/[1-9]/g) || [];
    for (const tile of tiles.children) {
      const index = used.indexOf(tile.dataset.token);
      tile.disabled = index !== -1;
      if (tile.disabled) used.splice(index, 1);
    }
    message();
  }

  function nextPuzzle() {
    if (!remaining.length) remaining = puzzles.map((_, index) => index).filter(index => index !== current);
    const choice = Math.floor(Math.random() * remaining.length);
    [current] = remaining.splice(choice, 1);
    puzzle = puzzles[current];
    solution = solve(puzzle.map(number => ({ value: [number, 1], text: String(number) })));
    tiles.replaceChildren(...puzzle.map(number => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.textContent = tile.dataset.token = String(number);
      return tile;
    }));
    input.value = '';
    hint.textContent = '提示';
    message();
  }

  form.addEventListener('click', (event) => {
    const token = event.target.dataset.token;
    if (!token) return;
    const { selectionStart, selectionEnd } = input;
    if (input.value.length - (selectionEnd - selectionStart) >= input.maxLength) return;
    input.setRangeText(token, selectionStart, selectionEnd, 'end');
    updateInput();
    if (event.target.disabled) input.focus({ preventScroll: true });
  });
  input.addEventListener('input', updateInput);
  document.getElementById('clear').addEventListener('click', () => {
    input.value = '';
    updateInput();
  });
  document.getElementById('undo').addEventListener('click', () => {
    const { selectionStart, selectionEnd } = input;
    if (selectionEnd > 0) {
      const start = selectionStart === selectionEnd ? selectionStart - 1 : selectionStart;
      input.setRangeText('', start, selectionEnd, 'end');
      updateInput();
    }
  });
  hint.addEventListener('click', () => {
    if (hint.textContent === '提示') {
      message('可以先算 ' + solution.first + '。');
      hint.textContent = '看答案';
    } else {
      message(solution.answer.slice(1, -1) + ' = 24');
    }
  });
  document.getElementById('next').addEventListener('click', nextPuzzle);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      if (checkExpression(input.value, puzzle)) {
        message('算对了！可以换一题继续。', 'win');
      } else {
        message('这道算式没有得到 24，再试试。', 'error');
      }
    } catch (error) {
      message(error.message, 'error');
    }
  });
  nextPuzzle();
})();
