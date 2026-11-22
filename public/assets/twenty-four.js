(() => {
  const puzzles = [
    [1, 2, 3, 4], [2, 2, 6, 6], [1, 3, 4, 6], [3, 3, 8, 8],
    [1, 5, 5, 5], [2, 3, 4, 5], [2, 5, 5, 9], [3, 4, 6, 8],
    [1, 2, 7, 8], [2, 2, 3, 9], [4, 4, 7, 7], [1, 6, 6, 8],
    [2, 3, 5, 7], [3, 5, 7, 9], [4, 5, 6, 7], [1, 3, 7, 9]
  ];
  const symbols = { '+': '+', '-': '−', '*': '×', '/': '÷' };

  function simplify(numerator, denominator) {
    let a = Math.abs(numerator);
    let b = Math.abs(denominator);
    while (b) [a, b] = [b, a % b];
    const divisor = denominator < 0 ? -a : a;
    return [numerator / divisor, denominator / divisor];
  }

  function calculate([a, b], op, [c, d]) {
    switch (op) {
      case '+': return simplify(a * d + b * c, b * d);
      case '-': return simplify(a * d - b * c, b * d);
      case '*': return simplify(a * c, b * d);
      case '/': return c === 0 ? null : simplify(a * d, b * c);
    }
  }

  const display = ([n, d]) => d === 1 ? String(n) : n + '/' + d;
  const equals24 = ([n, d]) => n === 24 * d;
  const stepText = (left, op, right) => display(left) + ' ' + symbols[op] + ' ' + display(right);

  function solve(cards, firstStep = '') {
    if (cards.length === 1) {
      return equals24(cards[0].value) ? { firstStep, expression: cards[0].expression } : null;
    }
    for (const [i, left] of cards.entries()) {
      for (const [j, right] of cards.entries()) {
        if (i === j) continue;
        const rest = cards.filter((_, index) => index !== i && index !== j);
        for (const op of Object.keys(symbols)) {
          const value = calculate(left.value, op, right.value);
          if (!value) continue;
          const expression = '(' + left.expression + symbols[op] + right.expression + ')';
          const solution = solve([...rest, { value, expression }], firstStep || stepText(left.value, op, right.value));
          if (solution) return solution;
        }
      }
    }
    return null;
  }

  const tiles = document.getElementById('numbers');
  const operators = document.getElementById('operators');
  const prompt = document.getElementById('selection-prompt');
  const result = document.getElementById('result');
  const undo = document.getElementById('undo');
  const hint = document.getElementById('hint');
  const next = document.getElementById('next');
  const seal = document.getElementById('win-seal');
  const moves = document.getElementById('moves');
  const remaining = [];
  const history = [];
  let current = -1;
  let cards = [];
  let selected = [];
  let feedback = '';
  let hintShown = false;
  let mergedIndex = -1;

  function render() {
    const finished = cards.length === 1;
    const won = finished && equals24(cards[0].value);
    tiles.replaceChildren(...cards.map((card, index) => {
      const button = document.createElement('button');
      const order = selected.indexOf(index);
      const value = display(card.value);
      button.type = 'button';
      button.dataset.index = index;
      button.textContent = value;
      button.disabled = finished;
      button.setAttribute('aria-pressed', String(order !== -1));
      if (order !== -1) {
        button.dataset.order = order + 1;
        button.setAttribute('aria-label', value + '，第 ' + (order + 1) + ' 张');
      }
      if (index === mergedIndex) button.classList.add('merged');
      return button;
    }));

    const [left, right] = selected.map(index => cards[index]);
    operators.hidden = !right;
    if (right) {
      for (const button of operators.children) {
        const op = button.dataset.op;
        const value = calculate(left.value, op, right.value);
        button.disabled = !value;
        button.querySelector('span').textContent = stepText(left.value, op, right.value);
        button.querySelector('strong').textContent = value ? '= ' + display(value) : '除数为 0';
      }
    }

    prompt.textContent = finished ? '剩下 1 张牌' : right ? '选择合并结果' :
      left ? '已选 ' + display(left.value) + '，再选一张牌' : '先选两张牌';
    undo.disabled = !history.length;
    hint.disabled = won;
    hint.textContent = hintShown ? '看答案' : '提示';
    next.classList.toggle('primary', won);
    seal.hidden = !won;
    moves.replaceChildren(...history.map(move => {
      const li = document.createElement('li');
      li.textContent = move.label;
      return li;
    }));
    result.textContent = won ? '凑成 24！' : finished && !feedback ?
      '算到了 ' + display(cards[0].value) + '。撤销一步，再试试看。' : feedback;
  }

  function clearSelection() {
    selected = [];
    feedback = '';
    hintShown = false;
    mergedIndex = -1;
  }

  function nextPuzzle() {
    if (!remaining.length) remaining.push(...puzzles.map((_, i) => i).filter(i => i !== current));
    [current] = remaining.splice(Math.floor(Math.random() * remaining.length), 1);
    cards = puzzles[current].map(number => ({ value: [number, 1], expression: String(number) }));
    history.length = 0;
    clearSelection();
    render();
  }

  tiles.addEventListener('click', event => {
    const tile = event.target.closest('button[data-index]');
    if (!tile || tile.disabled) return;
    const index = Number(tile.dataset.index);
    if (selected.includes(index)) selected = selected.filter(item => item !== index);
    else selected = selected.length === 2 ? [index] : [...selected, index];
    feedback = '';
    hintShown = false;
    mergedIndex = -1;
    render();
    if (event.detail === 0) tiles.children[index].focus();
  });

  operators.addEventListener('click', event => {
    const button = event.target.closest('button[data-op]');
    if (!button || button.disabled || selected.length !== 2) return;
    const [left, right] = selected.map(index => cards[index]);
    const op = button.dataset.op;
    const value = calculate(left.value, op, right.value);
    const index = Math.min(...selected);
    history.push({ cards, label: stepText(left.value, op, right.value) + ' = ' + display(value) });
    cards = cards.filter((_, position) => !selected.includes(position));
    cards.splice(index, 0, { value, expression: '(' + left.expression + symbols[op] + right.expression + ')' });
    clearSelection();
    mergedIndex = index;
    render();
    if (event.detail === 0) (cards.length === 1 ? next : tiles.children[index]).focus();
  });

  undo.addEventListener('click', () => {
    if (!history.length) return;
    cards = history.pop().cards;
    clearSelection();
    render();
    if (!history.length && document.activeElement === undo) tiles.firstElementChild.focus();
  });
  next.addEventListener('click', nextPuzzle);
  hint.addEventListener('click', () => {
    const solution = solve(cards);
    if (!solution) {
      feedback = '这条路凑不到 24，撤销一步再试试。';
    } else if (hintShown) {
      feedback = solution.expression.slice(1, -1) + ' = 24';
    } else {
      feedback = '下一步可以先算 ' + solution.firstStep + '。';
      hintShown = true;
    }
    mergedIndex = -1;
    render();
  });

  nextPuzzle();
})();
