const fs = require('fs');
const path = require('path');

// Canonical Expo dynamic-config pattern: receive the resolved app.json contents
// as `config` from Expo's loader, then layer dynamic fields on top.
// Re-requiring app.json here would bypass any pre-processing Expo's loader did
// and trips expo-doctor's static check.
module.exports = ({ config }) => {
    const configuredPath = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
    const resolved = path.resolve(__dirname, configuredPath);

    const next = { ...config };

    if (fs.existsSync(resolved)) {
        next.android = {
            ...config.android,
            googleServicesFile: configuredPath,
        };
        console.log(`[Config] Android googleServicesFile enabled: ${configuredPath}`);
    } else if (process.env.EAS_BUILD || process.env.CI) {
        throw new Error(
            `[Config] Missing ${configuredPath}. Android push notifications require google-services.json for Firebase initialization. Build aborted.`
        );
    } else {
        console.warn(
            `[Config] ${configuredPath} not found — Android push will be disabled in this build.`
        );
    }

    return next;
};
