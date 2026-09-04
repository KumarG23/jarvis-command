#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
android_dir="${repo_root}/apps/android"
signing_properties=${JARVIS_COMMAND_SIGNING_PROPERTIES:-/home/neal/.config/jarvis-command/android/signing.properties}
sdk_root=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/home/neal/.android-sdk}}
build_tools="${sdk_root}/build-tools/36.0.0"
apksigner="${build_tools}/apksigner"
aapt="${build_tools}/aapt"

[[ -x ${android_dir}/gradlew ]]
[[ -x ${apksigner} ]]
[[ -x ${aapt} ]]

keystore_path=$(python3 - "${signing_properties}" <<'PY'
import os
import stat
import sys
from pathlib import Path

path = Path(sys.argv[1])
fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
try:
    metadata = os.fstat(fd)
    if not stat.S_ISREG(metadata.st_mode):
        raise SystemExit('signing properties must be a regular file')
    if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise SystemExit('signing properties must be owned by the builder at mode 0600')
    if metadata.st_nlink != 1 or metadata.st_size > 16384:
        raise SystemExit('signing properties metadata is unsafe')
    source = os.read(fd, metadata.st_size + 1).decode('utf-8')
finally:
    os.close(fd)

values = {}
for raw_line in source.splitlines():
    line = raw_line.strip()
    if not line or line.startswith(('#', '!')):
        continue
    if '=' not in line:
        raise SystemExit('invalid signing properties line')
    key, value = line.split('=', 1)
    if key in values:
        raise SystemExit(f'duplicate signing property: {key}')
    values[key] = value
required = {'storeFile', 'storePassword', 'keyAlias', 'keyPassword'}
if set(values) != required:
    raise SystemExit('signing properties keys do not match the release contract')
if any(not value or any(ord(char) < 32 for char in value) for value in values.values()):
    raise SystemExit('invalid signing property value')

keystore = Path(values['storeFile'])
if not keystore.is_absolute():
    raise SystemExit('release keystore path must be absolute')
key_fd = os.open(keystore, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
try:
    key_metadata = os.fstat(key_fd)
    if not stat.S_ISREG(key_metadata.st_mode):
        raise SystemExit('release keystore must be a regular file')
    if key_metadata.st_uid != os.getuid() or stat.S_IMODE(key_metadata.st_mode) != 0o600:
        raise SystemExit('release keystore must be owned by the builder at mode 0600')
    if key_metadata.st_nlink != 1 or key_metadata.st_size > 1048576:
        raise SystemExit('release keystore metadata is unsafe')
finally:
    os.close(key_fd)
print(keystore)
PY
)
[[ -n ${keystore_path} ]]

export ANDROID_HOME="${sdk_root}"
export ANDROID_SDK_ROOT="${sdk_root}"
export JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}
export JARVIS_COMMAND_SIGNING_PROPERTIES="${signing_properties}"

cd "${android_dir}"
./gradlew --no-daemon clean test lintRelease assembleRelease

apk="${android_dir}/app/build/outputs/apk/release/app-release.apk"
[[ -s ${apk} ]]
verification=$("${apksigner}" verify --verbose --print-certs "${apk}")

actual_fingerprint=$(APKSIGNER_OUTPUT="${verification}" python3 - <<'PY'
import os
for line in os.environ['APKSIGNER_OUTPUT'].splitlines():
    prefix = 'Signer #1 certificate SHA-256 digest: '
    if line.startswith(prefix):
        value = line.removeprefix(prefix).strip().upper()
        if len(value) == 64 and all(char in '0123456789ABCDEF' for char in value):
            print(':'.join(value[index:index + 2] for index in range(0, 64, 2)))
            break
else:
    raise SystemExit('signed APK certificate fingerprint was not reported')
PY
)
expected_fingerprint=$(python3 - "${android_dir}/twa-manifest.json" <<'PY'
import json
import sys
manifest = json.load(open(sys.argv[1], encoding='utf-8'))
fingerprints = manifest.get('fingerprints')
if not isinstance(fingerprints, list) or len(fingerprints) != 1 or fingerprints[0].get('name') != 'release':
    raise SystemExit('TWA manifest must contain exactly one release fingerprint')
print(fingerprints[0]['value'].upper())
PY
)
[[ ${actual_fingerprint} == "${expected_fingerprint}" ]]

python3 - "${aapt}" "${apk}" <<'PY'
import re
import subprocess
import sys


def run_aapt(arguments, *tail):
    result = subprocess.run(
        [sys.argv[1], *arguments.split(), sys.argv[2], *tail],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr or f"aapt failed: {arguments}")
    return result.stdout


def element_blocks(source, element):
    lines = source.splitlines()
    blocks = []
    for index, line in enumerate(lines):
        stripped = line.lstrip()
        if not stripped.startswith(f"E: {element} "):
            continue
        indent = len(line) - len(stripped)
        end = len(lines)
        for candidate in range(index + 1, len(lines)):
            candidate_stripped = lines[candidate].lstrip()
            candidate_indent = len(lines[candidate]) - len(candidate_stripped)
            if candidate_stripped.startswith("E: ") and candidate_indent <= indent:
                end = candidate
                break
        blocks.append(lines[index:end])
    return blocks


def direct_attributes(block):
    element_indent = len(block[0]) - len(block[0].lstrip())
    attribute_indent = element_indent + 2
    return [
        line.strip()
        for line in block[1:]
        if len(line) - len(line.lstrip()) == attribute_indent
        and line.lstrip().startswith("A: ")
    ]


def direct_attribute_names(block):
    names = []
    for line in direct_attributes(block):
        match = re.match(r'^A: ([^=(]+)(?:\([^)]*\))?=', line)
        if match is None:
            return None
        names.append(match.group(1))
    return names


def direct_child_blocks(block, element):
    parent_indent = len(block[0]) - len(block[0].lstrip())
    child_indent = parent_indent + 2
    blocks = []
    for index, line in enumerate(block[1:], start=1):
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        if indent != child_indent or not stripped.startswith(f"E: {element} "):
            continue
        end = len(block)
        for candidate in range(index + 1, len(block)):
            candidate_stripped = block[candidate].lstrip()
            candidate_indent = len(block[candidate]) - len(candidate_stripped)
            if candidate_stripped.startswith("E: ") and candidate_indent <= child_indent:
                end = candidate
                break
        blocks.append(block[index:end])
    return blocks


def direct_child_element_names(block):
    parent_indent = len(block[0]) - len(block[0].lstrip())
    child_indent = parent_indent + 2
    names = []
    for line in block[1:]:
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        if indent != child_indent:
            continue
        match = re.match(r'^E: ([^ ]+)', stripped)
        if match is not None:
            names.append(match.group(1))
    return names


def attribute_values(block, name):
    pattern = re.compile(rf'^A: android:{re.escape(name)}(?:\([^)]*\))?=(.*)$')
    return [
        match.group(1)
        for line in direct_attributes(block)
        if (match := pattern.fullmatch(line)) is not None
    ]


def literal_attribute(block, name):
    values = attribute_values(block, name)
    if len(values) != 1:
        return None
    match = re.match(r'^"([^"]*)"', values[0])
    return None if match is None else match.group(1)


def numeric_attribute(block, name):
    values = attribute_values(block, name)
    if len(values) != 1:
        return None
    match = re.search(r'0x([0-9a-f]+)$', values[0])
    return None if match is None else int(match.group(1), 16)


def resolved_attribute(block, name, resource_values):
    values = attribute_values(block, name)
    if len(values) != 1:
        return None
    literal_match = re.match(r'^"([^"]*)"', values[0])
    if literal_match is not None:
        return literal_match.group(1)
    resource_match = re.match(r'^@(0x[0-9a-f]+)$', values[0])
    if resource_match is not None:
        return resource_values.get(resource_match.group(1))
    return None


def intent_filter_contract(block, resource_values):
    actions = [
        literal_attribute(child, 'name')
        for child in direct_child_blocks(block, 'action')
    ]
    categories = [
        literal_attribute(child, 'name')
        for child in direct_child_blocks(block, 'category')
    ]
    destinations = [
        (
            resolved_attribute(child, 'scheme', resource_values),
            resolved_attribute(child, 'host', resource_values),
        )
        for child in direct_child_blocks(block, 'data')
    ]
    return actions, categories, destinations


badging = run_aapt("dump badging")
manifest_tree = run_aapt("dump xmltree", "AndroidManifest.xml")
resources = run_aapt("dump --values resources")
lines = badging.splitlines()
package = next((line for line in lines if line.startswith('package:')), '')
if "name='com.kumargg.jarviscommand'" not in package:
    raise SystemExit('unexpected APK package ID')
if "versionCode='1'" not in package or "versionName='0.1.0'" not in package:
    raise SystemExit('unexpected APK version')
if not any(line == "sdkVersion:'23'" for line in lines):
    raise SystemExit('unexpected APK minimum SDK')
if not any(line == "targetSdkVersion:'36'" for line in lines):
    raise SystemExit('unexpected APK target SDK')

permission_name = 'com.kumargg.jarviscommand.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
permissions = {
    line.split("name='", 1)[1].removesuffix("'")
    for line in lines
    if line.startswith(('uses-permission:', 'uses-permission-sdk-23:'))
}
if permissions != {permission_name}:
    raise SystemExit(f'unexpected APK permissions: {sorted(permissions)}')
manifest_blocks = element_blocks(manifest_tree, 'manifest')
if len(manifest_blocks) != 1:
    raise SystemExit('merged APK does not contain exactly one manifest root')
manifest = manifest_blocks[0]
manifest_lines = manifest_tree.splitlines()
element_rows = [
    (index, len(line) - len(line.lstrip()), line)
    for index, line in enumerate(manifest_lines)
    if line.lstrip().startswith('E: ')
]
manifest_index = next(
    (index for index, _indent, line in element_rows if line == manifest[0]),
    None,
)
manifest_indent = len(manifest[0]) - len(manifest[0].lstrip())
minimum_element_indent = min((indent for _index, indent, _line in element_rows), default=-1)
top_level_elements = [
    line
    for _index, indent, line in element_rows
    if indent == minimum_element_indent
]
prefix_lines = [line for line in manifest_lines[:manifest_index] if line.strip()] if manifest_index is not None else []
flat_root = (
    manifest_indent == 0
    and all(
        len(line) - len(line.lstrip()) == 0 and line.startswith('N: ')
        for line in prefix_lines
    )
)
namespaced_root = (
    manifest_indent == 2
    and bool(prefix_lines)
    and all(
        len(line) - len(line.lstrip()) == 0 and line.startswith('N: ')
        for line in prefix_lines
    )
)
if (
    manifest_index is None
    or manifest_indent != minimum_element_indent
    or top_level_elements != [manifest[0]]
    or not (flat_root or namespaced_root)
):
    raise SystemExit('merged APK manifest root hierarchy mismatch')
permission_declarations = []
for block in direct_child_blocks(manifest, 'permission'):
    if literal_attribute(block, 'name') == permission_name:
        permission_declarations.append(block)
if len(permission_declarations) != 1:
    raise SystemExit('merged APK does not contain exactly one package-scoped receiver permission declaration')
if numeric_attribute(permission_declarations[0], 'protectionLevel') != 0x2:
    raise SystemExit('package-scoped receiver permission is not signature protected')

application_blocks = direct_child_blocks(manifest, 'application')
if len(application_blocks) != 1:
    raise SystemExit('merged APK does not contain exactly one application')
application = application_blocks[0]
if numeric_attribute(application, 'allowBackup') != 0x0:
    raise SystemExit('APK allows application backup')
if numeric_attribute(application, 'usesCleartextTraffic') != 0x0:
    raise SystemExit('APK allows cleartext traffic')

launcher_blocks = [
    block
    for block in direct_child_blocks(application, 'activity')
    if literal_attribute(block, 'name') == 'com.kumargg.jarviscommand.LauncherActivity'
]
if len(launcher_blocks) != 1:
    raise SystemExit('merged APK does not contain exactly one launcher activity')
launcher = launcher_blocks[0]
if numeric_attribute(launcher, 'exported') != 0xffffffff:
    raise SystemExit('launcher activity is not exported')

resource_values = {}
resource_lines = resources.splitlines()
for index, line in enumerate(resource_lines):
    match = re.fullmatch(
        r'\s*resource (0x[0-9a-f]+) .*:string/(fallbackType|hostName|launchUrl):.*',
        line,
    )
    if match is None:
        continue
    for value_line in resource_lines[index + 1:index + 4]:
        value_match = re.fullmatch(r'\s*\(string8\) "(.*)"', value_line)
        if value_match is not None:
            resource_values[match.group(1)] = value_match.group(1)
            break

required_metadata = {
    'android.support.customtabs.trusted.DEFAULT_URL': 'https://command.sharma-house.com/',
    'android.support.customtabs.trusted.FALLBACK_STRATEGY': 'customtabs',
}
metadata = {}
for block in direct_child_blocks(launcher, 'meta-data'):
    name = literal_attribute(block, 'name')
    if name not in required_metadata:
        continue
    metadata_attribute_names = direct_attribute_names(block)
    if metadata_attribute_names is None \
        or len(metadata_attribute_names) != 2 \
        or set(metadata_attribute_names) != {'android:name', 'android:value'}:
        raise SystemExit('launcher activity is missing the required TWA contract: metadata attribute mismatch')
    if name in metadata:
        raise SystemExit('launcher activity is missing the required TWA contract: duplicate metadata')
    metadata[name] = resolved_attribute(block, 'value', resource_values)
if metadata != required_metadata:
    raise SystemExit('launcher activity is missing the required TWA contract: metadata mismatch')

verified_filters = [
    block
    for block in direct_child_blocks(launcher, 'intent-filter')
    if numeric_attribute(block, 'autoVerify') == 0xffffffff
]
if len(verified_filters) != 1:
    raise SystemExit('launcher activity is missing the required TWA contract: autoVerify filter count')
verified_filter = verified_filters[0]
if sorted(direct_child_element_names(verified_filter)) != [
    'action',
    'category',
    'category',
    'data',
]:
    raise SystemExit('LauncherActivity App Links filter child structure mismatch')
action_blocks = direct_child_blocks(verified_filter, 'action')
category_blocks = direct_child_blocks(verified_filter, 'category')
data_blocks = direct_child_blocks(verified_filter, 'data')
data_attribute_names = direct_attribute_names(data_blocks[0]) if len(data_blocks) == 1 else None
if direct_attribute_names(verified_filter) != ['android:autoVerify'] \
    or any(direct_attribute_names(block) != ['android:name'] for block in action_blocks) \
    or any(direct_attribute_names(block) != ['android:name'] for block in category_blocks) \
    or data_attribute_names is None \
    or len(data_attribute_names) != 2 \
    or set(data_attribute_names) != {'android:scheme', 'android:host'}:
    raise SystemExit('launcher activity is missing the required TWA contract: App Links filter mismatch')
actions, categories, destinations = intent_filter_contract(verified_filter, resource_values)
if actions != ['android.intent.action.VIEW'] \
    or len(categories) != 2 \
    or set(categories) != {'android.intent.category.DEFAULT', 'android.intent.category.BROWSABLE'} \
    or destinations != [('https', 'command.sharma-house.com')]:
    raise SystemExit('launcher activity is missing the required TWA contract: App Links filter mismatch')

global_verified_filters = [
    block
    for block in element_blocks(manifest_tree, 'intent-filter')
    if numeric_attribute(block, 'autoVerify') == 0xffffffff
]
if len(global_verified_filters) != 1 or global_verified_filters[0] != verified_filter:
    raise SystemExit('unexpected production App Links handler count in merged APK')
PY

output_dir="${repo_root}/dist/android"
output="${output_dir}/jarvis-command-v0.1.0.apk"
mkdir -p "${output_dir}"
install -m 0644 "${apk}" "${output}"
cmp -s "${apk}" "${output}"
read -r apk_sha256 _ < <(sha256sum "${output}")
printf 'APK_PATH=%s\nAPK_SHA256=%s\nCERT_SHA256=%s\n' "${output}" "${apk_sha256}" "${actual_fingerprint}"
