#!/usr/bin/python3
"""Fixed-scope, verify-only command app supervisor. Not an installer/transaction."""
import json
import fcntl
from contextlib import contextmanager
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import subprocess
import sys
import time

TRUST_ROOT = "/"
TRUST_UID = 0
MONITOR_SECONDS = 5
DOCKER = "/usr/bin/docker"
NOTIFY = "/usr/bin/systemd-notify"
HELPER = "/usr/local/libexec/jarvis-command-prepare-audit-storage"
BASE = "/srv/jarvis-command/compose.yaml"
STORAGE = "/srv/jarvis-command/app-command-storage.compose.yaml"
RELEASE = "/etc/jarvis-command/release.env"
APP_ENV = "/etc/jarvis-command/app.env"
AUDIT = "/var/lib/jarvis-command/audit"
NAME = "jarvis-command-app"
PROJECT = "jarvis-command-supervised"
STATE = "/var/lib/jarvis-command-supervisor"
ownership = None
STORAGE_DEFINITION = """services:
  app:
    volumes:
      - type: bind
        source: /var/lib/jarvis-command/audit
        target: /var/lib/jarvis-command/audit
        read_only: false
        bind:
          create_host_path: false"""
PROTECTED = {
    "/run/jarvis-command/cloudflare-jwks": "/var/lib/jarvis-command/cloudflare-jwks",
    "/app/apps/web/dist/.well-known": "/srv/jarvis-command/public/.well-known",
}
requested_signal = 0
child = None


class Refused(Exception):
    def __init__(self, message, status=1):
        super().__init__(message)
        self.status = status


def on_signal(number, _frame):
    global requested_signal
    requested_signal = number
    if child is not None and child.returncode is None:
        try:
            # Do not poll/reap the leader: its PID pins our private process group.
            os.killpg(child.pid, number)
        except ProcessLookupError:
            pass


def run(args, *, fds=(), timeout=90, check=True):
    """Never relay child output: Compose/inspect may contain environment secrets."""
    global child
    env = {"PATH": "/usr/bin:/bin", "COMPOSE_DISABLE_ENV_FILE": "1"}
    # Only the fixed notifier receives the socket, never Docker or the helper.
    if args[0] == NOTIFY and "NOTIFY_SOCKET" in os.environ:
        env["NOTIFY_SOCKET"] = os.environ["NOTIFY_SOCKET"]
    child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env=env, start_new_session=True, pass_fds=fds)
    try:
        try:
            out, _ = child.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            # Timeout has not reaped the leader. Kill its pinned group first.
            os.killpg(child.pid, signal.SIGKILL)
            try:
                child.communicate(timeout=1)
            except subprocess.TimeoutExpired:
                assert child.stdout is not None and child.stderr is not None
                child.stdout.close()
                child.stderr.close()
                child.wait(timeout=1)
            raise Refused("supervisor operation timed out",
                          128 + requested_signal if requested_signal else 124)
        status = child.returncode
    finally:
        child = None
    if requested_signal:
        raise Refused("supervisor interrupted", 128 + requested_signal)
    if check and status:
        raise Refused("supervisor operation failed", status if status > 0 else 128 - status)
    return out.decode("utf-8"), status


def trusted_bytes(path, *, secret=False, executable=False):
    """No-follow walk, trusted ancestors, bounded regular single-link descriptor."""
    relative = Path(path).relative_to(TRUST_ROOT)
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
    fd = os.open(TRUST_ROOT, flags | os.O_DIRECTORY)
    try:
        for part in relative.parts[:-1]:
            s = os.fstat(fd)
            if s.st_uid != TRUST_UID or s.st_mode & 0o022:
                raise Refused("untrusted source ancestor")
            next_fd = os.open(part, flags | os.O_DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        s = os.fstat(fd)
        if s.st_uid != TRUST_UID or s.st_mode & 0o022:
            raise Refused("untrusted source parent")
        source = os.open(relative.name, flags | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(source)
            mode = stat.S_IMODE(before.st_mode)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != TRUST_UID
                    or before.st_nlink != 1 or mode & 0o7022
                    or (secret and mode != 0o600) or (executable and not mode & 0o111)
                    or not 0 < before.st_size <= 65536):
                raise Refused("unsafe supervisor input")
            data = os.read(source, 65537)
            after = os.fstat(source)
            fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
            if len(data) != before.st_size or any(getattr(before, k) != getattr(after, k) for k in fields):
                raise Refused("supervisor input changed while reading")
            binding = os.stat(relative.name, dir_fd=fd, follow_symlinks=False)
            if (binding.st_dev, binding.st_ino) != (before.st_dev, before.st_ino):
                raise Refused("supervisor input binding changed")
            return data
        finally:
            os.close(source)
    finally:
        os.close(fd)


def environment(data):
    # Deliberately narrower than shell/dotenv. No expansion, quoting or duplicate keys.
    result = {}
    for line in data.decode("utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=([^\s\x00\x01-\x1f'\"`$\\#]*)", line)
        if not match or match[1] in result:
            raise Refused("malformed or duplicate environment input")
        result[match[1]] = match[2]
    return result


def check_mounts(mounts, *, actual=False):
    expected = {**{t: (s, False) for t, s in PROTECTED.items()}, AUDIT: (AUDIT, True)}
    found = {}
    if not isinstance(mounts, list) or any(not isinstance(m, dict) for m in mounts):
        raise Refused('malformed mounts')
    for mount in mounts:
        target = mount.get("Destination" if actual else "target")
        if target in found:
            raise Refused("duplicate mount target")
        kind = mount.get("Type" if actual else "type")
        # Docker reports the configured /tmp tmpfs separately on some versions.
        if actual and target == "/tmp" and kind == "tmpfs":
            if mount.get('RW') is not True:
                raise Refused('unsafe tmpfs mount')
            continue
        if actual:
            if mount.get('Propagation') != 'rprivate':
                raise Refused('unsafe mount propagation')
        else:
            bind = mount.get('bind', {})
            if (set(mount) - {'type', 'source', 'target', 'read_only', 'bind'}
                    or not isinstance(mount.get('read_only', False), bool)
                    or not isinstance(bind, dict) or set(bind) - {'create_host_path'}
                    or ('create_host_path' in bind and not isinstance(bind['create_host_path'], bool))):
                raise Refused('unsafe effective mount options')
        source = mount.get("Source" if actual else "source")
        rw = mount.get("RW") if actual else not mount.get("read_only", False)
        if kind != "bind" or not isinstance(rw, bool):
            raise Refused("unsafe mount type")
        found[target] = (source, rw)
        # Compose 2 omits the false field but retains bind:{}; Compose 5 emits
        # explicit false. launch() first requires the exact raw false declaration
        # and verifies existing storage before CREATE. Neither version may create
        # the source. Keep absent bind, true, malformed and extra options refused.
        if not actual and target == AUDIT and ("bind" not in mount or mount["bind"].get("create_host_path", False) is not False):
            raise Refused("audit bind must not create host path")
    if found != expected:
        raise Refused("mount identity mismatch")


def exact(value, expected):
    """JSON equality without Python's bool == int safety trap."""
    if isinstance(expected, dict):
        return isinstance(value, dict) and set(value) == set(expected) and all(exact(value[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return isinstance(value, list) and len(value) == len(expected) and all(exact(a, b) for a, b in zip(value, expected))
    return type(value) is type(expected) and value == expected


COMPOSE_POLICY = {
    'network_mode': 'host', 'restart': 'no', 'init': True, 'read_only': True,
    'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
    'tmpfs': ['/tmp:rw,noexec,nosuid,nodev,size=16m'], 'pids_limit': 128,
    'ulimits': {'nofile': {'soft': 1024, 'hard': 2048}}, 'stop_grace_period': '20s',
}


def compose_config(config, image, app_env):
    if not isinstance(config, dict) or set(config) - {'name', 'services'}:
        raise Refused('unexpected Compose fields')
    if set(config.get("services", {})) != {"app"}:
        raise Refused("exact app-only Compose set required")
    app = config["services"]["app"]
    allowed = set(COMPOSE_POLICY) | {'image', 'container_name', 'user', 'environment', 'volumes', 'mem_limit', 'cpus', 'command', 'entrypoint'}
    if (not isinstance(app, dict) or set(app) - allowed
            or any(not exact(app.get(k), v) for k, v in COMPOSE_POLICY.items())
            or not any(exact(app.get('mem_limit'), v) for v in ('536870912', 536870912))
            or not any(exact(app.get('cpus'), v) for v in (1, 1.0))
            or app.get('command') is not None or app.get('entrypoint') is not None):
        raise Refused('effective Compose hardening mismatch')
    if (app.get("image") != image or app.get("container_name") != NAME
            or app.get("user") != "10001:10001" or app.get("read_only") is not True
            or app.get("environment") != app_env):
        raise Refused("effective Compose identity mismatch")
    check_mounts(app.get("volumes", []))


def inspect(target):
    out, _ = run([DOCKER, "inspect", target], timeout=10)
    values = json.loads(out)
    if not isinstance(values, list) or len(values) != 1:
        raise Refused("malformed container inspection")
    return values[0]


@contextmanager
def invocation_lock():
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    directory = os.open(TRUST_ROOT, flags)
    lock = None
    try:
        for part in Path(STATE).relative_to(TRUST_ROOT).parts:
            s = os.fstat(directory)
            if s.st_uid != TRUST_UID or s.st_mode & 0o7022:
                raise Refused("unsafe state ancestor")
            next_fd = os.open(part, flags, dir_fd=directory)
            os.close(directory)
            directory = next_fd
        s = os.fstat(directory)
        if s.st_uid != TRUST_UID or stat.S_IMODE(s.st_mode) != 0o700:
            raise Refused("unsafe state directory")
        lock = os.open('lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, 0o600, dir_fd=directory)
        s = os.fstat(lock)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != TRUST_UID or s.st_nlink != 1 or stat.S_IMODE(s.st_mode) != 0o600 or s.st_size:
            raise Refused("unsafe invocation lock")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused("another invocation owns the launcher") from None
        yield directory
    finally:
        if lock is not None:
            os.close(lock)
        os.close(directory)


def read_ownership():
    try:
        data = json.loads(trusted_bytes(STATE + '/ownership.json', secret=True))
    except FileNotFoundError:
        return None
    if (not isinstance(data, dict) or set(data) != {'invocation', 'token', 'image', 'id'}
            or not all(isinstance(data[k], str) for k in ('invocation', 'token', 'image'))
            or not re.fullmatch(r'[0-9a-f]{32}', data['invocation'])
            or not re.fullmatch(r'[0-9a-f]{32}', data['token'])
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', data['image'])
            or (data['id'] is not None and (not isinstance(data['id'], str) or not re.fullmatch(r'[0-9a-f]{64}', data['id'])))):
        raise Refused('invalid ownership record')
    return data


def save_ownership(directory, record):
    fd = os.open('ownership.next', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
    try:
        data = json.dumps(record, sort_keys=True).encode()
        if os.write(fd, data) != len(data):
            raise Refused('short ownership write')
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace('ownership.next', 'ownership.json', src_dir_fd=directory, dst_dir_fd=directory)
    os.fsync(directory)
    if read_ownership() != record:
        raise Refused('ownership persistence mismatch')


def owned(state):
    if not isinstance(state, dict) or not isinstance(state.get('Config'), dict) or not isinstance(state['Config'].get('Labels'), dict):
        raise Refused('malformed ownership inspection')
    labels = state.get("Config", {}).get("Labels", {})
    identifier = state.get("Id", "")
    if (not re.fullmatch(r"[0-9a-f]{64}", identifier)
            or ownership is None
            or labels.get("com.docker.compose.project") != PROJECT + '-' + ownership['token']
            or labels.get("com.docker.compose.service") != "app"
            or state.get('Image') != ownership['image']):
        raise Refused("candidate ownership could not be verified")
    return identifier


HOST_POLICY = {
    'NetworkMode': 'host', 'ReadonlyRootfs': True, 'Privileged': False,
    'Init': True, 'PublishAllPorts': False, 'AutoRemove': False,
    'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0},
    'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true'],
    'Memory': 536870912, 'MemorySwap': 1073741824, 'NanoCpus': 1000000000,
    'PidsLimit': 128, 'Ulimits': [{'Name': 'nofile', 'Hard': 2048, 'Soft': 1024}],
    'Tmpfs': {'/tmp': 'rw,noexec,nosuid,nodev,size=16m'},
    'PortBindings': {}, 'PidMode': '', 'IpcMode': 'private', 'UsernsMode': '',
    'UTSMode': '', 'CgroupnsMode': 'private', 'CgroupParent': '',
    'Runtime': 'runc', 'OomKillDisable': False, 'CpuPeriod': 0, 'CpuQuota': 0,
    'CpuRealtimePeriod': 0, 'CpuRealtimeRuntime': 0,
}
HOST_EMPTY_LISTS = ('CapAdd', 'Devices', 'DeviceRequests', 'DeviceCgroupRules',
                    'ExtraHosts', 'GroupAdd', 'Links', 'VolumesFrom', 'Dns', 'DnsOptions', 'DnsSearch')


def image_environment(values):
    # Image defaults can contain spaces/quotes; compare literal Docker strings,
    # not dotenv syntax. Duplicate keys are ambiguous and never accepted.
    if not isinstance(values, list):
        raise Refused('malformed image/container environment')
    result = {}
    for value in values:
        if not isinstance(value, str) or '\x00' in value or '=' not in value:
            raise Refused('malformed image/container environment')
        key, val = value.split('=', 1)
        if not key or key in result:
            raise Refused('duplicate image/container environment')
        result[key] = val
    return result


def verify_state(state, image, app_env, candidate, image_config, *, running=True, starting=False):
    if (not isinstance(state, dict) or not isinstance(image_config, dict)
            or any(not isinstance(state.get(k), dict) for k in ('Config', 'HostConfig', 'NetworkSettings', 'State'))):
        raise Refused('malformed container inspection')
    if owned(state) != candidate or state.get("Image") != image:
        raise Refused("running immutable identity mismatch")
    host = state.get('HostConfig', {})
    # Moby daemon_unix.go defaults CREATE's OomKillDisable pointer to false;
    # START's verifyContainerSettings clears it when disabling is unsupported.
    # On Linux cgroup v2 sysinfo explicitly reports OomKillDisable=false.
    # Accept only that post-START representation, with fresh daemon evidence on
    # every check. Never normalize absent keys, true, or other false-like values.
    oom_null = running and 'OomKillDisable' in host and host['OomKillDisable'] is None
    if oom_null:
        out, _ = run([DOCKER, 'info', '--format', '{{json .}}'], timeout=10)
        platform = json.loads(out)
        if (not isinstance(platform, dict)
                or any(k not in platform or not exact(platform[k], v) for k, v in
                       {'OSType': 'linux', 'CgroupVersion': '2', 'OomKillDisable': False}.items())):
            raise Refused('unqualified null OomKillDisable')
    if (any(k not in host or not exact(host[k], v) for k, v in HOST_POLICY.items()
            if not (k == 'OomKillDisable' and oom_null))
            or any(k not in host or not (host[k] is None or exact(host[k], [])) for k in HOST_EMPTY_LISTS)):
        raise Refused('actual container hardening mismatch')
    network = state.get('NetworkSettings', {})
    networks = network.get('Networks', {})
    if (not exact(network.get('Ports'), {}) or not isinstance(networks, dict) or set(networks) != {HOST_POLICY['NetworkMode']}
            or not isinstance(networks[HOST_POLICY['NetworkMode']], dict)
            or any(k not in networks[HOST_POLICY['NetworkMode']] or not (networks[HOST_POLICY['NetworkMode']][k] is None or exact(networks[HOST_POLICY['NetworkMode']][k], []))
                   for k in ('Aliases', 'Links', 'DriverOpts', 'IPAMConfig'))):
        raise Refused('actual container network mismatch')
    config = state.get('Config', {})
    if config.get('User') != '10001:10001':
        raise Refused('actual container UID mismatch')
    for key in ('Entrypoint', 'Cmd', 'WorkingDir', 'Healthcheck'):
        if key not in image_config or key not in config or not exact(config[key], image_config[key]):
            raise Refused('immutable image process mismatch')
    expected_env = {**image_environment(image_config.get('Env')), **app_env}
    if image_environment(config.get('Env')) != expected_env:
        raise Refused("running environment mismatch")
    check_mounts(state.get("Mounts", []), actual=True)
    runtime = state.get("State", {})
    if not running:
        if runtime.get('Running') is not False or runtime.get('Status') != 'created':
            raise Refused('candidate is not unstarted CREATED container')
    else:
        health = runtime.get('Health')
        allowed_health = ('starting', 'healthy') if starting else ('healthy',)
        if (runtime.get('Running') is not True or not isinstance(health, dict)
                or health.get('Status') not in allowed_health):
            raise Refused('candidate stopped or unhealthy')


def require_quiescent():
    out, _ = run([DOCKER, "ps", "--all", "--filter", f"name=^/{NAME}$", "--format", "{{.ID}}"])
    if out.strip():
        raise Refused("existing app container; transaction must remove it first")


def container_ids(filter_value):
    out, _ = run([DOCKER, 'ps', '--all', '--no-trunc', '--filter',
                  filter_value, '--format', '{{.ID}}'], timeout=10)
    ids = out.splitlines()
    if any(not re.fullmatch(r'[0-9a-f]{64}', value) for value in ids):
        raise Refused('malformed daemon container listing')
    return ids


def discard_partial_next(directory):
    # Only called under the lock after authenticating committed same-invocation
    # ownership. Uncommitted bytes grant no authority and are never promoted.
    try:
        fd = os.open('ownership.next', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
    except FileNotFoundError:
        return
    try:
        s = os.fstat(fd)
        binding = os.stat('ownership.next', dir_fd=directory, follow_symlinks=False)
        if (not stat.S_ISREG(s.st_mode) or s.st_uid != TRUST_UID or s.st_nlink != 1
                or stat.S_IMODE(s.st_mode) != 0o600 or s.st_size > 65536
                or (s.st_dev, s.st_ino) != (binding.st_dev, binding.st_ino)):
            raise Refused('unsafe partial ownership')
        os.unlink('ownership.next', dir_fd=directory)
        os.fsync(directory)
    finally:
        os.close(fd)


def cleanup(directory, invocation):
    global ownership
    ownership = read_ownership()
    if ownership is None:
        return
    if ownership['invocation'] != invocation:
        raise Refused('cleanup invocation mismatch')
    discard_partial_next(directory)
    candidate = ownership['id']
    # Create is never command-capable. No start is issued until the ID is durable.
    discovered = candidate is None
    if discovered:
        ids = container_ids('label=com.docker.compose.project=' + PROJECT + '-' + ownership['token'])
        if len(ids) != 1:
            # Empty is not final: an inflight daemon create may still materialize.
            raise Refused('unresolved create intent; exact stopped candidate required')
        state = inspect(ids[0])
        candidate = owned(state)
        if candidate != ids[0] or state.get('State', {}).get('Running') is not False:
            raise Refused('create recovery identity or stopped state mismatch')
        ownership['id'] = candidate
        save_ownership(directory, ownership)
    if candidate is not None and container_ids('id=' + candidate):
        if owned(inspect(candidate)) != candidate:
            raise Refused('cleanup immutable identity mismatch')
        if not discovered:
            run([DOCKER, 'stop', candidate], timeout=30)
        state = inspect(candidate)
        if owned(state) != candidate:
            raise Refused('candidate identity changed')
        # Stop is graceful, not final: a daemon-side start can still be pending.
        # Remove only the verified immutable ID, never volumes or the fixed name.
        run([DOCKER, 'rm', '--force', candidate], timeout=30)
        if container_ids('id=' + candidate):
            raise Refused('candidate removal not final')
    os.unlink('ownership.json', dir_fd=directory)
    os.fsync(directory)
    print('owned candidate removed and absence verified', file=sys.stderr)


def launch(directory, invocation):
    global requested_signal, ownership
    armed = False
    candidate = None
    status = 0
    try:
        if sys.argv[1:] == ['--cleanup']:
            cleanup(directory, invocation)
            return 0
        if sys.argv[1:] not in ([], ["--monitor"]):
            raise Refused("usage: supervised-command-app [--monitor|--cleanup]", 64)
        if read_ownership() is not None:
            raise Refused('unresolved prior ownership record')
        if any(k.startswith("COMPOSE_") for k in os.environ):
            raise Refused("ambient Compose inputs forbidden", 65)
        for number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
            signal.signal(number, on_signal)
        sources = {p: trusted_bytes(p, secret=p in (RELEASE, APP_ENV), executable=p == HELPER)
                   for p in (BASE, STORAGE, RELEASE, APP_ENV, HELPER)}
        storage_text = '\n'.join(line.rstrip() for line in sources[STORAGE].decode().splitlines()
                                 if line.strip() and not line.lstrip().startswith('#'))
        if storage_text != STORAGE_DEFINITION:
            raise Refused("exact narrow storage override required")
        release = environment(sources[RELEASE])
        image = release.get("JARVIS_COMMAND_APP_IMAGE", "")
        app_env = environment(sources[APP_ENV])
        if (not re.fullmatch(r"sha256:[0-9a-f]{64}", image)
                or app_env.get("COMMAND_MODE") != "enabled"
                or app_env.get("COMMAND_AUDIT_LOG_PATH") != AUDIT + "/events.jsonl"):
            raise Refused("explicit enabled mode, exact audit path and immutable image required", 65)
        ownership = {'invocation': invocation, 'token': secrets.token_hex(16), 'image': image, 'id': None}
        compose = [DOCKER, "compose", "--project-name", PROJECT + '-' + ownership['token'], "--env-file", RELEASE,
                   "-f", BASE, "-f", STORAGE]
        out, _ = run(compose + ["config", "--format", "json"])
        compose_config(json.loads(out), image, app_env)
        out, _ = run([DOCKER, "image", "inspect", image])
        metadata = json.loads(out)
        if not isinstance(metadata, list) or len(metadata) != 1 or metadata[0].get('Id') != image:
            raise Refused("local immutable image mismatch")
        image_config = metadata[0]['Config']
        require_quiescent()
        run([HELPER, "verify", "--trusted-root", "/var/lib/jarvis-command",
             "--path", AUDIT + "/events.jsonl"])
        # The launcher lock serializes invocations; the transaction excludes edits.
        def unchanged():
            for path, data in sources.items():
                if trusted_bytes(path, secret=path in (RELEASE, APP_ENV), executable=path == HELPER) != data:
                    raise Refused("supervised source configuration drift")
        unchanged()
        require_quiescent()
        save_ownership(directory, ownership)
        armed = True
        run(compose + ["create", "--no-build", "app"])
        state = inspect(NAME)
        candidate = owned(state)
        ownership['id'] = candidate
        save_ownership(directory, ownership)
        verify_state(state, image, app_env, candidate, image_config, running=False)
        run([DOCKER, 'start', candidate])
        deadline = time.monotonic() + 60
        while True:
            state = inspect(candidate)
            verify_state(state, image, app_env, candidate, image_config, starting=True)
            if state.get('State', {}).get('Health', {}).get('Status') == 'healthy':
                break
            if time.monotonic() >= deadline or state.get('State', {}).get('Running') is not True:
                raise Refused('candidate stopped or unhealthy')
            time.sleep(1)
        verify_state(state, image, app_env, candidate, image_config)
        unchanged()
        if not sys.argv[1:]:
            armed = False
            return 0
        run([NOTIFY, "--ready", "--status=App liveness and immutable storage configuration verified; command readiness is app-owned"])
        while True:
            time.sleep(MONITOR_SECONDS)
            if requested_signal:
                raise Refused("supervisor interrupted", 128 + requested_signal)
            unchanged()  # Never call the quiescent ledger helper against an active writer.
            verify_state(inspect(candidate), image, app_env, candidate, image_config)
    except Refused as error:
        print(str(error), file=sys.stderr)
        status = error.status
    except (OSError, ValueError, KeyError, TypeError):
        print("supervisor input/operation refused", file=sys.stderr)
        status = 1
    finally:
        if armed:
            # Ignore further signals only while performing bounded owned-ID cleanup.
            requested_signal = 0
            for number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
                signal.signal(number, signal.SIG_IGN)
            try:
                cleanup(directory, invocation)
            except (Refused, OSError, ValueError, KeyError, TypeError):
                print("owned candidate cleanup could not be verified", file=sys.stderr)
                status = 1
    return status


def main():
    invocation = os.environ.get('INVOCATION_ID', '')
    try:
        if not re.fullmatch(r'[0-9a-f]{32}', invocation):
            raise Refused('trusted systemd INVOCATION_ID required')
        with invocation_lock() as directory:
            return launch(directory, invocation)
    except (Refused, OSError, ValueError, TypeError):
        print('supervisor invocation refused', file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
