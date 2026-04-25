const { startHttpServer } = require('./http/server');
const { acceptInboundEvent } = require('./services/inbound-event-service');
const { acceptReplyCommand } = require('./services/reply-command-service');

/**
 * @param {{ getDb: () => import('better-sqlite3').Database, queueReplyFromCommand: (o: Record<string, unknown>) => Promise<Record<string, unknown>> }} deps
 */
function createControlPlane(deps) {
    const { getDb, queueReplyFromCommand } = deps;
    return {
        acceptInboundEvent: (payload) => acceptInboundEvent(getDb(), payload),
        acceptReplyCommand: (payload) => acceptReplyCommand(getDb(), payload, queueReplyFromCommand),
    };
}

module.exports = {
    createControlPlane,
    startHttpServer,
    acceptInboundEvent,
    acceptReplyCommand,
};
