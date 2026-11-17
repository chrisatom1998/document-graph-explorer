/**
 * electron-builder afterPack hook: flip Electron's runtime "fuses" off.
 *
 * At their defaults, a packaged, signed Electron app is a code-execution
 * gadget: ELECTRON_RUN_AS_NODE turns the signed binary into a general-purpose
 * Node interpreter, and --inspect lets any local process attach a debugger to
 * it. Because the app is signed and (once the user grants them) holds TCC
 * permissions, that inherits our identity and privileges. None of these are
 * needed at runtime here, so turn them off and require the app to load only
 * from a validated asar.
 */
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('node:path');

/**
 * Path of the thing to flip fuses on. electron-builder names the macOS bundle
 * and the Windows exe after productName ("Document Graph Explorer"), but the
 * Linux executable after packager.executableName (the lower-cased package
 * name, "document-graph-explorer", unless build.executableName overrides it).
 */
function resolveBinaryPath({ appOutDir, packager, electronPlatformName }) {
  const appName = packager.appInfo.productFilename;
  if (electronPlatformName === 'darwin') return path.join(appOutDir, `${appName}.app`);
  if (electronPlatformName === 'win32') return path.join(appOutDir, `${appName}.exe`);
  if (electronPlatformName === 'linux') return path.join(appOutDir, packager.executableName);
  return path.join(appOutDir, appName);
}

exports.default = async function hardenFuses(context) {
  const { electronPlatformName } = context;
  const binary = resolveBinaryPath(context);

  await flipFuses(binary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
      electronPlatformName === 'darwin',
  });
  console.log(`harden-fuses: locked down ${path.basename(binary)}`);
};
exports.resolveBinaryPath = resolveBinaryPath;
