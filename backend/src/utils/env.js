export function isEnvTruthy(value) {
    if (typeof value === 'boolean')
        return value;
    if (!value)
        return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
export function isEnvDefinedFalsy(value) {
    if (value === undefined)
        return false;
    if (typeof value === 'boolean')
        return !value;
    if (!value)
        return false;
    return ['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}
export function parseEnvAssignments(values) {
    const parsed = {};
    for (const value of values ?? []) {
        const [key, ...rest] = value.split('=');
        if (!key || rest.length === 0) {
            throw new Error(`Invalid environment assignment: ${value}`);
        }
        parsed[key] = rest.join('=');
    }
    return parsed;
}
export function getNumericEnv(name, fallback) {
    const runtime = globalThis;
    const raw = runtime.process?.env?.[name];
    if (!raw)
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}
