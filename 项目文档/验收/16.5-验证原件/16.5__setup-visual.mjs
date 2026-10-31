import fs from 'node:fs';
fs.mkdirSync('.artifacts/16.5/taste',{recursive:true});
fs.copyFileSync('.artifacts/16.4/taste/direction.json','.artifacts/16.5/taste/direction.json');
fs.writeFileSync('.artifacts/16.5/taste/brief.txt',`16.5 extends the accepted framed-sheet learning workbench, seed1060963509, minimal palette/type/shell.
Question: What changed in the real recursive C++ frame at this exact cursor?
People: beginning learners, desktop/tablet390px, inspect/rewind source, frame, alias and actual array writes.
Objects: values[30], one scratch[30] for merge, actual active/observed frames, scopes, aliases, scalar parameters and locals.
Data: accepted Rust P1 Step DSL only; current arrays/counters/output/memory all use the same AlgorithmPlayer cursor.
Separate execution frame from caller inspection and returned-frame notice. No ghost objects; virtual addresses are educational.
Independent page: input above code/observation workbench; pair: common input/controls above two stacked-responsive lanes.
Pair: exact same data in independent copies, real C++ twice, one Worker slot, one shared1000ms deadline, short side holds.
Keep existing visible writing borders, signed scales and source marks; no new decoration or global navigation.
QA: Chrome/minimal1440/768/390, actual merge at200 and paired merge/quick at100, real controls only.
No new learning/reward/storage authority; no challenge or snapshot integration; no redraw of established style.
`);
let s=fs.readFileSync('.artifacts/16.4/inspect-sorts.mjs','utf8');
const start=s.indexOf('    // QA setup only;'),end=s.indexOf('    const fold =',start);
s=s.slice(0,start)+`    // QA setup only; original skill probes and judgment rules remain unchanged.
    await page.eval(async () => {
      const wait=async(test)=>{const end=performance.now()+15000;while(!test()){if(performance.now()>end)throw Error('Actual recursive UI setup timed out');await new Promise(r=>setTimeout(r,50));}};
      const click=(name)=>[...document.querySelectorAll('button')].find(b=>b.textContent===name).click();
      await wait(()=>document.querySelector('[data-testid="sort-workspace"], [data-testid="recursive-comparison"]'));
      const pair=Boolean(document.querySelector('[data-testid="recursive-comparison"]'));
      if(pair){click('应用共同输入');await wait(()=>document.querySelector('[data-testid="recursive-comparison"]')?.getAttribute('data-phase')==='ready');click('运行两份C++');await wait(()=>document.querySelector('[data-testid="recursive-comparison"]')?.getAttribute('data-phase')==='settled');}
      else{click('运行C++案例');await wait(()=>document.querySelector('[data-testid="sort-workspace"]')?.getAttribute('data-state')==='ready');}
      const slider=document.querySelector(pair?'input[aria-label="C++对比统一步骤"]':'input[aria-label="C++排序执行步骤"]'),cursor=pair?'100':'200';
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,cursor);
      slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>document.querySelector(pair?'[data-testid="recursive-comparison"]':'[data-testid="sort-workspace"]')?.getAttribute('data-cursor')===cursor);
      window.scrollTo({top:0,behavior:'instant'});
    });
`+s.slice(end);
fs.writeFileSync('.artifacts/16.5/inspect-recursive.mjs',s);
s=fs.readFileSync('.artifacts/16.4/visual.mjs','utf8').replaceAll('16.4','16.5').replace('inspect-sorts.mjs','inspect-recursive.mjs').replace("'http://127.0.0.1:4178/#/algorithms/case.cpp.counting-sort'","'http://127.0.0.1:4178/#/'+(process.argv[3]??'algorithms/case.cpp.merge-sort')");
fs.writeFileSync('.artifacts/16.5/visual.mjs',s);
