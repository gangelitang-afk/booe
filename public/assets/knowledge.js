const unlockForm = document.querySelector('#unlock-form');
const askForm = document.querySelector('#ask-form');
const password = document.querySelector('#password');
const question = document.querySelector('#question');
const status = document.querySelector('#knowledge-status');
const answerPanel = document.querySelector('#answer-panel');
const sourcesPanel = document.querySelector('#sources-panel');

async function submit(route, input) {
  const response = await fetch(`/api/knowledge/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '暂时无法完成，请稍后再试。'), { status: response.status });
  return data;
}

function onSubmit(form, pendingText, action) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = pendingText;
    try {
      await action();
      status.textContent = '';
    } catch (error) {
      status.textContent = error.status ? error.message : '暂时无法连接，请稍后再试。';
    } finally {
      button.disabled = false;
    }
  });
}

onSubmit(unlockForm, '正在验证密码…', async () => {
  const input = password.value;
  password.value = '';
  await submit('unlock', { password: input });
  unlockForm.hidden = true;
  askForm.hidden = false;
  question.focus();
});

onSubmit(askForm, '正在查找资料…', async () => {
  answerPanel.hidden = true;
  let result;
  try {
    result = await submit('ask', { query: question.value });
  } catch (error) {
    if (error.status === 401) {
      askForm.hidden = true;
      unlockForm.hidden = false;
      password.focus();
    }
    throw error;
  }
  document.querySelector('#answer-text').textContent = result.answer;
  document.querySelector('#sources').replaceChildren(...result.sources.map(name => {
    const item = document.createElement('li');
    item.textContent = name;
    return item;
  }));
  sourcesPanel.hidden = result.sources.length === 0;
  answerPanel.hidden = false;
});
