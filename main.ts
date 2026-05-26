import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile
} from "obsidian";
import {
  TodoTask,
  parseTodoLine,
  stringifyTodo,
  updateMetadataInDescription,
  calculateNextDueDate,
  formatDate,
  groupAndSortTasks
} from "./parser";
import {
  createTodoHighlighterPlugin,
  createTodoAutocompleteExtension,
  createTodoPostProcessor
} from "./highlighter";

interface TodoSettings {
  todoPath: string;
  additionalPaths: string;
  archivePath: string;
  priorityColor: string;
  dueDateColor: string;
  overdueDateColor: string;
  projectColor: string;
  contextColor: string;
  recColor: string;
}

const DEFAULT_SETTINGS: TodoSettings = {
  todoPath: "todo.md",
  additionalPaths: "",
  archivePath: "completed_todo.md",
  priorityColor: "#c17171", // Soft rose/red
  dueDateColor: "#e28743",  // Sleek vibrant orange
  overdueDateColor: "#ff3b30", // Vibrant warning red
  projectColor: "#5c91e6",  // Modern premium blue
  contextColor: "#6a8390",  // Professional blue-gray
  recColor: "#8a3ab9"       // Vibrant recurrence purple
};

export default class TodoTxtPlugin extends Plugin {
  settings: TodoSettings;
  private fileCache: Record<string, string[]> = {};
  private isWritingFile = false;

  async onload() {
    await this.loadSettings();

    // 1. Register CodeMirror 6 syntax highlighter
    this.registerEditorExtension(createTodoHighlighterPlugin(this));

    // 1b. Register CodeMirror 6 autocomplete extension
    this.registerEditorExtension(createTodoAutocompleteExtension(this));

    // 2. Register Reading View Markdown Post-Processor
    this.registerMarkdownPostProcessor(createTodoPostProcessor(this));

    // 3. Ribbon Icon and Control Panel Modal
    this.addRibbonIcon("list-checks", "Todo.txt Control Panel", () => {
      new TodoControlPanelModal(this.app, this).open();
    });

    // 4. Register Commands
    this.addCommand({
      id: "todotxt-toggle-completion",
      name: "Toggle Completion on Current Line",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.toggleCompletion(editor, view);
      }
    });

    this.addCommand({
      id: "todotxt-sort-due",
      name: "Sort by Due Date",
      callback: () => this.processActiveFile("due")
    });

    this.addCommand({
      id: "todotxt-sort-priority",
      name: "Sort by Priority",
      callback: () => this.processActiveFile("priority")
    });

    this.addCommand({
      id: "todotxt-archive-completed",
      name: "Archive Completed Tasks",
      callback: () => this.archiveCompletedTasks()
    });

    // 5. Register File Modify Listener for Auto-Recurrence on manual edit
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (!(file instanceof TFile) || this.isWritingFile) return;
        if (!this.isTargetFile(file.path)) return;
        await this.handleFileModification(file);
      })
    );

    // Initialize cache for all target files
    this.app.workspace.onLayoutReady(() => {
      this.initializeFileCache();
    });

    // 6. Add Settings Tab
    this.addSettingTab(new TodoSettingTab(this.app, this));
  }

  onunload() {
    // Event listeners are automatically cleaned up by Obsidian
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Force a redraw of the active editor to pick up new colors immediately
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        leaf.view.previewMode?.rerender(true);
        // Trigger editor viewport refresh
        const editor = leaf.view.editor as any;
        if (editor?.cm) {
          editor.cm.dispatch({});
        }
      }
    });
  }

  /**
   * Helper to check if a file path is a designated todo target file
   */
  isTargetFile(filePath: string): boolean {
    const normalize = (p: string) => p.replace(/^\.\//, "").trim().toLowerCase();
    const normalizedPath = normalize(filePath);
    
    if (normalizedPath === normalize(this.settings.todoPath)) return true;

    const additional = this.settings.additionalPaths
      .split(",")
      .map((p) => normalize(p))
      .filter((p) => p.length > 0);

    return additional.includes(normalizedPath);
  }

  /**
   * Reads all target files and initializes the in-memory line cache.
   */
  private async initializeFileCache() {
    const files = this.app.vault.getFiles();
    for (const file of files) {
      if (this.isTargetFile(file.path)) {
        const content = await this.app.vault.read(file);
        this.fileCache[file.path] = content.split(/\r?\n/);
      }
    }
  }

  /**
   * Detects newly completed tasks upon manual file edits and handles recurrence.
   */
  private async handleFileModification(file: TFile) {
    const content = await this.app.vault.read(file);
    const newLines = content.split(/\r?\n/);
    const cachedLines = this.fileCache[file.path] || [];

    // Parse tasks
    const newTasks = newLines.map((line) => parseTodoLine(line));
    const cachedTasks = cachedLines.map((line) => parseTodoLine(line));

    const updatedLines = [...newLines];
    let insertedCount = 0;
    let fileModified = false;

    // Check if any task is newly completed
    for (let i = 0; i < newTasks.length; i++) {
      const newTask = newTasks[i];
      
      // Must be completed
      if (newTask.completed) {
        // Look for matching uncompleted task in cached lines
        const wasUncompleted = cachedTasks.some(
          (oldTask) =>
            !oldTask.completed &&
            oldTask.description === newTask.description &&
            oldTask.priority === newTask.priority
        );

        if (wasUncompleted) {
          const todayStr = formatDate(new Date());

          // 1. Add complete:yyyy-mm-dd tag if missing (applies to ALL completed tasks!)
          if (!newTask.metadata.complete) {
            newTask.completionDate = todayStr;
            newTask.metadata.complete = todayStr;
            newTask.description = updateMetadataInDescription(newTask.description, "complete", todayStr);
            updatedLines[i + insertedCount] = stringifyTodo(newTask);
            fileModified = true;
          }

          // 2. Generate recurrence ONLY if it has a recurrence tag!
          if (newTask.metadata.rec) {
            const nextDueExpected = calculateNextDueDate(
              newTask.metadata.due || null,
              newTask.completionDate || todayStr,
              newTask.metadata.rec
            );

            // Make sure the next occurrence is not already present
            const alreadyHasNext = newTasks.some(
              (t) =>
                !t.completed &&
                t.description === newTask.description &&
                t.metadata.due === nextDueExpected
            );

            if (!alreadyHasNext) {
              const nextDue = calculateNextDueDate(
                newTask.metadata.due || null,
                newTask.completionDate || todayStr,
                newTask.metadata.rec
              );

              let nextDescription = updateMetadataInDescription(newTask.description, "due", nextDue);
              nextDescription = updateMetadataInDescription(nextDescription, "complete", null);

              const nextMetadata = Object.assign({}, newTask.metadata, { due: nextDue });
              delete nextMetadata.complete;

              const nextTask: TodoTask = {
                originalLine: "",
                completed: false,
                priority: newTask.priority,
                completionDate: null,
                creationDate: null,
                description: nextDescription,
                projects: newTask.projects,
                contexts: newTask.contexts,
                metadata: nextMetadata
              };

              const stringifiedNext = stringifyTodo(nextTask);

              // Insert recurring task immediately below the completed line!
              const insertIndex = i + 1 + insertedCount;
              updatedLines.splice(insertIndex, 0, stringifiedNext);
              insertedCount++;
              fileModified = true;
            }
          }
        }
      }
    }

    // Save current lines to cache
    this.fileCache[file.path] = newLines;

    if (fileModified) {
      this.isWritingFile = true;
      try {
        const updatedContent = updatedLines.join("\n");
        await this.app.vault.modify(file, updatedContent);
        
        // Update cache with the final written state
        this.fileCache[file.path] = updatedContent.split(/\r?\n/);
        
        if (insertedCount > 0) {
          new Notice(`Completed tasks saved & generated ${insertedCount} recurring task(s) below!`);
        } else {
          new Notice("Completed task saved!");
        }
      } catch (err) {
        console.error("Failed to write completed task:", err);
      } finally {
        this.isWritingFile = false;
      }
    }
  }

  /**
   * Toggles task completion on the current line of the active editor.
   * Handles recurrence instantly in-place!
   */
  async toggleCompletion(editor: Editor, view: MarkdownView) {
    const activeFile = view.file;
    if (!activeFile) return;

    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    if (lineText.trim().length === 0) return;

    const task = parseTodoLine(lineText);
    const newTasksToInsert: string[] = [];

    if (task.completed) {
      // Uncomplete the task
      task.completed = false;
      task.completionDate = null;
      task.description = updateMetadataInDescription(task.description, "complete", null);
      if (task.metadata.complete) {
        delete task.metadata.complete;
      }
      
      editor.setLine(cursor.line, stringifyTodo(task));
      new Notice("Task marked incomplete");
    } else {
      // Complete the task
      task.completed = true;
      const todayStr = formatDate(new Date());
      task.completionDate = todayStr;
      task.description = updateMetadataInDescription(task.description, "complete", todayStr);
      task.metadata.complete = todayStr;

      // Handle recurrence
      if (task.metadata.rec) {
        const nextDue = calculateNextDueDate(
          task.metadata.due || null,
          task.completionDate,
          task.metadata.rec
        );

        let nextDescription = updateMetadataInDescription(task.description, "due", nextDue);
        nextDescription = updateMetadataInDescription(nextDescription, "complete", null);

        const nextMetadata = Object.assign({}, task.metadata, { due: nextDue });
        delete nextMetadata.complete;

        const nextTask: TodoTask = {
          originalLine: "",
          completed: false,
          priority: task.priority,
          completionDate: null,
          creationDate: null,
          description: nextDescription,
          projects: task.projects,
          contexts: task.contexts,
          metadata: nextMetadata
        };

        newTasksToInsert.push(stringifyTodo(nextTask));
      }

      // Replace the current line with completed task
      editor.setLine(cursor.line, stringifyTodo(task));

      // Insert recurring task immediately below the completed line for optimal UX!
      if (newTasksToInsert.length > 0) {
        const nextLinePos = { line: cursor.line + 1, ch: 0 };
        editor.replaceRange(newTasksToInsert.join("\n") + "\n", nextLinePos);
        new Notice("Task completed! Created recurring instance below.");
      } else {
        new Notice("Task completed!");
      }
    }

    // Explicitly update cache to prevent duplicate triggers
    if (this.isTargetFile(activeFile.path)) {
      const updatedContent = editor.getValue();
      this.fileCache[activeFile.path] = updatedContent.split(/\r?\n/);
    }
  }

  /**
   * Restructures, groups (Context -> Project), and sorts the tasks in the active file.
   * Preserves the top 3 blank lines for quick entry!
   */
  async processActiveFile(sortBy: "due" | "priority") {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      new Notice("No active file open!");
      return;
    }

    const file = activeView.file;
    if (!this.isTargetFile(file.path)) {
      new Notice("Active file is not a designated Todo.txt file!");
      return;
    }

    const content = await this.app.vault.read(file);
    // Parse tasks, filtering out existing markdown headers, dividers, and empty lines
    const tasks = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#") && line !== "---")
      .map((line) => parseTodoLine(line));

    if (tasks.length === 0) {
      new Notice("No tasks found in the file!");
      return;
    }

    const newContent = groupAndSortTasks(tasks, sortBy);

    this.isWritingFile = true;
    try {
      await this.app.vault.modify(file, newContent);
      this.fileCache[file.path] = newContent.split(/\r?\n/);
      new Notice(`Tasks structured & sorted by ${sortBy === "due" ? "due date" : "priority"}!`);
    } catch (err) {
      new Notice("Failed to organize tasks!");
      console.error(err);
    } finally {
      this.isWritingFile = false;
    }
  }

  /**
   * Moves all completed tasks (starting with x) to the completed archive file.
   */
  async archiveCompletedTasks() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      new Notice("No active file open!");
      return;
    }

    const file = activeView.file;
    if (!this.isTargetFile(file.path)) {
      new Notice("Active file is not a designated Todo.txt file!");
      return;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);

    // Preserve the 3 blank lines at the top for inbox
    let inboxLines = 0;
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      if (lines[i].trim().length === 0) {
        inboxLines++;
      } else {
        break;
      }
    }

    const uncompletedTasks: string[] = [];
    const completedTasks: string[] = [];

    for (let i = inboxLines; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      // If it is a header or divider, keep it in the active file
      if (trimmed.startsWith("#") || trimmed === "---") {
        uncompletedTasks.push(line);
        continue;
      }

      const task = parseTodoLine(line);
      if (task.completed) {
        completedTasks.push(line);
      } else {
        uncompletedTasks.push(line);
      }
    }

    if (completedTasks.length === 0) {
      new Notice("No completed tasks found to archive!");
      return;
    }

    // Append to archive file
    const archivePath = this.settings.archivePath || "completed_todo.md";
    let archiveFile = this.app.vault.getAbstractFileByPath(archivePath);

    this.isWritingFile = true;
    try {
      let archiveContent = "";
      if (archiveFile instanceof TFile) {
        archiveContent = await this.app.vault.read(archiveFile);
      }

      let updatedArchiveContent: string;
      if (archiveContent.length > 0) {
        updatedArchiveContent = archiveContent + "\n\n---\n\n" + completedTasks.join("\n");
      } else {
        updatedArchiveContent = completedTasks.join("\n");
      }

      if (archiveFile instanceof TFile) {
        await this.app.vault.modify(archiveFile, updatedArchiveContent);
      } else {
        await this.app.vault.create(archivePath, updatedArchiveContent);
      }

      // Write remaining back to active file with 3 blank lines at the top
      const inboxPrefix = "\n\n\n";
      const updatedActiveContent = inboxPrefix + uncompletedTasks.join("\n");
      await this.app.vault.modify(file, updatedActiveContent);
      this.fileCache[file.path] = uncompletedTasks;

      new Notice(`Archived ${completedTasks.length} task(s) to ${archivePath}!`);
    } catch (err) {
      new Notice("Failed to archive tasks!");
      console.error(err);
    } finally {
      this.isWritingFile = false;
    }
  }
}

/**
 * A sleek, premium Modal that acts as a control panel for sorting, grouping, and archiving tasks.
 */
class TodoControlPanelModal extends Modal {
  plugin: TodoTxtPlugin;

  constructor(app: App, plugin: TodoTxtPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Todo.txt Tasks Control Panel", cls: "todo-modal-title" });
    contentEl.createEl("p", { 
      text: "Select an operation to apply to your current active Todo.txt note.",
      cls: "todo-modal-subtitle"
    });

    const buttonContainer = contentEl.createDiv({ cls: "todo-modal-buttons" });

    const createActionButton = (name: string, icon: string, action: () => void, description: string) => {
      const btnWrapper = buttonContainer.createDiv({ cls: "todo-action-wrapper" });
      const btn = btnWrapper.createEl("button", { cls: "todo-action-btn" });
      
      const iconSpan = btn.createSpan({ cls: "todo-btn-icon" });
      iconSpan.textContent = icon;
      
      const textSpan = btn.createSpan({ cls: "todo-btn-text", text: name });
      
      btn.addEventListener("click", () => {
        action();
        this.close();
      });

      btnWrapper.createEl("span", { cls: "todo-action-desc", text: description });
    };

    createActionButton(
      "Sort by Due Date", 
      "📅", 
      () => this.plugin.processActiveFile("due"),
      "Group tasks under ## @context and ### +project, and sort by earliest due date."
    );

    createActionButton(
      "Sort by Priority", 
      "🔥", 
      () => this.plugin.processActiveFile("priority"),
      "Group tasks under ## @context and ### +project, and sort by priority (A) to (Z)."
    );

    createActionButton(
      "Archive Completed Tasks", 
      "📥", 
      () => this.plugin.archiveCompletedTasks(),
      "Move all completed tasks (starting with 'x') into your configured archive file."
    );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Settings UI Tab
 */
class TodoSettingTab extends PluginSettingTab {
  plugin: TodoTxtPlugin;

  constructor(app: App, plugin: TodoTxtPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Todo.txt Plugin Settings" });

    containerEl.createEl("h3", { text: "File Targeting" });

    new Setting(containerEl)
      .setName("Primary Todo File Path")
      .setDesc("The primary target file for your Todo.txt tasks (relative to vault root).")
      .addText((text) =>
        text
          .setPlaceholder("todo.md")
          .setValue(this.plugin.settings.todoPath)
          .onChange(async (value) => {
            this.plugin.settings.todoPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Additional Target Files")
      .setDesc("Comma-separated list of other files in your vault to target (relative to vault root).")
      .addText((text) =>
        text
          .setPlaceholder("work_todo.md, personal_todo.md")
          .setValue(this.plugin.settings.additionalPaths)
          .onChange(async (value) => {
            this.plugin.settings.additionalPaths = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Archive File Path")
      .setDesc("Completed tasks will be archived/moved into this file.")
      .addText((text) =>
        text
          .setPlaceholder("completed_todo.md")
          .setValue(this.plugin.settings.archivePath)
          .onChange(async (value) => {
            this.plugin.settings.archivePath = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Syntax Highlighting & Color Coding" });
    containerEl.createEl("p", {
      text: "Customize the hex colors of your Todo.txt components in target files.",
      cls: "setting-instructions-text"
    });

    const createColorPickerSetting = (name: string, desc: string, key: keyof TodoSettings) => {
      const setting = new Setting(containerEl)
        .setName(name)
        .setDesc(desc);

      const colorInput = setting.controlEl.createEl("input", {
        type: "color",
        cls: "todo-color-picker-input"
      });
      colorInput.value = this.plugin.settings[key] as string;

      const hexInput = setting.controlEl.createEl("input", {
        type: "text",
        cls: "todo-color-hex-input"
      });
      hexInput.value = this.plugin.settings[key] as string;
      hexInput.maxLength = 7;

      colorInput.addEventListener("input", async (e) => {
        const val = (e.target as HTMLInputElement).value;
        hexInput.value = val;
        (this.plugin.settings[key] as string) = val;
        await this.plugin.saveSettings();
      });

      hexInput.addEventListener("change", async (e) => {
        let val = (e.target as HTMLInputElement).value;
        if (!val.startsWith("#")) val = "#" + val;
        if (/^#[0-9A-F]{6}$/i.test(val)) {
          colorInput.value = val;
          (this.plugin.settings[key] as string) = val;
          await this.plugin.saveSettings();
        } else {
          new Notice("Invalid Hex color code! Format must be #RRGGBB");
          hexInput.value = this.plugin.settings[key] as string;
        }
      });
    };

    createColorPickerSetting("Priority Color", "Color for priorities (e.g. (A), (B))", "priorityColor");
    createColorPickerSetting("Due Date Color", "Color for due dates (e.g. due:2026-05-24)", "dueDateColor");
    createColorPickerSetting("Overdue / Due Today Color", "Color for overdue or due today tasks (e.g. due:2026-05-23)", "overdueDateColor");
    createColorPickerSetting("Project Color", "Color for projects (e.g. +ProjectName)", "projectColor");
    createColorPickerSetting("Context Color", "Color for contexts (e.g. @contextName)", "contextColor");
    createColorPickerSetting("Recurrence Color", "Color for recurrence tags (e.g. rec:1w)", "recColor");
  }
}
