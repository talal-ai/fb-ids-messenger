const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'contracts', 'schemas');

function loadJson(name) {
    const p = path.join(SCHEMA_DIR, name);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildValidators() {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);

    const common = loadJson('common-types.json');
    // $ref in contract files uses `common-types.json` relative to the contracts/schemas folder.
    // Register under the resolved URI so cross-file $ref resolves.
    const commonForRef = { ...common, $id: 'https://fb-ids-messenger/contracts/common-types.json' };
    ajv.addSchema(commonForRef);

    const inbound = loadJson('inbound-event.v1.json');
    const replyCommand = loadJson('reply-command.v1.json');

    return {
        validateInboundEvent: ajv.compile(inbound),
        validateReplyCommand: ajv.compile(replyCommand),
    };
}

let _validators;

function getValidators() {
    if (!_validators) {
        _validators = buildValidators();
    }
    return _validators;
}

/**
 * @param {string} kind
 * @param {unknown} payload
 * @returns {{ ok: true } | { ok: false, errors: import('ajv').ErrorObject[] }}
 */
function validate(kind, payload) {
    const v = getValidators();
    if (kind === 'InboundEvent') {
        const fn = v.validateInboundEvent;
        if (fn(payload)) return { ok: true };
        return { ok: false, errors: fn.errors || [] };
    }
    if (kind === 'ReplyCommand') {
        const fn = v.validateReplyCommand;
        if (fn(payload)) return { ok: true };
        return { ok: false, errors: fn.errors || [] };
    }
    throw new Error(`Unknown contract kind: ${kind}`);
}

module.exports = { validate, getValidators, buildValidators };
