export interface TodoTask {
  originalLine: string;
  completed: boolean;
  priority: string | null;      // Single uppercase letter, e.g., 'A'
  completionDate: string | null; // YYYY-MM-DD
  creationDate: string | null;   // YYYY-MM-DD
  description: string;           // The rest of the line containing text, tags, and metadata
  projects: string[];            // Projects (without '+')
  contexts: string[];            // Contexts (without '@')
  metadata: Record<string, string>; // Metadata key-values (e.g., due:2026-05-24)
}

/**
 * Parses a single line in Todo.txt format.
 */
export function parseTodoLine(line: string): TodoTask {
  const trimmed = line.trim();
  let remaining = trimmed;
  let completed = false;
  let priority: string | null = null;

  // 1. Parse Completion Status
  if (remaining.startsWith("x ")) {
    completed = true;
    remaining = remaining.substring(2).trim();
  }

  // 2. Parse Priority (starts with (A))
  const priorityMatch = remaining.match(/^\(([A-Z])\)\b/);
  if (priorityMatch) {
    priority = priorityMatch[1];
    remaining = remaining.substring(priorityMatch[0].length).trim();
  }

  // Under the new spec extension, we do not parse dates at the front!
  // The rest is the description
  const description = remaining;

  // Extract Projects, Contexts, and Metadata from the description
  const tokens = description.split(/\s+/).filter(t => t.length > 0);
  const projects: string[] = [];
  const contexts: string[] = [];
  const metadata: Record<string, string> = {};

  for (const token of tokens) {
    if (token.startsWith("+") && token.length > 1) {
      projects.push(token.substring(1));
    } else if (token.startsWith("@") && token.length > 1) {
      contexts.push(token.substring(1));
    } else {
      const colonIdx = token.indexOf(":");
      if (colonIdx > 0 && colonIdx < token.length - 1 && !token.startsWith("+") && !token.startsWith("@")) {
        const key = token.substring(0, colonIdx);
        const val = token.substring(colonIdx + 1);
        if (/^[a-zA-Z0-9_-]+$/.test(key) && !val.startsWith("//")) {
          metadata[key] = val;
        }
      }
    }
  }

  // Parse completionDate and creationDate from metadata keys
  const completionDate = metadata.complete || null;
  const creationDate = metadata.creation || null;

  return {
    originalLine: trimmed,
    completed,
    priority,
    completionDate,
    creationDate,
    description,
    projects,
    contexts,
    metadata
  };
}

/**
 * Updates or appends a key:val metadata pair inside a description string.
 */
export function updateMetadataInDescription(description: string, key: string, newValue: string | null): string {
  const regex = new RegExp(`(?:^|\\s)${key}:[^\\s]+`, "g");
  if (newValue === null) {
    return description.replace(regex, "").replace(/\s+/g, " ").trim();
  } else {
    const updatedToken = `${key}:${newValue}`;
    let replaced = false;
    const result = description.replace(regex, (match) => {
      replaced = true;
      const leadingSpace = match.startsWith(" ") || match.startsWith("\t") ? match[0] : " ";
      return `${leadingSpace}${updatedToken}`;
    });

    if (replaced) {
      return result.replace(/\s+/g, " ").trim();
    } else {
      return `${description.trim()} ${updatedToken}`.trim();
    }
  }
}

/**
 * Converts a TodoTask object back into a standard Todo.txt string.
 */
export function stringifyTodo(task: TodoTask): string {
  const parts: string[] = [];

  if (task.completed) {
    parts.push("x");
  }

  if (task.priority) {
    parts.push(`(${task.priority})`);
  }

  // Note: we no longer append completion/creation dates at the front.
  // The complete:yyyy-mm-dd tag is already stored inside description!

  if (task.description) {
    parts.push(task.description);
  }

  return parts.join(" ");
}

/**
 * Utility to format Date to YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calculates the next due date based on a recurrence interval.
 * Supports:
 * - Normal recurrence: rec:1w -> adds 1 week to completion date (or today if completion date missing)
 * - Strict recurrence: rec:+1w -> adds 1 week to the original due date
 */
export function calculateNextDueDate(dueDateStr: string | null, completionDateStr: string | null, recStr: string): string {
  const isStrict = recStr.startsWith("+");
  const cleanedRec = isStrict ? recStr.substring(1) : recStr;

  const match = cleanedRec.match(/^(\d*)([dwmy])$/);
  if (!match) {
    return formatDate(new Date(Date.now() + 86400000));
  }

  const amount = match[1] ? parseInt(match[1], 10) : 1;
  const period = match[2];

  let baseDate = new Date();
  
  // ALWAYS prefer the original due date of the completed task as base
  if (dueDateStr) {
    const parsed = new Date(dueDateStr);
    if (!isNaN(parsed.getTime())) {
      baseDate = parsed;
    }
  } else if (completionDateStr) {
    const parsed = new Date(completionDateStr);
    if (!isNaN(parsed.getTime())) {
      baseDate = parsed;
    }
  }

  const nextDate = new Date(baseDate.getTime());
  
  if (period === "d") {
    nextDate.setDate(nextDate.getDate() + amount);
  } else if (period === "w") {
    nextDate.setDate(nextDate.getDate() + amount * 7);
  } else if (period === "m") {
    nextDate.setMonth(nextDate.getMonth() + amount);
  } else if (period === "y") {
    nextDate.setFullYear(nextDate.getFullYear() + amount);
  }

  return formatDate(nextDate);
}

/**
 * Sorts tasks by due date. Tasks with earlier due dates come first.
 * Tasks without due dates go to the bottom.
 */
export function sortTasksByDueDate(tasks: TodoTask[]): TodoTask[] {
  return [...tasks].sort((a, b) => {
    // Put completed tasks at the bottom
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }

    const aDue = a.metadata.due || null;
    const bDue = b.metadata.due || null;

    if (aDue && bDue) {
      if (aDue !== bDue) return aDue.localeCompare(bDue);
    } else if (aDue) {
      return -1; // a has due date, b doesn't -> a comes first
    } else if (bDue) {
      return 1;  // b has due date, a doesn't -> b comes first
    }

    // Secondary: Priority
    const aPrio = a.priority || "Z";
    const bPrio = b.priority || "Z";
    if (aPrio !== bPrio) return aPrio.localeCompare(bPrio);

    // Tertiary: Alphabetical
    return a.description.localeCompare(b.description);
  });
}

/**
 * Sorts tasks by priority. A comes first, down to Z. Tasks without priority go to the bottom.
 */
export function sortTasksByPriority(tasks: TodoTask[]): TodoTask[] {
  return [...tasks].sort((a, b) => {
    // Put completed tasks at the bottom
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }

    const aPrio = a.priority || "Z";
    const bPrio = b.priority || "Z";

    if (aPrio !== bPrio) {
      return aPrio.localeCompare(bPrio);
    }

    // Secondary: Due Date
    const aDue = a.metadata.due || "9999-12-31";
    const bDue = b.metadata.due || "9999-12-31";
    if (aDue !== bDue) return aDue.localeCompare(bDue);

    // Tertiary: Alphabetical
    return a.description.localeCompare(b.description);
  });
}

/**
 * Groups all tasks in a two-level hierarchy (Context -> Project), sorts them within
 * each project, and returns the formatted markdown file content.
 * Preserves 3 empty lines at the very top of the file for the user's quick-entry inbox!
 */
export function groupAndSortTasks(tasks: TodoTask[], sortBy: "due" | "priority"): string {
  // Two-level groups map: context -> project -> tasks
  const groups: Record<string, Record<string, TodoTask[]>> = {};

  for (const task of tasks) {
    const context = task.contexts.length > 0 ? `@${task.contexts[0]}` : "No Context";
    const project = task.projects.length > 0 ? `+${task.projects[0]}` : "No Project";

    if (!groups[context]) {
      groups[context] = {};
    }
    if (!groups[context][project]) {
      groups[context][project] = [];
    }
    groups[context][project].push(task);
  }

  // 1. Sort Contexts alphabetically, keeping "No Context" at the very bottom
  const sortedContexts = Object.keys(groups).sort((a, b) => {
    if (a === "No Context") return 1;
    if (b === "No Context") return -1;
    return a.localeCompare(b);
  });

  const outputLines: string[] = ["", "", ""]; // 3 empty lines at the absolute top!

  for (const ctx of sortedContexts) {
    outputLines.push("---");
    outputLines.push(`## ${ctx}`);

    // 2. Sort Projects under this context alphabetically, keeping "No Project" at the bottom of the context
    const sortedProjects = Object.keys(groups[ctx]).sort((a, b) => {
      if (a === "No Project") return 1;
      if (b === "No Project") return -1;
      return a.localeCompare(b);
    });

    for (const proj of sortedProjects) {
      outputLines.push(`### ${proj}`);

      // 3. Sort tasks inside this project by Due Date or Priority
      const sortedTasks = sortBy === "due"
        ? sortTasksByDueDate(groups[ctx][proj])
        : sortTasksByPriority(groups[ctx][proj]);

      for (const t of sortedTasks) {
        outputLines.push(stringifyTodo(t));
      }
      
      outputLines.push(""); // Empty line between project blocks
    }
  }

  // Joint text, trimming trailing spaces/newlines but keeping exactly one final trailing newline
  return outputLines.join("\n").replace(/\s+$/, "") + "\n";
}
