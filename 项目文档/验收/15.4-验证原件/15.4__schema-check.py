import copy, gzip, json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

base=Path('.artifacts/15.4')
logical=json.loads(Path('项目文档/契约/15.4-存档结构6.0.0.schema.json').read_text(encoding='utf-8'))
achievement=json.loads(Path('项目文档/契约/15.4-成就1.0.0.schema.json').read_text(encoding='utf-8'))
for schema in [logical,achievement]:Draft202012Validator.check_schema(schema)
lv=Draft202012Validator(logical,format_checker=FormatChecker())
av=Draft202012Validator(achievement,format_checker=FormatChecker())
paths=[base/'browser/15-4-formal-final/actual-recursion.json',base/'browser/15-4-formal-final/pointer-one-actual.json.gz']
out=[]
for path in paths:
 data=json.loads(gzip.decompress(path.read_bytes()))['rows'] if path.suffix=='.gz' else json.loads(path.read_text(encoding='utf-8'))
 projection={k:data[k] for k in logical['properties']}
 assert len(projection)==11
 lv.validate(projection)
 for r in data['achievements']:
  av.validate(r)
  bad=copy.deepcopy(r);bad['sourceCode']='private body'
  assert list(av.iter_errors(bad))
  bad=copy.deepcopy(r);bad['evidence'][0]['input']=[1]
  assert list(av.iter_errors(bad))
 out.append({'path':str(path).replace('\\','/'),'logicalStores':11,'achievements':len(data['achievements']),'schemaValid':True,'unknownPrivateFieldsRejected':True})
(base/'schema-final.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(out)
