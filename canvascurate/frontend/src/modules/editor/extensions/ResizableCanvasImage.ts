import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { preservedAttributes } from "./extensionAttributes";

const CanvasImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...preservedAttributes([
        "id",
        "class",
        "style",
        "title",
        "role",
        "aria-label",
        "aria-hidden",
        "data-api-endpoint",
        "data-api-returntype",
        "data-ally-user-updated-alt",
        "data-canvas-file-id",
        "data-decorative",
      ]),
    };
  },
});

function imageSrcMatches(attrSrc: string | null, domSrc: string) {
  if (!attrSrc) return false;
  if (attrSrc === domSrc) return true;
  try {
    return new URL(attrSrc, window.location.origin).href === domSrc;
  } catch {
    return domSrc.endsWith(attrSrc);
  }
}

const IMAGE_ALIGN_STYLES: Record<string, string> = {
  left: "",
  center: "display:block;margin-left:auto;margin-right:auto;",
  right: "display:block;margin-left:auto;margin-right:0;",
  "float-left": "float:left;margin:0 12px 8px 0;",
  "float-right": "float:right;margin:0 0 8px 12px;",
};

export const ResizableCanvasImage = CanvasImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("width") || element.style.width?.replace("px", "") || null,
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("height") || element.style.height?.replace("px", "") || null,
      },
      align: {
        default: "left",
        parseHTML: (element: HTMLElement) => {
          const style = element.getAttribute("style") || "";
          if (style.includes("float:right") || style.includes("float: right")) return "float-right";
          if (style.includes("float:left") || style.includes("float: left")) return "float-left";
          if (style.includes("margin-left:auto") && style.includes("margin-right:auto")) return "center";
          if (style.includes("margin-left:auto") || style.includes("margin-left: auto")) return "right";
          return "left";
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const { align, style, width, height, ...rest } = HTMLAttributes;
    const widthStyle = width ? `width:${String(width)}${String(width).includes("%") ? "" : "px"};` : "";
    const nextStyle = [style, IMAGE_ALIGN_STYLES[String(align || "left")] || "", widthStyle].filter(Boolean).join("");
    return ["img", mergeAttributes(rest, width ? { width } : {}, height ? { height } : {}, nextStyle ? { style: nextStyle } : {})];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageSize: (attrs: Record<string, unknown>) => ({ commands }) => commands.updateAttributes("image", attrs),
    };
  },

  addProseMirrorPlugins() {
    let overlayEl: HTMLElement | null = null;
    let selectedImgPos: number | null = null;
    let selectedImgDom: HTMLImageElement | null = null;
    let resizeState: {
      pos: number;
      startX: number;
      startWidth: number;
      startHeight: number;
      aspectRatio: number;
      newWidth?: number;
      newHeight?: number;
    } | null = null;
    const editor = this.editor;

    function removeOverlay() {
      overlayEl?.remove();
      overlayEl = null;
      selectedImgPos = null;
      selectedImgDom = null;
    }

    function positionOverlay(viewDom: HTMLElement) {
      if (!overlayEl || !selectedImgDom) return;
      const wrapper = viewDom.parentElement;
      if (!wrapper) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const imageRect = selectedImgDom.getBoundingClientRect();
      overlayEl.style.top = `${imageRect.top - wrapperRect.top + wrapper.scrollTop}px`;
      overlayEl.style.left = `${imageRect.left - wrapperRect.left + wrapper.scrollLeft}px`;
      overlayEl.style.width = `${imageRect.width}px`;
      overlayEl.style.height = `${imageRect.height}px`;
    }

    function showOverlay(pos: number, imgDom: HTMLImageElement) {
      removeOverlay();
      const wrapper = editor.view.dom.parentElement as HTMLElement | null;
      if (!wrapper) return;
      selectedImgPos = pos;
      selectedImgDom = imgDom;
      if (window.getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";

      overlayEl = document.createElement("div");
      overlayEl.className = "image-resize-overlay";

      const handle = document.createElement("div");
      handle.className = "image-resize-handle";
      handle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const startWidth = imgDom.offsetWidth;
        const startHeight = imgDom.offsetHeight || startWidth;
        resizeState = {
          pos,
          startX: event.clientX,
          startWidth,
          startHeight,
          aspectRatio: startWidth / startHeight,
        };

        function onMove(moveEvent: MouseEvent) {
          if (!resizeState) return;
          const cellEl = imgDom.closest("td, th") as HTMLElement | null;
          const maxWidth = cellEl ? Math.max(80, cellEl.clientWidth - 16) : 1200;
          const nextWidth = Math.min(maxWidth, Math.max(50, resizeState.startWidth + moveEvent.clientX - resizeState.startX));
          const nextHeight = Math.round(nextWidth / resizeState.aspectRatio);
          imgDom.style.width = `${nextWidth}px`;
          imgDom.style.height = `${nextHeight}px`;
          if (overlayEl) {
            overlayEl.style.width = `${nextWidth}px`;
            overlayEl.style.height = `${nextHeight}px`;
          }
          resizeState.newWidth = nextWidth;
          resizeState.newHeight = nextHeight;
        }

        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          if (resizeState?.newWidth) {
            const node = editor.view.state.doc.nodeAt(resizeState.pos);
            if (node?.type.name === "image") {
              editor.view.dispatch(editor.view.state.tr.setNodeMarkup(resizeState.pos, undefined, {
                ...node.attrs,
                width: resizeState.newWidth,
                height: resizeState.newHeight,
              }));
            }
          }
          resizeState = null;
        }

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
      overlayEl.appendChild(handle);
      wrapper.appendChild(overlayEl);
      positionOverlay(editor.view.dom);
    }

    return [
      new Plugin({
        key: new PluginKey("resizableCanvasImage"),
        view(editorView) {
          function onClick(event: MouseEvent) {
            const target = event.target as HTMLElement;
            if (target.closest(".image-resize-overlay")) return;
            if (target.tagName !== "IMG") {
              removeOverlay();
              return;
            }
            let found = false;
            editorView.state.doc.descendants((child, pos) => {
              if (found) return false;
              if (child.type.name === "image" && imageSrcMatches(child.attrs.src, (target as HTMLImageElement).src)) {
                showOverlay(pos, target as HTMLImageElement);
                found = true;
                return false;
              }
            });
          }

          function onScroll() {
            positionOverlay(editorView.dom);
          }

          editorView.dom.addEventListener("click", onClick);
          window.addEventListener("scroll", onScroll, true);
          return {
            update() {
              if (resizeState) return;
              if (selectedImgPos !== null && (!editorView.state.doc.nodeAt(selectedImgPos) || !selectedImgDom?.isConnected)) {
                removeOverlay();
              } else {
                positionOverlay(editorView.dom);
              }
            },
            destroy() {
              editorView.dom.removeEventListener("click", onClick);
              window.removeEventListener("scroll", onScroll, true);
              removeOverlay();
            },
          };
        },
      }),
    ];
  },
});
