import { readFile, writeFile } from 'node:fs/promises';
import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { optionalNonNegativeInteger, optionalString, requiredString, requiredText, resolveWorkspacePath } from '../shared/index.js';
export const NotebookEditTool = {
    name: 'notebook_edit',
    description: 'Edit Jupyter .ipynb cells by inserting, replacing, or deleting JSON notebook cells.',
    safety: 'workspace_write',
    platforms: ['all'],
    behavior: { reads: true, writes: true },
    concurrency: 'serial',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            action: { type: 'string', enum: ['insert', 'replace', 'delete'] },
            index: { type: 'integer', minimum: 0 },
            cellType: { type: 'string', enum: ['code', 'markdown', 'raw'] },
            source: { type: 'string' },
        },
        required: ['path', 'action'],
    },
    async execute(toolUse, context) {
        try {
            const path = resolveWorkspacePath(context, requiredString(toolUse.input, 'path'));
            if (!path.relativePath.endsWith('.ipynb'))
                throw new Error('notebook_edit only supports .ipynb files in v1');
            const notebook = JSON.parse(await readFile(path.absolutePath, 'utf8'));
            if (!Array.isArray(notebook.cells))
                throw new Error('notebook file must contain a cells array');
            const action = requiredString(toolUse.input, 'action');
            const index = optionalNonNegativeInteger(toolUse.input, 'index', notebook.cells.length);
            if (action === 'insert') {
                notebook.cells.splice(index, 0, createCell(optionalString(toolUse.input, 'cellType') ?? 'code', requiredText(toolUse.input, 'source')));
            }
            else if (action === 'replace') {
                if (!notebook.cells[index])
                    throw new Error(`No notebook cell at index ${index}`);
                notebook.cells[index] = createCell(optionalString(toolUse.input, 'cellType') ?? 'code', requiredText(toolUse.input, 'source'));
            }
            else if (action === 'delete') {
                if (!notebook.cells[index])
                    throw new Error(`No notebook cell at index ${index}`);
                notebook.cells.splice(index, 1);
            }
            else {
                throw new Error('action must be insert, replace, or delete');
            }
            await writeFile(path.absolutePath, `${JSON.stringify(notebook, null, 2)}\n`, 'utf8');
            return createTextResult(toolUse.id, JSON.stringify({ path: path.relativePath, action, index, cellCount: notebook.cells.length }, null, 2), true, {
                path: path.relativePath,
                action,
                cellCount: notebook.cells.length,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'notebook_edit' });
        }
    },
};
function createCell(cellType, source) {
    if (cellType !== 'code' && cellType !== 'markdown' && cellType !== 'raw')
        throw new Error('cellType must be code, markdown, or raw');
    const cell = {
        cell_type: cellType,
        metadata: {},
        source: source.endsWith('\n') ? source.split(/(?<=\n)/) : [`${source}\n`],
    };
    if (cellType === 'code') {
        cell.outputs = [];
        cell.execution_count = null;
    }
    return cell;
}
