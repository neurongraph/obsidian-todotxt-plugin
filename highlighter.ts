import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { MarkdownPostProcessorContext } from "obsidian";
import { createTodoCompletionSource } from "./autocomplete";

/**
 * Creates a CodeMirror 6 ViewPlugin to provide live syntax highlighting in
 * Editor Source Mode and Live Preview Mode.
 */
export function createTodoHighlighterPlugin(plugin: any) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        // Rebuild decorations only when the document or viewport changes
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        
        // 1. Get current active file path
        const activeFile = plugin.app.workspace.getActiveFile();
        if (!activeFile) return builder.finish();

        // 2. Only color if active file is a configured todo target
        if (!plugin.isTargetFile(activeFile.path)) return builder.finish();

        const settings = plugin.settings;
        const priorityColor = settings.priorityColor || "#c17171";
        const dueDateColor = settings.dueDateColor || "#e28743";
        const overdueDateColor = settings.overdueDateColor || "#ff3b30";
        const projectColor = settings.projectColor || "#5c91e6";
        const contextColor = settings.contextColor || "#6a8390";
        const recColor = settings.recColor || "#8a3ab9";

        // Create the style decorations
        const priorityDeco = Decoration.mark({ attributes: { style: `color: ${priorityColor}; font-weight: bold;` } });
        const dueDeco = Decoration.mark({ attributes: { style: `color: ${dueDateColor}; font-weight: bold;` } });
        const overdueDeco = Decoration.mark({ attributes: { style: `color: ${overdueDateColor}; font-weight: bold;` } });
        const projectDeco = Decoration.mark({ attributes: { style: `color: ${projectColor}; font-weight: 500;` } });
        const contextDeco = Decoration.mark({ attributes: { style: `color: ${contextColor}; font-weight: 500;` } });
        const recDeco = Decoration.mark({ attributes: { style: `color: ${recColor}; font-style: italic;` } });

        // Strikethrough + gray decoration for completed tasks
        const completedDeco = Decoration.mark({
          attributes: {
            style: "color: var(--text-muted) !important; text-decoration: line-through !important; opacity: 0.6;"
          }
        });

        // Iterate through visible viewport ranges for performance
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            const lineText = line.text;

            // If the line starts with "x ", cross out the entire task line
            if (lineText.trim().startsWith("x ")) {
              const lineStart = line.from;
              const lineEnd = line.to;
              if (lineStart < lineEnd) {
                builder.add(lineStart, lineEnd, completedDeco);
              }
            } else {
              // Not completed, apply token-level highlighting
              const matches: { start: number; end: number; deco: Decoration }[] = [];

              // A. Priority matching: \([A-Z]\)
              const priorityRegex = /\([A-Z]\)/g;
              let match;
              while ((match = priorityRegex.exec(lineText)) !== null) {
                matches.push({
                  start: line.from + match.index,
                  end: line.from + match.index + match[0].length,
                  deco: priorityDeco
                });
              }

              // B. Due date matching: \bdue:\d{4}-\d{2}-\d{2}\b
              const dueRegex = /\bdue:\d{4}-\d{2}-\d{2}\b/g;
              while ((match = dueRegex.exec(lineText)) !== null) {
                const dueText = match[0];
                const dateVal = dueText.substring(4);
                
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const dd = String(today.getDate()).padStart(2, '0');
                const todayStr = `${yyyy}-${mm}-${dd}`;
                
                const isOverdue = dateVal <= todayStr;

                matches.push({
                  start: line.from + match.index,
                  end: line.from + match.index + match[0].length,
                  deco: isOverdue ? overdueDeco : dueDeco
                });
              }

              // C. Project matching: \+[a-zA-Z0-9_-]+
              const projectRegex = /(\s|^)(\+[a-zA-Z0-9_-]+)/g;
              while ((match = projectRegex.exec(lineText)) !== null) {
                const leadingSpaceLen = match[1].length;
                const tokenStart = line.from + match.index + leadingSpaceLen;
                const tokenEnd = tokenStart + match[2].length;
                matches.push({ start: tokenStart, end: tokenEnd, deco: projectDeco });
              }

              // D. Context matching: @[a-zA-Z0-9_-]+
              const contextRegex = /(\s|^)(@[a-zA-Z0-9_-]+)/g;
              while ((match = contextRegex.exec(lineText)) !== null) {
                const leadingSpaceLen = match[1].length;
                const tokenStart = line.from + match.index + leadingSpaceLen;
                const tokenEnd = tokenStart + match[2].length;
                matches.push({ start: tokenStart, end: tokenEnd, deco: contextDeco });
              }

              // E. Recurrence matching: \brec:\+?\d*[dwmy]\b
              const recRegex = /\brec:\+?\d*[dwmy]\b/g;
              while ((match = recRegex.exec(lineText)) !== null) {
                matches.push({
                  start: line.from + match.index,
                  end: line.from + match.index + match[0].length,
                  deco: recDeco
                });
              }

              // Sort matches by start index to comply with CM6 RangeSetBuilder requirements
              matches.sort((a, b) => a.start - b.start);

              // Add sorted matches to builder safely without overlapping
              let lastAddedEnd = -1;
              for (const m of matches) {
                if (m.start >= lastAddedEnd && m.start < m.end && m.end <= view.state.doc.length) {
                  builder.add(m.start, m.end, m.deco);
                  lastAddedEnd = m.end;
                }
              }
            }

            pos = line.to + 1;
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * Creates a CodeMirror 6 autocomplete extension for contexts (@) and projects (+).
 */
export function createTodoAutocompleteExtension(plugin: any) {
  const completionSource = (context: any) => {
    // Only provide completions for target todo files
    const activeFile = plugin.app.workspace.getActiveFile();

    if (!activeFile) {
      console.log("[TodoAutocomplete] No active file");
      return null;
    }

    const isTarget = plugin.isTargetFile(activeFile.path);
    if (!isTarget) {
      console.log(`[TodoAutocomplete] File not a target: ${activeFile.path}, configured: ${plugin.settings.todoPath}`);
      return null;
    }

    // Get the current file content from the editor state
    const content = context.state.doc.toString();

    // Create the completion source with the current file content
    const source = createTodoCompletionSource(() => content);
    const result = source(context);

    if (result) {
      console.log(`[TodoAutocomplete] Showing ${result.options?.length || 0} completions`);
    }

    return result;
  };

  return autocompletion({
    override: [completionSource],
    activateOnTyping: true,
    closeOnBlur: true
  });
}

/**
 * Creates an Obsidian Markdown Post-Processor to provide syntax highlighting in
 * Reading View Mode.
 */
export function createTodoPostProcessor(plugin: any) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    // 1. Check if the file is one of our target files
    if (!plugin.isTargetFile(ctx.sourcePath)) return;

    const settings = plugin.settings;
    const textContent = el.textContent || "";

    // If the element represents a completed task, style the entire element
    if (textContent.trim().startsWith("x ")) {
      el.style.color = "var(--text-muted)";
      el.style.textDecoration = "line-through";
      el.style.opacity = "0.6";
      return; // Skip token highlighting for completed lines
    }

    const priorityColor = settings.priorityColor || "#c17171";
    const dueDateColor = settings.dueDateColor || "#e28743";
    const overdueDateColor = settings.overdueDateColor || "#ff3b30";
    const projectColor = settings.projectColor || "#5c91e6";
    const contextColor = settings.contextColor || "#6a8390";
    const recColor = settings.recColor || "#8a3ab9";

    // Recursive helper to traverse DOM nodes and color text nodes
    const highlightElementText = (node: ChildNode) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        const tokens = text.split(/(\s+)/);
        const fragment = document.createDocumentFragment();
        let hasMatches = false;

        for (const token of tokens) {
          if (token.trim().length === 0) {
            fragment.appendChild(document.createTextNode(token));
            continue;
          }

          // Check token match types
          if (/^\([A-Z]\)$/.test(token)) {
            const span = document.createElement("span");
            span.style.color = priorityColor;
            span.style.fontWeight = "bold";
            span.textContent = token;
            fragment.appendChild(span);
            hasMatches = true;
          } else if (/^due:\d{4}-\d{2}-\d{2}$/.test(token)) {
            const dateVal = token.substring(4);
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const todayStr = `${yyyy}-${mm}-${dd}`;
            const isOverdue = dateVal <= todayStr;

            const span = document.createElement("span");
            span.style.color = isOverdue ? overdueDateColor : dueDateColor;
            span.style.fontWeight = "bold";
            span.textContent = token;
            fragment.appendChild(span);
            hasMatches = true;
          } else if (/^\+[a-zA-Z0-9_-]+$/.test(token)) {
            const span = document.createElement("span");
            span.style.color = projectColor;
            span.style.fontWeight = "500";
            span.textContent = token;
            fragment.appendChild(span);
            hasMatches = true;
          } else if (/^@[a-zA-Z0-9_-]+$/.test(token)) {
            const span = document.createElement("span");
            span.style.color = contextColor;
            span.style.fontWeight = "500";
            span.textContent = token;
            fragment.appendChild(span);
            hasMatches = true;
          } else if (/^rec:\+?\d*[dwmy]$/.test(token)) {
            const span = document.createElement("span");
            span.style.color = recColor;
            span.style.fontStyle = "italic";
            span.textContent = token;
            fragment.appendChild(span);
            hasMatches = true;
          } else {
            fragment.appendChild(document.createTextNode(token));
          }
        }

        if (hasMatches && node.parentNode) {
          node.parentNode.replaceChild(fragment, node);
        }
      } else {
        // Create a static array copy of childNodes to avoid mutating issues
        const children = Array.from(node.childNodes);
        for (const child of children) {
          highlightElementText(child);
        }
      }
    };

    highlightElementText(el);
  };
}
