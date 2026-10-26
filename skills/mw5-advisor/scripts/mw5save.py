#!/usr/bin/env python3
"""MW5: Mercenaries .sav snapshot reader (Unreal SaveGame property-tag format).

Usage:
  mw5save.py SLOT_DIR [--save FILE.sav] [--json] [--tree] [--list-top]
  mw5save.py --help

SLOT_DIR is a career folder containing Campaign.json + *.sav
(e.g. .../MW5Mercs/Saved/SaveGames/301EF41A.../).

Default: parses the slot's LastSaveFileName from Campaign.json and prints
an advisor snapshot (date, system, rep, C-bills, standings, mechs, pilots,
tracked objective). --json emits the snapshot as JSON (default output IS
JSON). --list-top prints top-level property names. --tree dumps the full
parsed tree (large).

Format notes (reverse-engineered from MW5 saves):
  tag = Name(FString) Type(FString) Size(i32) ArrayIndex(i32) [extras] payload
  - Tag lists end with the FString "None" (NOT a zero length!).
  - Size covers ONLY the payload; type extras sit outside Size. Extras may
    include a 1-byte flag (Object/Enum/Array/Struct payloads show one).
  - StructProperty extras = StructName + Guid(16B); payload = tags + "None".
    Some structs are NATIVE (raw bytes, e.g. Guid = 16B): detected by struct
    name, with parse-fallback to raw.
  - ObjectProperty payload = ClassPath(FString) [+ tags + "None" if inline].
    A bare ClassPath exactly filling Size is a mere reference.
  - ArrayProperty payload = Count(i32) + elements. Struct elements are usually
    full wrapped tags reusing the array name. Count is advisory: element
    boundaries + Size are ground truth (a stale count is warned, not fatal).
  - The career body lives inside the PersistentModelData byte blob, itself
    parsed as a nested tag stream.
Every container validates consumed bytes against its Size; any mismatch or
unknown layout raises loudly (stderr warnings are advisory only).
Stdlib only.
"""

import json
import os
import struct
import sys

SCALAR_SIZES = {
    "IntProperty": 4,
    "FloatProperty": 4,
    "DoubleProperty": 8,
    "IntProperty": 4,
    "Int64Property": 8,
    "UInt64Property": 8,
    "UInt32Property": 4,
    "Int16Property": 2,
    "UInt16Property": 2,
    "Int8Property": 1,
    "UInt8Property": 1,
}

# Native (non-tag) structs: name -> exact byte size. Others are attempted as
# tag streams first, falling back to raw Size bytes.
NATIVE_STRUCTS = {
    "Guid": 16,
    "Vector": 12,
    "Vector2D": 8,
    "Vector4": 16,
    "Rotator": 12,
    "Quat": 16,
    "Color": 4,
    "LinearColor": 16,
    "DateTime": 8,
    "Timespan": 8,
    "IntPoint": 8,
    "IntVector": 12,
    "TwoVectors": 24,
    "Plane": 16,
}

FAIL = object()


class Reader:
    def __init__(self, data):
        self.d = data
        self.o = 0

    def tell(self):
        return self.o

    def seek(self, o):
        self.o = o

    def read(self, n):
        if self.o + n > len(self.d):
            raise ValueError(f"read past end at {self.o}+{n} (len {len(self.d)})")
        b = self.d[self.o : self.o + n]
        self.o += n
        return b

    def i32(self):
        return struct.unpack("<i", self.read(4))[0]

    def i64(self):
        return struct.unpack("<q", self.read(8))[0]

    def f32(self):
        return struct.unpack("<f", self.read(4))[0]

    def u8(self):
        return self.read(1)[0]

    def fstring(self):
        n = self.i32()
        if n == 0:
            return ""
        if n < 0:
            raw = self.read(-n * 2)
            s = raw.decode("utf-16-le")
            return s[:-1] if s.endswith("\x00") else s
        raw = self.read(n)
        return raw[:-1].decode("utf-8", "replace") if raw.endswith(b"\x00") else raw.decode("utf-8", "replace")


class Parser:
    def __init__(self, data, warnings=None):
        self.r = Reader(data)
        self.debug = False
        self.trace = False
        self.stack = []
        self.warnings = warnings if warnings is not None else []

    def warn(self, msg):
        self.warnings.append(msg)

    def attempt(self, fn):
        pos = self.r.tell()
        try:
            return fn()
        except Exception:
            self.r.seek(pos)
            return FAIL

    def parse_tags(self):
        props = []
        while True:
            r = self.r
            # Terminator: FString "None", usually with a leading flag byte
            # in the outer shell stream (bare in the blob stream).
            peek = r.d[r.tell() : r.tell() + 10]
            if len(peek) >= 10 and peek[0:1] == b"\x00" and peek[1:10] == b"\x05\x00\x00\x00None\x00":
                r.seek(r.tell() + 10)
                return props
            if len(peek) >= 9 and peek[0:9] == b"\x05\x00\x00\x00None\x00":
                r.seek(r.tell() + 9)
                return props
            name = r.fstring()
            if name == "":
                raise ValueError(f"zero-length tag name at {r.tell()}")
            props.append(self.parse_tag(name))

    def parse_tag(self, name):
        self.stack.append(name)
        try:
            return self._parse_tag(name)
        except Exception:
            if self.debug:
                tail = " > ".join(self.stack[-4:])
                print(f"[debug] stack: ...{tail} at {self.r.tell()}", file=sys.stderr)
            raise
        finally:
            self.stack.pop()

    def _parse_tag(self, name):
        r = self.r
        typ = r.fstring()
        size = r.i32()
        arridx = r.i32()
        if self.trace and len(self.stack) <= 3:
            print(f"[trace] name={name!r} type={typ!r} size={size}", file=sys.stderr)
        for use_flag in (True, False):
            pos = r.tell()
            try:
                val = self.parse_payload(name, typ, size, arridx, use_flag)
                return (name, typ, val)
            except Exception as e:
                r.seek(pos)
                last = e
        raise ValueError(f"{name}/{typ} size={size}: no layout matched ({last})")

    # -- payload parsers: Size covers ONLY the payload; type extras sit
    # outside Size. Tag lists end with the FString "None". -----------------
    def parse_payload(self, name, typ, size, arridx, use_flag):
        r = self.r
        start = r.tell()

        def check(what, base):
            used = r.tell() - base
            if used != size:
                raise ValueError(f"{what}: consumed {used} != Size {size}")

        if typ in SCALAR_SIZES:
            n = SCALAR_SIZES[typ]
            if use_flag:
                r.read(1)
            raw = r.read(n)
            check("scalar", start)
            if typ == "IntProperty":
                val = struct.unpack("<i", raw)[0]
            elif typ == "FloatProperty":
                val = struct.unpack("<f", raw)[0]
            elif n == 8:
                val = struct.unpack("<q", raw)[0]
            else:
                val = int.from_bytes(raw, "little", signed=True)
            return val

        if typ == "BoolProperty":
            raw = r.read(2)
            if size not in (0, 2):
                self.warn(f"bool {name}: Size {size}, consumed 2")
            return bool(raw[0])

        if typ in ("StrProperty", "NameProperty"):
            # Normally len includes the null terminator; at least one
            # observed string (ProjectVersion "1.15.0") counts the null in
            # len but omits the byte. Fall back to len-1 bytes then.
            err = None
            for nonull in (False, True):
                pos2 = r.tell()
                try:
                    if use_flag:
                        r.read(1)
                    n = r.i32()
                    raw = r.read(n if not nonull else n - 1)
                    if not nonull:
                        if not raw.endswith(b"\x00"):
                            raise ValueError("str missing null")
                        val = raw[:-1].decode("utf-8", "replace")
                    else:
                        val = raw.decode("utf-8", "replace")
                    check("string", pos2 if use_flag else pos2)
                    # recompute: check must measure payload incl flag
                    return val
                except Exception as e:
                    err = e
                    r.seek(pos2)
            raise ValueError(f"string {name}: {err}")

        if typ == "TextProperty":
            r.read(size)
            return None

        if typ == "ByteProperty":
            enumname = r.fstring()
            if use_flag:
                r.read(1)
            base = r.tell()
            val = r.u8()
            check("byte", base)
            return {"enum": enumname or None, "value": val}

        if typ == "EnumProperty":
            enumname = r.fstring()
            if use_flag:
                r.read(1)
            base = r.tell()
            val = r.fstring()
            check("enum", base)
            return {"enum": enumname, "value": val}

        if typ == "StructProperty":
            sname = r.fstring()
            guid = r.read(16)
            if use_flag:
                r.read(1)
            base = r.tell()
            if size == 0:
                return {"struct": sname, "props": []}  # empty struct
            if sname in NATIVE_STRUCTS and size == NATIVE_STRUCTS[sname]:
                return {"struct": sname, "raw": r.read(size).hex()}
            res = self.attempt(self.parse_tags)
            if res is FAIL:
                raise ValueError(f"struct {sname}: tag parse failed")
            check(f"struct {sname}", base)
            return {"struct": sname, "props": res}

        if typ == "ObjectProperty":
            if use_flag:
                r.read(1)
            base = r.tell()
            if size == 0:
                return {"ref": None}  # null reference
            cls = r.fstring()
            if r.tell() - base == size:
                return {"ref": cls}  # bare reference, no inline data
            props = self.parse_tags()
            check(f"object {cls}", base)
            return {"class": cls, "props": props}

        if typ in ("ArrayProperty", "SetProperty"):
            inner = r.fstring()
            if use_flag:
                r.read(1)
            base = r.tell()
            val = self.parse_array(name, inner, size, base)
            check(f"array {name}", base)
            return val

        if typ == "MapProperty":
            kt = r.fstring()
            vt = r.fstring()
            if use_flag:
                r.read(1)
            base = r.tell()
            val = self.parse_map(name, kt, vt, size)
            check(f"map {name}", base)
            return val

        if typ in (
            "MulticastInlineDelegateProperty",
            "MulticastSparseDelegateProperty",
            "DelegateProperty",
            "InterfaceProperty",
            "FieldPathProperty",
            "SoftObjectProperty",
            "LazyObjectProperty",
            "WeakObjectProperty",
        ):
            r.read(size)
            return None

        raise ValueError(f"unknown property type {typ!r}")

    def parse_scalar_value(self, typ):
        r = self.r
        if typ in SCALAR_SIZES:
            n = SCALAR_SIZES[typ]
            raw = r.read(n)
            if typ == "IntProperty":
                return struct.unpack("<i", raw)[0]
            if typ == "FloatProperty":
                return struct.unpack("<f", raw)[0]
            if n == 8:
                return struct.unpack("<q", raw)[0]
            return int.from_bytes(raw, "little", signed=True)
        if typ == "BoolProperty":
            return bool(r.read(2)[0])
        if typ in ("StrProperty", "NameProperty"):
            return r.fstring()
        if typ == "ByteProperty":
            return r.u8()
        if typ == "EnumProperty":
            return r.fstring()
        raise ValueError(f"array/map scalar of type {typ!r}")

    def parse_array(self, name, inner, size, base):
        # Count is advisory: element boundaries + Size are ground truth.
        # Struct elements are usually full wrapped tags; raw fallback.
        r = self.r
        end = base + size
        if size == 0:
            return {"inner": inner, "items": []}  # empty, no count field
        count = r.i32()
        items = []
        if inner == "StructProperty":
            for how in ("wrapped", "raw"):
                pos = r.tell()
                try:
                    items = []
                    guard = 0
                    while r.tell() < end:
                        before = r.tell()
                        if how == "wrapped":
                            ename = r.fstring()
                            if ename == "None":
                                raise ValueError("None element in wrapped array")
                            etag = self.parse_tag(ename)
                            if etag[1] != "StructProperty":
                                raise ValueError(f"wrapped element not struct: {etag[1]}")
                            items.append(etag[2])
                        else:
                            items.append({"props": self.parse_tags()})
                        guard += 1
                        if r.tell() <= before or guard > count + 1024:
                            raise ValueError("array element made no progress")
                    if r.tell() != end:
                        raise ValueError("array did not end exactly at Size")
                    break
                except Exception:
                    r.seek(pos)
            else:
                raise ValueError(f"array {name}: neither wrapped nor raw matched")
        else:
            while r.tell() < end:
                items.append(self.parse_scalar_value(inner))
            if r.tell() != end:
                raise ValueError(f"array {name}/{inner}: misaligned end")
        if len(items) != count:
            self.warn(f"array {name}: parsed {len(items)} items, count field {count}")
        return {"inner": inner, "items": items}

    def parse_map(self, name, kt, vt, size):
        r = self.r
        if size == 0:
            return {"keytype": kt, "valuetype": vt, "entries": []}
        count = r.i32()
        entries = []
        for _ in range(count):
            k = self.parse_map_value(kt)
            v = self.parse_map_value(vt)
            entries.append([k, v])
        return {"keytype": kt, "valuetype": vt, "entries": entries}

    def parse_map_value(self, typ):
        r = self.r
        if typ == "StructProperty":
            sname = r.fstring()
            r.read(16)
            res = self.attempt(self.parse_tags)
            if res is FAIL:
                raise ValueError("map struct value not tag-parseable")
            return {"struct": sname, "props": res}
        return self.parse_scalar_value(typ)


def to_jsonable(props):
    out = {}
    for name, typ, val in props:
        out.setdefault(name, []).append({"type": typ, "value": _conv(val)})
    return {k: (v[0] if len(v) == 1 else v) for k, v in out.items()}


def _conv(val):
    if isinstance(val, dict):
        if "props" in val:
            return {
                "$struct": val.get("struct") or val.get("class"),
                "props": to_jsonable(val["props"]),
            }
        if "items" in val:
            return {"$array": val["inner"], "items": [_conv(i) for i in val["items"]]}
        if "entries" in val:
            return {
                "$map": [val["keytype"], val["valuetype"]],
                "entries": [[_conv(k), _conv(v)] for k, v in val["entries"]],
            }
        if "raw" in val:
            return {"$struct": val.get("struct"), "$raw": val["raw"]}
        if "ref" in val:
            return {"$ref": val["ref"]}
        return {k: _conv(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_conv(i) for i in val]
    return val


def find_props(props, name):
    """Yield values of all tags named `name` anywhere in the tree."""
    for pname, ptype, pval in props:
        if pname == name:
            yield pval
        yield from _walk(pval)


def _walk(val):
    if isinstance(val, dict):
        if "props" in val:
            for n, t, v in val["props"]:
                yield v
                yield from _walk(v)
        if "items" in val:
            for i in val["items"]:
                if isinstance(i, dict) and "props" in i:
                    yield from _walk(i)
                elif isinstance(i, tuple) and len(i) == 3:
                    yield i[2]
                    yield from _walk(i[2])
        if "entries" in val:
            for k, v in val["entries"]:
                yield from _walk(k)
                yield from _walk(v)


def summarize(props, campaign, save_entry):
    snap = {
        "save_name": save_entry.get("Name"),
        "game_date": save_entry.get("GameDate"),
        "star_system": save_entry.get("StarSystemName"),
        "reputation": save_entry.get("Reputation"),
        "reputation_level": save_entry.get("ReputationLevel"),
        "tracked_objective": save_entry.get("TrackedObjectiveId"),
        "dlcs": save_entry.get("DLCTags"),
        "career_start": (campaign.get("StartConditionId") or "").split(":")[-1],
    }
    for v in find_props(props, "AvailableCBills"):
        if isinstance(v, dict) and "props" in v:
            for n, t, subv in v["props"]:
                if n == "Value":
                    snap["cbills"] = subv
    standings = {}
    for v in find_props(props, "FactionReputations"):
        vals = v["items"] if isinstance(v, dict) and "items" in v else []
        for item in vals:
            ip = item.get("props") if isinstance(item, dict) else None
            if not ip:
                continue
            d = {n: subv for (n, t, subv) in ip}
            fac = d.get("Faction") or d.get("FactionId") or d.get("Key")
            rep = d.get("Reputation") or d.get("Value") or d.get("Standing")
            if fac is not None:
                standings[str(fac)] = rep
    if standings:
        snap["standings"] = standings
    mechs = []
    for v in find_props(props, "MechInventory"):
        vals = v.get("props") if isinstance(v, dict) else None
        if not vals:
            continue
        for n, t, subv in vals:
            if n == "Items" and isinstance(subv, dict):
                for item in subv.get("items", []):
                    m = extract_mech(item)
                    if m:
                        mechs.append(m)
    if mechs:
        snap["mechs"] = mechs
    pilots = []
    for v in find_props(props, "PilotRoster"):
        vals = v.get("props") if isinstance(v, dict) else None
        if not vals:
            continue
        for n, t, subv in vals:
            if n == "Items" and isinstance(subv, dict):
                for item in subv.get("items", []):
                    p = extract_pilot(item)
                    if p:
                        pilots.append(p)
    if pilots:
        snap["pilots"] = pilots
    return snap


def _pd(props, key):
    if not props:
        return None
    for n, t, v in props:
        if n == key:
            return v
    return None


def extract_mech(item):
    if isinstance(item, tuple) and len(item) == 3:
        item = item[2]
    if not isinstance(item, dict) or "props" not in item:
        return None
    props = item["props"]
    mech = {}
    for n, t, v in props:
        if n in ("MechData", "ItemData", "MechInfo", "Data") and isinstance(v, dict) and "props" in v:
            sub = {sn: sv for (sn, st, sv) in v["props"]}
            wid = sub.get("MechId") or sub.get("VariantId") or sub.get("ChassisId")
            if isinstance(wid, dict) and "props" in wid:
                wsub = {sn: sv for (sn, st, sv) in wid["props"]}
                pid = wsub.get("ID") or wsub.get("Id")
                if isinstance(pid, dict) and "props" in pid:
                    psub = {sn: sv for (sn, st, sv) in pid["props"]}
                    mech["variant"] = psub.get("PrimaryAssetName") or psub.get("Name")
                elif pid is not None:
                    mech["variant"] = str(pid)
            elif wid is not None:
                mech["variant"] = str(wid)
            if "HealthState" in sub:
                hs = sub["HealthState"]
                mech["health"] = hs.get("value") if isinstance(hs, dict) else hs
            for k in ("MechName", "CustomName", "Location", "BayIndex", "bIsDamaged", "Condition"):
                if k in sub:
                    mech[k.lower()] = sub[k]
        elif n in ("HealthState", "Count", "ItemId"):
            mech[n.lower()] = v.get("value") if isinstance(v, dict) and "value" in v else v
    return mech or None


def extract_pilot(item):
    if isinstance(item, tuple) and len(item) == 3:
        item = item[2]
    if not isinstance(item, dict) or "props" not in item:
        return None
    d = {n: v for (n, t, v) in item["props"]}
    name = d.get("PilotName") or d.get("Name") or d.get("Callsign")
    if name is None:
        for n, t, v in item["props"]:
            if isinstance(v, dict) and "props" in v:
                sub = {sn: sv for (sn, st, sv) in v["props"]}
                if "PilotName" in sub or "Callsign" in sub:
                    name = sub.get("PilotName") or sub.get("Callsign")
                    break
    if name is None:
        return None
    return {"name": name, "injured": d.get("bIsInjured", d.get("Injured"))}


def find_blob(props):
    """Locate PersistentModelData byte blob -> (blob_offset, blob_len)."""
    for pname, ptype, pval in props:
        if pname == "PersistentModelData" and isinstance(pval, dict) and "items" in pval:
            return pval
    return None


def load_slot(slot_dir):
    with open(os.path.join(slot_dir, "Campaign.json")) as f:
        campaign = json.load(f)
    last = campaign.get("LastSaveFileName", "")
    sav = os.path.join(slot_dir, last + ".sav") if last else None
    return campaign, sav


def parse_stream(data, warnings):
    parser = Parser(data, warnings)
    props = parser.parse_tags()
    return props, len(data) - parser.r.tell()


def main(argv):
    if "--help" in argv or "-h" in argv or len(argv) < 2:
        print(__doc__)
        return 0
    slot_dir = argv[1]
    campaign, default_sav = load_slot(slot_dir)
    sav_path = default_sav
    for i, a in enumerate(argv):
        if a == "--save" and i + 1 < len(argv):
            sav_path = argv[i + 1]
    if not sav_path or not os.path.exists(sav_path):
        print(f"save not found: {sav_path}", file=sys.stderr)
        return 1
    with open(sav_path, "rb") as f:
        data = f.read()
    warnings = []
    parser = Parser(data, warnings)
    parser.debug = "--debug" in argv
    parser.trace = "--trace" in argv
    props = parser.parse_tags()
    outer_leftover = len(data) - parser.r.tell()
    if outer_leftover:
        warnings.append(f"outer leftover bytes: {outer_leftover}")

    if "--list-top" in argv:
        for n, t, v in props:
            extra = ""
            if isinstance(v, dict):
                if "ref" in v:
                    extra = f"-> {v['ref'][:80]}"
                elif "inner" in v:
                    extra = f"[{v['inner']} x?]"

                elif "struct" in v:
                    extra = f"<{v['struct']}>"
            print(f"{n}  [{t}] {extra}")
        print(f"(outer leftover bytes: {outer_leftover})", file=sys.stderr)
        if warnings:
            print("warnings:", file=sys.stderr)
            for w in warnings[:20]:
                print(f"  - {w}", file=sys.stderr)
        return 0

    # The career body lives in the PersistentModelData byte blob: re-parse
    # its bytes as a nested tag stream (blob starts directly with tags).
    blob = find_blob(props)
    inner = []
    if blob is not None:
        raw_items = blob["items"]
        blob_bytes = bytes(raw_items)
        best = None
        errs = []
        for skip in (0, 1):
            iparser = Parser(blob_bytes[skip:], warnings)
            iparser.debug = "--debug" in argv
            try:
                cand = iparser.parse_tags()
                ileft = len(blob_bytes[skip:]) - iparser.r.tell()
                if best is None or ileft < best[1]:
                    best = (cand, ileft, skip)
            except Exception as e:
                errs.append(f"skip={skip}: {e}")
        if best is not None:
            inner, ileft, skip = best
            if skip:
                warnings.append(f"blob stream starts with {skip} version byte(s)")
            if ileft:
                warnings.append(f"blob stream leftover bytes: {ileft}")
        else:
            warnings.append(f"blob stream parse failed: {'; '.join(errs)}")
    else:
        warnings.append("no PersistentModelData blob found; using outer tags")

    if "--tree" in argv:
        print(json.dumps(to_jsonable(inner or props), indent=1, default=str))
        return 0

    entry = next(
        (s for s in campaign.get("Saves", []) if s.get("SaveFileName") == os.path.basename(sav_path)[:-4]),
        {},
    )
    snap = summarize(inner or props, campaign, entry)
    snap["slot"] = os.path.basename(os.path.normpath(slot_dir))
    snap["save_file"] = os.path.basename(sav_path)
    snap["warnings"] = warnings
    print(json.dumps(snap, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
