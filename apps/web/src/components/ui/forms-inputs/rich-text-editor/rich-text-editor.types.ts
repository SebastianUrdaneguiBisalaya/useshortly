import type { JSONContent } from '@tiptap/react';

/** Stable identifier assigned to every top-level block when it's created; used by block actions (duplicate/delete/move/convert) and, later, by block-level comments/backlinks. */
export type BlockId = string;

/** Metadata carried alongside a block's `BlockId`, independent of its content. */
export interface BlockMetadata {
	readonly id: BlockId;
	readonly createdAt?: string;
	readonly updatedAt?: string;
}

/** The editor's content, always JSON — never treat HTML as the source of truth. Named `Value`, not `Content`, so it doesn't collide with the `RichTextEditor.Content` component. */
export type RichTextEditorValue = JSONContent;
