"""Independent ZIP/PNG/relative-link verification for isolated test downloads."""
import sys, json, zipfile, pathlib, re, zlib, struct, hashlib
from PIL import Image

source, target = map(pathlib.Path, sys.argv[1:3])
assert not target.exists(), 'Keep prior verification outputs'
with zipfile.ZipFile(source) as archive:
    names = archive.namelist()
    assert len(names) == len(set(names)) <= 19
    assert set(names[:3]) == {'笔记.md', '说明.txt', 'notes.json'}
    assert archive.testzip() is None
    for info in archive.infolist():
        p = pathlib.PurePosixPath(info.filename)
        assert not p.is_absolute() and '..' not in p.parts and '\\' not in info.filename
        assert info.flag_bits & 0x800 and info.compress_type == zipfile.ZIP_STORED
    archive.extractall(target)

metadata = json.loads((target / 'notes.json').read_text(encoding='utf-8'))
if metadata['formatId'] == 'urn:c-viz:study-notes-download:1.0.0':
    assert names[:3] == ['笔记.md', '说明.txt', 'notes.json']
elif metadata['formatId'] == 'urn:c-viz:study-notes-download:2.0.0':
    assert metadata['formatVersion'] == '2.0.0'
    assert names[:3] == ['笔记.md', 'notes.json', '说明.txt']
else:
    raise AssertionError('Unknown notes download format')
assert 'lease' not in metadata and 0 < len(metadata['entries']) <= 200
markdown = (target / '笔记.md').read_bytes().decode('utf-8')
image_refs = re.findall(r'^!\[[^\n]*\]\((assets/[^)]+)\)$', markdown, re.MULTILINE)
assert image_refs == [a['image'] for a in metadata['assets']]
pngs = []
for asset in metadata['assets']:
    entry = next(e for e in metadata['entries'] if e['id'] == asset['entryId'])
    state_bytes = (target / asset['state']).read_bytes()
    state = json.loads(state_bytes)
    assert state == entry['snapshot']
    data = (target / asset['image']).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    offset, embedded = 8, None
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        body = data[offset + 8:offset + 8 + size]
        assert zlib.crc32(kind + body) == struct.unpack('>I', data[offset + 8 + size:offset + 12 + size])[0]
        if kind == b'iTXt' and body.startswith(b'c-viz.snapshot\0\0\0\0\0'):
            embedded = body[len(b'c-viz.snapshot\0\0\0\0\0'):]
        offset += size + 12
    assert offset == len(data) and embedded == state_bytes
    with Image.open(target / asset['image']) as image:
        image.load()
        assert image.width == (1280 if state['formatVersion'] == '2.0.0' else 1440) and 0 < image.height <= 8192
        pngs.append({'path': asset['image'], 'width': image.width, 'height': image.height})
    assert state['source']['text'] in markdown
    assert hashlib.sha256(state['source']['text'].encode('utf-8')).hexdigest() == state['source']['sha256']
    assert f"]({asset['state']})" in markdown
for entry in metadata['entries']:
    if metadata['formatId'].endswith(':1.0.0') and entry['reference'] and entry['reference']['source'] is not None:
        assert entry['reference']['source'] in markdown
report = {'files': names, 'entries': len(metadata['entries']), 'images': pngs, 'allCrcVerified': True, 'allReferencesLocalAndPresent': True}
(target / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
