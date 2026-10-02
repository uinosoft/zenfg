import type cytoscape from 'cytoscape';
import { selectionKey, type GraphScene } from './panelGraphScene.ts';
import type { Selection } from './panelTypes.ts';

/** One-hop context uses recorded relations, never all edges sharing a resource ID. */
export function graphRelationFocus(scene: GraphScene, selected: Selection | undefined): ReadonlySet<string> | undefined {
    if (!selected || (selected.kind !== 'node' && selected.kind !== 'group')) return undefined;
    const primary = scene.interaction.primaryElementIdsBySelection.get(selectionKey(selected));
    if (!primary?.length) return undefined;
    const byId = new Map(scene.nodes.map(node => [node.id, node]));
    if (selected.kind === 'group' && !primary.some(id => {
        const node = byId.get(id);
        return node?.kind === 'group' && node.groupPathKey === selected.pathKey;
    })) return undefined;
    const members = new Set(primary);
    if (selected.kind === 'group') {
        // Include descendants of an expanded group, retaining internal relationships.
        for (const node of scene.nodes) {
            let parent = node.parentId;
            while (parent) {
                if (members.has(parent)) { members.add(node.id); break; }
                parent = byId.get(parent)?.parentId;
            }
        }
    }
    const focused = new Set(members);
    for (const edge of scene.edges) {
        const related = selected.kind === 'node'
            ? edge.relations.some(relation => relation.nodeIds.includes(selected.id))
            : members.has(edge.from) || members.has(edge.to);
        if (!related) continue;
        focused.add(edge.id);
        focused.add(edge.from);
        focused.add(edge.to);
    }
    // A faded compound parent would fade its otherwise focused children too.
    for (const id of [...focused]) {
        let parent = byId.get(id)?.parentId;
        while (parent) { focused.add(parent); parent = byId.get(parent)?.parentId; }
    }
    return focused;
}

export function graphFocusStyles(): cytoscape.StylesheetJson {
    return [
        { selector: 'node.semantic-muted', style: { opacity: 0.24 } },
        { selector: 'edge.semantic-muted', style: { opacity: 0.14 } },
        { selector: 'node.semantic-hover, node.semantic-selected, edge.semantic-hover, edge.semantic-selected', style: { opacity: 1 } },
    ];
}
