export function renderGoldenTraceValidationReport(results) {
    const passed = results.filter(result => result.ok).length;
    const failed = results.length - passed;
    const lines = [
        '# Replay Golden Trace Validation',
        '',
        'Status: ' + (failed === 0 ? 'ok' : 'failed'),
        'Traces: ' + results.length,
        'Passed: ' + passed,
        'Failed: ' + failed,
        '',
        '## Results',
        '',
        '| Trace | Status | Events | Incidents | Graph Nodes | Graph Edges |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
    ];
    for (const result of results) {
        lines.push([
            result.traceName,
            result.ok ? 'ok' : 'failed',
            String(result.report.metadata.eventCount),
            String(result.report.incidents.length),
            String(result.report.graph.nodes.length),
            String(result.report.graph.edges.length),
        ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    const failedResults = results.filter(result => !result.ok);
    if (failedResults.length) {
        lines.push('', '## Failures', '');
        for (const result of failedResults) {
            lines.push('### ' + result.traceName, '');
            for (const error of result.errors)
                lines.push('- ' + error);
            lines.push('');
        }
    }
    return lines.join('\n') + '\n';
}
