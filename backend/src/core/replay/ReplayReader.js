import { projectLoopState } from '../loop/LoopProjector.js';
import { EventReplay } from './EventReplay.js';
import { ReplayReport } from './ReplayReport.js';
export class ReplayReader {
    durable;
    constructor(durable) {
        this.durable = durable;
    }
    read(input = {}) {
        if (input.runId)
            return this.durable.readRunEvents(input.runId);
        if (input.threadId)
            return this.durable.readThreadEvents(input.threadId);
        return this.durable.readEvents(input);
    }
    async readWithLoopProjection(input = {}) {
        const events = await this.read(input);
        const loopId = input.loopId ?? events.find(event => event.loopId)?.loopId;
        return {
            events,
            loopState: loopId ? projectLoopState(events.filter(event => event.loopId === loopId || event.eventType.startsWith('loop_'))) : undefined,
        };
    }
    async buildLoopReplay(loopId) {
        const events = await this.durable.readEvents({ loopId });
        return {
            loopId,
            events,
            timeline: new EventReplay().buildTimeline(events),
            state: projectLoopState(events),
        };
    }
    async buildGatewayTimeline(input = {}) {
        const events = await this.durable.readEvents();
        return new EventReplay().buildTimeline(events.filter(event => {
            if (!event.eventType.startsWith('gateway_'))
                return false;
            const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
            if (input.gatewayId && payload.gatewayId !== input.gatewayId)
                return false;
            if (input.channelId && payload.channelId !== input.channelId)
                return false;
            if (input.inboundId && payload.inboundId !== input.inboundId)
                return false;
            if (input.deliveryId && payload.deliveryId !== input.deliveryId)
                return false;
            return true;
        }));
    }
    replayLoop(loopId) {
        return this.buildLoopReplay(loopId);
    }
    async buildLoopReplayMarkdown(loopId) {
        const replay = await this.buildLoopReplay(loopId);
        return new ReplayReport().toMarkdown({
            title: 'Pando Loop Replay',
            timeline: replay.timeline,
            loopState: replay.state,
        });
    }
}
