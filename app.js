const taskInput = document.getElementById('taskInput');
const addBtn = document.getElementById('addBtn');
const taskList = document.getElementById('taskList');

let tasks = [];

function renderTasks() {
  taskList.innerHTML = '';
  for (let i = 0; i < tasks.length; i++) {
    const li = document.createElement('li');
    li.textContent = tasks[i];

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function () {
      removeTask(i);
    });

    li.appendChild(removeBtn);
    taskList.appendChild(li);
  }
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

renderTasks();
