import fs from 'node:fs';
let s=fs.readFileSync('tests/browser/iterative-sorts.spec.ts','utf8').replaceAll('16.4','16.6').replace('iterative-sorts-1.0.0.json','bucket-sort-1.0.0.json').replaceAll('sortCases[2]','sortCases[0]').replaceAll('sortCases[1]','sortCases[0]');
s=s.replace('  return state;','  await sameBuckets(p,result,cursor);\n  return state;');
const start=s.indexOf('for (const spec of sortCases)');
s=s.slice(0,start)+`async function sameBuckets(p:Page,result:AlgorithmResult,cursor:number){
  const player=new AlgorithmPlayer();player.accept(result);player.seek(cursor);const state=player.snapshot().state!,step=cursor?result.trace!.steps[cursor-1]:null,data=state.objects.find(o=>o.name==='bucketData'),sizes=state.objects.find(o=>o.name==='bucketSizes');
  if(!data){await expect(p.getByTestId('bucket-row')).toHaveCount(0);await expect(p.getByTestId('bucket-absent')).toHaveCount(1);return;}
  await expect(p.getByTestId('bucket-row')).toHaveCount(5);
  for(let b=0;b<5;b++){
    const row=p.getByTestId('bucket-row').filter({has:p.getByRole('heading',{name:new RegExp('^桶'+b+' ·')})}),size=sizes?slotValue(sizes,b):null;
    await expect(row).toHaveAttribute('data-size',String(size??'uninitialized'));await expect(row).toHaveAttribute('data-object-id',data.id);
    const writes=new Set(step?.changes.flatMap(c=>c.op==='cell'&&c.objectId===data.id?[c.index]:[])??[]),indices=Array.from({length:30},(_,i)=>b*30+i).filter(i=>(size!==null&&i-b*30<size)||writes.has(i));
    expect(await row.getByTestId('bucket-cell').evaluateAll(cells=>cells.map(c=>Number(c.getAttribute('data-index'))))).toEqual(indices);
    for(const index of indices){const cell=row.locator('[data-testid="bucket-cell"][data-index="'+index+'"]');await expect(cell).toHaveAttribute('data-value',String(slotValue(data,index)??'uninitialized'));await expect(cell).toHaveAttribute('data-write',String(writes.has(index)));await expect(cell).toHaveAttribute('data-pending',String(size===null||index-b*30>=size));}
    const layout=p.getByTestId('bucket-layout').nth(b);await expect(layout).toHaveAttribute('data-start-address',String(data.baseAddress+b*120));await expect(layout).toHaveAttribute('data-end-address',String(data.baseAddress+(b+1)*120));
  }
}
`+s.slice(start);
s=s.replace("    { id: 'capacity-reverse', values: Array.from({ length: 30 }, (_, i) => 15 - i) },","    { id: 'capacity-reverse', values: Array.from({ length: 30 }, (_, i) => 15 - i) },\n    { id: 'borders', values: [-20,-11,-10,-1,0,9,10,19,20,29] },\n    { id: 'capacity-sorted', values: Array.from({length:30},(_,i)=>i-10) },\n    { id: 'capacity-min', values: Array(30).fill(-20) as number[] },\n    { id: 'capacity-max', values: Array(30).fill(29) as number[] },\n    { id: 'capacity-zero', values: Array(30).fill(0) as number[] },\n    { id: 'capacity-first-bucket', values: Array.from({length:30},(_,i)=>-11-Math.floor(i/3)) },\n    { id: 'capacity-last-bucket', values: Array.from({length:30},(_,i)=>29-Math.floor(i/3)) },");
s=s.replace('catalog exposes exactly three new C++ cases and retains all seven original C routes','catalog exposes one bucket case and keeps the five prior C++ and seven C cases').replace("  await expect(p.getByTestId('cpp-sort-catalog').getByRole('link')).toHaveCount(3);","  await expect(p.getByTestId('cpp-sort-catalog').getByRole('link')).toHaveCount(3);\n  await expect(p.getByTestId('cpp-recursive-catalog').getByRole('link')).toHaveCount(3);\n  await expect(p.getByTestId('cpp-bucket-catalog').getByRole('link')).toHaveCount(1);");
s=s.replaceAll('查看计数排序工作区','查看桶排序工作区').replace("name: '计数排序', exact: true","name: '桶排序', exact: true").replace('counting-${width}.png','bucket-${width}.png');
fs.writeFileSync('tests/browser/bucket-sort.spec.ts',s);
