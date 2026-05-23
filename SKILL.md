---
name: obsidian-todotxt
description: Read, parse, write, sort, and complete tasks in Obsidian vaults using our custom Todo.txt format and its extended `complete:yyyy-mm-dd` tag and hierarchical grouping spec. Equip coding agents to cleanly add, modify, and check off tasks.
---

# Obsidian Todo.txt Agent Skill

This skill guides AI coding agents on how to read, parse, write, sort, and complete tasks in an Obsidian vault conforming to our custom **Todo.txt spec and its extensions**.

---

## 1. Syntax Specification & Extensions

Every task is represented as **one line of plain text**. We follow the standard Todo.txt spec with three specific custom extensions:
1. **No Front-Loaded Dates**: We do not prepend completion or creation dates at the beginning of task lines.
2. **The `complete:yyyy-mm-dd` Tag**: Task completion date is stored as a custom metadata key-value tag `complete:YYYY-MM-DD` at the very end of the line.
3. **Hierarchy Grouping**: Note contents are structured in a two-level markdown header hierarchy separated by horizontal dividers (`---`):
   - `---`
   - `## @context` (sorted alphabetically, `No Context` at the bottom)
   - `### +project` (sorted alphabetically under the context, `No Project` at the bottom)

### Standard & Extended Formats:
* **Uncompleted Task**: `(Priority) Description text +project @context due:YYYY-MM-DD rec:N[dwmy]`
* **Completed Task**: `x (Priority) Description text +project @context due:YYYY-MM-DD rec:N[dwmy] complete:YYYY-MM-DD`

---

## 2. Parsing Task Lines

Agents parsing a task line should use the following logic (or equivalents in Python/JavaScript):

### Parsing Logic:
1. **Completed Status**: Check if the line starts with `x `. If it does, `completed = true`. Strip the leading `x ` from the string.
2. **Priority**: Look for a priority block starting at the beginning of the remaining string matching `^\(([A-Z])\)\b`. If found, extract the letter as `priority` and strip the priority block from the start.
3. **Description & Metadata**: The rest of the line is the description.
4. **Token Scanning**: Split the description by whitespace.
   - Tokens starting with `+` are **Projects** (extract without the `+`).
   - Tokens starting with `@` are **Contexts** (extract without the `@`).
   - Tokens matching `key:value` are **Metadata**. Ensure you filter out URLs (keys shouldn't be `http` or contain `//`).
   - **`due:YYYY-MM-DD`** represents the task's due date.
   - **`rec:N[dwmy]`** represents task recurrence (e.g. `1w` for 1 week, `3d` for 3 days, `2m` for 2 months, `1y` for 1 year). The optional `+` prefix (like `+1m`) represents strict recurrence.
   - **`complete:YYYY-MM-DD`** represents the completion date (only present if completed).

---

## 3. Stringifying Task Objects

When reconstructing a line from a task object, assemble the parts strictly in this order:
1. `x ` (if completed)
2. `(A) ` (if priority is present, e.g. `A`)
3. `description` (retains projects, contexts, and metadata tags like `due:`, `rec:`, and `complete:`)

**Example**:
`x (A) Greet team +work @office due:2026-05-24 rec:1w complete:2026-05-23`

---

## 4. Agent Workflows for Vault Interactions

When reading or modifying a vault's `todo.md` file, agents MUST follow these workflows to maintain list integrity:

### A. Quick-Entry Inbox (Adding a New Task)
* **Rule**: Keep **exactly 3 empty lines** at the very top of `todo.md`.
* **Action**: To add a new task, insert it at the very top of the file (within the 3 blank lines).
* **Filing**: Do not worry about filing it under headings. When the user sorts their list via the Obsidian plugin, it will automatically parse the inbox tasks and file them into the correct sections below!

### B. Completing a Task
To check off a task on a specific line:
1. Prepend `x ` to the beginning of the line.
2. Format today's date as `YYYY-MM-DD`.
3. Append `complete:YYYY-MM-DD` to the end of the line (e.g. `complete:2026-05-23`).

**Handling Recurrence (`rec:`)**:
If the task being completed has a `rec:n[dwmy]` tag (e.g., `rec:1w`):
1. Locate its due date (e.g., `due:2026-05-25`). If missing, fall back to today's date.
2. Add the interval to that base due date (e.g., `2026-05-25 + 1 week = 2026-06-01`).
3. Generate a new, uncompleted task object copying priority, inline projects, contexts, and recurrence, but **with the new due date** and **without the `complete:` tag**.
4. **Insert this new uncompleted task directly on the line below the completed task!**

### C. Uncompleting a Task
1. Remove `x ` from the beginning of the line.
2. Strip `complete:YYYY-MM-DD` from the end of the line.

### D. File Restructuring (Sorting & Grouping)
If asked to reorganize or sort the file:
1. Parse all non-empty task lines (ignore lines starting with `#` or exactly equal to `---`).
2. Group tasks by context (`@context` or `No Context`), then by project (`+project` or `No Project`).
3. Sort contexts and projects alphabetically (putting `No Context` and `No Project` at the bottom of their respective levels).
4. Sort tasks within each project block by due date or priority.
5. Reconstruct the file with:
   - 3 empty lines at the top.
   - `---` separator before each context block.
   - `## @context` headings.
   - `### +project` headings under each context.
   - Tasks printed on new lines under their subheadings.
