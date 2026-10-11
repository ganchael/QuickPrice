#!/usr/bin/env python3
"""Check the fixed OKX feed and request a GitHub runner refresh when needed.

Python 3.6 compatible. There is deliberately no configurable upstream URL,
repository, branch, or Git command. The server's repository-scoped deploy key
is kept outside the checkout; this program never reads or prints its contents.
"""

import base64
import datetime
import decimal
import fcntl
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


RAW_FEED_URL = 'https://raw.githubusercontent.com/ganchael/QuickPrice/rate-feed/okx-usdt-cny.json'
API_FEED_URL = 'https://api.github.com/repos/ganchael/QuickPrice/contents/okx-usdt-cny.json?ref=rate-feed'
OKX_SOURCE_URL = 'https://www.okx.com/zh-hans/convert/usdt-to-cny'
REPOSITORY_URL = 'ssh://git@ssh.github.com:443/ganchael/QuickPrice.git'
MAIN_REF = 'refs/heads/main'
REFRESH_REF = 'refs/heads/rate-refresh'
MARKER_PATH = '.rate-refresh-request.json'
STATE_DIRECTORY = '/var/lib/quickprice-rate-watchdog'
KEY_PATH = '/etc/quickprice-rate-watchdog/github_ed25519'
KNOWN_HOSTS_PATH = '/etc/quickprice-rate-watchdog/known_hosts'
MAX_BODY_BYTES = 128 * 1024
REFRESH_AFTER_SECONDS = 240
EXPIRED_AFTER_SECONDS = 600
MAX_FEED_AGE_SECONDS = 24 * 60 * 60
PROCESS_BUDGET_SECONDS = 60


class WatchdogError(Exception):
    pass


class DeadlineExceeded(WatchdogError):
    """An overall deadline must escape all source/retry error handling."""
    pass


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise WatchdogError('feed redirect refused')


def timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise WatchdogError('invalid feed timestamp')
    for pattern in ('%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%SZ'):
        try:
            return datetime.datetime.strptime(value, pattern).replace(
                tzinfo=datetime.timezone.utc).timestamp()
        except ValueError:
            pass
    raise WatchdogError('invalid feed timestamp')


def iso_time(seconds):
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).isoformat(
        timespec='milliseconds').replace('+00:00', 'Z')


def parse_feed(payload, now):
    if not isinstance(payload, dict) or type(payload.get('schemaVersion')) is not int or \
            payload.get('schemaVersion') != 1 or \
            payload.get('baseCurrency') != 'USDT' or payload.get('quoteCurrency') != 'CNY' or \
            payload.get('delivery') != 'scheduled' or payload.get('kind') != 'reference' or \
            payload.get('source') != '欧易 OKX · 获取于' or \
            payload.get('sourceUrl') != OKX_SOURCE_URL:
        raise WatchdogError('feed source or currency pair is invalid')
    rate = payload.get('rate')
    if not isinstance(rate, str) or not re.fullmatch(r'[0-9]{1,6}\.[0-9]{6}', rate):
        raise WatchdogError('feed price is invalid')
    numeric_rate = decimal.Decimal(rate)
    if numeric_rate <= 0 or numeric_rate >= 1000000:
        raise WatchdogError('feed price is out of range')
    raw_rate = payload.get('rawRate')
    if not isinstance(raw_rate, str) or len(raw_rate) > 64 or \
            not re.fullmatch(r'[0-9]{1,6}(?:\.[0-9]+)?', raw_rate):
        raise WatchdogError('feed raw price is invalid')
    if abs(decimal.Decimal(raw_rate) - numeric_rate) > decimal.Decimal('0.0000005'):
        raise WatchdogError('feed price precision is inconsistent')
    fetched = timestamp(payload.get('fetchedAt'))
    if payload.get('updatedAt') != payload.get('fetchedAt') or \
            fetched > now + 30 or now - fetched > MAX_FEED_AGE_SECONDS:
        raise WatchdogError('feed retrieval time is invalid or older than 24 hours')
    return {'fetchedAt': payload['fetchedAt'], 'rate': rate}


def read_json_response(url, timeout=4):
    if url not in (RAW_FEED_URL, API_FEED_URL):
        raise WatchdogError('non-allowlisted feed URL refused')
    # Do not rely on a CDN honoring a request cache header for a moving branch.
    # Only this generated numeric query may vary; host/path/ref remain fixed.
    separator = '&' if '?' in url else '?'
    request_url = url + separator + 'watchdogCheckedAt=' + str(int(time.time() * 1000))
    request = urllib.request.Request(request_url, headers={
        'Accept': 'application/json',
        'User-Agent': 'QuickPrice-Rate-Watchdog/1.0',
        'Cache-Control': 'no-cache',
    })
    # No local VPN/proxy is required. The HTTPS handler retains CA verification.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
    with opener.open(request, timeout=timeout) as response:
        if response.status != 200:
            raise WatchdogError('feed HTTP status is not 200')
        content = response.read(MAX_BODY_BYTES + 1)
        if len(content) > MAX_BODY_BYTES:
            raise WatchdogError('feed response is too large')
    return json.loads(content.decode('utf-8'))


def fetch_quote(now, reader=read_json_response):
    failures = []
    candidate = None
    for url in (RAW_FEED_URL, API_FEED_URL):
        try:
            payload = reader(url)
            if url == API_FEED_URL:
                if not isinstance(payload, dict) or payload.get('encoding') != 'base64' or \
                        payload.get('path') != 'okx-usdt-cny.json' or payload.get('type') != 'file':
                    raise WatchdogError('GitHub Contents response is invalid')
                encoded = payload.get('content')
                if not isinstance(encoded, str) or len(encoded) > MAX_BODY_BYTES:
                    raise WatchdogError('GitHub Contents response is too large')
                content = base64.b64decode(encoded.replace('\n', ''), validate=True)
                if len(content) > MAX_BODY_BYTES:
                    raise WatchdogError('decoded feed response is too large')
                payload = json.loads(content.decode('utf-8'))
            quote = parse_feed(payload, now)
            if candidate is None or timestamp(quote['fetchedAt']) > timestamp(candidate['fetchedAt']):
                candidate = quote
            if url == RAW_FEED_URL and now - timestamp(quote['fetchedAt']) < REFRESH_AFTER_SECONDS:
                return quote
        except DeadlineExceeded:
            raise
        except (WatchdogError, ValueError, TypeError, OSError) as error:
            failures.append(type(error).__name__)
    if candidate is not None:
        return candidate
    # Do not dump remote response text or subprocess stderr into status/journals.
    raise WatchdogError('both fixed GitHub feed endpoints failed ({})'.format(', '.join(failures)))


def atomic_state(path, value):
    directory = os.path.dirname(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.status-', dir=directory)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(value, output, ensure_ascii=False, sort_keys=True)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_state(path):
    try:
        with open(path, encoding='utf-8') as source:
            value = json.load(source)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


class Deadline:
    def __init__(self, seconds=PROCESS_BUDGET_SECONDS):
        self.end = time.monotonic() + seconds

    def remaining(self, maximum):
        remaining = min(maximum, self.end - time.monotonic())
        if remaining <= 0:
            raise DeadlineExceeded('watchdog execution deadline exceeded')
        return remaining


def git_environment(key_path, known_hosts_path):
    ssh_args = [
        '/usr/bin/ssh', '-F', '/dev/null', '-p', '443', '-i', key_path,
        '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlias=github.com',
        '-o', 'UserKnownHostsFile=' + known_hosts_path,
        '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=5',
        '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=5',
        '-o', 'ServerAliveCountMax=1',
    ]
    return {
        'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8',
        'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_SYSTEM': '/dev/null',
        'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
        'GIT_SSH_COMMAND': ' '.join(shlex.quote(argument) for argument in ssh_args),
        'GIT_AUTHOR_NAME': 'QuickPrice rate watchdog',
        'GIT_AUTHOR_EMAIL': 'quickprice-watchdog@users.noreply.github.com',
        'GIT_COMMITTER_NAME': 'QuickPrice rate watchdog',
        'GIT_COMMITTER_EMAIL': 'quickprice-watchdog@users.noreply.github.com',
    }


def run_git(directory, arguments, environment, deadline, input_text=None,
            allowed_codes=(0,), maximum=10):
    command = ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
               '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never',
               '-c', 'credential.helper=', '-C', directory] + arguments
    try:
        result = subprocess.run(command, input=input_text.encode('utf-8') if input_text is not None else None,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=environment, timeout=deadline.remaining(maximum))
    except subprocess.TimeoutExpired:
        raise WatchdogError('Git operation timed out')
    if result.returncode not in allowed_codes:
        raise WatchdogError('Git {} failed (exit {})'.format(arguments[0], result.returncode))
    return result.returncode, result.stdout.decode('utf-8').strip()


def verify_credentials(key_path, known_hosts_path):
    for credential_path in (key_path, known_hosts_path):
        if not os.path.isfile(credential_path) or os.path.islink(credential_path):
            raise WatchdogError('server GitHub credential or known_hosts is missing')
        if os.stat(credential_path).st_uid != 0 or os.stat(credential_path).st_mode & 0o077:
            raise WatchdogError('server GitHub credential permissions must be root-only')


def request_refresh(requested_at, state_directory=STATE_DIRECTORY, key_path=KEY_PATH,
                    known_hosts_path=KNOWN_HOSTS_PATH, deadline=None):
    deadline = deadline or Deadline()
    verify_credentials(key_path, known_hosts_path)
    environment = git_environment(key_path, known_hosts_path)
    with tempfile.TemporaryDirectory(prefix='git-request-', dir=state_directory) as directory:
        def git(arguments, **options):
            return run_git(directory, arguments, environment, deadline, **options)
        git(['init', '--quiet'])
        git(['fetch', '--quiet', '--depth=1', '--no-tags', REPOSITORY_URL,
             MAIN_REF + ':refs/remotes/watchdog/main'])
        main = git(['rev-parse', 'refs/remotes/watchdog/main'])[1]
        branch_status, branch_output = git(
            ['ls-remote', '--exit-code', '--heads', REPOSITORY_URL, REFRESH_REF],
            allowed_codes=(0, 2), maximum=8)
        refresh = None
        if branch_status == 0:
            if not re.match(r'^[0-9a-f]{40,64}\s+refs/heads/rate-refresh$', branch_output):
                raise WatchdogError('unexpected refresh branch response')
            git(['fetch', '--quiet', '--depth=1', '--no-tags', REPOSITORY_URL,
                 REFRESH_REF + ':refs/remotes/watchdog/refresh'])
            refresh = git(['rev-parse', 'refs/remotes/watchdog/refresh'])[1]
        environment['GIT_INDEX_FILE'] = os.path.join(directory, 'request.index')
        git(['read-tree', main])
        marker = json.dumps({'requestedAt': requested_at}, sort_keys=True) + '\n'
        blob = git(['hash-object', '-w', '--stdin'], input_text=marker)[1]
        git(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + MARKER_PATH])
        tree = git(['write-tree'])[1]
        parents = ['-p', refresh, '-p', main] if refresh and refresh != main else ['-p', main]
        commit = git(['commit-tree', tree] + parents,
                     input_text='Request OKX USDT CNY rate refresh\n')[1]
        # Only the dedicated request branch is written; never force-push main or feed.
        git(['push', '--quiet', REPOSITORY_URL, commit + ':' + REFRESH_REF])
        return commit


def run_watchdog(state_directory=STATE_DIRECTORY, now=None, quote_fetcher=fetch_quote,
                 trigger=None):
    now = time.time() if now is None else now
    os.makedirs(state_directory, mode=0o700, exist_ok=True)
    os.chmod(state_directory, 0o700)
    path = os.path.join(state_directory, 'status.json')
    previous = load_state(path)
    state = {
        'checkedAt': iso_time(now), 'fetchedAt': previous.get('fetchedAt'),
        'ageSeconds': None, 'status': 'unavailable',
        'triggerRequestedAt': previous.get('triggerRequestedAt'),
        'lastTriggerAttemptAt': previous.get('lastTriggerAttemptAt'), 'error': None,
    }
    fetch_failed = False
    errors = []
    try:
        quote = quote_fetcher(now)
        state['fetchedAt'] = quote['fetchedAt']
    except DeadlineExceeded:
        raise
    except (WatchdogError, ValueError, OSError) as error:
        fetch_failed = True
        errors.append(str(error) if isinstance(error, WatchdogError) else 'feed check failed')
    try:
        fetched = timestamp(state['fetchedAt'])
        if fetched > now + 30:
            raise WatchdogError('previous feed metadata is invalid')
        state['ageSeconds'] = max(0, int(now - fetched))
        state['status'] = 'fresh' if now - fetched < EXPIRED_AFTER_SECONDS else 'expired'
    except DeadlineExceeded:
        raise
    except WatchdogError:
        state['fetchedAt'] = previous.get('fetchedAt')
    needs_refresh = state['ageSeconds'] is None or state['ageSeconds'] >= REFRESH_AFTER_SECONDS
    try:
        last_attempt = timestamp(state['lastTriggerAttemptAt'])
        throttled = -30 <= now - last_attempt < REFRESH_AFTER_SECONDS
    except DeadlineExceeded:
        raise
    except WatchdogError:
        throttled = False
    if needs_refresh and not throttled:
        # Persist before attempting a push: an uncertain timeout must not cause
        # duplicate runner requests every two minutes if the remote accepted it.
        state['lastTriggerAttemptAt'] = iso_time(now)
        atomic_state(path, state)
        try:
            if trigger is None:
                request_refresh(state['lastTriggerAttemptAt'], state_directory=state_directory)
            else:
                trigger(state['lastTriggerAttemptAt'])
            state['triggerRequestedAt'] = state['lastTriggerAttemptAt']
        except DeadlineExceeded:
            raise
        except (WatchdogError, ValueError, OSError) as error:
            errors.append(str(error) if isinstance(error, WatchdogError) else 'refresh request failed')
    if state['status'] == 'expired':
        errors.append('ALERT: OKX feed is at least 10 minutes old; fresh rate not confirmed')
    elif state['status'] == 'unavailable':
        errors.append('ALERT: no valid OKX feed within 24 hours')
    state['error'] = '; '.join(errors) if errors else None
    atomic_state(path, state)
    print(json.dumps(state, ensure_ascii=False, sort_keys=True), flush=True)
    return 1 if errors or fetch_failed else 0


def main():
    os.umask(0o077)
    os.makedirs(STATE_DIRECTORY, mode=0o700, exist_ok=True)
    lock_path = os.path.join(STATE_DIRECTORY, '.lock')
    with open(lock_path, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Another watchdog check is already running.', file=sys.stderr)
            return 0
        def timed_out(signum, frame):
            raise DeadlineExceeded('watchdog execution deadline exceeded')
        signal.signal(signal.SIGALRM, timed_out)
        signal.alarm(PROCESS_BUDGET_SECONDS)
        try:
            return run_watchdog(state_directory=STATE_DIRECTORY)
        except (WatchdogError, OSError, ValueError) as error:
            # Keep the last verified quote time when an overall deadline fires.
            path = os.path.join(STATE_DIRECTORY, 'status.json')
            previous = load_state(path)
            checked = time.time()
            previous.update({'checkedAt': iso_time(checked), 'error':
                             str(error) if isinstance(error, WatchdogError) else 'watchdog execution failed'})
            try:
                fetched = timestamp(previous.get('fetchedAt'))
                if fetched > checked + 30:
                    raise WatchdogError('previous feed retrieval time is in the future')
                quote_age = max(0, checked - fetched)
                previous['ageSeconds'] = int(quote_age)
                previous['status'] = 'fresh' if quote_age < EXPIRED_AFTER_SECONDS else 'expired'
                if quote_age > MAX_FEED_AGE_SECONDS:
                    previous['error'] += '; previous verified quote is older than 24 hours'
            except WatchdogError:
                previous['ageSeconds'] = None
                previous['status'] = 'unavailable'
            atomic_state(path, previous)
            print(json.dumps(previous, ensure_ascii=False, sort_keys=True), file=sys.stderr)
            return 1
        finally:
            signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
