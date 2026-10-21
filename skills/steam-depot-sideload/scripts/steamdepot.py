#!/usr/bin/env python3
"""steamdepot.py — parsing/verification/manifest tool for Steam depot sideloading.

Parses output of Steam's console commands (`app_info_print`, `licenses_print`)
from console_log.txt, verifies a downloaded depot against its manifest, and
writes/patches appmanifest_<appid>.acf so the Windows Steam client (Wine/Heroic)
registers a sideloaded install.

Subcommands: appinfo, licenses, verify, manifest, reset
verify gains: --depotcache (hash manifest from the Windows client's depotcache)
appinfo gains: --api (fetch layout from api.steamcmd.net, no console needed)
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
    if args.api:
        return cmd_appinfo_api(args)
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


# ---------- api.steamcmd.net layout (rule 16) ----------

def cmd_appinfo_api(args):
    """Fetch depot layout from api.steamcmd.net — no console paste needed."""
    import urllib.request
    if not args.appid or len(args.appid) != 1:
        sys.stderr.write("--api needs exactly one --appid\n")
        return 2
    url = f'https://api.steamcmd.net/v1/info/{args.appid[0]}'
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            payload = json.load(r)
    except Exception as e:
        sys.stderr.write(f"API fetch failed: {e}\n(url: {url})\n")
        return 2
    appid = str(args.appid[0])
    app = payload.get('data', payload).get(appid, payload.get(appid, payload))
    if isinstance(app, dict) and 'data' in app and isinstance(app['data'], dict):
        app = app['data']
    common = app.get('common', {})
    config = app.get('config', {})
    depots = app.get('depots', {})
    branches = depots.get('branches', {})
    public_bid = branches.get('public', {}).get('buildid')
    print(f"=== AppID {appid}: {common.get('name')} ===")
    print(f"  public buildid : {public_bid}")
    print(f"  installdir     : {config.get('installdir')}")
    print(f"  launch exe     : {(config.get('launch') or {}).get('0', {}).get('executable')}")
    print("  depots (public manifests):")
    paste, manargs = [], []
    for k in sorted(depots, key=lambda x: (not str(x).isdigit(), x)):
        if not str(k).isdigit():
            continue
        v = depots[k] or {}
        if 'depotfromapp' in v:
            print(f"  depot {k:>8}: shared from app {v['depotfromapp']} (nothing to download)")
            continue
        pub = ((v.get('manifests') or {}).get('public')) or {}
        gid, size = pub.get('gid'), pub.get('size')
        extra = f" dlcappid={v['dlcappid']}" if 'dlcappid' in v else ''
        sz = f"{int(size) / 1e9:.1f}GB" if size else '(no public manifest)'
        print(f"  depot {k:>8}: {gid}  {sz}{extra}")
        if gid and size:
            paste.append(f'download_depot {appid} {k}')
            if 'dlcappid' in v:
                manargs.append(f'--dlc-depot {k}:{gid}:{size}:{v["dlcappid"]}')
            else:
                manargs.append(f'--depot {k}:{gid}:{size}')
    print("\n--- paste into the Steam console (after @sSteamCmdForcePlatformType windows) ---")
    print('\n'.join(paste) or '(no downloadable depots)')
    print("\n--- manifest args ---")
    print(f"--appid {appid} --installdir \"{config.get('installdir')}\" "
          f"--name \"{common.get('name')}\" --buildid {public_bid} \\\n  " +
          ' \\\n  '.join(manargs))
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
    if args.depotcache:
        return cmd_verify_dc(args)
    if not args.depot:
        sys.stderr.write("verify needs --depot DIR or --depotcache FILE --root DIR\n")
        return 2
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


# ---------- depotcache verification (rule 17/21) ----------
#
# The Windows client keeps <depot>_<gid>.manifest files (protobuf FileMappings)
# for every configured depot. Layout (decoded empirically 2026-10-21):
#   8-byte header, then top-level repeated field-1 length-delimited FileMappings.
#   FileMapping: f1 = backslash-separated path, f2 = size (varint, 0 for dirs),
#   f3 = flags (64 = directory), f4/f5 = 20-byte hashes, f6* = chunk messages.
# Trailing bytes after the last clean field are left unparsed (observed 64B
# trailer on small manifests) — entries before it are unaffected.
# This checks existence + SIZE against any tree (fresh depot dir or assembled
# common/<installdir>/), catching 0-byte husks, truncation, and bitrot that
# changes size. Same-size bitrot needs Steam's own hash verify (rule 21).

def _pb_varint(buf, pos):
    shift, val = 0, 0
    while True:
        b = buf[pos]
        pos += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            return val, pos
        shift += 7
        if shift > 70:
            raise ValueError('varint overflow')


def _pb_fields(buf, pos, end):
    """Walk protobuf fields; length-delimited kept as raw bytes."""
    out = []
    while pos < end:
        key, pos = _pb_varint(buf, pos)
        field, wtype = key >> 3, key & 7
        if wtype == 0:
            v, pos = _pb_varint(buf, pos)
            out.append((field, v))
        elif wtype == 1:
            out.append((field, int.from_bytes(buf[pos:pos + 8], 'little')))
            pos += 8
        elif wtype == 2:
            ln, pos = _pb_varint(buf, pos)
            if pos + ln > end:
                raise ValueError('length-delimited overrun')
            out.append((field, bytes(buf[pos:pos + ln])))
            pos += ln
        elif wtype == 5:
            out.append((field, int.from_bytes(buf[pos:pos + 4], 'little')))
            pos += 4
        else:
            raise ValueError(f'unsupported wire type {wtype}')
    return out


def _pb_str(raw):
    try:
        t = raw.decode('utf-8')
    except UnicodeDecodeError:
        return None
    if all(32 <= ord(c) < 127 or c in '\t\n' for c in t):
        return t
    return None


def depotcache_files(manifest_path):
    """Return [(relpath_parts, size)] for file entries (dirs skipped)."""
    data = open(manifest_path, 'rb').read()
    entries, pos = [], 8
    while pos < len(data):
        try:
            key, pos = _pb_varint(data, pos)
        except (IndexError, ValueError):
            break
        field, wtype = key >> 3, key & 7
        if field != 1 or wtype != 2:
            # not a FileMapping: skip one field generically, keep walking
            try:
                if wtype == 0:
                    _, pos = _pb_varint(data, pos)
                elif wtype == 1:
                    pos += 8
                elif wtype == 2:
                    ln, pos = _pb_varint(data, pos)
                    pos += ln
                elif wtype == 5:
                    pos += 4
                else:
                    break
            except (IndexError, ValueError):
                break
            continue
        try:
            ln, pos = _pb_varint(data, pos)
            blob = data[pos:pos + ln]
            pos += ln
            flds = _pb_fields(blob, 0, len(blob))
        except (IndexError, ValueError):
            break
        path = size = flags = None
        for f, v in flds:
            if f == 1 and isinstance(v, bytes) and path is None:
                path = _pb_str(v)
            elif f == 2 and isinstance(v, int) and size is None:
                size = v
            elif f == 3 and isinstance(v, int) and flags is None:
                flags = v
        if path is None:
            continue
        if flags == 64:
            continue  # directory entry
        parts = [p for p in path.replace('\\', '/').split('/') if p not in ('', '.')]
        entries.append((parts, size if size is not None else -1))
    return entries


def cmd_verify_dc(args):
    root = os.path.expanduser(args.root)
    try:
        entries = depotcache_files(os.path.expanduser(args.depotcache))
    except OSError as e:
        print(f"cannot read depotcache manifest: {e}", file=sys.stderr)
        return 2
    if not entries:
        print("no file entries parsed from depotcache manifest", file=sys.stderr)
        return 2
    missing, wrongsize, ok = [], [], 0
    for parts, size in entries:
        full = os.path.join(root, *parts)
        if not os.path.isfile(full):
            missing.append('/'.join(parts))
            continue
        if size is not None and size >= 0:
            try:
                actual = os.path.getsize(full)
            except OSError:
                missing.append('/'.join(parts) + ' (unreadable)')
                continue
            if actual != size:
                wrongsize.append((('/'.join(parts)), size, actual))
                continue
        ok += 1
    total = len(entries)
    print(f"depotcache: {os.path.basename(os.path.expanduser(args.depotcache))}")
    print(f"root     : {root}")
    print(f"files    : {ok}/{total} present with matching size")
    for m in missing[:args.list]:
        print(f"  MISSING: {m}")
    for p, want, got in wrongsize[:args.list]:
        print(f"  SIZE-MISMATCH: {p} (manifest {want}B, disk {got}B)")
    shown = len(missing[:args.list]) + len(wrongsize[:args.list])
    if len(missing) + len(wrongsize) > shown:
        print(f"  ... and {len(missing) + len(wrongsize) - shown} more")
    if missing or wrongsize:
        return 1
    print("OK — all depotcache files present with matching sizes")
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
    import subprocess
    steamapps = os.path.join(os.path.expanduser(args.library),
                             'steamapps')
    path = os.path.join(steamapps, f'appmanifest_{args.appid}.acf')
    if not args.force:
        procs = subprocess.run(['pgrep', '-fl', 'steam_osx|steam.exe|SteamHeroic'],
                               capture_output=True, text=True).stdout.strip()
        if procs:
            sys.stderr.write(
                f"a Steam client appears to be running:\n  {procs}\n"
                "manifest surgery with a client open gets reconciled/reverted\n"
                "(rules 14/20) — quit ALL Steam clients first, then re-run.\n"
                "Override with --force if you are sure they are quit.\n")
            return 2
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
    if os.path.exists(path) and not args.dry_run:
        bak = path + '.bak'
        with open(bak, 'w', encoding='utf-8') as f:
            f.write(open(path, encoding='utf-8', errors='replace').read())
        print(f"backup  : {bak}")
        # timestamped history (single .bak gets clobbered; /tmp gets wiped)
        histdir = os.path.join(steamapps, 'backups')
        try:
            os.makedirs(histdir, exist_ok=True)
            import time as _t
            hist = os.path.join(
                histdir,
                f"appmanifest_{args.appid}.acf.{_t.strftime('%Y%m%d-%H%M%S')}")
            with open(hist, 'w', encoding='utf-8') as f:
                f.write(open(bak, encoding='utf-8', errors='replace').read())
            print(f"history : {hist}")
        except OSError as e:
            print(f"history : skipped ({e})")
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
    resume ("same chunk requested twice" assertion or wedged progress), or a
    FALSE COMPLETE (stale state + empty cache after the files were assembled
    away — Steam prints "Depot download complete" while fetching 0 bytes).
    QUIT the Steam client first — it holds the state file open in memory."""
    import subprocess
    procs = subprocess.run(['pgrep', '-fl', 'steam_osx|steam.exe|SteamHeroic'],
                           capture_output=True, text=True).stdout.strip()
    cache = os.path.join(os.path.expanduser(args.cache), 'content',
                         f'app_{args.appid}')
    depot = os.path.join(cache, f'depot_{args.depotid}')
    state = os.path.join(cache, f'state_{args.appid}_{args.depotid}.patch')
    if procs and not args.force:
        sys.stderr.write(
            f"a Steam client appears to be running:\n  {procs}\n"
            "quit it first (it holds the state file in memory), then re-run.\n"
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

    p = sub.add_parser('appinfo', help='parse app_info_print output (or --api)')
    p.add_argument('--log', default=DEFAULT_LOG)
    p.add_argument('--appid', type=int, action='append')
    p.add_argument('--api', action='store_true',
                   help='fetch depot layout from api.steamcmd.net (needs one --appid, no console)')
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_appinfo)

    p = sub.add_parser('licenses', help='parse licenses_print output')
    p.add_argument('--log', default=DEFAULT_LOG)
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_licenses)

    p = sub.add_parser('verify', help='verify files against a manifest')
    p.add_argument('--depot', help='path to depot dir (contains Manifest_*Files_*.txt)')
    p.add_argument('--depotcache',
                   help='Windows depotcache .manifest (protobuf FileMappings) — '
                        'checks existence + SIZE against --root (any tree)')
    p.add_argument('--root', default='.',
                   help='tree to verify with --depotcache (depot dir or common/<installdir>/)')
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
    p.add_argument('--force', action='store_true',
                   help='allow manifest surgery while a Steam client is running')
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
