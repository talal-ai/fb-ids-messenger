const fs = require('fs');
const path = require('path');
const { sha256Utf8, computeInboundEventHash } = require('./hashes');

describe('hashes', () => {
    test('sha256Utf8 matches literal-send fixture vector', () => {
        const { vectors } = require('../../contracts/fixtures/literal-send.hash-vectors.json');
        for (const v of vectors) {
            expect(sha256Utf8(v.input)).toBe(v.sha256);
        }
    });

    test('inbound-event.valid fixture event_hash matches formula', () => {
        const p = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'fixtures', 'inbound-event.valid.json'), 'utf8')
        );
        const h = computeInboundEventHash({
            account_id: p.account_id,
            conversation_id: p.conversation_id,
            sender_name: p.sender_name,
            body_raw: p.body_raw,
            detected_at: p.detected_at,
            detector_source: p.detector_source,
        });
        expect(h).toBe(p.event_hash);
    });

    test('computeInboundEventHash is deterministic', () => {
        const a = computeInboundEventHash({
            account_id: 'acc_1',
            conversation_id: 'c1',
            sender_name: 'Bob',
            body_raw: 'hi',
            detected_at: 1710000000000,
            detector_source: 'sidebar',
        });
        const b = computeInboundEventHash({
            account_id: 'acc_1',
            conversation_id: 'c1',
            sender_name: 'Bob',
            body_raw: 'hi',
            detected_at: 1710000000000,
            detector_source: 'sidebar',
        });
        expect(a).toBe(b);
        expect(a).toMatch(/^[a-f0-9]{64}$/);
    });
});
