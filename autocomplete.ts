import { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { extractContexts, extractProjects } from "./parser";

/**
 * Creates a completion source for contexts (@) and projects (+).
 * Triggered when user types @ or +, provides a list of existing contexts/projects.
 */
export function createTodoCompletionSource(getFileContent: () => string): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    // Get the word being completed
    const word = context.matchBefore(/[@+]\w*/);
    if (!word) return null;

    const text = word.text;
    const isContext = text.startsWith("@");
    const isProject = text.startsWith("+");

    if (!isContext && !isProject) return null;

    // Get the prefix to filter by (e.g., "con" from "@con")
    const filterPrefix = text.slice(1).toLowerCase();
    const fileContent = getFileContent();

    // Extract available contexts or projects
    const items = isContext
      ? extractContexts(fileContent)
      : extractProjects(fileContent);

    // Filter by what's been typed
    const completions: Completion[] = items
      .filter(item => item.toLowerCase().startsWith(filterPrefix))
      .map(item => ({
        label: item,
        detail: isContext ? "context" : "project",
        // Complete to the full tag (e.g., "@context")
        apply: isContext ? `@${item}` : `+${item}`,
        type: "variable"
      }));

    if (completions.length === 0) return null;

    return {
      from: word.from,
      options: completions
    };
  };
}
