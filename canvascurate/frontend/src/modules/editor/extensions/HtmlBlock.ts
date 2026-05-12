import { Node, mergeAttributes } from "@tiptap/react";

export type HtmlBlockEditRequest = {
  content: string;
  update: (nextContent: string) => void;
};

export type LatexBlockEditRequest = {
  latex: string;
  displayMode: boolean;
  update: (nextContent: string) => void;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    htmlBlock: {
      insertHtmlBlock: (html: string) => ReturnType;
      updateHtmlBlock: (content: string) => ReturnType;
    };
  }
}

export const HtmlBlock = Node.create({
  name: "htmlBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element: HTMLElement) => (
          element.hasAttribute("data-html-block")
            ? element.getAttribute("data-content") || element.innerHTML
            : element.outerHTML
        ),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "div[data-html-block]", priority: 90 },
      { tag: "div.enhanceable_content", priority: 85 },
      {
        tag: "div[style]",
        priority: 70,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const style = el.getAttribute("style") || "";
          if ((style.includes("display:flex") || style.includes("display: flex")) && el.children.length >= 2) return {};
          if (style.includes("linear-gradient")) return {};
          if ((style.includes("background") || style.includes("border-left")) && style.includes("padding")) return {};
          if ((style.includes("text-align:center") || style.includes("text-align: center")) && el.querySelector("a[style]")) return {};
          return false;
        },
      },
      { tag: "figure[style]", priority: 70 },
      {
        tag: "iframe",
        priority: 75,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const parent = el.parentElement;
          if (parent?.tagName === "DIV" && parent.querySelector("iframe")) return false;
          return { content: el.outerHTML };
        },
      },
      {
        tag: "div",
        priority: 65,
        getAttrs: (element) => ((element as HTMLElement).querySelector("iframe") ? {} : false),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-html-block": "",
        "data-content": node.attrs.content || "",
      }),
    ];
  },

  addCommands() {
    return {
      insertHtmlBlock: (html: string) => ({ commands }) =>
        commands.insertContent({ type: "htmlBlock", attrs: { content: html } }),
      updateHtmlBlock: (content: string) => ({ commands }) => commands.updateAttributes("htmlBlock", { content }),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node;
      const wrapper = document.createElement("div");
      wrapper.className = "html-block-wrapper";
      wrapper.setAttribute("data-html-block", "");

      const content = document.createElement("div");
      content.className = "html-block-content";
      content.innerHTML = node.attrs.content || "";
      wrapper.appendChild(content);

      function cleanContentHtml() {
        const clone = content.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("[data-html-block-editable]").forEach((editable) => {
          editable.removeAttribute("contenteditable");
          editable.removeAttribute("spellcheck");
        });
        return clone.innerHTML;
      }

      function updateHtmlBlockContent() {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        const nextContent = cleanContentHtml();
        if (nextContent === currentNode.attrs.content) return;
        currentNode = currentNode.type.create({ ...currentNode.attrs, content: nextContent }, currentNode.content, currentNode.marks);
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { content: nextContent }));
      }

      function duplicateHtmlBlock() {
        updateHtmlBlockContent();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        const duplicate = currentNode.type.create(currentNode.attrs, currentNode.content, currentNode.marks);
        editor.view.dispatch(editor.view.state.tr.insert(pos + currentNode.nodeSize, duplicate));
      }

      function deleteHtmlBlock() {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        editor.view.dispatch(editor.view.state.tr.delete(pos, pos + currentNode.nodeSize));
      }

      function setHtmlBlockContent(nextContent: string) {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        currentNode = currentNode.type.create({ ...currentNode.attrs, content: nextContent }, currentNode.content, currentNode.marks);
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { content: nextContent }));
      }

      function showHtmlBlockEditor() {
        updateHtmlBlockContent();
        window.dispatchEvent(new CustomEvent<HtmlBlockEditRequest>("canvascurate:edit-html-block", {
          detail: {
            content: String(currentNode.attrs.content || ""),
            update: setHtmlBlockContent,
          },
        }));
      }

      function latexBlockElement() {
        return content.querySelector<HTMLElement>("[data-latex-block]");
      }

      function showLatexBlockEditor() {
        const latexBlock = latexBlockElement();
        if (!latexBlock) return;
        updateHtmlBlockContent();
        window.dispatchEvent(new CustomEvent<LatexBlockEditRequest>("canvascurate:edit-latex-block", {
          detail: {
            latex: latexBlock.getAttribute("data-latex-source") || "",
            displayMode: latexBlock.getAttribute("data-latex-display-mode") !== "inline",
            update: setHtmlBlockContent,
          },
        }));
      }

      function showSourceEditor() {
        if (latexBlockElement()) {
          showLatexBlockEditor();
          return;
        }
        showHtmlBlockEditor();
      }

      function showDeleteConfirmation() {
        if (document.querySelector(".html-block-delete-confirm")) return;
        const confirmation = document.createElement("div");
        confirmation.className = "html-block-delete-confirm";
        confirmation.setAttribute("role", "dialog");
        confirmation.setAttribute("aria-modal", "true");
        confirmation.setAttribute("aria-label", "Delete block confirmation");
        confirmation.innerHTML = `
          <div class="html-block-delete-dialog">
            <p class="html-block-delete-eyebrow">Delete block</p>
            <h2>Delete this content block?</h2>
            <p>This removes the block from the draft. You can still use undo after deleting.</p>
            <div class="html-block-delete-actions">
              <button type="button" data-action="cancel">Cancel</button>
              <button type="button" data-action="delete">Delete Block</button>
            </div>
          </div>
        `;
        function removeConfirmation() {
          confirmation.remove();
          document.removeEventListener("keydown", handleConfirmationKeyDown);
        }
        function handleConfirmationKeyDown(event: KeyboardEvent) {
          if (event.key === "Escape") {
            removeConfirmation();
          }
        }
        confirmation.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const action = target.dataset.action;
          if (action === "cancel") {
            removeConfirmation();
          }
          if (action === "delete") {
            removeConfirmation();
            deleteHtmlBlock();
          }
          if (target === confirmation) {
            removeConfirmation();
          }
        });
        document.body.appendChild(confirmation);
        document.addEventListener("keydown", handleConfirmationKeyDown);
      }

      let editableRegions: HTMLElement[] = [];
      function setupEditableRegions() {
        editableRegions = Array.from(content.querySelectorAll<HTMLElement>("[data-html-block-editable]"));
        editableRegions.forEach((editableRegion) => {
          editableRegion.contentEditable = "true";
          editableRegion.spellcheck = true;
          editableRegion.addEventListener("blur", updateHtmlBlockContent);
        });
      }
      setupEditableRegions();

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "html-block-edit";
      editButton.textContent = latexBlockElement() ? "Edit Equation" : "Edit HTML";
      editButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showSourceEditor();
      });
      if (editableRegions.length === 0) {
        wrapper.appendChild(editButton);
      } else {
        const controls = document.createElement("div");
        controls.className = "html-block-controls";

        const editSourceButton = document.createElement("button");
        editSourceButton.type = "button";
        editSourceButton.textContent = latexBlockElement() ? "Edit Equation" : "Edit HTML";
        editSourceButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          showSourceEditor();
        });

        const duplicateButton = document.createElement("button");
        duplicateButton.type = "button";
        duplicateButton.textContent = "Duplicate";
        duplicateButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          duplicateHtmlBlock();
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          showDeleteConfirmation();
        });

        controls.appendChild(editSourceButton);
        controls.appendChild(duplicateButton);
        controls.appendChild(deleteButton);
        wrapper.appendChild(controls);
      }

      return {
        dom: wrapper,
        ignoreMutation: (mutation) => editableRegions.some((region) => region.contains(mutation.target)),
        stopEvent: (event) => {
          const target = event.target;
          return target instanceof globalThis.Node && editableRegions.some((region) => region.contains(target));
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== currentNode.type.name) return false;
          currentNode = updatedNode;
          if (document.activeElement && editableRegions.some((region) => region.contains(document.activeElement))) {
            return true;
          }
          content.innerHTML = updatedNode.attrs.content || "";
          setupEditableRegions();
          return true;
        },
      };
    };
  },
});
