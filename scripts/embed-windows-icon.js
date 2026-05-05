const path = require('path');
const rcedit = require('rcedit');

// Runs after electron-builder packages the app, before NSIS wraps it.
// We embed the icon and version-info ourselves because electron-builder's
// bundled rcedit lives inside winCodeSign-2.6.0.7z, whose macOS dylib
// symlinks fail to extract on Windows without Developer Mode / admin.
exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'win32') return;

    const productFilename = context.packager.appInfo.productFilename;
    const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
    const iconPath = path.join(context.packager.info.projectDir, 'logo.ico');
    const version = context.packager.appInfo.version;

    console.log(`[afterPack] Embedding icon from ${iconPath} into ${exePath}`);

    await rcedit(exePath, {
        icon: iconPath,
        'version-string': {
            ProductName: 'Multi FB Manager',
            FileDescription: 'Multi FB Manager',
            CompanyName: 'Multi FB Manager',
            LegalCopyright: 'Multi FB Manager',
            OriginalFilename: `${productFilename}.exe`,
        },
        'product-version': version,
        'file-version': version,
    });

    console.log('[afterPack] Icon embedded successfully');
};
