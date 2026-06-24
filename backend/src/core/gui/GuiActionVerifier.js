export class GuiActionVerifier {
    adapter;
    constructor(adapter) {
        this.adapter = adapter;
    }
    verify(action, context) {
        return this.adapter.verify(action, context);
    }
}
