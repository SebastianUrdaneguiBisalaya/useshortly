"use client";

import type { Editor } from "@tiptap/react";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import { Icon } from "../../foundations/icon/icon";
import { cn } from "../../utils/tailwind/cn";

function duplicateBlock(editor: Editor, getPos: () => number | undefined) {
  const pos = getPos();
  if (pos === undefined) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const json = node.toJSON();
  // Drop the stable `id`: the `blockId` plugin's `appendTransaction` (see
  // `rich-text-editor-extensions.ts`) assigns the duplicate a fresh one on
  // the next transaction, since block IDs must stay unique per block.
  const { id: _id, ...attrsWithoutId } = json.attrs ?? {};
  editor
    .chain()
    .focus()
    .insertContentAt(pos + node.nodeSize, {
      ...json,
      attrs: attrsWithoutId,
    })
    .run();
}

function deleteBlock(editor: Editor, getPos: () => number | undefined) {
  const pos = getPos();
  if (pos === undefined) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor
    .chain()
    .focus()
    .deleteRange({
      from: pos,
      to: pos + node.nodeSize,
    })
    .run();
}

/** Texts rendered by `BlockMenu`. Pass `lang` to override any of them. */
export interface BlockMenuLang {
  /** Accessible name of the drag handle. */
  dragToReorder: string;
  /** Accessible name of the duplicate button. */
  duplicateBlock: string;
  /** Tooltip of the duplicate button. */
  duplicate: string;
  /** Accessible name of the delete button. */
  deleteBlock: string;
  /** Tooltip of the delete button. */
  delete: string;
}

/** English defaults for `BlockMenuLang`. */
export const defaultBlockMenuLang: BlockMenuLang = {
  delete: "Delete",
  deleteBlock: "Delete block",
  dragToReorder: "Drag to reorder",
  duplicate: "Duplicate",
  duplicateBlock: "Duplicate block",
};

export interface BlockMenuProps {
  readonly editor: Editor;
  /** The node's current document position — a Tiptap `NodeViewProps.getPos`. */
  readonly getPos: () => number | undefined;
  /**
   * Called while the drag handle is pressed, so the enclosing `NodeViewWrapper`
   * can flip its own `draggable` attribute on only for that window — native
   * HTML5 drag then starts solely from the handle, leaving ordinary text
   * selection inside the block untouched.
   */
  readonly onDragHandlePointerDown?: () => void;
  readonly onDragHandlePointerUp?: () => void;
  /**
   * Texts rendered by this menu. Merges over English defaults.
   * @default defaultBlockMenuLang
   */
  readonly lang?: Partial<BlockMenuLang>;
  readonly className?: string;
}

/**
 * Hover-revealed controls shared by every analytical block's `NodeView`:
 * a drag handle plus duplicate/delete/move-up/move-down. Block-specific
 * actions (e.g. `ChartBlock`'s "Edit chart") are rendered by the block
 * itself, next to this menu, not folded into it.
 */
export function BlockMenu({
  editor,
  getPos,
  onDragHandlePointerDown,
  onDragHandlePointerUp,
  lang,
  className,
}: BlockMenuProps) {
  const resolvedLang = { ...defaultBlockMenuLang, ...lang };
  const buttonClassName = cn(
    "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-in-out hover:bg-muted hover:text-foreground",
    "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
  );

  return (
    <div
      className={cn(
        "-left-8 absolute top-1 flex flex-col items-center gap-0.5 opacity-0 transition-opacity duration-150 ease-in-out group-hover:opacity-100 group-focus-within:opacity-100",
        className,
      )}
      contentEditable={false}
    >
      <button
        aria-label={resolvedLang.dragToReorder}
        className={cn(buttonClassName, "cursor-grab active:cursor-grabbing")}
        data-drag-handle=""
        onPointerDown={onDragHandlePointerDown}
        onPointerUp={onDragHandlePointerUp}
        type="button"
      >
        <Icon
          icon={GripVertical}
          size="xs"
        />
      </button>
      <button
        aria-label={resolvedLang.duplicateBlock}
        className={buttonClassName}
        onClick={() => duplicateBlock(editor, getPos)}
        title={resolvedLang.duplicate}
        type="button"
      >
        <Icon
          icon={Copy}
          size="xs"
        />
      </button>
      <button
        aria-label={resolvedLang.deleteBlock}
        className={buttonClassName}
        onClick={() => deleteBlock(editor, getPos)}
        title={resolvedLang.delete}
        type="button"
      >
        <Icon
          icon={Trash2}
          size="xs"
        />
      </button>
    </div>
  );
}
