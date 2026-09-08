import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const deployDirectory = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = join(deployDirectory, '..');
const androidDirectory = join(repositoryRoot, 'apps', 'android');

const verifierBadging = [
  "package: name='com.kumargg.jarviscommand' versionCode='1' versionName='0.1.0'",
  "sdkVersion:'23'",
  "targetSdkVersion:'36'",
  "uses-permission: name='com.kumargg.jarviscommand.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'",
  '',
].join('\n');

const verifierResources = [
  'resource 0x7f0d0001 com.kumargg.jarviscommand:string/launchUrl: t=0x03 d=0x00000000 (s=0x0008 r=0x00)',
  '  (string8) "https://command.sharma-house.com/"',
  'resource 0x7f0d0002 com.kumargg.jarviscommand:string/fallbackType: t=0x03 d=0x00000001 (s=0x0008 r=0x00)',
  '  (string8) "customtabs"',
  'resource 0x7f0d0003 com.kumargg.jarviscommand:string/hostName: t=0x03 d=0x00000002 (s=0x0008 r=0x00)',
  '  (string8) "command.sharma-house.com"',
  '',
].join('\n');

function verifierManifestTree({
  weakReceiverPermission = false,
  launcherOwnsContract = true,
  duplicateProductionHandler = false,
  extraDataAttribute = false,
  nestedReceiverPermission = false,
  nestedLauncher = false,
  extraMetadataAttribute = false,
} = {}) {
  const receiverProtection = weakReceiverPermission ? '0x0' : '0x2';
  const unrelatedPermission = weakReceiverPermission
    ? [
      '  E: permission (line=8)',
      '    A: android:name(0x01010003)="com.example.UNRELATED" (Raw: "com.example.UNRELATED")',
      '    A: android:protectionLevel(0x01010009)=(type 0x11)0x2',
    ]
    : [];
  const contract = [
    '      E: meta-data (line=20)',
    '        A: android:name(0x01010003)="android.support.customtabs.trusted.DEFAULT_URL" (Raw: "android.support.customtabs.trusted.DEFAULT_URL")',
    '        A: android:value(0x01010024)=@0x7f0d0001',
    ...(extraMetadataAttribute ? [
      '        A: android:resource(0x01010025)=@0x7f0d0002',
    ] : []),
    '      E: meta-data (line=23)',
    '        A: android:name(0x01010003)="android.support.customtabs.trusted.FALLBACK_STRATEGY" (Raw: "android.support.customtabs.trusted.FALLBACK_STRATEGY")',
    '        A: android:value(0x01010024)=@0x7f0d0002',
    '      E: intent-filter (line=26)',
    '        A: android:autoVerify(0x010104ee)=(type 0x12)0xffffffff',
    '        E: action (line=27)',
    '          A: android:name(0x01010003)="android.intent.action.VIEW" (Raw: "android.intent.action.VIEW")',
    '        E: category (line=29)',
    '          A: android:name(0x01010003)="android.intent.category.DEFAULT" (Raw: "android.intent.category.DEFAULT")',
    '        E: category (line=31)',
    '          A: android:name(0x01010003)="android.intent.category.BROWSABLE" (Raw: "android.intent.category.BROWSABLE")',
    '        E: data (line=33)',
    '          A: android:scheme(0x01010027)="https" (Raw: "https")',
    '          A: android:host(0x01010028)=@0x7f0d0003',
    ...(extraDataAttribute ? [
      '          A: android:pathPrefix(0x01010031)="/app" (Raw: "/app")',
    ] : []),
  ];
  return [
    'N: android=http://schemas.android.com/apk/res/android',
    'E: manifest (line=2)',
    ...(nestedReceiverPermission ? [
      '  E: queries (line=3)',
      '    E: permission (line=4)',
      '      A: android:name(0x01010003)="com.kumargg.jarviscommand.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" (Raw: "com.kumargg.jarviscommand.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")',
      `      A: android:protectionLevel(0x01010009)=(type 0x11)${receiverProtection}`,
    ] : [
      '  E: permission (line=4)',
      '    A: android:name(0x01010003)="com.kumargg.jarviscommand.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" (Raw: "com.kumargg.jarviscommand.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")',
      `    A: android:protectionLevel(0x01010009)=(type 0x11)${receiverProtection}`,
    ]),
    ...unrelatedPermission,
    '  E: application (line=10)',
    '    A: android:allowBackup(0x01010280)=(type 0x12)0x0',
    '    A: android:usesCleartextTraffic(0x010104ec)=(type 0x12)0x0',
    ...(nestedLauncher ? [
      '    E: service (line=13)',
      '      E: activity (line=14)',
      '        A: android:name(0x01010003)="com.kumargg.jarviscommand.LauncherActivity" (Raw: "com.kumargg.jarviscommand.LauncherActivity")',
      '        A: android:exported(0x01010010)=(type 0x12)0xffffffff',
      ...(launcherOwnsContract ? contract.map((line) => `  ${line}`) : []),
    ] : [
      '    E: activity (line=14)',
      '      A: android:name(0x01010003)="com.kumargg.jarviscommand.LauncherActivity" (Raw: "com.kumargg.jarviscommand.LauncherActivity")',
      '      A: android:exported(0x01010010)=(type 0x12)0xffffffff',
      ...(launcherOwnsContract ? contract : []),
    ]),
    ...(!launcherOwnsContract ? [
      '    E: activity (line=40)',
      '      A: android:name(0x01010003)="com.example.OtherActivity" (Raw: "com.example.OtherActivity")',
      ...contract,
    ] : []),
    ...(duplicateProductionHandler ? [
      '    E: activity (line=50)',
      '      A: android:name(0x01010003)="com.example.DuplicateActivity" (Raw: "com.example.DuplicateActivity")',
      '      A: android:exported(0x01010010)=(type 0x12)0xffffffff',
      ...contract.slice(4),
    ] : []),
    '',
  ].join('\n');
}

async function runEmbeddedApkVerifier(manifestTree) {
  const buildScript = await readFile(join(repositoryRoot, 'deploy', 'build-android-release.sh'), 'utf8');
  const startMarker = 'python3 - "${aapt}" "${apk}" <<\'PY\'\n';
  const start = buildScript.indexOf(startMarker);
  assert.notEqual(start, -1, 'release builder is missing the embedded APK verifier');
  const verifierStart = start + startMarker.length;
  const end = buildScript.indexOf('\nPY\n', verifierStart);
  assert.notEqual(end, -1, 'release builder APK verifier heredoc is unterminated');
  const verifier = buildScript.slice(verifierStart, end);

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'jarvis-command-apk-verifier-'));
  try {
    const badgingPath = join(temporaryDirectory, 'badging.txt');
    const manifestPath = join(temporaryDirectory, 'manifest.txt');
    const resourcesPath = join(temporaryDirectory, 'resources.txt');
    const fakeAapt = join(temporaryDirectory, 'aapt');
    const fakeApk = join(temporaryDirectory, 'candidate.apk');
    await Promise.all([
      writeFile(badgingPath, verifierBadging),
      writeFile(manifestPath, manifestTree),
      writeFile(resourcesPath, verifierResources),
      writeFile(fakeApk, 'not-an-apk'),
      writeFile(fakeAapt, `#!/usr/bin/env bash\nset -euo pipefail\ncase "$1:$2" in\n  dump:badging) exec cat ${JSON.stringify(badgingPath)} ;;\n  dump:xmltree) exec cat ${JSON.stringify(manifestPath)} ;;\n  dump:--values) exec cat ${JSON.stringify(resourcesPath)} ;;\n  *) exit 64 ;;\nesac\n`),
    ]);
    await chmod(fakeAapt, 0o755);
    return spawnSync('python3', ['-', fakeAapt, fakeApk], {
      encoding: 'utf8',
      input: verifier,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('Android v0.1 defines a user-permission-free HTTPS Trusted Web Activity contract', async () => {
  const twaManifestPath = join(androidDirectory, 'twa-manifest.json');
  const rootGradlePath = join(androidDirectory, 'build.gradle');
  const wrapperPropertiesPath = join(androidDirectory, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  const wrapperJarPath = join(androidDirectory, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  const gradlewPath = join(androidDirectory, 'gradlew');
  const gradlewBatPath = join(androidDirectory, 'gradlew.bat');
  const appGradlePath = join(androidDirectory, 'app', 'build.gradle');
  const androidManifestPath = join(androidDirectory, 'app', 'src', 'main', 'AndroidManifest.xml');

  assert.equal(existsSync(twaManifestPath), true, 'missing Android TWA manifest');
  assert.equal(
    existsSync(join(androidDirectory, 'manifest-checksum.txt')),
    false,
    'unused Bubblewrap SHA-1 bookkeeping must not ship as release integrity metadata',
  );
  assert.equal(existsSync(appGradlePath), true, 'missing generated Android application');
  assert.equal(existsSync(androidManifestPath), true, 'missing Android application manifest');

  const [
    twaManifestSource,
    rootGradle,
    wrapperProperties,
    wrapperJar,
    gradlew,
    gradlewBat,
    appGradle,
    androidManifest,
  ] = await Promise.all([
    readFile(twaManifestPath, 'utf8'),
    readFile(rootGradlePath, 'utf8'),
    readFile(wrapperPropertiesPath, 'utf8'),
    readFile(wrapperJarPath),
    readFile(gradlewPath),
    readFile(gradlewBatPath),
    readFile(appGradlePath, 'utf8'),
    readFile(androidManifestPath, 'utf8'),
  ]);
  const twaManifest = JSON.parse(twaManifestSource);

  assert.equal(twaManifest.packageId, 'com.kumargg.jarviscommand');
  assert.equal(twaManifest.host, 'command.sharma-house.com');
  assert.equal(twaManifest.startUrl, '/');
  assert.equal(twaManifest.fullScopeUrl, 'https://command.sharma-house.com/');
  assert.equal(twaManifest.display, 'standalone');
  assert.equal(twaManifest.fallbackType, 'customtabs');
  assert.equal(twaManifest.enableNotifications, false);
  assert.equal(twaManifest.minSdkVersion, 23);
  assert.equal(twaManifest.appVersionName, '0.1.0');
  assert.equal(twaManifest.appVersionCode, 1);
  assert.equal(twaManifest.generatorApp, 'bubblewrap-cli');
  assert.equal('webManifestUrl' in twaManifest, false, 'build must not fetch the Access-protected web manifest');

  assert.match(appGradle, /compileSdkVersion 36/);
  assert.match(appGradle, /targetSdkVersion 36/);
  assert.match(appGradle, /com\.google\.androidbrowserhelper:androidbrowserhelper:2\.7\.3/);
  assert.match(rootGradle, /mavenCentral\(\)/);
  assert.doesNotMatch(rootGradle, /jcenter\(\)/);
  assert.match(rootGradle, /com\.android\.tools\.build:gradle:8\.13\.2/);
  assert.match(wrapperProperties, /gradle-8\.13-bin\.zip/);
  assert.match(wrapperProperties, /distributionSha256Sum=20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78/);
  assert.equal(
    createHash('sha256').update(wrapperJar).digest('hex'),
    '81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f',
  );
  assert.equal(
    createHash('sha256').update(gradlew).digest('hex'),
    '734b3879d3501dce471cf0522d3bcbafe76873d9fc5129345b67fb43bd15e933',
  );
  assert.equal(
    createHash('sha256').update(gradlewBat).digest('hex'),
    '2209f919a22528af59a2af2ad97e8d056cca18e39f7d87aa3fd549a73b180150',
  );
  assert.match(androidManifest, /android:autoVerify="true"/);
  assert.match(androidManifest, /android:scheme="https"/);
  assert.doesNotMatch(androidManifest, /\s+package="com\.kumargg\.jarviscommand"/);
  assert.match(androidManifest, /android:usesCleartextTraffic="false"/);
  assert.match(androidManifest, /android:allowBackup="false"/);
  assert.doesNotMatch(androidManifest, /<uses-permission\b/);
  assert.doesNotMatch(androidManifest, /WebViewFallbackActivity/);
});

test('Android Gradle configuration avoids deprecated Groovy property assignment', async () => {
  const appGradle = await readFile(join(androidDirectory, 'app', 'build.gradle'), 'utf8');

  assert.match(appGradle, /namespace = "com\.kumargg\.jarviscommand"/);
  assert.match(appGradle, /signingConfig = signingConfigs\.release/);
  assert.match(appGradle, /checkReleaseBuilds = false/);
  assert.doesNotMatch(appGradle, /namespace "com\.kumargg\.jarviscommand"/);
  assert.doesNotMatch(appGradle, /signingConfig signingConfigs\.release/);
  assert.doesNotMatch(appGradle, /checkReleaseBuilds false/);
});

test('Android system chrome uses valid AndroidX Trusted Web Activity metadata', async () => {
  const androidManifest = await readFile(
    join(androidDirectory, 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8',
  );

  assert.match(androidManifest, /androidx\.browser\.trusted\.NAVIGATION_BAR_DIVIDER_COLOR/);
  assert.match(androidManifest, /androidx\.browser\.trusted\.NAVIGATION_BAR_DIVIDER_COLOR_DARK/);
  assert.doesNotMatch(androidManifest, /androix\.browser/);
});

test('Digital Asset Links delegates only the Jarvis Command release certificate', async () => {
  const twaManifestPath = join(androidDirectory, 'twa-manifest.json');
  const assetLinksPath = join(
    repositoryRoot,
    'apps',
    'web',
    'public',
    '.well-known',
    'assetlinks.json',
  );
  const twaManifest = JSON.parse(await readFile(twaManifestPath, 'utf8'));

  assert.equal(existsSync(assetLinksPath), true, 'missing Digital Asset Links statement');
  const assetLinks = JSON.parse(await readFile(assetLinksPath, 'utf8'));
  assert.equal(assetLinks.length, 1);
  assert.deepEqual(assetLinks[0], {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.kumargg.jarviscommand',
      sha256_cert_fingerprints: [twaManifest.fingerprints[0].value],
    },
  });
  assert.deepEqual(twaManifest.fingerprints.map(({ name }) => name), ['release']);
});

test('Android release builder keeps signing material external and verifies the signed artifact', async () => {
  const buildScriptPath = join(repositoryRoot, 'deploy', 'build-android-release.sh');
  const gitignorePath = join(repositoryRoot, '.gitignore');

  assert.equal(existsSync(buildScriptPath), true, 'missing Android release builder');
  const [buildScript, gitignore] = await Promise.all([
    readFile(buildScriptPath, 'utf8'),
    readFile(gitignorePath, 'utf8'),
  ]);

  assert.match(buildScript, /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail\numask 077\n/);
  assert.match(buildScript, /O_NOFOLLOW/);
  assert.match(buildScript, /JARVIS_COMMAND_SIGNING_PROPERTIES/);
  assert.doesNotMatch(buildScript, /(?:^|\s)(?:source|\.)\s+["']?\$?\{?signing/i);
  assert.match(buildScript, /\.\/gradlew --no-daemon clean test lintRelease assembleRelease/);
  assert.match(buildScript, /verify --verbose --print-certs/);
  assert.match(buildScript, /dump badging/);
  assert.match(buildScript, /com\.kumargg\.jarviscommand/);
  assert.match(buildScript, /DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION/);
  assert.match(buildScript, /protectionLevel/);
  assert.match(buildScript, /unexpected APK minimum SDK/);
  assert.match(buildScript, /APK allows application backup/);
  assert.match(buildScript, /APK allows cleartext traffic/);
  assert.match(buildScript, /launcher activity is not exported/);
  assert.match(buildScript, /launcher activity is missing the required TWA contract/);
  assert.match(buildScript, /direct_child_blocks\(launcher, 'meta-data'\)/);
  assert.match(buildScript, /direct_child_blocks\(launcher, 'intent-filter'\)/);
  assert.match(buildScript, /App Links filter mismatch/);
  assert.match(buildScript, /jarvis-command-v0\.1\.0\.apk/);
  assert.match(buildScript, /sha256sum/);

  const gitignoreLines = new Set(gitignore.split(/\r?\n/));
  for (const pattern of ['.gradle/', '**/build/', 'local.properties', '*.apk', '*.aab', '*.jks', '*.keystore']) {
    assert.equal(gitignoreLines.has(pattern), true, `missing .gitignore rule: ${pattern}`);
  }
});

test('Android release verifier binds signature protection to the package-scoped permission', async () => {
  const result = await runEmbeddedApkVerifier(verifierManifestTree({ weakReceiverPermission: true }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package-scoped receiver permission is not signature protected/i);
});

test('Android release verifier binds TWA metadata and App Links to LauncherActivity', async () => {
  const result = await runEmbeddedApkVerifier(verifierManifestTree({ launcherOwnsContract: false }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /launcher activity is missing the required TWA contract/i);
});

test('Android release verifier rejects a second production App Links handler', async () => {
  const result = await runEmbeddedApkVerifier(verifierManifestTree({
    duplicateProductionHandler: true,
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production App Links handler count/i);
});

test('Android release verifier accepts the real namespaced aapt root hierarchy', async () => {
  const tree = verifierManifestTree()
    .split('\n')
    .map((line, index) => index === 0 || line === '' ? line : `  ${line}`)
    .join('\n');
  const result = await runEmbeddedApkVerifier(tree);

  assert.equal(result.status, 0, result.stderr);
});

test('Android release verifier binds manifest to the aapt root hierarchy', async () => {
  const tree = verifierManifestTree()
    .split('\n')
    .map((line) => line === '' ? line : `  ${line}`)
    .join('\n');
  const result = await runEmbeddedApkVerifier(tree);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest root hierarchy mismatch/i);
});

test('Android release verifier requires the receiver permission directly under manifest', async () => {
  const result = await runEmbeddedApkVerifier(verifierManifestTree({
    nestedReceiverPermission: true,
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package-scoped receiver permission declaration/i);
});

test('Android release verifier requires LauncherActivity directly under application', async () => {
  const result = await runEmbeddedApkVerifier(verifierManifestTree({
    nestedLauncher: true,
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one launcher activity/i);
});

test('Android release verifier rejects extra TWA metadata attributes', async () => {
  const result = await runEmbeddedApkVerifier(verifierManifestTree({
    extraMetadataAttribute: true,
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /metadata attribute mismatch/i);
});

test('Android release verifier rejects extra App Links filter children', async () => {
  const tree = verifierManifestTree().replace(
    '        E: data (line=33)',
    '        E: uri-relative-filter-group (line=32)\n          A: android:allow(0x01010600)=(type 0x12)0xffffffff\n        E: data (line=33)',
  );
  const result = await runEmbeddedApkVerifier(tree);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /App Links filter child structure mismatch/i);
});

test('Android release verifier rejects extra App Links data attributes', async () => {
  const result = await runEmbeddedApkVerifier(verifierManifestTree({
    extraDataAttribute: true,
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /App Links filter mismatch/i);
});

test('Android deployment runbook blocks descendants of the public association file', async () => {
  const runbook = await readFile(join(repositoryRoot, 'docs', 'deployment', 'v0.1.md'), 'utf8');

  assert.match(runbook, /command\.sharma-house\.com\/\.well-known\/assetlinks\.json`/);
  assert.match(runbook, /\/\.well-known\/assetlinks\.json\/\*`/);
  assert.match(runbook, /`Block` policy with `Include: Everyone`/);
  assert.match(runbook, /\/\.well-known\/assetlinks\.json\/test/);
});

test('Android association publisher emits its receipt only after both private stages are clean', async () => {
  const releaseScript = await readFile(join(repositoryRoot, 'deploy', 'release-android-association.sh'), 'utf8');

  const cleanupCall = releaseScript.lastIndexOf('\ncleanup_stages 0\n');
  const trapDisable = releaseScript.lastIndexOf('\ntrap - EXIT HUP INT TERM\n');
  const receipt = releaseScript.lastIndexOf("\nprintf 'ASSOCIATION_STATE_DIR=%s\\n' \"$release_result\"\n");

  assert.notEqual(cleanupCall, -1, 'publisher must explicitly clean stages before success');
  assert.notEqual(trapDisable, -1, 'publisher must disable cleanup traps after explicit cleanup');
  assert.notEqual(receipt, -1, 'publisher must emit an association rollback receipt');
  assert.ok(cleanupCall < trapDisable, 'cleanup must finish before cleanup traps are disabled');
  assert.ok(trapDisable < receipt, 'cleanup must finish before the success receipt is emitted');
});

test('Android release builder rejects duplicate signing properties before Gradle runs', async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'jarvis-command-android-signing-'));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const signingPropertiesPath = join(temporaryDirectory, 'signing.properties');
  await writeFile(
    signingPropertiesPath,
    [
      'storeFile=/does/not/exist',
      'storeFile=/also/does/not/exist',
      'storePassword=placeholder',
      'keyAlias=jarvis-command',
      'keyPassword=placeholder',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  await chmod(signingPropertiesPath, 0o600);

  const result = spawnSync(join(repositoryRoot, 'deploy', 'build-android-release.sh'), {
    encoding: 'utf8',
    env: {
      ...process.env,
      JARVIS_COMMAND_SIGNING_PROPERTIES: signingPropertiesPath,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate signing property: storeFile/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Gradle/);
});

test('Android association release uses one dedicated descriptor-safe transaction', async () => {
  const compose = await readFile(join(repositoryRoot, 'deploy', 'app.compose.yaml'), 'utf8');
  const currentReleasePath = join(repositoryRoot, 'deploy', 'release-android-association.sh');
  const currentInstallerPath = join(repositoryRoot, 'deploy', 'install-android-association.sh');
  const initialRelease = await readFile(join(repositoryRoot, 'deploy', 'release-app.sh'), 'utf8');
  const initialInstaller = await readFile(join(repositoryRoot, 'deploy', 'install-app-release.sh'), 'utf8');

  assert.equal(existsSync(currentReleasePath), true, 'association release entrypoint is missing');
  const [currentRelease, currentInstaller] = await Promise.all([
    readFile(currentReleasePath, 'utf8'),
    readFile(currentInstallerPath, 'utf8'),
  ]);
  assert.match(
    compose,
    /\/srv\/jarvis-command\/public\/\.well-known:\/app\/apps\/web\/dist\/\.well-known:ro/,
  );
  assert.doesNotMatch(
    compose,
    /\/srv\/jarvis-command\/public\/\.well-known:\/app\/apps\/web\/dist\/\.well-known:rw/,
  );
  assert.match(currentRelease, /apps\/web\/public\/\.well-known\/assetlinks\.json/);
  assert.match(currentRelease, /SHA256SUMS/);
  assert.match(currentRelease, /StrictHostKeyChecking=yes/);
  assert.match(currentRelease, /BatchMode=yes/);
  assert.match(currentRelease, /sudo -n \/usr\/bin\/bash -s -- apply/);
  assert.doesNotMatch(currentRelease, /scp[^\n]*install-android-association\.sh/);
  assert.match(currentInstaller, /snapshot_release_stage/);
  assert.match(currentInstaller, /release stage does not match reviewed checksum/);
  assert.match(currentInstaller, /recovery_create "association-\$timestamp"/);
  assert.doesNotMatch(initialRelease, /assetlinks\.json/);
  assert.doesNotMatch(initialInstaller, /assetlinks\.json/);
});
