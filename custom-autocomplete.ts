import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { extractContexts, extractProjects } from "./parser";

interface AutocompleteState {
  isOpen: boolean;
  currentWord: string;
  isContext: boolean;
  suggestions: string[];
  selectedIndex: number;
  popup: HTMLElement | null;
  startPos: number;
  endPos: number;
}

export function createCustomAutocompletePlugin(plugin: any) {
  return ViewPlugin.fromClass(
    class {
      state: AutocompleteState = {
        isOpen: false,
        currentWord: "",
        isContext: false,
        suggestions: [],
        selectedIndex: 0,
        popup: null,
        startPos: 0,
        endPos: 0
      };

      constructor(public view: EditorView) {
        this.setupEventListeners();
      }

      setupEventListeners() {
        this.view.dom.addEventListener("keydown", (e) => this.handleKeydown(e));
        this.view.dom.addEventListener("click", () => this.closePopup());
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;

        const activeFile = plugin.app.workspace.getActiveFile();
        if (!activeFile || !plugin.isTargetFile(activeFile.path)) {
          this.closePopup();
          return;
        }

        const cursor = update.view.state.selection.main.head;
        const line = update.view.state.doc.lineAt(cursor);
        const lineText = line.text;
        const posInLine = cursor - line.from;

        // Check if we're after @ or +
        const beforeCursor = lineText.substring(0, posInLine);
        const match = beforeCursor.match(/([@+])(\w*)$/);

        if (!match) {
          this.closePopup();
          return;
        }

        const isContext = match[1] === "@";
        const prefix = match[2];
        const startPos = line.from + match.index! + 1; // +1 to skip the @ or +

        // Get suggestions
        const content = update.view.state.doc.toString();
        const allItems = isContext
          ? extractContexts(content)
          : extractProjects(content);

        const suggestions = allItems.filter((item) =>
          item.toLowerCase().startsWith(prefix.toLowerCase())
        );

        if (suggestions.length === 0) {
          this.closePopup();
          return;
        }

        this.state.currentWord = match[0];
        this.state.isContext = isContext;
        this.state.suggestions = suggestions;
        this.state.selectedIndex = 0;
        this.state.startPos = line.from + match.index!;
        this.state.endPos = cursor;

        // Defer popup showing to avoid "Reading editor layout during update" error
        requestAnimationFrame(() => this.showPopup(update.view));
      }

      showPopup(view: EditorView) {
        this.closePopup();

        const popup = document.createElement("div");
        popup.className = "todo-autocomplete-popup";
        popup.style.cssText = `
          position: fixed;
          background: var(--background-secondary);
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          max-width: 300px;
          max-height: 200px;
          overflow-y: auto;
        `;

        const coords = view.coordsAtPos(this.state.endPos);
        if (coords) {
          popup.style.left = coords.left + "px";
          popup.style.top = coords.bottom + 4 + "px";
        }

        this.state.suggestions.forEach((suggestion, index) => {
          const item = document.createElement("div");
          item.className = "todo-autocomplete-item";
          item.textContent = suggestion;
          item.style.cssText = `
            padding: 6px 12px;
            cursor: pointer;
            ${
              index === this.state.selectedIndex
                ? "background: var(--background-modifier-hover);"
                : ""
            }
          `;

          item.addEventListener("click", () => {
            this.selectSuggestion(view, suggestion);
          });

          item.addEventListener("mouseenter", () => {
            this.state.selectedIndex = index;
            this.updatePopupStyles();
          });

          popup.appendChild(item);
        });

        document.body.appendChild(popup);
        this.state.popup = popup;
        this.state.isOpen = true;
      }

      updatePopupStyles() {
        if (!this.state.popup) return;

        const items = this.state.popup.querySelectorAll(
          ".todo-autocomplete-item"
        );
        items.forEach((item, index) => {
          if (index === this.state.selectedIndex) {
            (item as HTMLElement).style.background =
              "var(--background-modifier-hover)";
          } else {
            (item as HTMLElement).style.background = "";
          }
        });
      }

      selectSuggestion(view: EditorView, suggestion: string) {
        const prefix = this.state.isContext ? "@" : "+";
        const replacement = prefix + suggestion;

        const changes = {
          from: this.state.startPos,
          to: this.state.endPos,
          insert: replacement + " "
        };

        view.dispatch({ changes });
        this.closePopup();
      }

      handleKeydown(e: KeyboardEvent) {
        if (!this.state.isOpen) return;

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            this.state.selectedIndex = Math.min(
              this.state.selectedIndex + 1,
              this.state.suggestions.length - 1
            );
            this.updatePopupStyles();
            break;

          case "ArrowUp":
            e.preventDefault();
            this.state.selectedIndex = Math.max(this.state.selectedIndex - 1, 0);
            this.updatePopupStyles();
            break;

          case "Enter":
            e.preventDefault();
            this.selectSuggestion(
              this.view,
              this.state.suggestions[this.state.selectedIndex]
            );
            break;

          case "Escape":
            e.preventDefault();
            this.closePopup();
            break;
        }
      }

      closePopup() {
        if (this.state.popup) {
          this.state.popup.remove();
          this.state.popup = null;
        }
        this.state.isOpen = false;
      }

      destroy() {
        this.closePopup();
      }
    }
  );
}
