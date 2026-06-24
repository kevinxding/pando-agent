export class ReplayQueryError extends Error {
    code;
    query;
    constructor(code, message, query = {}) {
        super(message);
        this.name = 'ReplayQueryError';
        this.code = code;
        this.query = query;
    }
}
