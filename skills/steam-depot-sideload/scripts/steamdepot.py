#!/usr/bin/env python3
"""steamdepot.py — parsing/verification/manifest tool for Steam depot sideloading.

Parses output of Steam's console commands (`app_info_print`, `licenses_print`)
from console_log.txt, verifies a downloaded depot against its manifest, and
writes/patches appmanifest_<appid>.acf so the Windows Steam client (Wine/Heroic)
registers a sideloaded install.

Subcommands: appinfo, licenses, verify, manifest, reset
"""
import argparse, json, os, re, shutil, sys, time

DEFAULT_LOG = os.path.expanduser(
    "~/Library/Application Support/Steam/logs/console_log.txt")
TS = re.compile(r'^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] ', re.M)


def strip_ts(text):
    return TS.sub('', text)


# ---------- tiny VDF parser for appinfo blocks ----------

def vdf_parse(lines):
    """Parse tab-indented VDF (Steam appinfo format). lines: [(ntabs, text)]."""
    pos = 0

    def walk(ntabs):
        nonlocal pos
        out = {}
        while pos < len(lines):
            t, c = lines[pos]
            if c == '}' and t == ntabs - 1:
                pos += 1
                return out
            if t < ntabs:
                return out
            m = re.match(r'^"(.+?)"(?:\t+(.*))?$', c)
            if not m:
                pos += 1
                continue
            key, val = m.group(1), m.group(2)
            pos += 1
            if val is None:
                if pos < len(lines) and lines[pos][1] == '{':
                    pos += 1
                    out[key] = walk(t + 1)
                else:
                    out[key] = None
            else:
                out[key] = val.strip().strip('"')
        return out

    return walk(0)


def extract_appinfo_blocks(text):
    """Yield (appid, parsed_dict) for each `app_info_print` block in the log."""
    lines = [(len(l) - len(l.lstrip('\t')), l.lstrip('\t').rstrip())
             for l in strip_ts(text).splitlines()]
    marks = [i for i, (_, c) in enumerate(lines)
             if re.match(r'^AppID : \d+, change number', c)]
    marks.append(len(lines))
    for start, end in zip(marks[:-1], marks[1:]):
        m = re.match(r'^AppID : (\d+),', lines[start][1])
        appid = int(m.group(1))
        j = start + 1
        if j >= end:
            continue
        try:
            parsed = vdf_parse(lines[j:end])
        except Exception as e:
            sys.stderr.write(f"warn: appid {appid} parse failed: {e}\n")
            continue
        # top level is keyed by the appid string; convar-echo junk lines after
        # the closing brace may add stray keys — unwrap just the app's dict.
        body = parsed.get(str(appid))
        if isinstance(body, dict):
            yield appid, body


def cmd_appinfo(args):
    text = open(args.log, encoding='utf-8', errors='replace').read()
    found = 0
    for appid, d in extract_appinfo_blocks(text):
        if args.appid and appid not in args.appid:
            continue
        found += 1
        common = d.get('common') or {}
        extended = d.get('extended') or {}
        config = d.get('config') or {}
        branches = (d.get('depots') or {}).get('branches') or {}
        public = branches.get('public') or {}
        info = {
            'appid': appid,
            'name': common.get('name'),
            'type': common.get('type'),
            'oslist': common.get('oslist'),
            'parent': common.get('parent'),
            'buildid_public': public.get('buildid'),
            'installdir': config.get('installdir'),
            'listofdlc': extended.get('listofdlc'),
            'depots': [],
        }
        depots = d.get('depots') or {}
        for k, v in depots.items():
            if not re.fullmatch(r'\d+', str(k)):
                continue
            entry = {'depot': k}
            if isinstance(v, dict):
                if 'depotfromapp' in v:
                    entry['shared_from_app'] = v['depotfromapp']
                    info['depots'].append(entry)
                    continue
                if 'dlcappid' in v:
                    entry['dlcappid'] = v['dlcappid']
                pub = (v.get('manifests') or {}).get('public') or {}
                entry['manifest_gid'] = pub.get('gid')
                entry['size'] = pub.get('size')
                entry['download'] = pub.get('download')
            info['depots'].append(entry)
        if args.json:
            print(json.dumps(info, indent=2))
        else:
            print(f"=== AppID {appid}: {info['name']} "
                  f"[{info['type']}, oslist={info['oslist']}] ===")
            print(f"  public buildid : {info['buildid_public']}")
            if info['installdir']:
                print(f"  installdir     : {info['installdir']}")
            if info['listofdlc']:
                print(f"  listofdlc      : {info['listofdlc']}")
            for e in info['depots']:
                size = e.get('size')
                dl = e.get('download')
                sz = f"{int(size)/1e9:.1f}GB" if size else "-"
                dlh = f"dl {int(dl)/1e9:.1f}GB" if dl else ""
                extra = []
                if e.get('dlcappid'):
                    extra.append(f"dlcappid={e['dlcappid']}")
                if e.get('shared_from_app'):
                    extra.append(f"shared from app {e['shared_from_app']}")
                gid = e.get('manifest_gid') or '(no public manifest)'
                print(f"  depot {e['depot']:>8}: {gid}  {sz} {dlh} "
                      f"{' '.join(extra)}".rstrip())
            print()
    if not found:
        sys.stderr.write("no app_info_print blocks found in log\n"
                         f"(log: {args.log})\n"
                         "hint: run `app_info_print <appid>` in the Steam console\n")
        return 1
    return 0


# ---------- licenses_print parser ----------

def cmd_licenses(args):
    text = open(args.log, encoding='utf-8', errors='replace').read()
    txt = strip_ts(text)
    parts = re.split(r'(License packageID (\d+):)', txt)
    out = []
    for i in range(1, len(parts) - 1, 3):
        pkg = int(parts[i + 1])
        body = parts[i + 2]
        st = re.search(r'- State\s*:\s*\n(.+?)\n.*?\(flags (0x[0-9a-fA-F]+)\)',
                       body, re.S)
        apps_m = re.search(
            r'- Apps\s*:\s*\n(.*?)(?=\(\d+ in total\)|- Depots|License packageID|\Z)',
            body, re.S)
        dep_m = re.search(
            r'- Depots\s*:\s*\n(.*?)(?=\(\d+ in total\)|License packageID|\Z)',
            body, re.S)
        rec = {
            'package': pkg,
            'state': st.group(1).strip() if st else '?',
            'flags': st.group(2) if st else '?',
            'apps': [int(x) for x in re.findall(r'(\d+),', apps_m.group(1))] if apps_m else [],
            'depots': [int(x) for x in re.findall(r'(\d+),', dep_m.group(1))] if dep_m else [],
        }
        out.append(rec)
        if args.json:
            continue
        apps = ','.join(str(a) for a in rec['apps']) or '-'
        deps = ','.join(str(d) for d in rec['depots']) or '(0 in total)'
        print(f"pkg {pkg:>9} [{rec['state']} {rec['flags']}] "
              f"apps: {apps}  |  depots: {deps}")
    if args.json:
        print(json.dumps(out, indent=2))
    if not out:
        sys.stderr.write("no licenses_print output found\n"
                         "hint: run `licenses_print` in the Steam console\n")
        return 1
    return 0


# ---------- depot verification ----------

def cmd_verify(args):
    depot = os.path.expanduser(args.depot)
    manifest = None
    for name in sorted(os.listdir(depot)):
        if re.match(r'Manifest_\w*Files_\w+\.txt$', name):
            manifest = os.path.join(depot, name)
            if 'NonUFS' in name:
                break
    if not manifest:
        print(f"NO manifest file found in {depot}", file=sys.stderr)
        return 2
    missing, present = [], 0
    with open(manifest, encoding='utf-8', errors='replace') as f:
        for line in f:
            path = line.split('\t')[0].strip()
            if not path:
                continue
            if os.path.isfile(os.path.join(depot, path)):
                present += 1
            else:
                missing.append(path)
    total = present + len(missing)
    print(f"manifest : {os.path.basename(manifest)}")
    print(f"files    : {present}/{total} present")
    if missing:
        print(f"MISSING  : {len(missing)}")
        for m in missing[:args.list]:
            print(f"  {m}")
        if len(missing) > args.list:
            print(f"  ... and {len(missing) - args.list} more")
        return 1
    print("OK — all manifest files present")
    return 0


# ---------- appmanifest writer ----------

ACF_INT_KEYS = ['StateFlags', 'StagingSize', 'BytesToDownload', 'BytesDownloaded',
                'BytesToStage', 'BytesStaged']


def build_installed_depots(depots, dlc_depots):
    lines = ['\t"InstalledDepots"', '\t{']
    for d in depots:
        dep, gid, size = d.split(':')
        lines += [f'\t\t"{dep}"', '\t\t{',
                  f'\t\t\t"manifest"\t\t"{gid}"',
                  f'\t\t\t"size"\t\t"{size}"', '\t\t}']
    for d in dlc_depots:
        parts = d.split(':')
        dep, gid, size, dlcappid = parts[0], parts[1], parts[2], parts[3]
        lines += [f'\t\t"{dep}"', '\t\t{',
                  f'\t\t\t"manifest"\t\t"{gid}"',
                  f'\t\t\t"size"\t\t"{size}"',
                  f'\t\t\t"dlcappid"\t\t"{dlcappid}"', '\t\t}']
    lines.append('\t}')
    return '\n'.join(lines)


def replace_installed_depots(text, block):
    m = re.search(r'\n\t"InstalledDepots"\n\t\{.*?\n\t\}', text, re.S)
    if not m:
        # append before final closing brace
        idx = text.rstrip().rfind('\n}')
        return text[:idx] + '\n' + block + text[idx:]
    return text[:m.start()] + '\n' + block + text[m.end():]


def set_scalar(text, key, value):
    pat = re.compile(r'(\n\t"%s"\t\t")[^"]*(")' % re.escape(key))
    if pat.search(text):
        return pat.sub(lambda m: m.group(1) + str(value) + m.group(2), text)
    return text


def cmd_manifest(args):
    steamapps = os.path.join(os.path.expanduser(args.library),
                             'steamapps')
    path = os.path.join(steamapps, f'appmanifest_{args.appid}.acf')
    total = sum(int(d.split(':')[2]) for d in args.depot)
    total += sum(int(d.split(':')[2]) for d in args.dlc_depot)
    depots_block = build_installed_depots(args.depot, args.dlc_depot)

    if os.path.exists(path) and not args.fresh:
        with open(path, encoding='utf-8', errors='replace') as f:
            text = f.read()
        action = 'patched'
    else:
        if not args.lastowner:
            sys.stderr.write(
                "fresh manifest requires --lastowner <steamid64>\n"
                "(find it in an existing appmanifest's \"LastOwner\")\n")
            return 2
        text = '\n'.join([
            '"AppState"', '{',
            f'\t"appid"\t\t"{args.appid}"',
            '\t"universe"\t\t"1"',
            f'\t"name"\t\t"{args.name}"',
            '\t"StateFlags"\t\t"4"',
            f'\t"installdir"\t\t"{args.installdir}"',
            f'\t"LastUpdated"\t\t"{int(time.time())}"',
            '\t"LastPlayed"\t\t"0"',
            f'\t"SizeOnDisk"\t\t"{total}"',
            '\t"StagingSize"\t\t"0"',
            f'\t"buildid"\t\t"{args.buildid}"',
            f'\t"LastOwner"\t\t"{args.lastowner}"',
            '\t"UpdateResult"\t\t"0"',
            '\t"BytesToDownload"\t\t"0"',
            '\t"BytesDownloaded"\t\t"0"',
            '\t"BytesToStage"\t\t"0"',
            '\t"BytesStaged"\t\t"0"',
            f'\t"TargetBuildID"\t\t"{args.buildid}"',
            '\t"AutoUpdateBehavior"\t\t"0"',
            '\t"AllowOtherDownloadsWhileRunning"\t\t"0"',
            depots_block,
            '\t"UserConfig"', '\t{', '\t}',
            '\t"MountedConfig"', '\t{', '\t}',
            '}'])
        action = 'created'

    for k in ACF_INT_KEYS:
        text = set_scalar(text, k, '0')
    text = set_scalar(text, 'StateFlags', '4')
    if args.buildid:
        text = set_scalar(text, 'buildid', args.buildid)
        text = set_scalar(text, 'TargetBuildID', args.buildid)
    if args.name:
        text = set_scalar(text, 'name', args.name)
    if args.installdir:
        text = set_scalar(text, 'installdir', args.installdir)
    text = set_scalar(text, 'SizeOnDisk', total)
    text = replace_installed_depots(text, depots_block)

    os.makedirs(steamapps, exist_ok=True)
    if os.path.exists(path):
        bak = path + '.bak'
        with open(bak, 'w', encoding='utf-8') as f:
            f.write(open(path, encoding='utf-8', errors='replace').read())
        print(f"backup  : {bak}")
    if args.dry_run:
        print(f"DRY RUN — would {action}: {path}\n")
        print(text)
        return 0
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f"{action}: {path}")
    print(f"SizeOnDisk={total} buildid={args.buildid or '(unchanged)'} "
          f"depots={[d.split(':')[0] for d in args.depot + args.dlc_depot]}")
    print("next: in the Windows Steam client run "
          "Properties -> Installed Files -> Verify integrity of game files")
    return 0


def cmd_reset(args):
    """Delete a depot's download dir + resume-state file after a corrupted
    resume ("same chunk requested twice" assertion or wedged progress).
    QUIT the Steam client first — it holds the state file open in memory."""
    import subprocess
    running = subprocess.run(
        ['pgrep', '-x', 'steam'], capture_output=True).returncode == 0
    cache = os.path.join(os.path.expanduser(args.cache), 'content',
                         f'app_{args.appid}')
    depot = os.path.join(cache, f'depot_{args.depotid}')
    state = os.path.join(cache, f'state_{args.appid}_{args.depotid}.patch')
    if running and not args.force:
        sys.stderr.write(
            "Steam client appears to be running — quit it first "
            "(it holds the state file open), then re-run.\n"
            "Override with --force if you are sure it is quit.\n")
        return 2
    for p in (depot, state):
        if os.path.exists(p):
            if os.path.isdir(p):
                shutil.rmtree(p)
            else:
                os.remove(p)
            print(f"removed: {p}")
        else:
            print(f"(not present, skipping): {p}")
    print("reset done — relaunch Steam, open console, re-run download_depot.")
    return 0


def main():
    ap = argparse.ArgumentParser(
        prog='steamdepot.py',
        description='Parse Steam console logs, verify depots, write appmanifests.')
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('appinfo', help='parse app_info_print output')
    p.add_argument('--log', default=DEFAULT_LOG)
    p.add_argument('--appid', type=int, action='append')
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_appinfo)

    p = sub.add_parser('licenses', help='parse licenses_print output')
    p.add_argument('--log', default=DEFAULT_LOG)
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_licenses)

    p = sub.add_parser('verify', help='verify depot files against its manifest')
    p.add_argument('--depot', required=True,
                   help='path to depot dir (contains Manifest_*Files_*.txt)')
    p.add_argument('--list', type=int, default=20, help='max missing to list')
    p.set_defaults(fn=cmd_verify)

    p = sub.add_parser('manifest', help='write/patch appmanifest_<appid>.acf')
    p.add_argument('--appid', required=True, type=int)
    p.add_argument('--library', required=True,
                   help='SteamLibrary root (contains steamapps/)')
    p.add_argument('--installdir', help='e.g. "MechWarrior 5 Mercenaries"')
    p.add_argument('--name', help='game title as Steam shows it')
    p.add_argument('--buildid')
    p.add_argument('--depot', action='append', default=[],
                   metavar='DEPOTID:MANIFESTGID:SIZE')
    p.add_argument('--dlc-depot', action='append', default=[],
                   metavar='DEPOTID:MANIFESTGID:SIZE:DLCAPPID')
    p.add_argument('--lastowner', help='SteamID64, needed for fresh manifests')
    p.add_argument('--fresh', action='store_true',
                   help='create new manifest even if one exists')
    p.add_argument('--dry-run', action='store_true')
    p.set_defaults(fn=cmd_manifest)

    p = sub.add_parser('reset', help='wipe a depot dir + resume-state after '
                                    'a corrupted resume (quit Steam first)')
    p.add_argument('--appid', required=True, type=int)
    p.add_argument('--depotid', required=True, type=int)
    p.add_argument('--cache', default=os.path.join(
        os.environ.get('STEAM_EXTERNAL', '/Volumes/YH-SanP2TB'),
        'SteamDepotCache'),
        help='depot-cache root (default: $STEAM_EXTERNAL/SteamDepotCache)')
    p.add_argument('--force', action='store_true',
                   help='skip the Steam-still-running check')
    p.set_defaults(fn=cmd_reset)

    args = ap.parse_args()
    sys.exit(args.fn(args))


if __name__ == '__main__':
    main()
