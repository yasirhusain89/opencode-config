const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync("static/data/starmap.json", "utf8"));
const r = JSON.parse(fs.readFileSync("tests/fixtures/snapshot-response.json", "utf8"));
const tois = r.snapshot.system_tois;
const clusters = m.clusters || [];
const names = new Set(clusters.map((c) => c.name));
const byName = new Map(clusters.map((c) => [c.name, c]));

const strip = (a) => (a.endsWith("_ClusterAsset") ? a.slice(0, -"_ClusterAsset".length) : a);

const ct = tois.filter((t) => t.kind === "ClusterToi");
let exact = 0, prefix = 0;
const miss = [];
for (const t of ct) {
	const base = strip(t.cluster_asset ?? "");
	if (names.has(base)) { exact++; continue; }
	const pref = base.replace(/(_\d+)+$/, "");
	if (names.has(pref)) { prefix++; continue; }
	miss.push(`${t.star_system_id}:${base}`);
}
console.log("ClusterToi:", ct.length, "exact-name:", exact, "prefix-fallback:", prefix, "miss:", miss.length);
console.log("miss sample:", miss.slice(0, 12).join(" | "));

const t0 = ct[0];
const b0 = strip(t0.cluster_asset);
const c0 = byName.get(b0) || byName.get(b0.replace(/(_\d+)+$/, ""));
console.log(`first: sys=${t0.star_system_id} asset=${t0.cluster_asset} matched=${c0?.name} member?=${c0 ? c0.memberIds.includes(t0.star_system_id) : "n/a"}`);

const sysById = new Map(m.systems.map((s) => [s.id, s]));
let onMap = 0;
for (const t of ct) {
	const s = sysById.get(t.star_system_id);
	if (s && s.name !== "INVALID" && s.status !== "Hidden") onMap++;
}
console.log("cluster systems on displayed map:", onMap, "/", ct.length);

const q = tois.filter((t) => (t.kind === "SideQuestToi" || t.kind === "GeneratedMissionToi") && t.added);
let qOn = 0;
const qNames = [];
for (const t of q) {
	const s = sysById.get(t.star_system_id);
	if (s && s.name !== "INVALID" && s.status !== "Hidden") { qOn++; qNames.push(s.name); }
}
console.log("quest pins on map:", qOn, "/", q.length);

//#region 629 pin spellings
const sys629 = sysById.get(629);
console.log("system 629 name:", sys629?.name, "status:", sys629?.status, "id:", sys629?.id);
const systemNamesMap = new Map(m.systems.filter((s) => s.id !== null).map((s) => [s.id, s.name]));
for (const t of q) {
	if (t.star_system_id === 629) console.log("629 pin:", t.kind, t.toi_id, "name:", systemNamesMap.get(629));
}
//#endregion

// membership agreement between the save asset and starmap clusters
let agree = 0, disagree = 0, unmatched = 0;
for (const t of ct) {
	const base = strip(t.cluster_asset ?? "");
	const c = byName.get(base) || byName.get(base.replace(/(_\d+)+$/, ""));
	if (!c) { unmatched++; continue; }
	if (c.memberIds.includes(t.star_system_id)) agree++; else disagree++;
}
console.log("membership agree:", agree, "disagree:", disagree, "unmatched:", unmatched);

const displayed = [...new Set(ct.map((t) => t.star_system_id))].filter(
	(id) => {
		const s = sysById.get(id);
		return s && s.id !== null && s.name !== "INVALID" && s.status !== "Hidden";
	}
);
console.log("displayed cluster systems:", displayed.length);
console.log("sample names:", displayed.slice(0, 10).map((id) => sysById.get(id).name).join(","));

// For the compared-with-clustersOf check: do displayed cluster systems ALSO have starmap membership for the matched cluster?
let agreeDisplayed = 0, disagreeDisplayed = 0;
for (const t of ct) {
	const s = sysById.get(t.star_system_id);
	if (!s || s.id === null || s.name === "INVALID" || s.status === "Hidden") continue;
	const base = strip(t.cluster_asset ?? "");
	const c = byName.get(base) || byName.get(base.replace(/(_\d+)+$/, ""));
	if (!c) continue;
	if (c.memberIds.includes(t.star_system_id)) agreeDisplayed++; else disagreeDisplayed++;
}
console.log("displayed agree:", agreeDisplayed, "disagree:", disagreeDisplayed);

// MultipleMissionOperationToi + Cantina/Market counts for the intel line (dedupe by system+kind, ALL not just added)
const seen = new Set();
let cantina = 0, market = 0, side = 0;
for (const t of tois) {
	const key = `${t.star_system_id}:${t.kind}`;
	if (seen.has(key)) continue;
	seen.add(key);
	if (t.kind === "CantinaToi") cantina++;
	else if (t.kind === "BlackMarketToi") market++;
	else if (t.kind === "SideQuestToi") side++;
}
console.log("intel line counts:", cantina, market, side);

// quest pins deduped by system+kind (added only)
const qSeen = new Set();
const qRows = [];
for (const t of q) {
	const key = `${t.star_system_id}:${t.kind}`;
	if (qSeen.has(key)) continue;
	qSeen.add(key);
	qRows.push(t);
}
console.log("deduped quest rows:", qRows.length, "(of", q.length, "raw)");
