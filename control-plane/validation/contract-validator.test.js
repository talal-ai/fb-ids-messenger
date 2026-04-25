const fs = require('fs');
const path = require('path');
const { validate } = require('./contract-validator');

const fixturesDir = path.join(__dirname, '..', '..', 'contracts', 'fixtures');

function load(name) {
    return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
}

describe('contract-validator', () => {
    test('valid inbound fixture passes', () => {
        const p = load('inbound-event.valid.json');
        const r = validate('InboundEvent', p);
        expect(r.ok).toBe(true);
    });

    test('invalid inbound fixture fails', () => {
        const p = load('inbound-event.invalid.missing-event-hash.json');
        const r = validate('InboundEvent', p);
        expect(r.ok).toBe(false);
    });

    test('valid reply-command passes', () => {
        const p = load('reply-command.valid.json');
        const r = validate('ReplyCommand', p);
        expect(r.ok).toBe(true);
    });

    test('invalid reply-command fails', () => {
        const p = load('reply-command.invalid.missing-idempotency-key.json');
        const r = validate('ReplyCommand', p);
        expect(r.ok).toBe(false);
    });
});
