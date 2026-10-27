import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { BlockId } from "./rich-text-editor.types";

/** Generates a `BlockId` — `crypto.randomUUID()` where available, otherwise a time/random fallback for older runtimes. */
export function generateBlockId(): BlockId {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `block_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** Top-level block node types StarterKit registers, which get a stable `id` attribute out of the box. Custom analytical blocks add their own name to `createBlockIdExtension`'s `types` when registered. */
const DEFAULT_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "codeBlock",
  "horizontalRule",
];

/**
 * Assigns every top-level block a stable `id` attribute (rendered as
 * `data-block-id`) the moment it's created, via an `appendTransaction`
 * plugin — not a lazy default, so the ID is part of the actual document
 * state and survives `getJSON()`. `rich-text-editor-block-menu.tsx`'s
 * duplicate/delete/move commands, and any future block-level comment or
 * backlink feature, key off this ID.
 */
function createBlockIdExtension(types: readonly string[]) {
  return Extension.create({
    addGlobalAttributes() {
      return [
        {
          attributes: {
            id: {
              default: null,
              parseHTML: (element: HTMLElement) =>
                element.getAttribute("data-block-id"),
              // `attributes` is typed `Record<string, any>` by Tiptap's own
              // `Attribute["renderHTML"]` — narrowing the parameter to
              // `{ id: BlockId | null }` makes this function's type
              // incompatible with that signature (contravariance), even
              // though it's safe at runtime.
              renderHTML: (attributes: Record<string, unknown>) =>
                attributes.id
                  ? {
                      "data-block-id": attributes.id,
                    }
                  : {},
            },
          },
          types: [
            ...types,
          ],
        },
      ];
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          appendTransaction: (transactions, _oldState, newState) => {
            if (!transactions.some((transaction) => transaction.docChanged)) {
              return null;
            }
            let transaction = newState.tr;
            let changed = false;
            newState.doc.descendants((node: ProseMirrorNode, pos: number) => {
              if (!types.includes(node.type.name)) return;
              if (node.attrs.id) return;
              transaction = transaction.setNodeAttribute(
                pos,
                "id",
                generateBlockId(),
              );
              changed = true;
            });
            return changed ? transaction : null;
          },
          key: new PluginKey("blockId"),
        }),
      ];
    },
    name: "blockId",
  });
}

export interface BaseExtensionsOptions {
  /** Placeholder shown in an empty document. */
  readonly placeholder?: string;
  /** Additional top-level node type names (custom analytical blocks) that should also receive a stable `id` — pass each block's own node `name`. */
  readonly blockTypes?: readonly string[];
}

/**
 * The editor's built-in extension set: StarterKit plus the text-formatting
 * marks/nodes from the spec (underline, link, alignment, highlight,
 * sub/superscript, task lists) and the `BlockId` plugin. Analytical blocks
 * (`chart-block.tsx`, `kpi-block.tsx`, …) and the slash-command suggestion
 * are registered separately, via `RichTextEditorProps.extensions`.
 */
export function baseExtensions({
  placeholder = "Write, or type “/” for commands…",
  blockTypes = [],
}: BaseExtensionsOptions = {}) {
  return [
    StarterKit.configure({
      heading: {
        levels: [
          1,
          2,
          3,
        ],
      },
      link: false,
    }),
    Underline,
    Link.configure({
      autolink: true,
      openOnClick: false,
    }),
    TextAlign.configure({
      types: [
        "heading",
        "paragraph",
      ],
    }),
    Highlight,
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Placeholder.configure({
      placeholder,
    }),
    createBlockIdExtension([
      ...DEFAULT_BLOCK_TYPES,
      ...blockTypes,
    ]),
  ];
}
