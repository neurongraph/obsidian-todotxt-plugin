# Todo.txt Integration for Obsidian

A premium, productivity-focused Obsidian plugin for managing tasks in the standard **Todo.txt** format with custom grouping, visual styling, automatic recurrence, and a quick-entry inbox. 

It is designed to give you a highly visual, frictionless, and structured task management experience directly inside your vault.

---

## 📅 Key Features

* **Visual Syntax Highlighting**: Color-codes priorities, due dates (`due:yyyy-mm-dd`), project tags (`+project`), context tags (`@context`), and recurrence tags (`rec:`).
* **Custom Coloring Settings**: Fully customize the hex colors of each component directly in Obsidian's settings tab using standard color pickers.
* **Frictionless Quick-Entry Inbox**: Preserves 3 empty lines at the very top of your todo note. Quickly brain-dump new tasks at the top, click sort, and let the plugin file them into their correct categories below!
* **Unified Nested Hierarchy**: Restructures your note in-place into a clean, nested GTD structure:
  - **Contexts** (`## @context`) as main headings (sorted alphabetically).
  - **Projects** (`### +project`) as subheadings under each context (sorted alphabetically).
  - Uncategorized tasks are cleanly filed under `No Context` and `No Project` sections at the bottom.
* **Custom Strikethrough Completed Tasks**: Completed tasks (`x `) are beautifully styled with gray text and a full strikethrough, making them stand out in both editing and reading modes.
* **Automatic Recurrence & the `complete:` Extension**:
  - We extend the todo.txt spec by adding a custom `complete:yyyy-mm-dd` metadata tag at the end of completed tasks, keeping your text clean without front-loaded dates.
  - Toggling completion on a recurring task (`rec:n[d|w|m|y]`) automatically calculates the next due date starting from the original completed task's due date, and **inserts the new uncompleted task directly on the line below**!

---

## 🛠️ How to Install via BRAT

You can easily install this plugin into any vault using the **BRAT (Beta Reviewers Auto-update Tool)** plugin:

1. Install and enable **BRAT** from the Community Plugins directory in Obsidian.
2. Open Obsidian **Settings**, select **BRAT** under Community Plugins.
3. Click the **Add Beta Plugin** button.
4. Paste the repository URL:
   `https://github.com/neurongraph/obsidian-todotxt-plugin`
5. Click **Add Plugin**.
6. Go to **Settings > Community plugins** and enable **Todo.txt Integration**!

---

## 🚀 How to Use

### 1. Unified Sorting & Grouping
Click the list-checks ribbon icon in your left sidebar (or run `Todo.txt Control Panel` in the Command Palette) and select:
* 📅 **Sort by Due Date**: Groups all tasks under Contexts ➡️ Projects, and sorts tasks within groups by earliest due date.
* 🔥 **Sort by Priority**: Groups all tasks under Contexts ➡️ Projects, and sorts tasks within groups alphabetically by Priority `(A)` to `(Z)`.
* 📥 **Archive Completed Tasks**: Moves all completed tasks to `completed_todo.md` and deletes them from your main list, preserving the clean uncompleted structure!

### 2. In-Place Completion Toggle
* Place your cursor on any task line.
* Open the Command Palette and run: **`Todo.txt: Toggle Completion on Current Line`**
* *(Tip: We highly recommend binding this command to a hotkey like `Cmd+Enter` or `Ctrl+Enter` in Obsidian's Hotkey Settings!)*

---

## 💻 Tech Stack
* **Core**: TypeScript, Obsidian API.
* **Syntax Highlighting**: CodeMirror 6 Editor Extension (Live Preview / Source Mode) & Markdown Post-Processor (Reading View).
* **Bundler**: `esbuild` for fast production compilation.

*Developed by neurongraph.*
