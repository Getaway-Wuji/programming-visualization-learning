"""Read-only current-release/content/archived-evidence audit for task 20.4."""
import datetime
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


destination = Path(sys.argv[1])
assert not destination.exists(), "Use a new audit filename"
registration_path = Path("content/c/p0/blockly-release-1.0.68.json")
registration = read(registration_path)
for file in registration["files"]:
    assert digest(Path(file["path"]).read_bytes()) == file["sha256"], file["path"]

expected_wasm = {
    registration[key]["wasmSha256"]
    for key in ["engine", "memoryEngine", "algorithmEngine", "advancedEngine", "generatorEngine"]
}
wasm = [
    {"path": p.as_posix(), "sha256": digest(p.read_bytes())}
    for p in Path("web/src/generated").rglob("*.wasm")
    if digest(p.read_bytes()) in expected_wasm
]
assert len(wasm) == 5 and {f["sha256"] for f in wasm} == expected_wasm

course = read("content/c/p05/course-1.0.0.json")
bugs = [read(f"content/{language}/bugs/questions-1.0.0.json") for language in ["c", "cpp"]]
advanced = read("content/advanced/course-1.0.0.json")
definitions = {c["id"]: c for c in course["cases"]}
definition_files = {c["id"]: "content/c/p05/course-1.0.0.json" for c in course["cases"]}
for path in Path("content/algorithms/cpp").glob("*.json"):
    catalog = read(path)
    for spec in catalog.get("cases", []) + ([catalog["case"]] if "case" in catalog else []):
        assert spec["id"] not in definitions, spec["id"]
        definitions[spec["id"]] = spec
        definition_files[spec["id"]] = path.as_posix()
ids = re.findall(r"`(case\.(?:c|cpp)\.[\w-]+)@", Path("项目文档/算法目录覆盖表.md").read_text(encoding="utf-8"))[:22]
assert len(ids) == len(set(ids)) == 22
assert len(definitions) == 26
algorithms = []
for case_id in ids:
    spec = definitions[case_id]
    language = spec.get("language", spec.get("languageRef", {}).get("id", "").removeprefix("lang."))
    assert language == ("cpp" if case_id.startswith("case.cpp.") else "c")
    source = Path(spec["sourceFile"]) if "sourceFile" in spec else None
    program_ref = spec["programRef"] if "programRef" in spec else {"id": spec["programId"], "version": spec["programVersion"]}
    algorithms.append({"id": case_id, "version": spec["version"], "programRef": program_ref, "language": language, "definition": definition_files[case_id], "definitionSha256": digest(Path(definition_files[case_id]).read_bytes()), "sourceFile": source.as_posix() if source else None, "sourceTemplateSha256": digest(source.read_bytes()) if source else None, "sampleCount": len(spec.get("samples", spec.get("boundarySamples", spec.get("boundaryDrafts", []))))})

archives = []
metadata_only_indexes = []
for index_path in sorted(Path("项目文档/验收").glob("*验证原件/index.json")):
    index = read(index_path)
    entries = index.get("files", index.get("entries", []))
    if not entries:
        metadata_only_indexes.append({"path": index_path.as_posix(), "sha256": digest(index_path.read_bytes()), "keys": list(index)})
        continue
    original_observations = []
    for entry in entries:
        archive_name = entry.get("file", entry.get("path"))
        archive_path = index_path.parent / archive_name
        data = archive_path.read_bytes()
        if "archiveSha256" in entry:
            assert digest(data) == entry["archiveSha256"], archive_path
            raw = data if entry.get("encoding") == "identity" else gzip.decompress(data)
            expected = entry["sha256"]
            assert len(raw) == entry["bytes"], archive_path
        elif "originalSha256" in entry:
            assert digest(data) == entry["sha256"], archive_path
            raw = data if entry.get("encoding") == "identity" else gzip.decompress(data)
            expected = entry["originalSha256"]
            assert len(raw) == entry["originalBytes"]
        else:
            raw = data
            expected = entry["sha256"]
        assert digest(raw) == expected, archive_path
        source = entry.get("sourcePath", entry.get("source", entry.get("path")))
        source_path = Path(source)
        present = source_path.is_file()
        observed = digest(source_path.read_bytes()) if present else None
        original_observations.append({"path": source, "expectedSha256": expected, "observedSha256": observed, "matches": observed == expected})
    archives.append({"index": index_path.as_posix(), "sha256": digest(index_path.read_bytes()), "verifiedArchiveEntries": len(entries), "originalObservations": original_observations})

report = {
    "task": "20.4", "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "registration": {"path": registration_path.as_posix(), "version": registration["releaseVersion"], "sha256": digest(registration_path.read_bytes()), "sourcesVerified": len(registration["files"])},
    "wasm": wasm,
    "content": {"cChapters": len(course["chapters"]), "cLessons": len(course["lessons"]), "baseExercises": len(course["exercises"]), "baseTestGroups": sum(len(e["tests"]) for e in course["exercises"]), "blocks": len(course["blocks"]), "bugQuestions": sum(len(b["questions"]) for b in bugs), "advancedChapters": len(advanced["chapters"]), "advancedGuidedLessons": len(advanced["lessons"]), "formalCases": len(definitions), "srsAlgorithms": len(algorithms), "cAlgorithms": sum(a["language"] == "c" for a in algorithms), "cppAlgorithms": sum(a["language"] == "cpp" for a in algorithms)},
    "algorithms": algorithms, "archives": archives, "metadataOnlyIndexes": metadata_only_indexes,
    "archiveEntriesVerified": sum(a["verifiedArchiveEntries"] for a in archives),
    "originalMismatchCount": sum(not o["matches"] for a in archives for o in a["originalObservations"]),
}
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({k: report[k] for k in ["content", "archiveEntriesVerified", "originalMismatchCount"]}, ensure_ascii=False))
