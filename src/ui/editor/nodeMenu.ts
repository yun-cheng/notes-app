import type { NodeViewRenderer } from '@tiptap/core';

/**
 * A block's node view that lets a right-click through to the editor, for its own menu (`useEditorMenu`): TipTap's
 * node views keep every other event to themselves, so a right-click on a photo or a file got no menu at all.
 */
export function withEditorMenu(render: NodeViewRenderer): NodeViewRenderer {
  return (props) => {
    const view = render(props) as { stopEvent?: (event: Event) => boolean };
    const stop = view.stopEvent?.bind(view);
    if (stop) view.stopEvent = (event) => event.type !== 'contextmenu' && stop(event);
    return view as ReturnType<NodeViewRenderer>;
  };
}
