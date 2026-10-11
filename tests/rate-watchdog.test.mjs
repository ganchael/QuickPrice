import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('../deploy/aliyun/rate-watchdog.py', import.meta.url));
const setup = `
import base64, contextlib, importlib.util, io, json, os, pathlib, subprocess, tempfile
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('watchdog', ${JSON.stringify(scriptPath)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW = 1791763200.0
def feed(age=0):
    stamp = m.iso_time(NOW - age)
    return {'schemaVersion': 1, 'baseCurrency': 'USDT', 'quoteCurrency': 'CNY',
      'delivery': 'scheduled', 'kind': 'reference', 'source': '欧易 OKX · 获取于',
      'sourceUrl': m.OKX_SOURCE_URL, 'rate': '6.686007', 'rawRate': '6.68600712',
      'fetchedAt': stamp, 'updatedAt': stamp}
def state(directory):
    with open(os.path.join(directory, 'status.json')) as source:
        return json.load(source)
def check(directory, age=0, trigger=None, fetcher=None, now=NOW):
    with contextlib.redirect_stdout(io.StringIO()):
        return m.run_watchdog(directory, now, fetcher or (lambda moment: m.parse_feed(feed(age), moment)), trigger)
def fails(call):
    try:
        call()
    except m.WatchdogError:
        return
    raise AssertionError('Expected strict validation to reject input')
`;

function python(source, timeout = 15_000) {
  const result = spawnSync('python3', ['-c', `${setup}\n${source}`], { encoding: 'utf8', timeout });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}\n${result.error ?? ''}`);
}

test('watchdog validates original OKX pair, precision, retrieval timestamp and 24 hour limit', () => python(`
assert m.parse_feed(feed(0), NOW)['fetchedAt'] == m.iso_time(NOW)
for key, value in [('schemaVersion', True), ('baseCurrency', 'USD'), ('quoteCurrency', 'USD'), ('sourceUrl', 'https://example.com'),
  ('source', 'CoinGate'), ('rate', '0.000000'), ('rate', '6.700000\\n'), ('rawRate', '6.800000')]:
    bad = feed(); bad[key] = value
    fails(lambda: m.parse_feed(bad, NOW))
fails(lambda: m.parse_feed(feed(86401), NOW))
fails(lambda: m.parse_feed(feed(-31), NOW))
bad = feed(); bad['updatedAt'] = m.iso_time(NOW - 1)
fails(lambda: m.parse_feed(bad, NOW))
`));

test('whole-process deadline interrupts a stuck operation and persists failure state', () => python(`
import time
with tempfile.TemporaryDirectory() as directory:
    with patch.object(m, 'STATE_DIRECTORY', directory), patch.object(m, 'PROCESS_BUDGET_SECONDS', 1):
        def blocked(*args, **kwargs):
            time.sleep(10)
            raise AssertionError('Unbounded operation was not interrupted')
        with patch.object(m, 'run_watchdog', blocked), contextlib.redirect_stderr(io.StringIO()):
            assert m.main() == 1
        saved = state(directory)
        assert saved['status'] == 'unavailable'
        assert saved['error'] == 'watchdog execution deadline exceeded'
`, 5_000));

test('whole-process deadline propagates out of actual feed fallback and never starts a refresh', () => python(`
import time
calls = []
class Opener:
    def open(self, request, timeout):
        calls.append(request.full_url)
        time.sleep(5)
        raise AssertionError('Deadline should have interrupted the first feed source')
with tempfile.TemporaryDirectory() as directory:
    with patch.object(m, 'STATE_DIRECTORY', directory), patch.object(m, 'PROCESS_BUDGET_SECONDS', 1), \\
      patch.object(m.urllib.request, 'build_opener', return_value=Opener()), \\
      patch.object(m, 'request_refresh') as trigger, contextlib.redirect_stderr(io.StringIO()):
        assert m.main() == 1
        trigger.assert_not_called()
    assert len(calls) == 1 and calls[0].startswith(m.RAW_FEED_URL)
    saved = state(directory)
    assert saved['error'] == 'watchdog execution deadline exceeded'
    assert saved.get('triggerRequestedAt') is None
`, 5_000));

test('whole-process deadline during refresh is propagated and is never recorded as successful', () => python(`
import time
class Response:
    status = 200
    def __init__(self, value): self.value = value
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit): return json.dumps(self.value).encode()
class Opener:
    def open(self, request, timeout):
        payload = feed(300)
        if request.full_url.startswith(m.API_FEED_URL):
            payload = {'encoding': 'base64', 'path': 'okx-usdt-cny.json', 'type': 'file',
              'content': base64.b64encode(json.dumps(payload).encode()).decode()}
        return Response(payload)
requests = []
def slow_trigger(*args, **kwargs):
    requests.append(args[0])
    time.sleep(5)
    raise AssertionError('Deadline should have interrupted the refresh')
with tempfile.TemporaryDirectory() as directory:
    with patch.object(m, 'STATE_DIRECTORY', directory), patch.object(m, 'PROCESS_BUDGET_SECONDS', 1), \\
      patch.object(m.time, 'time', return_value=NOW), \\
      patch.object(m.urllib.request, 'build_opener', return_value=Opener()), \\
      patch.object(m, 'request_refresh', slow_trigger), contextlib.redirect_stderr(io.StringIO()):
        assert m.main() == 1
    assert requests == [m.iso_time(NOW)]
    saved = state(directory)
    assert saved['error'] == 'watchdog execution deadline exceeded'
    assert saved['triggerRequestedAt'] is None
    assert saved['lastTriggerAttemptAt'] == m.iso_time(NOW)
    assert saved['fetchedAt'] == m.iso_time(NOW - 300)
`, 5_000));

test('outer deadline recovery never marks future or over-24-hour metadata as fresh', () => python(`
for original, expected_status in [(m.iso_time(NOW + 500), 'unavailable'), (m.iso_time(NOW - 86401), 'expired')]:
    with tempfile.TemporaryDirectory() as directory:
        m.atomic_state(os.path.join(directory, 'status.json'), {'fetchedAt': original})
        with patch.object(m, 'STATE_DIRECTORY', directory), patch.object(m.time, 'time', return_value=NOW), \\
          patch.object(m, 'run_watchdog', side_effect=m.DeadlineExceeded('watchdog execution deadline exceeded')), \\
          contextlib.redirect_stderr(io.StringIO()):
            assert m.main() == 1
        saved = state(directory)
        assert saved['status'] == expected_status and saved['fetchedAt'] == original
        if expected_status == 'unavailable':
            assert saved['ageSeconds'] is None
        else:
            assert saved['ageSeconds'] == 86401 and 'older than 24 hours' in saved['error']
`));

test('watchdog uses fixed raw endpoint and validates fixed GitHub Contents fallback', () => python(`
calls = []
def reader(url):
    calls.append(url)
    if url == m.RAW_FEED_URL: raise OSError('raw unavailable')
    return {'encoding': 'base64', 'path': 'okx-usdt-cny.json', 'type': 'file',
      'content': base64.b64encode(json.dumps(feed()).encode()).decode()}
assert m.fetch_quote(NOW, reader)['rate'] == '6.686007'
assert calls == [m.RAW_FEED_URL, m.API_FEED_URL]
def invalid(url):
    if url == m.RAW_FEED_URL: raise OSError()
    return {'encoding': 'base64', 'path': 'arbitrary.json', 'type': 'file', 'content': ''}
fails(lambda: m.fetch_quote(NOW, invalid))
fails(lambda: m.read_json_response('https://example.com'))
fails(lambda: m.NoRedirects().redirect_request(None, None, 302, '', {}, 'https://example.com'))
`));

test('stale raw CDN checks Contents API and chooses actual latest retrieval time', () => python(`
calls = []
def reader(url):
    calls.append(url)
    if url == m.RAW_FEED_URL: return feed(301)
    return {'encoding': 'base64', 'path': 'okx-usdt-cny.json', 'type': 'file',
      'content': base64.b64encode(json.dumps(feed(5)).encode()).decode()}
assert m.fetch_quote(NOW, reader)['fetchedAt'] == m.iso_time(NOW - 5)
assert calls == [m.RAW_FEED_URL, m.API_FEED_URL]
def api_fails(url):
    if url == m.RAW_FEED_URL: return feed(301)
    raise OSError('API unavailable')
assert m.fetch_quote(NOW, api_fails)['fetchedAt'] == m.iso_time(NOW - 301)
`));

test('HTTP reader adds only a numeric cache buster to fixed hosts, paths and branch', () => python(`
class Response:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit): return b'{}'
requests = []
class Opener:
    def open(self, request, timeout):
        requests.append(request)
        assert timeout == 4
        return Response()
with patch.object(m.urllib.request, 'build_opener', return_value=Opener()), patch.object(m.time, 'time', return_value=NOW):
    assert m.read_json_response(m.RAW_FEED_URL) == {}
    assert m.read_json_response(m.API_FEED_URL) == {}
    fails(lambda: m.read_json_response(m.RAW_FEED_URL + '?url=https://example.com'))
assert requests[0].full_url == m.RAW_FEED_URL + '?watchdogCheckedAt=' + str(int(NOW * 1000))
assert requests[1].full_url == m.API_FEED_URL + '&watchdogCheckedAt=' + str(int(NOW * 1000))
assert all(request.get_header('Cache-control') == 'no-cache' for request in requests)
`));

test('fresh quote does not start a GitHub job and status writes remain private', () => python(`
with tempfile.TemporaryDirectory() as directory:
    requests = []
    assert check(directory, 239, requests.append) == 0
    saved = state(directory)
    assert saved['status'] == 'fresh' and saved['ageSeconds'] == 239
    assert saved['fetchedAt'] == m.iso_time(NOW - 239)
    assert saved['triggerRequestedAt'] is None and requests == []
    assert os.stat(directory).st_mode & 0o077 == 0
    assert os.stat(os.path.join(directory, 'status.json')).st_mode & 0o077 == 0
`));

test('four minute quote requests refresh and never rewrites its actual retrieval time', () => python(`
with tempfile.TemporaryDirectory() as directory:
    requests = []
    assert check(directory, 240, requests.append) == 0
    saved = state(directory)
    assert requests == [m.iso_time(NOW)]
    assert saved['triggerRequestedAt'] == m.iso_time(NOW)
    assert saved['fetchedAt'] == m.iso_time(NOW - 240)
    assert saved['ageSeconds'] == 240 and saved['status'] == 'fresh'
`));

test('trigger is throttled for four minutes even after an uncertain push failure', () => python(`
with tempfile.TemporaryDirectory() as directory:
    requests = []
    def failing_trigger(stamp):
        requests.append(stamp)
        raise m.WatchdogError('push uncertain')
    assert check(directory, 300, failing_trigger) == 1
    assert state(directory)['triggerRequestedAt'] is None
    assert check(directory, 300, requests.append, now=NOW + 120) == 0
    assert requests == [m.iso_time(NOW)]
    assert check(directory, 300, requests.append, now=NOW + 240) == 0
    assert requests == [m.iso_time(NOW), m.iso_time(NOW + 240)]
`));

test('ten minute stale quote reports an alert and nonzero exit even if job requested', () => python(`
with tempfile.TemporaryDirectory() as directory:
    requests = []
    assert check(directory, 600, requests.append) == 1
    saved = state(directory)
    assert saved['status'] == 'expired' and 'ALERT:' in saved['error']
    assert saved['fetchedAt'] == m.iso_time(NOW - 600)
    assert requests == [m.iso_time(NOW)]
`));

test('network failure retains prior real quote metadata and reports failure without inventing freshness', () => python(`
with tempfile.TemporaryDirectory() as directory:
    requests = []
    assert check(directory, 0, requests.append) == 0
    original = state(directory)['fetchedAt']
    def unavailable(moment): raise m.WatchdogError('all sources unavailable')
    assert check(directory, fetcher=unavailable, trigger=requests.append, now=NOW + 601) == 1
    saved = state(directory)
    assert saved['fetchedAt'] == original and saved['ageSeconds'] == 601
    assert saved['status'] == 'expired' and 'all sources unavailable' in saved['error']
    assert requests == [m.iso_time(NOW + 601)]
`));

test('more than 24 hour old incoming data is rejected while previous metadata remains for audit', () => python(`
with tempfile.TemporaryDirectory() as directory:
    assert check(directory, 0, lambda stamp: None) == 0
    original = state(directory)['fetchedAt']
    assert check(directory, age=86401, trigger=lambda stamp: None, now=NOW + 86401) == 1
    saved = state(directory)
    assert saved['fetchedAt'] == original and saved['status'] == 'expired'
    assert saved['ageSeconds'] == 86401
`));

test('missing quote requests retry with unavailable state, invalid previous future time is not fresh', () => python(`
with tempfile.TemporaryDirectory() as directory:
    requests = []
    def unavailable(moment): raise m.WatchdogError('network down')
    assert check(directory, fetcher=unavailable, trigger=requests.append) == 1
    saved = state(directory)
    assert saved['status'] == 'unavailable' and saved['fetchedAt'] is None
    m.atomic_state(os.path.join(directory, 'status.json'), {'fetchedAt': m.iso_time(NOW + 500)})
    assert check(directory, fetcher=unavailable, trigger=requests.append) == 1
    assert state(directory)['status'] == 'unavailable'
`));

test('Git environment isolates configs and credentials and fails closed for unsafe key permissions', () => python(`
environment = m.git_environment('/etc/private-key', '/etc/known_hosts')
assert environment['GIT_CONFIG_GLOBAL'] == '/dev/null'
assert 'StrictHostKeyChecking=yes' in environment['GIT_SSH_COMMAND']
assert 'HostKeyAlias=github.com' in environment['GIT_SSH_COMMAND']
assert 'BatchMode=yes' in environment['GIT_SSH_COMMAND']
assert '-p 443' in environment['GIT_SSH_COMMAND']
assert all(key not in environment for key in ['GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'HTTP_PROXY'])
with tempfile.TemporaryDirectory() as directory:
    key = os.path.join(directory, 'key'); known = os.path.join(directory, 'known')
    pathlib.Path(key).write_text('fixture-key'); pathlib.Path(known).write_text('fixture-known-host')
    os.chmod(key, 0o644); os.chmod(known, 0o600)
    fails(lambda: m.verify_credentials(key, known))
`));

test('Git operations honor deadlines and suppress remote stderr', () => python(`
class TimedOut:
    def __call__(self, *args, **kwargs): raise subprocess.TimeoutExpired(args[0], 1)
with patch.object(m.subprocess, 'run', TimedOut()):
    fails(lambda: m.run_git('/tmp', ['fetch'], {}, m.Deadline(1)))
with patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess(['git'], 128, b'', b'secret remote details')):
    try: m.run_git('/tmp', ['push'], {}, m.Deadline(1))
    except m.WatchdogError as error:
        assert 'secret' not in str(error) and 'push failed' in str(error)
    else: raise AssertionError('Expected Git failure')
fails(lambda: m.Deadline(0).remaining(1))
`));

test('Git plumbing writes only request marker branch and safely includes latest main without force push', () => python(`
with tempfile.TemporaryDirectory() as directory:
    remote = os.path.join(directory, 'remote.git')
    seed = os.path.join(directory, 'seed')
    env = m.git_environment('/fixture-key', '/fixture-known')
    def local_git(cwd, args, content=None):
        result = subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-C', cwd] + args,
          input=content.encode() if content is not None else None, stdout=subprocess.PIPE,
          stderr=subprocess.PIPE, env=env, timeout=5)
        assert result.returncode == 0, result.stderr.decode()
        return result.stdout.decode().strip()
    os.mkdir(remote); local_git(remote, ['init', '--bare', '--quiet'])
    os.mkdir(seed); local_git(seed, ['init', '--quiet'])
    local_git(seed, ['checkout', '--quiet', '-b', 'main'])
    pathlib.Path(os.path.join(seed, 'catalog.json')).write_text('["product stays"]')
    pathlib.Path(os.path.join(seed, 'README.md')).write_text('initial main')
    local_git(seed, ['add', '.']); local_git(seed, ['commit', '--quiet', '-m', 'main seed'])
    local_git(seed, ['push', '--quiet', remote, 'main'])
    main_before = local_git(remote, ['rev-parse', 'refs/heads/main'])
    local_git(seed, ['checkout', '--quiet', '--orphan', 'rate-feed'])
    local_git(seed, ['rm', '--cached', '--quiet', '-r', '.'])
    os.unlink(os.path.join(seed, 'README.md')); os.unlink(os.path.join(seed, 'catalog.json'))
    pathlib.Path(os.path.join(seed, 'okx-usdt-cny.json')).write_text(json.dumps(feed()))
    local_git(seed, ['add', 'okx-usdt-cny.json']); local_git(seed, ['commit', '--quiet', '-m', 'feed seed'])
    local_git(seed, ['push', '--quiet', remote, 'rate-feed'])
    feed_before = local_git(remote, ['rev-parse', 'refs/heads/rate-feed'])
    original_runner = m.run_git
    calls = []
    def local_runner(cwd, args, environment, deadline, input_text=None, allowed_codes=(0,), maximum=10):
        calls.append(list(args))
        args = [remote if arg == m.REPOSITORY_URL else arg for arg in args]
        result = subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-C', cwd] + args,
          input=input_text.encode() if input_text is not None else None, stdout=subprocess.PIPE,
          stderr=subprocess.PIPE, env=environment, timeout=5)
        assert result.returncode in allowed_codes, result.stderr.decode()
        return result.returncode, result.stdout.decode().strip()
    with patch.object(m, 'verify_credentials'), patch.object(m, 'run_git', local_runner):
        first = m.request_refresh(m.iso_time(NOW), directory)
        assert local_git(remote, ['rev-parse', 'refs/heads/main']) == main_before
        assert local_git(remote, ['rev-parse', 'refs/heads/rate-feed']) == feed_before
        assert local_git(remote, ['show', first + ':catalog.json']) == '["product stays"]'
        assert json.loads(local_git(remote, ['show', first + ':' + m.MARKER_PATH])) == {'requestedAt': m.iso_time(NOW)}
        assert local_git(remote, ['rev-list', '--parents', '-n', '1', first]).split() == [first, main_before]
        local_git(seed, ['checkout', '--quiet', 'main'])
        pathlib.Path(os.path.join(seed, 'README.md')).write_text('updated main')
        local_git(seed, ['add', 'README.md']); local_git(seed, ['commit', '--quiet', '-m', 'main update'])
        local_git(seed, ['push', '--quiet', remote, 'main'])
        main_after = local_git(remote, ['rev-parse', 'refs/heads/main'])
        second = m.request_refresh(m.iso_time(NOW + 240), directory)
        assert local_git(remote, ['rev-list', '--parents', '-n', '1', second]).split() == [second, first, main_after]
        assert local_git(remote, ['show', second + ':README.md']) == 'updated main'
        assert local_git(remote, ['rev-parse', 'refs/heads/main']) == main_after
        assert local_git(remote, ['rev-parse', 'refs/heads/rate-feed']) == feed_before
        pushes = [args for args in calls if args[0] == 'push']
        assert len(pushes) == 2 and all('--force' not in args for args in pushes)
        assert all(args[-1].endswith(':refs/heads/rate-refresh') for args in pushes)
`));
