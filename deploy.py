#!/usr/bin/env python3
"""Deploy an app to the mail server.

Replaces deploy-console.sh, which pointed at a DigitalOcean droplet
(206.189.136.89, user `ubuntu`, /home/ubuntu/arham-console, pm2 name
`arham-console`) that has since been decommissioned. Every one of those facts is
now wrong, and the script would have failed halfway through or, worse, deployed
somewhere nobody was looking.

Transport is AWS SSM, not SSH. Port 22 is allowlisted to a single operator IP
that is a dynamic ISP address, so SSH breaks without warning whenever it drifts;
SSM needs no open port, no key and no allowlist. (An Elastic IP does not help —
it pins the server's address, which is already static. The address that moves is
the client's.)

Only files that changed since the last deploy are shipped. The server has no git
and no `patch` binary, and SSM caps a command near 100KB while the console
sources alone are 235KB gzipped, so neither a pull nor a whole-tree push is
available. Each file goes over as gzip+base64 and is verified by md5 before
anything is built.

Usage:
    python3 deploy.py <console|webui|workers> [--since REF] [--dry-run]

The baseline is read from /srv/<app>/.deployed-commit, written by the previous
run. Pass --since explicitly the first time, or to redeploy from further back.
"""
import argparse, base64, gzip, hashlib, subprocess, sys, time

INSTANCE, REGION = 'i-09a9636fa02fcbab4', 'ap-south-1'

APPS = {
    'console': {'local': 'console-app', 'remote': '/srv/console',
                'build': 'npm run build', 'pm2': ['console']},
    'webui':   {'local': 'webui',       'remote': '/srv/webui',
                'build': 'npm run build', 'pm2': ['webui']},
    # `build` here is `tsc --noEmit`: a typecheck, not a compile. The workers run
    # straight from source, so this gates the deploy rather than producing output.
    'workers': {'local': 'workers',     'remote': '/srv/workers',
                'build': 'npm run build',
                'pm2': ['migration-orchestrator', 'migration-users', 'migration-messages']},
}

# SSM rejects a command document over ~100KB. Anything close to that needs a
# different transport (S3 with an instance-role grant), so fail loudly instead of
# letting the API reject it with something unhelpful.
MAX_B64 = 60_000


def ssm(cmd, timeout=900):
    import boto3
    c = boto3.client('ssm', region_name=REGION)
    cid = c.send_command(InstanceIds=[INSTANCE], DocumentName='AWS-RunShellScript',
                         Parameters={'commands': [cmd], 'executionTimeout': [str(timeout)]}
                         )['Command']['CommandId']
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(3)
        try:
            inv = c.get_command_invocation(CommandId=cid, InstanceId=INSTANCE)
        except c.exceptions.InvocationDoesNotExist:
            continue
        if inv['Status'] in ('Pending', 'InProgress', 'Delayed'):
            continue
        return inv['Status'], (inv.get('StandardOutputContent') or '').strip(), \
               (inv.get('StandardErrorContent') or '').strip()
    return 'Timeout', '', ''


def git(*a):
    return subprocess.run(['git', *a], capture_output=True, text=True, check=True).stdout.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('app', choices=sorted(APPS))
    ap.add_argument('--since', help='baseline commit (default: server marker)')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    app = APPS[args.app]
    local, remote = app['local'], app['remote']

    # Deploying an uncommitted tree is how the server quietly stops matching any
    # commit. Refuse rather than produce a build nobody can trace back to a sha.
    if git('status', '--porcelain', '--', local):
        sys.exit('ERROR: uncommitted changes under %s/ — commit them first.' % local)

    head = git('rev-parse', 'HEAD')
    base = args.since
    if not base:
        st, out, _ = ssm('cat %s/.deployed-commit 2>/dev/null || true' % remote, 60)
        base = out.strip()
        if not base:
            sys.exit('ERROR: no %s/.deployed-commit on the server. Pass --since REF.' % remote)
    base = git('rev-parse', base)
    if base == head:
        print('Server already at %s — nothing to deploy.' % head[:9]); return

    rng = '%s..%s' % (base, head)
    changed = [f for f in git('diff', '--name-only', '--diff-filter=ACMR', rng, '--', local).splitlines() if f]
    deleted = [f for f in git('diff', '--name-only', '--diff-filter=D', rng, '--', local).splitlines() if f]
    print('%s: %s -> %s  (%d changed, %d deleted)' % (args.app, base[:9], head[:9], len(changed), len(deleted)))
    for f in changed + deleted:
        print('   %s %s' % ('D' if f in deleted else 'M', f))
    if args.dry_run:
        print('\n--dry-run: nothing sent.'); return
    if not changed and not deleted:
        print('No files under %s/ changed.' % local); return

    for f in changed:
        raw = open(f, 'rb').read()
        want = hashlib.md5(raw).hexdigest()
        b = base64.b64encode(gzip.compress(raw, 9)).decode()
        if len(b) > MAX_B64:
            sys.exit('ERROR: %s is too large for SSM (%d b64 bytes).' % (f, len(b)))
        dest = '%s/%s' % (remote, f[len(local) + 1:])
        # SSM runs as root; without the chown the app's own user loses ownership
        # of files it has to rebuild from.
        st, out, err = ssm(
            'set -e\nmkdir -p "$(dirname "%s")"\ncp -n "%s" "%s.bak-predeploy" 2>/dev/null || true\n'
            "echo '%s' | base64 -d | gunzip > \"%s\"\nchown ec2-user:ec2-user \"%s\"\n"
            'md5sum "%s" | cut -d" " -f1\n' % (dest, dest, dest, b, dest, dest, dest), 180)
        got = out.splitlines()[-1] if out else ''
        if st != 'Success' or got != want:
            sys.exit('ERROR: failed to ship %s (%s) %s' % (f, st, err[:300]))
        print('   sent %s' % dest)

    for f in deleted:
        ssm('rm -f "%s/%s"' % (remote, f[len(local) + 1:]), 60)
        print('   removed %s' % f)

    print('\nBuilding...')
    st, out, err = ssm('cd %s && sudo -u ec2-user -H env PATH=$PATH %s 2>&1 | tail -15'
                       % (remote, app['build']), 900)
    print(out[-2000:] or err[-2000:])
    if st != 'Success':
        sys.exit('ERROR: build failed — nothing restarted, previous build still serving.')

    print('\nRestarting %s...' % ', '.join(app['pm2']))
    st, out, _ = ssm('sudo -u ec2-user -H pm2 restart %s --update-env >/dev/null 2>&1; sleep 8; '
                     'sudo -u ec2-user -H pm2 list 2>/dev/null | grep -E "%s"'
                     % (' '.join(app['pm2']), '|'.join(app['pm2'])), 240)
    print(out)

    ssm('echo %s > %s/.deployed-commit && chown ec2-user:ec2-user %s/.deployed-commit'
        % (head, remote, remote), 60)
    print('\nDeployed %s at %s' % (args.app, head[:9]))


if __name__ == '__main__':
    main()
