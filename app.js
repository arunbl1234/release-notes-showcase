const taskInput = document.getElementById('taskInput');
const addBtn = document.getElementById('addBtn');
const taskList = document.getElementById('taskList');
const searchInput = document.getElementById('searchInput');

let tasks = [];
let searchTerm = '';
let debounceTimer = null;

function renderTasks() {
  const fragment = document.createDocumentFragment();
  const filtered = [];
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].toLowerCase().includes(searchTerm.toLowerCase())) {
      filtered.push({ text: tasks[i], originalIndex: i });
    }
  }

  for (let i = 0; i < filtered.length; i++) {
    const li = document.createElement('li');
    li.textContent = filtered[i].text;

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function () {
      removeTask(filtered[i].originalIndex);
    });

    li.appendChild(removeBtn);
    fragment.appendChild(li);
  }

  taskList.innerHTML = '';
  taskList.appendChild(fragment);
}

function addTask(text) {
  if (!text.trim()) return;
  tasks.push(text.trim());
  renderTasks();
}

function removeTask(index) {
  tasks.splice(index, 1);
  renderTasks();
}

addBtn.addEventListener('click', function () {
  addTask(taskInput.value);
  taskInput.value = '';
});

taskInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    addTask(taskInput.value);
    taskInput.value = '';
  }
});

searchInput.addEventListener('input', function () {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function () {
    searchTerm = searchInput.value;
    renderTasks();
  }, 150);
});

renderTasks();
