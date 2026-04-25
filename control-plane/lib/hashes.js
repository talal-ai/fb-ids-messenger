const crypto = require('crypto');

/**
 * SHA-256 hex of UTF-8 bytes (literal-send L2).
 * @param {string} s
 * @returns {string}
 */
function sha256Utf8(s) {
    return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/**
 * Deterministic inbound event hash for dedup and contract event_hash.
 * Locked formula for v1: includes detector_source so network vs sidebar are distinct rows if both fire.
 * @param {{ account_id: string, conversation_id: string, sender_name: string, body_raw: string, detected_at: number, detector_source: string }} fields
 */
function computeInboundEventHash(fields) {
    const bucket = Math.floor(Number(fields.detected_at) / 5000);
    const payload = [
        fields.account_id,
        fields.conversation_id,
        fields.sender_name,
        fields.body_raw,
        String(bucket),
        fields.detector_source,
    ].join('|');
    return sha256Utf8(payload);
}

module.exports = { sha256Utf8, computeInboundEventHash };
